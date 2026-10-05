import test, {beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {isPilotEmail, PILOT_ORG_ID} from '../lib/pilot.ts';

// Run the production API handlers and migrations with real cookie authentication,
// transactional SQLite D1 adapter, and synthetic email delivery. Nothing is sent.
let database, visitor=null, cookie='', emails=[], deliveryStatus=200,failSentUpdate=false;
const SEND_SCOPE='https://www.googleapis.com/auth/gmail.send';
let gmailTokenStatus=200,gmailScope='openid email '+SEND_SCOPE,gmailSender='',gmailIdentityStatus=200,gmailVerified=true,gmailFailureReason='',gmailMessageId='synthetic-gmail-id',providerCalls=[];
const actualNow=Date.now, actualFetch=globalThis.fetch;
let now=actualNow();
const ADMIN='24ug1bybs030@bmsit.in';
const state={env:{},getHeaders:async()=>new Headers({cookie,...(visitor?{'oai-authenticated-user-id':visitor.userId,'oai-authenticated-user-email':visitor.email}:{} )})};
function prepared(sql,values=[]){
 const execute=()=>{if(failSentUpdate&&sql.startsWith("UPDATE otp_challenges SET delivery='sent'")){failSentUpdate=false;throw new Error('synthetic database failure');}return {meta:{changes:Number(database.prepare(sql).run(...values).changes)}};};
 return {bind:(...next)=>prepared(sql,next),first:async()=>database.prepare(sql).get(...values)??null,all:async()=>({results:database.prepare(sql).all(...values)}),run:async()=>execute(),execute};
}
state.env.DB={prepare:prepared,batch:async statements=>{
 database.exec('BEGIN');try{const results=statements.map(statement=>statement.execute());database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}
}};
globalThis.__campuscarePilotTest=state;
globalThis.fetch=async(url,options)=>{
 providerCalls.push(url);
 if(url==='https://oauth2.googleapis.com/token'){
  assert.equal(options.redirect,'manual');assert.equal(options.body.get('grant_type'),'refresh_token');
  assert.equal(options.body.get('refresh_token'),'synthetic-refresh-token');
  return Response.json(gmailTokenStatus===200?{access_token:'synthetic-access-token',token_type:'Bearer',scope:gmailScope}:{error:'invalid_grant'}, {status:gmailTokenStatus});
 }
 if(url==='https://openidconnect.googleapis.com/v1/userinfo'){
  assert.equal(options.headers.Authorization,'Bearer synthetic-access-token');
  return Response.json({email:gmailSender,email_verified:gmailVerified},{status:gmailIdentityStatus});
 }
 if(url==='https://gmail.googleapis.com/gmail/v1/users/me/messages/send'){
  assert.equal(options.headers.Authorization,'Bearer synthetic-access-token');assert.equal(options.redirect,'manual');
  const raw=JSON.parse(options.body).raw;assert.match(raw,/^[A-Za-z0-9_-]+$/);
  const mime=Buffer.from(raw,'base64url').toString('utf8');
  const email=mime.match(/^To: <([^>]+)>\r?$/m)[1],code=mime.match(/code is ([0-9]{6})/)[1];
  assert.ok(mime.includes(`From: CampusCare <${state.env.GMAIL_SENDER_EMAIL}>\r\n`));
  assert.ok(mime.includes('Content-Type: text/plain; charset=UTF-8\r\n'));
  emails.push({email,code});
  return Response.json(deliveryStatus===200?{id:gmailMessageId}:{error:{message:'private-provider-body',errors:[{reason:gmailFailureReason}]}},{status:deliveryStatus});
 }
 assert.equal(url,'https://api.resend.com/emails');
 const message=JSON.parse(options.body);
 emails.push({email:message.to[0],code:message.text.match(/code is ([0-9]{6})/)[1]});
 assert.match(options.headers['Idempotency-Key'],/^campuscare-otp\//);
 return Response.json(deliveryStatus===200?{id:'synthetic-email'}:{error:'synthetic failure'},{status:deliveryStatus});
};
Date.now=()=>now;
async function bundleRoute(entry){
 const bundle=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'test-platform-boundaries',setup(plugin){
   plugin.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},args=>({path:args.path,namespace:'test-platform'}));
   plugin.onLoad({filter:/.*/,namespace:'test-platform'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__campuscarePilotTest.env;':'export const headers=globalThis.__campuscarePilotTest.getHeaders;'}));
  },
 }]});
 return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
const campus=await bundleRoute('app/api/campuscare/route.ts');
const access=await bundleRoute('app/api/access/route.ts');
const migrations=await Promise.all(['0000_flaky_talisman.sql','0001_rare_wind_dancer.sql'].map(file=>readFile(new URL('../drizzle/'+file,import.meta.url),'utf8')));
const user=(email,id=email)=>({userId:id,email,displayName:'Test member',fullName:'Test member'});
const get=query=>campus.GET(new Request('https://campus.test/api/campuscare?'+query));
const accessGet=(op='status')=>access.GET(new Request('https://campus.test/api/access?op='+op));
const request=(action,values={})=>new Request('https://campus.test/api/access',{method:'POST',headers:{'Content-Type':'application/json','X-Campuscare-Request':'1','Origin':'https://campus.test'},body:JSON.stringify({action,...values})});
const post=(action,values={})=>campus.POST(request(action,values));
const accessPost=(action,values={})=>access.POST(request(action,['send_code','verify_code'].includes(action)?{email:visitor?.email,...values}:values));
async function photo(org){const data=new FormData();data.set('orgId',org);return campus.POST(new Request('https://campus.test/api/campuscare?op=photo',{method:'POST',headers:{'X-Campuscare-Request':'1'},body:data}));}
const row=(sql,...values)=>database.prepare(sql).get(...values);
function approve(email,changes={}){
 database.prepare('INSERT INTO student_records(id,org_id,email,name,usn,cohort_id,status,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(email,PILOT_ORG_ID,email.toLowerCase(),'Test student',changes.usn||email,'current-batch',changes.status||'active',now);
}
async function send(){const response=await accessPost('send_code');assert.equal(response.status,200);const challenge=await response.json();assert.equal('code' in challenge,false);return {...challenge,code:emails.at(-1).code};}
async function verify(challenge){return accessPost('verify_code',{challengeId:challenge.challengeId,code:challenge.code});}
async function signIn(email,id=email){
 // Model an existing pilot member to prove historical IDs and ownership survive.
 database.prepare('INSERT INTO members(id,org_id,user_id,email,name,role) VALUES(?,?,?,?,?,?) ON CONFLICT(org_id,email) DO UPDATE SET user_id=COALESCE(members.user_id,excluded.user_id)').run('existing-'+email,PILOT_ORG_ID,id,email,'Test member',email===ADMIN?'admin':'reporter');
 visitor=user(email,id);cookie='';const challenge=await send();const response=await verify(challenge);assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];assert.equal((await post('initialise',{role:'admin'})).status,200);return cookie;
}
beforeEach(()=>{
 database?.close();database=new DatabaseSync(':memory:');for(const migration of migrations)database.exec(migration);
 now=actualNow();visitor=null;cookie='';emails=[];deliveryStatus=200;failSentUpdate=false;gmailTokenStatus=200;gmailScope='openid email '+SEND_SCOPE;gmailSender=ADMIN;gmailIdentityStatus=200;gmailVerified=true;gmailFailureReason='';gmailMessageId='synthetic-gmail-id';providerCalls=[];
 delete state.env.GMAIL_CLIENT_ID;delete state.env.GMAIL_CLIENT_SECRET;delete state.env.GMAIL_REFRESH_TOKEN;delete state.env.GMAIL_SENDER_EMAIL;
 state.env.OTP_MAIL_PROVIDER='resend';
 Object.assign(state.env,{BMSIT_ADMIN_EMAIL:ADMIN,RESEND_API_KEY:'synthetic-test-key',OTP_FROM_EMAIL:'CampusCare Test <otp@example.test>',OTP_HMAC_SECRET:'synthetic-test-secret-only-at-least-32-characters'});
 database.prepare('INSERT INTO organisations(id,name,type,creator,created_at) VALUES(?,?,?,?,?)').run(PILOT_ORG_ID,'BMSIT','College','test-fixture',now);
 database.prepare('INSERT INTO cohorts(id,org_id,name,admission_year,starts_at,ends_at,active) VALUES(?,?,?,?,?,?,?)').run('current-batch',PILOT_ORG_ID,'Synthetic current batch',2024,now-1000,now+86400000,1);
});
after(()=>{database.close();Date.now=actualNow;globalThis.fetch=actualFetch;delete globalThis.__campuscarePilotTest;});

test('forged platform identity, user IDs and roles cannot replace a mailbox login',async()=>{
 visitor=user(ADMIN,'forged-platform-admin');
 assert.equal((await get('op=bootstrap')).status,401);
 assert.equal((await post('initialise',{userId:'forged-platform-admin',role:'admin'})).status,401);
 approve('new@bmsit.in');visitor=user('new@bmsit.in','forged-platform-admin');
 const challenge=await send();const verified=await verify(challenge);assert.equal(verified.status,200);
 cookie=verified.headers.get('set-cookie').split(';')[0];visitor=user(ADMIN,'forged-platform-admin');
 assert.equal((await post('initialise',{role:'admin',userId:'forged-platform-admin'})).status,200);
 const boot=await (await get('op=bootstrap')).json();assert.equal(boot.user.email,'new@bmsit.in');assert.equal(boot.organisations[0].role,'reporter');
 assert.equal(row('SELECT user_id FROM otp_sessions').user_id.startsWith('campuscare:'),true);
 assert.notEqual(row('SELECT user_id FROM otp_sessions').user_id,'forged-platform-admin');
});

test('first mailbox login works with no platform identity and retains a stable ID across concurrent enrollment',async()=>{
 approve('new@bmsit.in');visitor=null;
 const response=await accessPost('send_code',{email:'NEW@BMSIT.IN',userId:'attacker',role:'admin'});assert.equal(response.status,200);
 const challenge=await response.json();assert.equal(challenge.email,'new@bmsit.in');
 const verified=await accessPost('verify_code',{email:challenge.email,challengeId:challenge.challengeId,code:emails[0].code,userId:'attacker',role:'admin'});assert.equal(verified.status,200);
 cookie=verified.headers.get('set-cookie').split(';')[0];
 for(const result of await Promise.all(Array.from({length:6},()=>post('initialise',{role:'admin'}))))assert.equal(result.status,200);
 const member=row('SELECT * FROM members WHERE email=?','new@bmsit.in');assert.match(member.user_id,/^campuscare:[a-f0-9]{64}$/);assert.equal(member.role,'reporter');
 assert.equal(row('SELECT COUNT(*) n FROM members WHERE email=?','new@bmsit.in').n,1);
 assert.equal((await (await get('op=bootstrap')).json()).user.id,member.user_id);
 now+=60_001;const again=await accessPost('send_code',{email:challenge.email});assert.equal(again.status,200);assert.equal(row('SELECT user_id FROM otp_challenges').user_id,member.user_id);
});

test('an OTP cannot authenticate a different approved email and roster revocation blocks pending verification',async()=>{
 approve('first@bmsit.in');approve('second@bmsit.in');visitor=user('first@bmsit.in');const challenge=await send();
 assert.equal((await accessPost('verify_code',{...challenge,email:'second@bmsit.in'})).status,400);
 assert.equal(row('SELECT COUNT(*) n FROM otp_sessions').n,0);
 database.prepare("UPDATE student_records SET status='suspended' WHERE email='first@bmsit.in'").run();assert.equal((await verify(challenge)).status,403);
 assert.equal(row('SELECT COUNT(*) n FROM otp_sessions').n,0);
});

test('existing complaint ownership, follows and notifications survive direct email login',async()=>{
 const email='existing@bmsit.in',oldId='historical-platform-id';approve(email);await signIn(email,oldId);syntheticFacility('allowed');
 syntheticComplaint('historical-own',{reporter:oldId});
 database.prepare('INSERT INTO followers(id,org_id,complaint_id,user_id) VALUES(?,?,?,?)').run('old-follow',PILOT_ORG_ID,'historical-own',oldId);
 database.prepare('INSERT INTO notifications(id,org_id,user_id,complaint_id,message,created_at) VALUES(?,?,?,?,?,?)').run('old-update',PILOT_ORG_ID,oldId,'historical-own','Existing update',now);
 visitor=null;const response=await get(`op=workspace&org=${PILOT_ORG_ID}`);assert.equal(response.status,200);
 const workspace=await response.json();assert.equal(workspace.tickets[0].own,true);assert.equal(workspace.tickets[0].can_view_evidence,true);
 assert.deepEqual(workspace.following,['historical-own']);assert.equal(workspace.notifications[0].id,'old-update');assert.equal(workspace.accessIdentity.id,oldId);
});

test('legacy verification cookies and sessions cannot serve as the new primary login credential',async()=>{
 approve('student@bmsit.in');await signIn('student@bmsit.in');const current=cookie;
 cookie=current.replace('__Host-campuscare-session','__Host-campuscare-verified');assert.equal((await get('op=bootstrap')).status,401);
 cookie=current;database.prepare("UPDATE otp_sessions SET challenge_id='legacy-second-factor-challenge'").run();assert.equal((await get('op=bootstrap')).status,401);
 assert.equal((await (await accessGet()).json()).verified,false);
});

test('only exact official domains match, including case normalization',()=>{
 for(const email of ['student@bmsit.in','student@bmsit.ac.in','STUDENT@BMSIT.IN'])assert.equal(isPilotEmail(email),true);
 for(const email of ['student@gmail.com','student@bmsit.in.evil.com','student@sub.bmsit.in','bmsit.in@evil.com','a@@bmsit.in','@bmsit.in','x y@bmsit.in','x@bmsit.in.','x@bmsit．in'])assert.equal(isPilotEmail(email),false,email);
});
test('anonymous and forged outside-domain headers cannot access protected APIs',async()=>{
 assert.equal((await get('op=bootstrap')).status,401);assert.equal((await accessGet()).status,200);assert.equal((await (await accessGet()).json()).verified,false);
 for(const email of ['student@gmail.com','student@bmsit.in.evil.com']){
  visitor=user(email);
  for(const response of [await get('op=bootstrap'),await get(`op=workspace&org=${PILOT_ORG_ID}`),await get(`op=photo&org=${PILOT_ORG_ID}&id=x`),await post('initialise'),await post('create_org'),await photo(PILOT_ORG_ID)])assert.equal(response.status,401);
  assert.equal((await accessPost('send_code')).status,403);
 }
 assert.equal(emails.length,0);assert.equal(row('SELECT COUNT(*) n FROM members').n,0);
});
test('official email alone and self-declared enrollment never grant student access',async()=>{
 visitor=user('unlisted@bmsit.in');
 assert.equal((await accessPost('send_code',{status:'active',cohortId:'current-batch'})).status,403);
 for(const response of [await post('initialise',{role:'admin',active:true}),await accessPost('save_student',{email:visitor.email,name:'Self',usn:'SELF',cohortId:'current-batch',status:'active'})])assert.equal(response.status,401);
 assert.equal(emails.length,0);assert.equal(row('SELECT COUNT(*) n FROM student_records').n,0);
});
test('roster status, disabled batches, future start and inclusive expiry all deny access',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);
 for(const status of ['graduated','withdrawn','suspended']){database.prepare('UPDATE student_records SET status=?').run(status);assert.equal((await accessPost('send_code')).status,403);}
 database.prepare("UPDATE student_records SET status='active'").run();
 database.prepare('UPDATE cohorts SET active=0').run();assert.equal((await accessPost('send_code')).status,403);
 database.prepare('UPDATE cohorts SET active=1,starts_at=?').run(now+1);assert.equal((await accessPost('send_code')).status,403);
 database.prepare('UPDATE cohorts SET starts_at=?,ends_at=?').run(now-1,now);assert.equal((await accessPost('send_code')).status,403);assert.equal(emails.length,0);
});
test('eligible students still need OTP before bootstrap, reads and photo uploads',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);
 assert.equal((await (await accessGet()).json()).verified,false);
 for(const response of [await get('op=bootstrap'),await post('initialise'),await get(`op=workspace&org=${PILOT_ORG_ID}`),await get(`op=photo&org=${PILOT_ORG_ID}&id=x`),await photo(PILOT_ORG_ID)])assert.equal(response.status,401);
 assert.equal(row('SELECT COUNT(*) n FROM members').n,0);
});
test('both domains enroll only verified approved students as reporters, idempotently',async()=>{
 for(const email of ['student@bmsit.in','student@bmsit.ac.in']){
  approve(email);await signIn(email);
  for(const response of await Promise.all([post('initialise',{role:'admin'}),post('initialise')]))assert.equal(response.status,200);
  const boot=await (await get('op=bootstrap')).json();assert.deepEqual(boot.organisations.map(org=>org.id),[PILOT_ORG_ID]);assert.equal(boot.organisations[0].role,'reporter');
  assert.equal((await get(`op=workspace&org=${PILOT_ORG_ID}`)).status,200);assert.equal((await post('save_site',{orgId:PILOT_ORG_ID})).status,403);
 }
 assert.equal(row("SELECT COUNT(*) n FROM members WHERE role='reporter'").n,2);
});
test('codes and tokens are hashed and anonymous status does not expose the login challenge',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);const challenge=await send();assert.equal(emails[0].email,visitor.email);
 const record=row('SELECT * FROM otp_challenges');assert.match(record.code_hash,/^[a-f0-9]{64}$/);assert.notEqual(record.code_hash,challenge.code);
 const status=await (await accessGet()).json();assert.equal(status.challenge,undefined);assert.equal(status.email,undefined);assert.equal('code' in status,false);
 const response=await verify(challenge);assert.equal(response.status,200);const header=response.headers.get('set-cookie');for(const flag of ['__Host-campuscare-session=','HttpOnly','Secure','SameSite=Lax','Path=/'])assert.ok(header.includes(flag));
 cookie=header.split(';')[0];assert.notEqual(row('SELECT token_hash FROM otp_sessions').token_hash,cookie.split('=')[1]);assert.equal((await (await accessGet()).json()).verified,true);
});
test('OTP attempts stop at five, including concurrent incorrect guesses',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);const challenge=await send();const wrong=(Number(challenge.code)+1)%1000000;
 const responses=await Promise.all(Array.from({length:12},()=>accessPost('verify_code',{challengeId:challenge.challengeId,code:String(wrong).padStart(6,'0')})));
 for(const response of responses)assert.equal(response.status,400);
 assert.equal(row('SELECT attempts FROM otp_challenges').attempts,5);assert.equal((await verify(challenge)).status,400);assert.equal(row('SELECT COUNT(*) n FROM otp_sessions').n,0);
});
test('parallel correct verifications create one session and replay is denied',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);const challenge=await send();const responses=await Promise.all(Array.from({length:8},()=>verify(challenge)));
 assert.equal(responses.filter(response=>response.status===200).length,1);assert.equal(responses.filter(response=>response.status===400).length,7);assert.equal(row('SELECT COUNT(*) n FROM otp_sessions').n,1);assert.equal((await verify(challenge)).status,400);
});
test('expired OTP cannot create a verification session',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);const challenge=await send();now=challenge.expiresAt;assert.equal((await verify(challenge)).status,400);assert.equal(row('SELECT COUNT(*) n FROM otp_sessions').n,0);
});
test('resending invalidates the older challenge and limits concurrent sending',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);const responses=await Promise.all(Array.from({length:8},()=>accessPost('send_code')));
 const successful=responses.find(response=>response.status===200);assert.ok(successful);assert.equal(emails.length,1);assert.equal(responses.filter(response=>response.status===429).length,7);
 const old={...await successful.json(),code:emails[0].code};now+=60000;const latest=await send();assert.notEqual(latest.challengeId,old.challengeId);assert.equal((await verify(old)).status,400);assert.equal((await verify(latest)).status,200);
});
test('one-minute cooldown and five-code hourly send limit are enforced',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);await send();assert.equal((await accessPost('send_code')).status,429);
 for(let index=1;index<5;index++){now+=60000;await send();}
 now+=60000;assert.equal((await accessPost('send_code')).status,429);assert.equal(emails.length,5);
 now+=3600000;assert.equal((await accessPost('send_code')).status,200);assert.equal(row('SELECT send_count FROM otp_challenges').send_count,1);
});
test('missing email configuration fails closed without generating a challenge',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);
 for(const key of ['RESEND_API_KEY','OTP_FROM_EMAIL','OTP_HMAC_SECRET']){const value=state.env[key];delete state.env[key];assert.equal((await accessPost('send_code')).status,503);assert.equal((await (await accessGet()).json()).configured,false);state.env[key]=value;}
 assert.equal(row('SELECT COUNT(*) n FROM otp_challenges').n,0);assert.equal(emails.length,0);
});
test('email service failure leaves an unusable challenge and no verification session',async()=>{
 visitor=user('student@bmsit.in');approve(visitor.email);deliveryStatus=503;const response=await accessPost('send_code');assert.equal(response.status,503);
 const record=row('SELECT * FROM otp_challenges');assert.equal(record.delivery,'failed');assert.equal(record.code_hash,'');assert.equal((await verify({challengeId:record.challenge_id,code:emails[0].code})).status,400);assert.equal(row('SELECT COUNT(*) n FROM otp_sessions').n,0);
});
test('verified sessions are bound to email and identity, expire and are revoked on logout',async()=>{
 approve('student@bmsit.in');const saved=await signIn('student@bmsit.in','original');visitor=user(ADMIN,'forged-admin');
 const boot=await (await get('op=bootstrap')).json();assert.equal(boot.user.id,'original');assert.equal(boot.user.email,'student@bmsit.in');assert.equal(boot.organisations[0].role,'reporter');
 visitor=null;assert.equal((await get('op=bootstrap')).status,200);
 now+=8*3600000;assert.equal((await get('op=bootstrap')).status,401);now-=8*3600000;cookie=saved;
 const logout=await accessPost('logout');assert.equal(logout.status,200);assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));assert.equal(row('SELECT COUNT(*) n FROM otp_sessions').n,0);assert.equal((await get('op=bootstrap')).status,401);
});
test('graduation, suspension and batch expiry revoke an already verified session on every protected operation',async()=>{
 approve('student@bmsit.in');await signIn('student@bmsit.in');
 for(const status of ['graduated','suspended']){database.prepare('UPDATE student_records SET status=?').run(status);for(const response of [await get('op=bootstrap'),await get(`op=workspace&org=${PILOT_ORG_ID}`),await get(`op=photo&org=${PILOT_ORG_ID}&id=x`),await photo(PILOT_ORG_ID),await post('initialise')])assert.equal(response.status,403);}
 database.prepare("UPDATE student_records SET status='active'").run();database.prepare('UPDATE cohorts SET ends_at=?').run(now);assert.equal((await get('op=bootstrap')).status,403);
});
test('deactivation cannot be bypassed by re-enrollment or by changing account email',async()=>{
 approve('student@bmsit.in');await signIn('student@bmsit.in','original');database.prepare('UPDATE members SET active=0 WHERE user_id=?').run('original');
 for(const email of ['student@bmsit.in','new@bmsit.in']){visitor=user(email,'original');for(const response of [await accessGet(),await accessPost('send_code'),await post('initialise'),await get('op=bootstrap')])assert.equal(response.status,403);}
 assert.equal(row('SELECT active FROM members WHERE user_id=?','original').active,0);
});
test('only designated administrator can claim setup access, and must first verify OTP',async()=>{
 visitor=user(ADMIN);assert.equal((await accessPost('save_cohort',{name:'Self-approved'})).status,401);assert.equal((await post('initialise')).status,401);await signIn(ADMIN,'admin-id');assert.equal(row('SELECT role FROM members WHERE user_id=?','admin-id').role,'admin');
 assert.equal((await post('invite_member',{orgId:PILOT_ORG_ID,name:'Outside',email:'outside@gmail.com',role:'admin',site_scope:'*'})).status,400);
 assert.equal((await post('save_settings',{orgId:PILOT_ORG_ID,name:'Other college',color:'#305bea',max_accuracy:50,response_hours:24,emergency_contact:'Call facilities',identifier_label:'USN'})).status,400);
});
test('approved staff need OTP and an inactive student record overrides their staff role',async()=>{
 await signIn(ADMIN);assert.equal((await post('invite_member',{orgId:PILOT_ORG_ID,name:'Test technician',email:'tech@bmsit.ac.in',role:'technician',site_scope:'*'})).status,200);
 visitor=user('tech@bmsit.ac.in');cookie='';assert.equal((await get('op=bootstrap')).status,401);await signIn(visitor.email);assert.equal((await get(`op=workspace&org=${PILOT_ORG_ID}`)).status,200);
 approve(visitor.email,{status:'graduated'});assert.equal((await accessGet()).status,403);assert.equal((await get('op=bootstrap')).status,403);
});
test('only administrators can maintain the roster; invalid parent and duplicate USNs are rejected',async()=>{
 approve('student@bmsit.in');await signIn('student@bmsit.in');assert.equal((await accessGet('students')).status,403);assert.equal((await accessPost('save_cohort',{name:'Attempt'})).status,403);
 await signIn(ADMIN);assert.equal((await accessGet('students')).status,200);
 assert.equal((await accessPost('save_cohort',{name:'2024–2028',admissionYear:2024,startsAt:now-1000,endsAt:now+1000,active:true})).status,200);
 assert.equal((await accessPost('save_cohort',{name:'Invalid',admissionYear:2024,startsAt:now,endsAt:now-1,active:true})).status,400);
 const record={name:'Approved test student',email:'approved@bmsit.in',usn:'TEST-USN',cohortId:'current-batch',status:'active'};
 assert.equal((await accessPost('save_student',{...record,cohortId:'another-tenant'})).status,400);assert.equal((await accessPost('save_student',{...record,email:'outside@gmail.com'})).status,400);assert.equal((await accessPost('save_student',record)).status,200);
 assert.equal((await accessPost('save_student',{...record,email:'second@bmsit.in'})).status,409);assert.equal((await accessPost('save_student',{...record,status:'graduated'})).status,200);assert.equal(row('SELECT status FROM student_records WHERE email=?',record.email).status,'graduated');
});
test('legacy organisations, new organisations and demos remain inaccessible with a valid OTP',async()=>{
 approve('student@bmsit.in');await signIn('student@bmsit.in');database.prepare('INSERT INTO organisations(id,name,type,creator,created_at) VALUES(?,?,?,?,?)').run('legacy','Legacy','Office',visitor.userId,0);database.prepare('INSERT INTO members(id,org_id,user_id,email,name,role) VALUES(?,?,?,?,?,?)').run('legacy-admin','legacy',visitor.userId,visitor.email,'Test member','admin');
 assert.deepEqual((await (await get('op=bootstrap')).json()).organisations.map(org=>org.id),[PILOT_ORG_ID]);
 for(const op of ['workspace','detail','photo'])assert.equal((await get(`op=${op}&org=legacy&id=x`)).status,403);assert.equal((await photo('legacy')).status,403);assert.equal((await post('read_notifications',{orgId:'legacy'})).status,403);assert.equal((await post('create_org',{name:'Other',type:'College'})).status,403);assert.equal((await post('initialise',{demo:true})).status,403);
});
test('invalid JSON and cross-origin access writes are rejected',async()=>{
 visitor=user(ADMIN);
 assert.equal((await access.POST(new Request('https://campus.test/api/access',{method:'POST',headers:{'X-Campuscare-Request':'1'},body:'null'}))).status,400);
 assert.equal((await access.POST(new Request('https://campus.test/api/access',{method:'POST',headers:{'X-Campuscare-Request':'1'},body:'broken-json'}))).status,400);
 assert.equal((await access.POST(new Request('https://campus.test/api/access',{method:'POST',headers:{'Content-Type':'application/json','X-Campuscare-Request':'1','Origin':'https://evil.test'},body:JSON.stringify({action:'send_code'})}))).status,403);assert.equal(emails.length,0);
});
test('administrators can find and suspend students beyond the first 2000 records',async()=>{
 await signIn(ADMIN);database.exec('BEGIN');
 const insert=database.prepare('INSERT INTO student_records(id,org_id,email,name,usn,cohort_id,status,updated_at) VALUES(?,?,?,?,?,?,?,?)');
 for(let index=0;index<2105;index++){const number=String(index).padStart(4,'0');insert.run('roster-'+number,PILOT_ORG_ID,'roster'+number+'@bmsit.in','Student '+number,'ROSTER-'+number,'current-batch','active',now);}
 database.exec('COMMIT');
 const first=await (await accessGet('students')).json();assert.equal(first.students.length,100);assert.equal(first.pagination.total,2105);assert.equal(first.pagination.totalPages,22);
 const last=await (await accessGet('students&page=22')).json();assert.equal(last.students.length,5);assert.equal(last.students.at(-1).email,'roster2104@bmsit.in');
 const found=await (await accessGet('students&search=ROSTER-2104')).json();assert.equal(found.pagination.total,1);const student=found.students[0];assert.equal(student.email,'roster2104@bmsit.in');
 assert.equal((await accessPost('save_student',{email:student.email,name:student.name,usn:student.usn,cohortId:student.cohort_id,status:'suspended'})).status,200);
 visitor=user(student.email);cookie='';assert.equal((await accessPost('send_code')).status,403);
});
test('student search treats wildcard and SQL syntax as literal input',async()=>{
 await signIn(ADMIN);approve('percent@bmsit.in');approve('ordinary@bmsit.in');database.prepare('UPDATE student_records SET name=? WHERE email=?').run('Student 100%_ready','percent@bmsit.in');
 const results=await (await accessGet('students&search='+encodeURIComponent('%_'))).json();assert.equal(results.pagination.total,1);assert.equal(results.students[0].email,'percent@bmsit.in');
 const injection=await (await accessGet('students&search='+encodeURIComponent("' OR 1=1 --"))).json();assert.equal(injection.pagination.total,0);
});
test('student pagination rejects invalid inputs and clamps pages after records change',async()=>{
 await signIn(ADMIN);approve('student@bmsit.in');
 for(const page of ['0','-1','1.5','bad','100001'])assert.equal((await accessGet('students&page='+page)).status,400);
 assert.equal((await accessGet('students&search='+'x'.repeat(201))).status,400);
 const results=await (await accessGet('students&page=999')).json();assert.equal(results.pagination.page,1);assert.equal(results.students.length,1);
});
test('global eligibility rejection is distinct from an ordinary workflow permission error',async()=>{
 approve('student@bmsit.in');await signIn('student@bmsit.in');const forbidden=await post('save_site',{orgId:PILOT_ORG_ID});assert.equal(forbidden.status,403);assert.equal((await forbidden.json()).code,undefined);
 database.prepare("UPDATE student_records SET status='graduated'").run();const denied=await get('op=bootstrap');assert.equal(denied.status,403);assert.equal((await denied.json()).code,'ACCESS_DENIED');
 database.prepare("UPDATE student_records SET status='active'").run();cookie='';const expired=await get('op=bootstrap');assert.equal(expired.status,401);
});

function configureGmail(){Object.assign(state.env,{OTP_MAIL_PROVIDER:'gmail',GMAIL_CLIENT_ID:'synthetic-client.apps.googleusercontent.com',GMAIL_CLIENT_SECRET:'synthetic-client-secret',GMAIL_REFRESH_TOKEN:'synthetic-refresh-token',GMAIL_SENDER_EMAIL:ADMIN});}
test('Gmail sends to the eligible email entered on the public login form and completes verification',async()=>{
 configureGmail();visitor=user('student@bmsit.ac.in');approve(visitor.email);
 assert.equal((await accessPost('send_code',{email:'attacker@gmail.com'})).status,403);
 const response=await accessPost('send_code',{email:visitor.email,userId:'attacker',role:'admin'});assert.equal(response.status,200);
 const challenge=await response.json();assert.equal('code' in challenge,false);assert.equal(emails[0].email,visitor.email);
 assert.deepEqual(providerCalls,['https://oauth2.googleapis.com/token','https://openidconnect.googleapis.com/v1/userinfo','https://gmail.googleapis.com/gmail/v1/users/me/messages/send']);
 challenge.code=emails[0].code;assert.equal((await verify(challenge)).status,200);
});
test('revoked Gmail authorization invalidates the pending code without exposing provider errors',async()=>{
 configureGmail();visitor=user(ADMIN);gmailTokenStatus=400;
 const response=await accessPost('send_code');assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/invalid_grant|synthetic-client-secret|synthetic-refresh-token/);
 const challenge=row('SELECT * FROM otp_challenges');assert.equal(challenge.delivery,'failed');assert.equal(challenge.code_hash,'');assert.equal(challenge.expires_at,0);assert.equal(emails.length,0);
});
test('Gmail refuses missing send permission or a different authorized sender',async()=>{
 configureGmail();visitor=user(ADMIN);gmailScope='openid email';assert.equal((await accessPost('send_code')).status,503);assert.equal(emails.length,0);
 now+=60_001;gmailScope=SEND_SCOPE;gmailSender='different@gmail.com';assert.equal((await accessPost('send_code')).status,503);assert.equal(emails.length,0);
 assert.equal(providerCalls.includes('https://gmail.googleapis.com/gmail/v1/users/me/messages/send'),false);
});
test('Gmail rejection or malformed acceptance never leaves a usable verification code',async()=>{
 configureGmail();visitor=user(ADMIN);deliveryStatus=429;assert.equal((await accessPost('send_code')).status,503);assert.equal(row('SELECT delivery FROM otp_challenges').delivery,'failed');
 now+=60_001;deliveryStatus=200;gmailMessageId='';assert.equal((await accessPost('send_code')).status,503);assert.equal(row('SELECT code_hash FROM otp_challenges').code_hash,'');
});
test('Gmail identity service failure or unverified sender prevents sending and invalidates the challenge',async()=>{
 configureGmail();visitor=user(ADMIN);gmailIdentityStatus=401;
 assert.equal((await accessPost('send_code')).status,503);assert.equal(row('SELECT code_hash FROM otp_challenges').code_hash,'');
 now+=60_001;gmailIdentityStatus=200;gmailVerified=false;
 assert.equal((await accessPost('send_code')).status,503);assert.equal(row('SELECT code_hash FROM otp_challenges').code_hash,'');
 assert.equal(providerCalls.includes('https://gmail.googleapis.com/gmail/v1/users/me/messages/send'),false);
});
test('incomplete Gmail configuration and invalid sender headers cannot fall back to another provider',async()=>{
 configureGmail();visitor=user(ADMIN);delete state.env.GMAIL_REFRESH_TOKEN;assert.equal((await accessPost('send_code')).status,503);
 state.env.GMAIL_REFRESH_TOKEN='synthetic-refresh-token';state.env.GMAIL_SENDER_EMAIL=ADMIN+'\r\nBcc: attacker@gmail.com';assert.equal((await accessPost('send_code')).status,503);
 state.env.OTP_MAIL_PROVIDER='unknown';assert.equal((await accessPost('send_code')).status,503);assert.equal(providerCalls.length,0);
});
test('email diagnostics expose only a fixed stage, HTTP status and allowlisted error category',async()=>{
 configureGmail();visitor=user(ADMIN);deliveryStatus=429;gmailFailureReason='rateLimitExceeded';
 const logs=[],original=console.error;console.error=(...values)=>logs.push(values);
 try{
  const response=await accessPost('send_code');assert.equal(response.status,503);
  assert.deepEqual(logs[0],['CampusCare email delivery failed',{stage:'send',status:429,reason:'rateLimitExceeded'}]);
  now+=60_001;gmailFailureReason='unexpected-secret-reason';await accessPost('send_code');
  assert.equal(logs[1][1].reason,'unclassified');
  assert.doesNotMatch(JSON.stringify(logs),/private-provider-body|unexpected-secret|synthetic-client-secret|synthetic-refresh-token/);
  assert.doesNotMatch(await response.text(),/rateLimitExceeded|private-provider|synthetic/);
 }finally{console.error=original;}
});
test('provider acceptance followed by a database failure invalidates the code and identifies the database stage',async()=>{
 configureGmail();visitor=user(ADMIN);failSentUpdate=true;
 const logs=[],original=console.error;console.error=(...values)=>logs.push(values);
 try{
  assert.equal((await accessPost('send_code')).status,503);assert.equal(emails.length,1);
  const failed=row('SELECT * FROM otp_challenges');assert.equal(failed.delivery,'failed');assert.equal(failed.code_hash,'');assert.equal(failed.expires_at,0);
  assert.deepEqual(logs[0],['CampusCare email delivery failed',{stage:'delivery_db',status:0,reason:'update_failed'}]);
  assert.equal((await verify({challengeId:failed.challenge_id,code:emails[0].code})).status,400);
 }finally{console.error=original;}
});

function syntheticFacility(siteId){
 database.prepare('INSERT INTO sites(id,org_id,name) VALUES(?,?,?)').run(siteId,PILOT_ORG_ID,'Synthetic site '+siteId);
 database.prepare('INSERT INTO buildings(id,org_id,site_id,name) VALUES(?,?,?,?)').run('building-'+siteId,PILOT_ORG_ID,siteId,'Synthetic building');
 database.prepare('INSERT INTO locations(id,org_id,building_id,floor,name) VALUES(?,?,?,?,?)').run('room-'+siteId,PILOT_ORG_ID,'building-'+siteId,'Ground','Synthetic room');
}
function syntheticComplaint(id,{site='allowed',reporter='another-student',visibility='private',createdAt=now,assignee=null}={}){
 database.prepare(`INSERT INTO complaints(id,org_id,site_id,location_id,reporter_id,reporter_name,ticket_no,title,description,item,category,visibility,created_at,updated_at,assignee_id)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,PILOT_ORG_ID,site,'room-'+site,reporter,'Private reporter','CC-'+id,'Synthetic fault '+id,'Private description '+id,'Synthetic fixture','Electrical',visibility,createdAt,createdAt,assignee);
}
test('older own and shared complaints remain trackable beyond 500 inaccessible recent reports',async()=>{
 const email='current@bmsit.in';approve(email);await signIn(email);syntheticFacility('allowed');syntheticFacility('outside');
 database.prepare('UPDATE members SET site_scope=? WHERE user_id=?').run('allowed',email);
 syntheticComplaint('old-own',{reporter:email,createdAt:now-1000});
 syntheticComplaint('old-shared',{visibility:'shared',createdAt:now-1000});
 syntheticComplaint('old-private',{createdAt:now-1000});
 syntheticComplaint('outside-own',{site:'outside',reporter:email});
 syntheticComplaint('outside-shared',{site:'outside',visibility:'shared'});
 for(let index=0;index<600;index++)syntheticComplaint('hidden-'+index);
 const response=await get(`op=workspace&org=${PILOT_ORG_ID}`);assert.equal(response.status,200);
 const workspace=await response.json();assert.deepEqual(workspace.tickets.map(ticket=>ticket.id),['old-shared','old-own']);
 const own=workspace.tickets.find(ticket=>ticket.own),shared=workspace.tickets.find(ticket=>!ticket.own);
 assert.equal(own.can_view_evidence,true);assert.equal(own.description,'Private description old-own');
 assert.equal(shared.can_view_evidence,false);assert.equal(shared.reporter_id,undefined);assert.equal(shared.reporter_name,'Community member');assert.doesNotMatch(shared.description,/Private description/);
});
test('staff workspace includes every accessible complaint across multiple batches with equal timestamps',async()=>{
 await signIn(ADMIN);syntheticFacility('allowed');
 for(let index=0;index<605;index++)syntheticComplaint(String(index).padStart(4,'0'),{createdAt:index<301?now-1000:now});
 const expected=Array.from({length:605},(_,index)=>String(604-index).padStart(4,'0'));
 for(const role of ['admin','verifier']){
  database.prepare('UPDATE members SET role=? WHERE user_id=?').run(role,ADMIN);
  const response=await get(`op=workspace&org=${PILOT_ORG_ID}`);assert.equal(response.status,200);
  const workspace=await response.json();assert.deepEqual(workspace.tickets.map(ticket=>ticket.id),expected);
  assert.equal(new Set(workspace.tickets.map(ticket=>ticket.id)).size,605);
  assert.equal(workspace.tickets.every(ticket=>ticket.can_view_evidence),true);
 }
});
test('technician history preserves own and assigned private issues while enforcing site and visibility scope',async()=>{
 const email='tech@bmsit.ac.in';approve(email);await signIn(email);syntheticFacility('allowed');syntheticFacility('outside');
 const technician=row('SELECT id FROM members WHERE user_id=?',email);
 database.prepare('UPDATE members SET role=?,site_scope=? WHERE id=?').run('technician','allowed',technician.id);
 syntheticComplaint('old-assigned',{assignee:technician.id,createdAt:now-1000});
 syntheticComplaint('old-own',{reporter:email,createdAt:now-1000});
 syntheticComplaint('old-shared',{visibility:'shared',createdAt:now-1000});
 syntheticComplaint('outside-assigned',{site:'outside',assignee:technician.id});
 for(let index=0;index<600;index++)syntheticComplaint('unassigned-'+index);
 const response=await get(`op=workspace&org=${PILOT_ORG_ID}`);assert.equal(response.status,200);
 const workspace=await response.json();assert.deepEqual(workspace.tickets.map(ticket=>ticket.id),['old-shared','old-own','old-assigned']);
 assert.equal(workspace.tickets.find(ticket=>ticket.id==='old-assigned').can_view_evidence,true);
 assert.equal(workspace.tickets.find(ticket=>ticket.id==='old-shared').can_view_evidence,false);
});
