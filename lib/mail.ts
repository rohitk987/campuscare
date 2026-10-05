import {env} from 'cloudflare:workers';
import {isPilotEmail,normaliseEmail} from './pilot';
import {verificationEmail} from './email-template';

const SEND_SCOPE='https://www.googleapis.com/auth/gmail.send';
type MailStage='configuration'|'token'|'token_validation'|'userinfo'|'sender_match'|'send'|'acceptance'|'resend';
const providerReasons=new Set(['invalid_grant','invalid_client','invalid_scope','access_denied','unauthorized_client',
 'accessNotConfigured','domainPolicy','authError','insufficientPermissions','failedPrecondition','invalidArgument',
 'quotaExceeded','rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','backendError','forbidden',
 'SERVICE_DISABLED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','PERMISSION_DENIED','FAILED_PRECONDITION','UNAUTHENTICATED',
 'RESOURCE_EXHAUSTED','INVALID_ARGUMENT','INTERNAL','UNAVAILABLE']);
class MailDeliveryError extends Error{
 constructor(readonly stage:MailStage,readonly status=0,readonly reason='unclassified'){super('Email delivery failed.');}
}
export function mailFailureDetails(error:unknown){
 return error instanceof MailDeliveryError?{stage:error.stage,status:error.status,reason:error.reason}:{stage:'delivery_db_or_runtime',status:0,reason:'unclassified'};
}
async function providerFailure(response:Response,stage:MailStage){
 let reason='unclassified';
 try{
  const body=await response.json() as {error?:unknown};
  if(typeof body?.error==='string'&&providerReasons.has(body.error))reason=body.error;
  else if(body?.error&&typeof body.error==='object'){
   const problem=body.error as {status?:unknown;message?:unknown;errors?:{reason?:unknown}[];details?:{reason?:unknown}[]};
   const candidates=[...(Array.isArray(problem.errors)?problem.errors.map(e=>e?.reason):[]),
    ...(Array.isArray(problem.details)?problem.details.map(e=>e?.reason):[]),problem.status];
   const known=candidates.find(value=>typeof value==='string'&&providerReasons.has(value));
   if(typeof known==='string')reason=known;
   if(typeof problem.message==='string'&&/mail service not enabled/i.test(problem.message))reason='mail_service_disabled';
  }
 }catch{/* Provider text is never copied into diagnostics. */}
 return new MailDeliveryError(stage,response.status,reason);
}
async function mailFetch(stage:MailStage,url:string,options:RequestInit){
 let response:Response;
 // workerd supports manual/follow only. Never follow a redirect with credentials.
 try{response=await fetch(url,{...options,redirect:'manual'});}catch(error){throw new MailDeliveryError(stage,0,error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'timeout':'network_error');}
 if(response.status>=300&&response.status<400)throw new MailDeliveryError(stage,response.status,'redirect_blocked');
 return response;
}
// Only a bare ASCII mailbox can enter a MIME header. Reject lists and header injection.
const mailbox=/^[a-z0-9.!#$%&'*+\/=\?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
function validMailbox(value:string){return mailbox.test(value)&&!value.includes('..');}
export function mailConfigured(){
 if(!env.OTP_HMAC_SECRET||env.OTP_HMAC_SECRET.length<32)return false;
 const provider=env.OTP_MAIL_PROVIDER||'resend';
 if(provider==='gmail')return !!env.GMAIL_CLIENT_ID?.endsWith('.apps.googleusercontent.com')&&
  !!env.GMAIL_CLIENT_SECRET?.trim()&&!!env.GMAIL_REFRESH_TOKEN?.trim()&&
  !!env.GMAIL_SENDER_EMAIL&&validMailbox(env.GMAIL_SENDER_EMAIL);
 return provider==='resend'&&!!env.RESEND_API_KEY&&!!env.OTP_FROM_EMAIL;
}
const base64=(text:string)=>btoa(Array.from(new TextEncoder().encode(text),byte=>String.fromCharCode(byte)).join(''));
const base64url=(text:string)=>base64(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const mimeBody=(text:string)=>base64(text).match(/.{1,76}/g)!.join('\r\n');
async function responseObject(response:Response,stage:MailStage):Promise<Record<string,unknown>>{
 let value:unknown;
 try{value=await response.json();}catch{throw new MailDeliveryError(stage,response.status,'invalid_json');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new MailDeliveryError(stage,response.status,'invalid_response');
 return value as Record<string,unknown>;
}

/** Server-only, fixed provider destinations. It sends exclusively to the checked BMSIT identity. */
export async function deliverVerificationCode(email:string,code:string,challengeId:string){
 email=normaliseEmail(email);
 if(!isPilotEmail(email)||!validMailbox(email)||!/^\d{6}$/.test(code)||!/^[-a-z0-9]{1,100}$/i.test(challengeId)||!mailConfigured())
  throw new MailDeliveryError('configuration');
 const {subject,text,html}=verificationEmail(code);
 if(env.OTP_MAIL_PROVIDER==='gmail'){
  const tokenResponse=await mailFetch('token','https://oauth2.googleapis.com/token',{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:env.GMAIL_CLIENT_ID!,client_secret:env.GMAIL_CLIENT_SECRET!,refresh_token:env.GMAIL_REFRESH_TOKEN!,grant_type:'refresh_token'}),
   signal:AbortSignal.timeout(15_000),
  });
  if(!tokenResponse.ok)throw await providerFailure(tokenResponse,'token');
  const token=await responseObject(tokenResponse,'token_validation');
  if(typeof token.access_token!=='string'||!token.access_token||typeof token.token_type!=='string'||token.token_type.toLowerCase()!=='bearer'||
   typeof token.scope!=='string'||!token.scope.split(' ').includes(SEND_SCOPE))
   throw new MailDeliveryError('token_validation',tokenResponse.status,'missing_send_permission');
  const identityResponse=await mailFetch('userinfo','https://openidconnect.googleapis.com/v1/userinfo',{
   headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15_000),
  });
  if(!identityResponse.ok)throw await providerFailure(identityResponse,'userinfo');
  const identity=await responseObject(identityResponse,'sender_match');
  if(identity.email_verified!==true||typeof identity.email!=='string'||
   normaliseEmail(identity.email)!==normaliseEmail(env.GMAIL_SENDER_EMAIL!))
   throw new MailDeliveryError('sender_match',identityResponse.status,'sender_not_verified_or_mismatch');
  const boundary='campuscare-'+crypto.randomUUID();
  const mime=[`From: CampusCare <${env.GMAIL_SENDER_EMAIL}>`,`To: <${email}>`,`Subject: ${subject}`,
   `Date: ${new Date().toUTCString()}`,`Message-ID: <${challengeId}@${env.GMAIL_SENDER_EMAIL!.split('@')[1]}>`,
   'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`,'',
   `--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',mimeBody(text),
   `--${boundary}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',mimeBody(html),
   `--${boundary}--`,''].join('\r\n');
  const response=await mailFetch('send','https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
   method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},
   body:JSON.stringify({raw:base64url(mime)}),signal:AbortSignal.timeout(20_000),
  });
  if(!response.ok)throw await providerFailure(response,'send');
  const result=await responseObject(response,'acceptance');
  if(typeof result.id!=='string'||!result.id)throw new MailDeliveryError('acceptance',response.status,'missing_message_id');
  // Provider acceptance is not proof of receipt in the student's inbox.
  return {provider:'gmail' as const,messageId:result.id};
 }
 const response=await mailFetch('resend','https://api.resend.com/emails',{
  method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'campuscare-otp/'+challengeId},
  body:JSON.stringify({from:env.OTP_FROM_EMAIL,to:[email],subject,text,html}),signal:AbortSignal.timeout(20_000),
 });
 if(!response.ok)throw await providerFailure(response,'resend');
 const result=await responseObject(response,'acceptance');
 if(typeof result.id!=='string'||!result.id)throw new MailDeliveryError('acceptance',response.status,'missing_message_id');
 return {provider:'resend' as const,messageId:result.id};
}
