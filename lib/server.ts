import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {withinScope} from './domain';
export const uid=()=>crypto.randomUUID();
export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export const db=()=>{if(!env.DB)throw new HttpError(503,'Saved data is temporarily unavailable. Please retry.');return env.DB;};
export const bucket=()=>{if(!env.BUCKET)throw new HttpError(503,'Photo storage is temporarily unavailable. Please retry.');return env.BUCKET;};
export const stmt=(sql:string,...params:any[])=>db().prepare(sql).bind(...params);
export function insert(table:string,values:Record<string,any>){const keys=Object.keys(values);return stmt(`INSERT INTO ${table} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,...keys.map(k=>values[k]));}
export async function all(sql:string,...params:any[]){return (await stmt(sql,...params).all()).results as any[];}
export async function one(sql:string,...params:any[]){return await stmt(sql,...params).first() as any;}
export async function identity(){const u=await getChatGPTUser();if(!u)throw new HttpError(401,'Sign in to access your workspaces.');return u;}
export async function membership(orgId:string){const user=await identity();const member=await one('SELECT * FROM members WHERE org_id=? AND user_id=? AND active=1',orgId,user.userId);if(!member)throw new HttpError(403,'You do not have access to this workspace.');return {user,member};}
export function admin(m:any){if(m.role!=='admin')throw new HttpError(403,'An organisation administrator is required.');}
export function siteAccess(m:any,siteId:string){if(!withinScope(m,siteId))throw new HttpError(403,'This site is not in your assigned access scope.');}
export function mutateRequest(request:Request){const origin=request.headers.get('origin'),host=new URL(request.url).host;if(origin&&new URL(origin).host!==host)throw new HttpError(403,'Cross-site requests are not allowed.');if(request.headers.get('x-sitecare-request')!=='1')throw new HttpError(403,'Invalid request.');}
export function safeError(e:unknown){if(e instanceof HttpError)return Response.json({error:e.message},{status:e.status,headers:{'Cache-Control':'no-store'}});console.error('SiteCare request failed',e instanceof Error?e.message:'Unknown error');return Response.json({error:'We could not complete this request. Your changes were not confirmed; please retry.'},{status:500});}
export async function ticketAccess(orgId:string,id:string){const {user,member}=await membership(orgId);const t=await one('SELECT c.*, l.name room,l.floor,b.name building,s.name site FROM complaints c JOIN locations l ON l.id=c.location_id AND l.org_id=c.org_id JOIN buildings b ON b.id=l.building_id AND b.org_id=c.org_id JOIN sites s ON s.id=c.site_id AND s.org_id=c.org_id WHERE c.id=? AND c.org_id=?',id,orgId);if(!t)throw new HttpError(404,'Complaint not found.');siteAccess(member,t.site_id);const own=t.reporter_id===user.userId;const full=own||['admin','verifier'].includes(member.role)||(member.role==='technician'&&t.assignee_id===member.id);if(!full&&t.visibility!=='shared')throw new HttpError(404,'Complaint not found.');return {user,member,t,own,full};}
