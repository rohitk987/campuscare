import {env} from 'cloudflare:workers';
import type {CampusUser} from './account';
import {withinScope} from './domain';
import {PILOT_ORG_ID,PILOT_ORG_NAME,PILOT_ACCESS_MESSAGE,isPilotEmail,normaliseEmail} from './pilot';
import {requireVerifiedAccess,getVerifiedIdentity} from './access';
import type {Complaint,Member} from './models';

export const uid=()=>crypto.randomUUID();
export class HttpError extends Error{constructor(public status:number,message:string,public code?:'ACCESS_DENIED'|'EMAIL_VERIFICATION_REQUIRED'){super(message)}}
export const db=()=>{if(!env.DB)throw new HttpError(503,'Saved data is temporarily unavailable. Please retry.');return env.DB;};
export const bucket=()=>{if(!env.BUCKET)throw new HttpError(503,'Photo storage is temporarily unavailable. Please retry.');return env.BUCKET;};
export const stmt=(sql:string,...params:unknown[])=>db().prepare(sql).bind(...params);
export function insert(table:string,values:Record<string,unknown>){const keys=Object.keys(values);return stmt(`INSERT INTO ${table} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,...keys.map(k=>values[k]));}
export async function all<T=Record<string,unknown>>(sql:string,...params:unknown[]):Promise<T[]>{return (await stmt(sql,...params).all<T>()).results;}
export async function one<T=Record<string,unknown>>(sql:string,...params:unknown[]):Promise<T|null>{return await stmt(sql,...params).first<T>();}
export async function authenticatedIdentity():Promise<CampusUser>{
 const user=await getVerifiedIdentity();
 if(!user)throw new HttpError(401,'Sign in with your BMSIT email and verification code to access CampusCare.');
 if(!isPilotEmail(user.email))throw new HttpError(403,PILOT_ACCESS_MESSAGE,'ACCESS_DENIED');
 const email=normaliseEmail(user.email);
 if(await one<{id:string}>('SELECT id FROM members WHERE org_id=? AND active=0 AND (user_id=? OR email=?)',PILOT_ORG_ID,user.userId,email))throw new HttpError(403,'Your BMSIT account has been deactivated. Contact the administrator.','ACCESS_DENIED');
 if(await one<{id:string}>('SELECT id FROM members WHERE org_id=? AND email=? AND user_id IS NOT NULL AND user_id<>?',PILOT_ORG_ID,email,user.userId))throw new HttpError(403,'This BMSIT email is already linked to another account. Contact the administrator.','ACCESS_DENIED');
 return user;
}
export async function identity():Promise<CampusUser>{const user=await authenticatedIdentity();await requireVerifiedAccess(user);return user;}
export async function membership(orgId:string){
 const user=await identity();
 if(orgId!==PILOT_ORG_ID)throw new HttpError(403,'Only the BMSIT workspace is available during this pilot.','ACCESS_DENIED');
 const member=await one<Member>('SELECT * FROM members WHERE org_id=? AND user_id=? AND email=? AND active=1',orgId,user.userId,normaliseEmail(user.email));
 if(!member)throw new HttpError(403,'Your BMSIT membership is unavailable or has been deactivated. Contact the BMSIT administrator.','ACCESS_DENIED');
 return {user,member};
}
export async function initialisePilot(user:Awaited<ReturnType<typeof identity>>){
 if(!isPilotEmail(user.email))throw new HttpError(403,PILOT_ACCESS_MESSAGE);
 await requireVerifiedAccess(user);
 const email=normaliseEmail(user.email),configuredAdmin=normaliseEmail(env.BMSIT_ADMIN_EMAIL||'');
 if(configuredAdmin&&!isPilotEmail(configuredAdmin))throw new HttpError(503,'The BMSIT administrator configuration needs attention.');
 // Seed records, never schema. The stable ID and unique email constraint make first sign-ins idempotent.
 await stmt('INSERT INTO organisations (id,name,type,creator,created_at,identifier_label) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',PILOT_ORG_ID,PILOT_ORG_NAME,'College','bmsit-pilot-setup',Date.now(),'USN').run();
 if(configuredAdmin)await stmt('INSERT INTO members (id,org_id,email,name,role) VALUES (?,?,?,?,?) ON CONFLICT(org_id,email) DO NOTHING',uid(),PILOT_ORG_ID,configuredAdmin,'BMSIT administrator','admin').run();
 await stmt('INSERT INTO members (id,org_id,user_id,email,name,role) VALUES (?,?,?,?,?,?) ON CONFLICT(org_id,email) DO NOTHING',uid(),PILOT_ORG_ID,user.userId,email,user.fullName||user.displayName,'reporter').run();
 // Never reactivate a suspended member, change a role, or transfer an already-bound identity.
 await stmt('UPDATE members SET user_id=?,name=? WHERE org_id=? AND email=? AND user_id IS NULL AND active=1',user.userId,user.fullName||user.displayName,PILOT_ORG_ID,email).run();
 return membership(PILOT_ORG_ID);
}
export function admin(member:Member){if(member.role!=='admin')throw new HttpError(403,'An organisation administrator is required.');}
export function siteAccess(member:Member,siteId:string){if(!withinScope(member,siteId))throw new HttpError(403,'This site is not in your assigned access scope.');}
export function mutateRequest(request:Request){const origin=request.headers.get('origin'),host=new URL(request.url).host;if(origin&&new URL(origin).host!==host)throw new HttpError(403,'Cross-site requests are not allowed.');if(request.headers.get('x-campuscare-request')!=='1')throw new HttpError(403,'Invalid request.');}
export function safeError(error:unknown){if(error instanceof HttpError)return Response.json({error:error.message,...(error.code?{code:error.code}:{})},{status:error.status,headers:{'Cache-Control':'no-store'}});console.error('CampusCare request failed',error instanceof Error?error.message:'Unknown error');return Response.json({error:'We could not complete this request. Your changes were not confirmed; please retry.'},{status:500});}
export async function ticketAccess(orgId:string,id:string){
 const {user,member}=await membership(orgId);
 const ticket=await one<Complaint>('SELECT c.*, l.name room,l.floor,b.name building,s.name site FROM complaints c JOIN locations l ON l.id=c.location_id AND l.org_id=c.org_id JOIN buildings b ON b.id=l.building_id AND b.org_id=l.org_id JOIN sites s ON s.id=c.site_id AND s.org_id=c.org_id WHERE c.id=? AND c.org_id=?',id,orgId);
 if(!ticket)throw new HttpError(404,'Complaint not found.');
 siteAccess(member,ticket.site_id);
 const own=ticket.reporter_id===user.userId,full=own||['admin','verifier'].includes(member.role)||(member.role==='technician'&&ticket.assignee_id===member.id);
 if(!full&&ticket.visibility!=='shared')throw new HttpError(404,'Complaint not found.');
 return {user,member,t:ticket,own,full};
}
