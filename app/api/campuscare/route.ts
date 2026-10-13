import {z} from 'zod';
import {all,one,stmt,db,bucket,uid,identity,membership,initialisePilot,admin,siteAccess,ticketAccess,mutateRequest,safeError,HttpError,insert} from '@/lib/server';
import {categories,checkPosition,buildingCandidates,withinScope,transition} from '@/lib/domain';
import {PILOT_ORG_ID,PILOT_ORG_NAME,PILOT_DOMAINS,PILOT_ACCESS_MESSAGE,isPilotEmail,normaliseEmail} from '@/lib/pilot';
import {visibleComplaints} from '@/lib/complaints';
import type {CampusUser} from '@/lib/account';
import type {Building,Complaint,DetailEvent,Location,Member,Notification,Organisation,Site} from '@/lib/models';
import type {Position} from '@/lib/domain';
type ReportLocation=Location&{site_id:string;latitude:number|null;longitude:number|null;radius:number};
type ReportSessionRow={id:string;site_id:string;consumed:number;expires_at:number;image_key:string|null;location_id:string|null;latitude:number|null;longitude:number|null;accuracy:number|null;captured_at:number|null;received_at:number|null};
type EvidenceRow={latitude:number|null;longitude:number|null;accuracy:number|null;captured_at:number|null;received_at:number|null;image_key?:string|null;available?:boolean};
export const dynamic='force-dynamic';
const text=z.string().trim().min(1).max(200),id=text,position=z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),accuracy:z.number().positive(),timestamp:z.number()});
const json=(value:unknown)=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
function parse<S extends z.ZodTypeAny>(schema:S,value:unknown):z.output<S>{const result=schema.safeParse(value);if(!result.success)throw new HttpError(400,result.error.issues.map(issue=>issue.path.join('.')+': '+issue.message).join('; '));return result.data;}
async function siteFor(orgId:string,siteId:string,member:Member){siteAccess(member,siteId);const site=await one<Site>('SELECT * FROM sites WHERE id=? AND org_id=?',siteId,orgId);if(!site)throw new HttpError(404,'Site not found.');return site;}
async function locationFor(orgId:string,locationId:string,siteId?:string){const location=await one<ReportLocation>('SELECT l.*,b.site_id,b.latitude,b.longitude,b.radius,b.name building FROM locations l JOIN buildings b ON b.id=l.building_id AND b.org_id=l.org_id WHERE l.id=? AND l.org_id=?',locationId,orgId);if(!location||siteId&&location.site_id!==siteId)throw new HttpError(400,'Select a valid room or area within this site.');return location;}
async function check(orgId:string,member:Member,siteId:string,p:Position){const site=await siteFor(orgId,siteId,member);const org=await one<Pick<Organisation,'max_accuracy'>>('SELECT max_accuracy FROM organisations WHERE id=?',orgId);if(!org)throw new HttpError(404,'Organisation not found.');try{checkPosition(p,site,org.max_accuracy);}catch(e){throw new HttpError(422,(e as Error).message);}const buildings=await all<Building>('SELECT * FROM buildings WHERE org_id=? AND site_id=?',orgId,siteId);return buildingCandidates(p,buildings);}
function redact(t:Complaint,user:CampusUser,m:Member){const full=t.reporter_id===user.userId||['admin','verifier'].includes(m.role)||(m.role==='technician'&&t.assignee_id===m.id);return {...t,reporter_name:full?t.reporter_name:'Community member',reporter_id:full?t.reporter_id:undefined,description:full?t.description:'Shared facility issue. Detailed evidence is available to the reporter and authorised staff.',can_view_evidence:full,own:t.reporter_id===user.userId};}
export async function GET(request:Request){try{
 const url=new URL(request.url),op=url.searchParams.get('op')||'bootstrap';const user=await identity();
 if(op==='bootstrap'){
  const known=await one<{active:number;user_id:string|null}>('SELECT active,user_id FROM members WHERE org_id=? AND email=?',PILOT_ORG_ID,user.email.trim().toLowerCase());
  if(known&&(!known.active||known.user_id&&known.user_id!==user.userId))throw new HttpError(403,'Your BMSIT membership is unavailable or has been deactivated. Contact the BMSIT administrator.');
  const organisations=await all('SELECT o.*,m.id member_id,m.role,m.site_scope FROM organisations o JOIN members m ON m.org_id=o.id WHERE o.id=? AND m.user_id=? AND m.email=? AND m.active=1',PILOT_ORG_ID,user.userId,user.email.trim().toLowerCase());
  return json({user:{id:user.userId,name:user.fullName||user.displayName,email:user.email},organisations,pilot:{organisationId:PILOT_ORG_ID,domains:PILOT_DOMAINS}});
 }
 const orgId=url.searchParams.get('org')||'',{member}=await membership(orgId);
 if(op==='workspace'){
  const sites=(await all<Site>('SELECT * FROM sites WHERE org_id=?',orgId)).filter(s=>withinScope(member,s.id));const siteIds=new Set(sites.map(s=>s.id));
  const buildings=(await all<Building>('SELECT * FROM buildings WHERE org_id=?',orgId)).filter(b=>siteIds.has(b.site_id));const buildingIds=new Set(buildings.map(b=>b.id));
  const locations=(await all<Location>('SELECT * FROM locations WHERE org_id=?',orgId)).filter(l=>buildingIds.has(l.building_id));
  const tickets=(await visibleComplaints(orgId,{userId:user.userId,role:member.role,memberId:member.id,siteIds:[...siteIds]})).map(t=>redact(t,user,member));
  const members=member.role==='admin'?await all<Member>('SELECT id,org_id,name,email,role,site_scope,active,user_id FROM members WHERE org_id=? ORDER BY name',orgId):[];
  const notifications=await all<Notification>('SELECT * FROM notifications WHERE org_id=? AND user_id=? ORDER BY created_at DESC LIMIT 30',orgId,user.userId);
  const following=(await all<{complaint_id:string}>('SELECT complaint_id FROM followers WHERE org_id=? AND user_id=?',orgId,user.userId)).map(f=>f.complaint_id);
  return json({sites,buildings,locations,tickets,members,member,notifications,following,categories,accessIdentity:{id:user.userId,email:normaliseEmail(user.email)}});
 }
 if(op==='detail'){
  const {t,full,own}=await ticketAccess(orgId,url.searchParams.get('id')||'');const events=full?await all<DetailEvent>('SELECT * FROM events WHERE org_id=? AND complaint_id=? ORDER BY created_at',orgId,t.id):[];
  const evidence=full&&t.session_id?await one<EvidenceRow>('SELECT latitude,longitude,accuracy,captured_at,received_at,image_key FROM report_sessions WHERE id=? AND org_id=?',t.session_id,orgId):null;
  if(evidence){evidence.available=!!evidence.image_key;delete evidence.image_key;}return json({ticket:redact(t,user,member),events:events.map(e=>t.demo&&e.action==='sample'?{...e,actor:'CampusCare demo'}:e),evidence,own});
 }
 if(op==='photo'){
  const {t,full}=await ticketAccess(orgId,url.searchParams.get('id')||'');if(!full)throw new HttpError(403,'You cannot access this evidence.');const s=await one<{image_key:string|null}>('SELECT image_key FROM report_sessions WHERE id=? AND org_id=?',t.session_id||'',orgId);if(!s?.image_key)throw new HttpError(404,'No photo is attached.');const object=await bucket().get(s.image_key);if(!object)throw new HttpError(404,'Photo unavailable.');return new Response(object.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
 }
 throw new HttpError(404,'Unknown request.');
 }catch(e){return safeError(e);}}
export async function POST(request:Request){try{
 mutateRequest(request);const user=await identity();const url=new URL(request.url);
 if(url.searchParams.get('op')==='photo'){
  const length=Number(request.headers.get('content-length')||0);if(length>6*1024*1024)throw new HttpError(413,'Photo must be smaller than 5 MB.');
  const form=await request.formData();const orgId=String(form.get('orgId')||''),sessionId=String(form.get('sessionId')||''),locationId=String(form.get('locationId')||'');const {member}=await membership(orgId);
  const s=await one<ReportSessionRow>('SELECT * FROM report_sessions WHERE id=? AND org_id=? AND user_id=?',sessionId,orgId,user.userId);if(!s||s.consumed||s.expires_at<Date.now())throw new HttpError(409,'Your reporting session expired. Start a new report.');
  let raw;try{raw=JSON.parse(String(form.get('position')));}catch{throw new HttpError(400,'Invalid location data.');}const p=parse(position,raw),candidates=await check(orgId,member,s.site_id,p);const l=await locationFor(orgId,locationId,s.site_id);if(!candidates.some(b=>b.id===l.building_id))throw new HttpError(422,'This photo location does not support the selected building. Recheck your location.');
  const file=form.get('photo');if(!(file instanceof File)||file.size<100||file.size>5*1024*1024)throw new HttpError(400,'Capture a JPEG photo smaller than 5 MB.');const bytes=new Uint8Array(await file.arrayBuffer());if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw new HttpError(400,'The captured photo is not a valid JPEG.');
  const key=`${orgId}/${sessionId}/${uid()}.jpg`,now=Date.now();await bucket().put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
  const result=await stmt('UPDATE report_sessions SET image_key=?,location_id=?,latitude=?,longitude=?,accuracy=?,captured_at=?,received_at=? WHERE id=? AND org_id=? AND user_id=? AND consumed=0 AND expires_at>?',key,locationId,p.latitude,p.longitude,p.accuracy,p.timestamp,now,sessionId,orgId,user.userId,now).run();if(!result.meta.changes){await bucket().delete(key);throw new HttpError(409,'Capture session is no longer available.');}if(s.image_key)await bucket().delete(s.image_key);
  return json({saved:true,receivedAt:now,accuracy:p.accuracy});
 }
 let body:unknown;try{body=await request.json();}catch{throw new HttpError(400,'Invalid request data.');}const data=parse(z.object({action:z.string().min(1).max(100)}).passthrough(),body),action=data.action;
 if(action==='initialise'){
  if(data.demo)throw new HttpError(403,'Demo workspaces are disabled during the BMSIT pilot.');
  await initialisePilot(user);return json({ok:true});
 }
 if(action==='create_org'){
  throw new HttpError(403,'New organisations are disabled. CampusCare is running the BMSIT pilot only.');
 }
 const orgId=parse(id,data.orgId),{member}=await membership(orgId);
 if(action==='save_settings'){
  admin(member);const d=parse(z.object({name:text,color:z.string().regex(/^#[0-9a-fA-F]{6}$/),max_accuracy:z.number().min(5).max(100),response_hours:z.number().min(1).max(720),emergency_contact:text,identifier_label:text}),data);
  if(d.name!==PILOT_ORG_NAME)throw new HttpError(400,'The pilot organisation name is fixed to BMSIT.');
  await stmt('UPDATE organisations SET name=?,color=?,max_accuracy=?,response_hours=?,emergency_contact=?,identifier_label=? WHERE id=?',d.name,d.color,d.max_accuracy,d.response_hours,d.emergency_contact,d.identifier_label,orgId).run();return json({ok:true});
 }
 if(action==='save_site'){
  admin(member);const d=parse(z.object({id:z.string().optional(),name:text,latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),radius:z.number().min(10).max(5000),enabled:z.boolean()}),data);
  if(d.id){const s=await siteFor(orgId,d.id,member);await stmt('UPDATE sites SET name=?,latitude=?,longitude=?,radius=?,enabled=? WHERE id=? AND org_id=?',d.name,d.latitude,d.longitude,d.radius,d.enabled?1:0,s.id,orgId).run();}else await insert('sites',{id:uid(),org_id:orgId,name:d.name,latitude:d.latitude,longitude:d.longitude,radius:d.radius,enabled:d.enabled?1:0}).run();return json({ok:true});
 }
 if(action==='save_building'){
  admin(member);const d=parse(z.object({id:z.string().optional(),siteId:id,name:text,latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),radius:z.number().min(5).max(1000)}),data);await siteFor(orgId,d.siteId,member);
  if(d.id){const b=await one<{id:string}>('SELECT id FROM buildings WHERE id=? AND org_id=? AND site_id=?',d.id,orgId,d.siteId);if(!b)throw new HttpError(404,'Building not found.');await stmt('UPDATE buildings SET name=?,latitude=?,longitude=?,radius=? WHERE id=? AND org_id=?',d.name,d.latitude,d.longitude,d.radius,d.id,orgId).run();}else await insert('buildings',{id:uid(),org_id:orgId,site_id:d.siteId,name:d.name,latitude:d.latitude,longitude:d.longitude,radius:d.radius}).run();return json({ok:true});
 }
 if(action==='add_location'){
  admin(member);const d=parse(z.object({buildingId:id,floor:text,name:text,private:z.boolean()}),data);const b=await one<{id:string}>('SELECT id FROM buildings WHERE org_id=? AND id=?',orgId,d.buildingId);if(!b)throw new HttpError(400,'Invalid building.');await insert('locations',{id:uid(),org_id:orgId,building_id:d.buildingId,floor:d.floor,name:d.name,private:d.private?1:0}).run();return json({ok:true});
 }
 if(action==='invite_member'){
  admin(member);const d=parse(z.object({name:text,email:z.string().email().max(200),role:z.enum(['admin','verifier','technician','reporter']),site_scope:text}),data);if(d.site_scope!=='*')for(const siteId of d.site_scope.split(','))await siteFor(orgId,siteId,member);
  if(!isPilotEmail(d.email))throw new HttpError(400,PILOT_ACCESS_MESSAGE);
  if(await one('SELECT id FROM members WHERE org_id=? AND email=?',orgId,d.email.toLowerCase()))throw new HttpError(409,'This email is already in the workspace.');await insert('members',{id:uid(),org_id:orgId,email:d.email.toLowerCase(),name:d.name,role:d.role,site_scope:d.site_scope}).run();return json({ok:true});
 }
 if(action==='deactivate_member'){
  admin(member);const memberId=parse(id,data.memberId),m=await one<Member>('SELECT * FROM members WHERE org_id=? AND id=?',orgId,memberId);if(!m||m.id===member.id)throw new HttpError(400,'You cannot deactivate your own membership.');await stmt('UPDATE members SET active=0 WHERE id=? AND org_id=?',m.id,orgId).run();return json({ok:true});
 }
 if(action==='start_report'){
  const d=parse(z.object({siteId:id,position}),data);const candidates=await check(orgId,member,d.siteId,d.position);if(!candidates.length)throw new HttpError(422,'No mapped building or zone matches this reading. Ask your administrator to check the site map.');const now=Date.now();const recent=await one<{n:number}>('SELECT COUNT(*) n FROM report_sessions WHERE user_id=? AND org_id=? AND created_at>?',user.userId,orgId,now-3600000);if((recent?.n??0)>=30)throw new HttpError(429,'Too many reporting attempts. Please try again later.');const sessionId=uid();await insert('report_sessions',{id:sessionId,org_id:orgId,user_id:user.userId,site_id:d.siteId,created_at:now,expires_at:now+15*60000}).run();return json({sessionId,candidates,accuracy:d.position.accuracy});
 }
 if(action==='submit'){
  const d=parse(z.object({sessionId:id,locationId:id,title:z.string().trim().min(8).max(160),description:z.string().trim().min(15).max(3000),item:text,category:z.enum(categories as [string,...string[]]),visibility:z.enum(['private','shared'])}),data);
  const previous=await one<{id:string}>('SELECT id FROM complaints WHERE org_id=? AND session_id=? AND reporter_id=?',orgId,d.sessionId,user.userId);if(previous)return json({id:previous.id});
  const s=await one<ReportSessionRow>('SELECT * FROM report_sessions WHERE id=? AND org_id=? AND user_id=?',d.sessionId,orgId,user.userId),now=Date.now();if(!s||s.consumed||s.expires_at<now)throw new HttpError(409,'Your reporting session expired. Start again.');siteAccess(member,s.site_id);if(!s.image_key||s.received_at===null||s.captured_at===null||now-s.received_at>120000||now-s.captured_at>150000)throw new HttpError(422,'A fresh geotagged photo is required. Please capture the photo again.');if(s.location_id!==d.locationId)throw new HttpError(400,'The photo belongs to a different location. Recapture it for the selected room.');
  const l=await locationFor(orgId,d.locationId,s.site_id),site=await siteFor(orgId,s.site_id,member),org=await one<Organisation>('SELECT * FROM organisations WHERE id=?',orgId);if(!org)throw new HttpError(404,'Organisation not found.');if(s.latitude===null||s.longitude===null||s.accuracy===null)throw new HttpError(422,'Location evidence is incomplete. Please capture the photo again.');
  try{checkPosition({latitude:s.latitude,longitude:s.longitude,accuracy:s.accuracy,timestamp:now},site,org.max_accuracy,now);}catch(e){throw new HttpError(422,(e as Error).message);}if(!buildingCandidates({latitude:s.latitude,longitude:s.longitude,accuracy:s.accuracy,timestamp:now},[l]).length)throw new HttpError(422,'The building map has changed. Please capture fresh evidence.');
  const tid=uid(),eventId=uid(),ticketNo='CC-'+tid.slice(0,6).toUpperCase(),visibility=l.private||org.type==='School'?'private':d.visibility;
  const results=await db().batch([
   stmt('INSERT INTO complaints (id,org_id,site_id,location_id,reporter_id,reporter_name,ticket_no,title,description,item,category,visibility,session_id,created_at,updated_at,last_event_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM report_sessions WHERE id=? AND org_id=? AND user_id=? AND consumed=0 AND expires_at>?',tid,orgId,s.site_id,d.locationId,user.userId,member.name,ticketNo,d.title,d.description,d.item,d.category,visibility,d.sessionId,now,now,eventId,d.sessionId,orgId,user.userId,now),
   stmt('UPDATE report_sessions SET consumed=1 WHERE id=? AND org_id=? AND EXISTS (SELECT 1 FROM complaints WHERE id=? AND session_id=?)',d.sessionId,orgId,tid,d.sessionId),
   stmt('INSERT INTO events (id,org_id,complaint_id,actor,action,note,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM complaints WHERE id=?)',eventId,orgId,tid,member.name,'submitted','Report submitted with location-assisted photo evidence. Awaiting staff verification.',now,tid)
  ]);if(!results[0].meta.changes)throw new HttpError(409,'This reporting session has already been used.');return json({id:tid});
 }
 if(action==='ticket_action'){
  const d=parse(z.object({ticketId:id,event:text,note:z.string().trim().min(4).max(2000),version:z.number().int().positive(),assigneeId:z.string().optional(),duplicateId:z.string().optional(),priority:z.enum(['Low','Medium','High']).optional()}),data);const {t,own,full}=await ticketAccess(orgId,d.ticketId);if(!full)throw new HttpError(403,'You cannot modify this complaint.');let patch;try{patch=transition(t,d.event,member,own,d);}catch(e){throw new HttpError(403,(e as Error).message);}
  if(d.event==='assign'){const assignee=await one<Member>('SELECT * FROM members WHERE id=? AND org_id=? AND active=1',d.assigneeId,orgId);if(!assignee||!['admin','technician'].includes(assignee.role)||!withinScope(assignee,t.site_id))throw new HttpError(400,'Choose an active technician or administrator with access to this site.');}
  if(d.event==='duplicate'){const target=await ticketAccess(orgId,d.duplicateId!);if(target.t.id===t.id||target.t.verification==='duplicate')throw new HttpError(400,'Choose a different original complaint.');}
  if(d.priority&&['admin','verifier'].includes(member.role))patch.priority=d.priority;
  const eventId=uid(),now=Date.now();patch.updated_at=now;patch.last_event_id=eventId;
  const keys=Object.keys(patch);const results=await db().batch([
   stmt(`UPDATE complaints SET ${keys.map(k=>k+'=?').join(',')}, version=version+1 WHERE id=? AND org_id=? AND version=?`,...keys.map(k=>patch[k]),t.id,orgId,d.version),
   stmt('INSERT INTO events (id,org_id,complaint_id,actor,action,note,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM complaints WHERE id=? AND org_id=? AND last_event_id=?)',eventId,orgId,t.id,member.name,d.event,d.note,now,t.id,orgId,eventId),
   stmt('INSERT INTO notifications (id,org_id,user_id,complaint_id,message,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM complaints WHERE id=? AND org_id=? AND last_event_id=?)',uid(),orgId,t.reporter_id,t.id,`${t.ticket_no}: ${d.event.replaceAll('_',' ')}`,now,t.id,orgId,eventId)
  ]);if(!results[0].meta.changes)throw new HttpError(409,'This ticket changed while you were viewing it. Refresh and try again.');return json({ok:true});
 }
 if(action==='follow'){
  const ticketId=parse(id,data.ticketId),{t}=await ticketAccess(orgId,ticketId);await stmt('INSERT OR IGNORE INTO followers (id,org_id,complaint_id,user_id) VALUES (?,?,?,?)',uid(),orgId,t.id,user.userId).run();return json({ok:true});
 }
 if(action==='read_notifications'){await stmt('UPDATE notifications SET read_at=? WHERE org_id=? AND user_id=? AND read_at IS NULL',Date.now(),orgId,user.userId).run();return json({ok:true});}
 throw new HttpError(400,'Unknown action.');
 }catch(e){return safeError(e);}}
