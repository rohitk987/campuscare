import {env} from 'cloudflare:workers';
import {headers} from 'next/headers';
import type {CampusUser} from './account';
import {db,stmt,one,HttpError,uid} from './server';
import {PILOT_ORG_ID,isPilotEmail,normaliseEmail} from './pilot';
import {deliverVerificationCode,mailFailureDetails} from './mail';
import {mailConfigured} from './mail';
import type {Member} from './models';
export {mailConfigured} from './mail';

export const VERIFICATION_COOKIE='__Host-campuscare-session';
const LOGIN_CHALLENGE_PREFIX='login-';
const CODE_TTL=5*60_000, SESSION_TTL=8*60*60_000;
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
async function digest(value:string){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
async function codeHash(id:string,user:CampusUser,code:string){
 if(!env.OTP_HMAC_SECRET||env.OTP_HMAC_SECRET.length<32)throw new HttpError(503,'Email verification is not configured yet. Contact the CampusCare administrator.');
 const key=await crypto.subtle.importKey('raw',encoder.encode(env.OTP_HMAC_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(JSON.stringify(['campuscare-email-login-v1',id,user.userId,normaliseEmail(user.email),code]))));
}
function cookieValue(value:string){return value.split(';').map(part=>part.trim()).find(part=>part.startsWith(VERIFICATION_COOKIE+'='))?.slice(VERIFICATION_COOKIE.length+1)||'';}
async function currentToken(){return cookieValue((await headers()).get('cookie')||'');}
export async function loginIdentity(value:string):Promise<CampusUser>{
 const email=normaliseEmail(value);
 if(!isPilotEmail(email))throw new HttpError(403,'Use your official @bmsit.in or @bmsit.ac.in email.','ACCESS_DENIED');
 const member=await one<{user_id:string|null;name:string}>('SELECT user_id,name FROM members WHERE org_id=? AND email=?',PILOT_ORG_ID,email);
 const student=await one<{name:string}>('SELECT name FROM student_records WHERE org_id=? AND email=?',PILOT_ORG_ID,email);
 // Existing IDs own complaints and updates. New accounts use a stable server-derived ID.
 const userId=member?.user_id||'campuscare:'+await digest(email),name=student?.name||member?.name||email;
 const user={userId,email,displayName:name,fullName:name};
 await assertEligibility(user);return user;
}
export async function getVerifiedIdentity():Promise<CampusUser|null>{
 const token=await currentToken();if(!/^[a-f0-9]{64}$/.test(token))return null;
 const session=await one<{user_id:string;email:string}>("SELECT user_id,email FROM otp_sessions WHERE token_hash=? AND expires_at>? AND challenge_id LIKE 'login-%'",await digest(token),Date.now());
 if(!session)return null;
 const member=await one<{name:string}>('SELECT name FROM members WHERE org_id=? AND email=? AND user_id=?',PILOT_ORG_ID,session.email,session.user_id);
 const student=await one<{name:string}>('SELECT name FROM student_records WHERE org_id=? AND email=?',PILOT_ORG_ID,session.email);
 const name=student?.name||member?.name||session.email;
 return {userId:session.user_id,email:session.email,displayName:name,fullName:name};
}
export async function assertEligibility(user:CampusUser){
 const email=normaliseEmail(user.email),now=Date.now();
 if(!isPilotEmail(email))throw new HttpError(403,'Use your official BMSIT email.','ACCESS_DENIED');
 const member=await one<Member>('SELECT * FROM members WHERE org_id=? AND email=?',PILOT_ORG_ID,email);
 if(member&&(!member.active||member.user_id&&member.user_id!==user.userId))throw new HttpError(403,'Your BMSIT account is unavailable. Contact the administrator.','ACCESS_DENIED');
 const student=await one<{status:string;cohort_active:number;starts_at:number;ends_at:number}>('SELECT s.*,c.active cohort_active,c.starts_at,c.ends_at FROM student_records s JOIN cohorts c ON c.id=s.cohort_id AND c.org_id=s.org_id WHERE s.org_id=? AND s.email=?',PILOT_ORG_ID,email);
 if(student){
  if(student.status!=='active'||!student.cohort_active||now<student.starts_at||now>=student.ends_at)throw new HttpError(403,'Student access has ended or is inactive. Contact the BMSIT administrator.','ACCESS_DENIED');
  return;
 }
 // The designated setup administrator and explicitly approved staff can manage the pilot.
 // A student record, when present, takes precedence even for a privileged member.
 if(email===normaliseEmail(env.BMSIT_ADMIN_EMAIL||'')||member&&['admin','verifier','technician'].includes(member.role))return;
 throw new HttpError(403,'Your email is not on the approved current-student list. Ask the BMSIT administrator to check your student record and batch.','ACCESS_DENIED');
}
export async function hasVerifiedSession(user:CampusUser){
 const token=await currentToken();if(!/^[a-f0-9]{64}$/.test(token))return false;
 return !!await one("SELECT token_hash FROM otp_sessions WHERE token_hash=? AND user_id=? AND email=? AND expires_at>? AND challenge_id LIKE 'login-%'",await digest(token),user.userId,normaliseEmail(user.email),Date.now());
}
export async function verificationChallenge(user:CampusUser){
 const row=await one<{challenge_id:string;expires_at:number;last_sent_at:number;attempts:number;delivery:string;consumed_at:number|null}>("SELECT challenge_id,expires_at,last_sent_at,attempts,delivery,consumed_at FROM otp_challenges WHERE user_id=? AND email=?",user.userId,normaliseEmail(user.email));
 if(!row||row.delivery!=='sent'||row.consumed_at!==null)return null;
 return {challengeId:row.challenge_id,expiresAt:row.attempts>=5?0:row.expires_at,resendAt:row.last_sent_at+60_000};
}
export async function requireVerifiedAccess(user:CampusUser){
 await assertEligibility(user);
 if(!await hasVerifiedSession(user))throw new HttpError(428,'Verify your BMSIT email with the code sent to your mailbox before accessing CampusCare.','EMAIL_VERIFICATION_REQUIRED');
}
export async function sendVerificationCode(user:CampusUser){
 await assertEligibility(user);
 if(!mailConfigured())throw new HttpError(503,'Email verification is not configured yet. Contact the CampusCare administrator.');
 const now=Date.now(),id=LOGIN_CHALLENGE_PREFIX+uid();let number:number;
 do{number=crypto.getRandomValues(new Uint32Array(1))[0];}while(number>=4_294_000_000);
 const code=(number%1_000_000).toString().padStart(6,'0'),hash=await codeHash(id,user,code),email=normaliseEmail(user.email);
 const reserved=await one<{challenge_id:string}>(`INSERT INTO otp_challenges (user_id,email,challenge_id,code_hash,expires_at,last_sent_at,window_started_at,send_count) VALUES (?,?,?,?,?,?,?,1)
 ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,challenge_id=excluded.challenge_id,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,consumed_at=NULL,attempt_marker=NULL,delivery='pending',last_sent_at=excluded.last_sent_at,
 window_started_at=CASE WHEN otp_challenges.window_started_at<=? THEN excluded.window_started_at ELSE otp_challenges.window_started_at END,
 send_count=CASE WHEN otp_challenges.window_started_at<=? THEN 1 ELSE otp_challenges.send_count+1 END
 WHERE otp_challenges.last_sent_at<=? AND (otp_challenges.window_started_at<=? OR otp_challenges.send_count<5) RETURNING challenge_id`,user.userId,email,id,hash,now+CODE_TTL,now,now,now-3_600_000,now-3_600_000,now-60_000,now-3_600_000);
 if(!reserved)throw new HttpError(429,'Wait at least one minute between codes. A maximum of five codes can be sent per hour.');
 let providerAccepted=false;
 try{
  await deliverVerificationCode(email,code,id);
  providerAccepted=true;
  await stmt("UPDATE otp_challenges SET delivery='sent' WHERE user_id=? AND challenge_id=?",user.userId,id).run();
 }catch(error){
  console.error('CampusCare email delivery failed',providerAccepted?{stage:'delivery_db',status:0,reason:'update_failed'}:mailFailureDetails(error));
  await stmt("UPDATE otp_challenges SET delivery='failed',code_hash='',expires_at=0 WHERE user_id=? AND challenge_id=?",user.userId,id).run();
  throw new HttpError(503,'The verification email could not be sent. Please retry later or contact the administrator.');
 }
 return {email,challengeId:id,expiresAt:now+CODE_TTL,resendAt:now+60_000};
}
export async function verifyCode(user:CampusUser,id:string,code:string){
 await assertEligibility(user);
 if(!/^[0-9]{6}$/.test(code)||!id.startsWith(LOGIN_CHALLENGE_PREFIX)||id.length>100)throw new HttpError(400,'Enter the six-digit code from your latest verification email.');
 const now=Date.now(),hash=await codeHash(id,user,code),marker=uid(),token=hex(crypto.getRandomValues(new Uint8Array(32)).buffer),tokenHash=await digest(token);
 const result=await db().batch([
  stmt("UPDATE otp_challenges SET attempts=attempts+1,attempt_marker=? WHERE user_id=? AND email=? AND challenge_id=? AND delivery='sent' AND expires_at>? AND attempts<5 AND consumed_at IS NULL",marker,user.userId,normaliseEmail(user.email),id,now),
  stmt('INSERT INTO otp_sessions (token_hash,user_id,email,challenge_id,created_at,expires_at) SELECT ?,user_id,email,challenge_id,?,? FROM otp_challenges WHERE user_id=? AND challenge_id=? AND attempt_marker=? AND code_hash=? AND consumed_at IS NULL AND expires_at>?',tokenHash,now,now+SESSION_TTL,user.userId,id,marker,hash,now),
  stmt('UPDATE otp_challenges SET consumed_at=? WHERE user_id=? AND challenge_id=? AND attempt_marker=? AND EXISTS (SELECT 1 FROM otp_sessions WHERE token_hash=?)',now,user.userId,id,marker,tokenHash),
 ]);
 if(!result[1].meta.changes)throw new HttpError(400,'This code is incorrect, expired or already used. Request a new code after five unsuccessful attempts.');
 return `${VERIFICATION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL/1000}; HttpOnly; Secure; SameSite=Lax`;
}
export async function clearVerification(){
 const token=await currentToken();if(/^[a-f0-9]{64}$/.test(token))await stmt('DELETE FROM otp_sessions WHERE token_hash=?',await digest(token)).run();
 return `${VERIFICATION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
