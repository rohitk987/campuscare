import {env} from 'cloudflare:workers';
import {isPilotEmail,normaliseEmail} from './pilot';

const SEND_SCOPE='https://www.googleapis.com/auth/gmail.send';
const subject='Your CampusCare BMSIT verification code';
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
const base64url=(text:string)=>btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function responseObject(response:Response):Promise<Record<string,unknown>>{
 const value:unknown=await response.json();
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Email service returned an invalid response.');
 return value as Record<string,unknown>;
}

/** Server-only, fixed provider destinations. It sends exclusively to the checked BMSIT identity. */
export async function deliverVerificationCode(email:string,code:string,challengeId:string){
 email=normaliseEmail(email);
 if(!isPilotEmail(email)||!validMailbox(email)||!/^\d{6}$/.test(code)||!/^[-a-z0-9]{1,100}$/i.test(challengeId)||!mailConfigured())
  throw new Error('Email verification is not configured or its inputs are invalid.');
 const text=`Your CampusCare verification code is ${code}. It expires in 5 minutes. Do not share this code. If you did not request it, ignore this email.`;
 if(env.OTP_MAIL_PROVIDER==='gmail'){
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:env.GMAIL_CLIENT_ID!,client_secret:env.GMAIL_CLIENT_SECRET!,refresh_token:env.GMAIL_REFRESH_TOKEN!,grant_type:'refresh_token'}),
   signal:AbortSignal.timeout(15_000),redirect:'error',
  });
  if(!tokenResponse.ok)throw new Error('Gmail sender authorization is unavailable.');
  const token=await responseObject(tokenResponse);
  if(typeof token.access_token!=='string'||!token.access_token||typeof token.token_type!=='string'||token.token_type.toLowerCase()!=='bearer'||
   typeof token.scope!=='string'||!token.scope.split(' ').includes(SEND_SCOPE))
   throw new Error('Gmail sending permission is unavailable.');
  const identityResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{
   headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15_000),redirect:'error',
  });
  if(!identityResponse.ok)throw new Error('Gmail sender identity is unavailable.');
  const identity=await responseObject(identityResponse);
  if(identity.email_verified!==true||typeof identity.email!=='string'||
   normaliseEmail(identity.email)!==normaliseEmail(env.GMAIL_SENDER_EMAIL!))
   throw new Error('Gmail authorization belongs to another sender.');
  const mime=[`From: CampusCare <${env.GMAIL_SENDER_EMAIL}>`,`To: <${email}>`,`Subject: ${subject}`,
   `Date: ${new Date().toUTCString()}`,`Message-ID: <${challengeId}@${env.GMAIL_SENDER_EMAIL!.split('@')[1]}>`,
   'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 7bit','',text].join('\r\n');
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
   method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},
   body:JSON.stringify({raw:base64url(mime)}),signal:AbortSignal.timeout(20_000),redirect:'error',
  });
  if(!response.ok)throw new Error('Gmail rejected the verification email.');
  const result=await responseObject(response);
  if(typeof result.id!=='string'||!result.id)throw new Error('Gmail did not confirm message acceptance.');
  // Provider acceptance is not proof of receipt in the student's inbox.
  return {provider:'gmail' as const,messageId:result.id};
 }
 const response=await fetch('https://api.resend.com/emails',{
  method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'campuscare-otp/'+challengeId},
  body:JSON.stringify({from:env.OTP_FROM_EMAIL,to:[email],subject,text}),signal:AbortSignal.timeout(20_000),redirect:'error',
 });
 if(!response.ok)throw new Error('Email service rejected delivery.');
 const result=await responseObject(response);
 if(typeof result.id!=='string'||!result.id)throw new Error('Email service did not confirm message acceptance.');
 return {provider:'resend' as const,messageId:result.id};
}
