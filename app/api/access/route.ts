import {z} from 'zod';
import {authenticatedIdentity,membership,admin,all,one,stmt,uid,mutateRequest,safeError,HttpError} from '@/lib/server';
import {PILOT_ORG_ID,isPilotEmail,normaliseEmail} from '@/lib/pilot';
import {assertEligibility,loginIdentity,getVerifiedIdentity,mailConfigured,sendVerificationCode,verifyCode,clearVerification} from '@/lib/access';
import {ROSTER_CHUNK_ROWS,checkRoster,isRosterCells,planRoster} from '@/lib/roster';
import type {RosterCohort,RosterRecord} from '@/lib/roster';
export const dynamic='force-dynamic';
const json=(data:unknown,headers:Record<string,string>={})=>Response.json(data,{headers:{'Cache-Control':'no-store',...headers}});
function parse<S extends z.ZodTypeAny>(schema:S,data:unknown):z.output<S>{const result=schema.safeParse(data);if(!result.success)throw new HttpError(400,'Check the required fields and dates.');return result.data;}
export async function GET(request:Request){try{
 const params=new URL(request.url).searchParams,op=params.get('op')||'status';
 if(op==='status'){if(!await getVerifiedIdentity())return json({verified:false,configured:mailConfigured()});const user=await authenticatedIdentity();await assertEligibility(user);return json({userId:user.userId,email:normaliseEmail(user.email),verified:true,configured:mailConfigured()});}
 if(op==='students'){
  const {member}=await membership(PILOT_ORG_ID);admin(member);
  const input=parse(z.object({page:z.coerce.number().int().min(1).max(100000).default(1),search:z.string().trim().max(200).default('')}),{page:params.get('page')??undefined,search:params.get('search')??undefined});
  const needle='%'+input.search.replace(/[\\%_]/g,'\\$&')+'%',filter="s.org_id=? AND (s.name LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\' OR s.usn LIKE ? ESCAPE '\\')",values=[PILOT_ORG_ID,needle,needle,needle];
  const count=await one<{total:number}>('SELECT COUNT(*) total FROM student_records s WHERE '+filter,...values),total=count?.total??0,pageSize=100,totalPages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(input.page,totalPages);
  return json({cohorts:await all('SELECT * FROM cohorts WHERE org_id=? ORDER BY admission_year DESC',PILOT_ORG_ID),students:await all('SELECT s.*,c.name cohort_name FROM student_records s JOIN cohorts c ON c.id=s.cohort_id AND c.org_id=s.org_id WHERE '+filter+' ORDER BY s.name,s.id LIMIT ? OFFSET ?',...values,pageSize,(page-1)*pageSize),pagination:{page,pageSize,total,totalPages}});
 }
 throw new HttpError(404,'Unknown request.');
 }catch(error){return safeError(error);}}
export async function POST(request:Request){try{
 mutateRequest(request);const body=await request.json().catch(()=>{throw new HttpError(400,'Send a valid JSON request.');});const data=parse(z.object({action:z.string().min(1).max(100)}).passthrough(),body);
 if(data.action==='logout')return json({ok:true},{'Set-Cookie':await clearVerification()});
 if(data.action==='send_code'){const input=parse(z.object({email:z.string().trim().email().max(200)}),data);return json(await sendVerificationCode(await loginIdentity(input.email)));}
 if(data.action==='verify_code'){const input=parse(z.object({email:z.string().trim().email().max(200),challengeId:z.string().min(1).max(100),code:z.string().regex(/^[0-9]{6}$/)}),data);return json({verified:true},{'Set-Cookie':await verifyCode(await loginIdentity(input.email),input.challengeId,input.code)});}
 const {member}=await membership(PILOT_ORG_ID);admin(member);
 if(data.action==='save_cohort'){
  const input=parse(z.object({id:z.string().optional(),name:z.string().trim().min(1).max(100),admissionYear:z.number().int().min(2000).max(2100),startsAt:z.number().int().nonnegative(),endsAt:z.number().int().positive(),active:z.boolean()}),data);
  if(input.endsAt<=input.startsAt)throw new HttpError(400,'The access end date must be after the start date.');
  if(input.id){if(!await one('SELECT id FROM cohorts WHERE id=? AND org_id=?',input.id,PILOT_ORG_ID))throw new HttpError(404,'Batch not found.');await stmt('UPDATE cohorts SET name=?,admission_year=?,starts_at=?,ends_at=?,active=? WHERE id=? AND org_id=?',input.name,input.admissionYear,input.startsAt,input.endsAt,input.active?1:0,input.id,PILOT_ORG_ID).run();}
  else await stmt('INSERT INTO cohorts (id,org_id,name,admission_year,starts_at,ends_at,active) VALUES (?,?,?,?,?,?,?)',uid(),PILOT_ORG_ID,input.name,input.admissionYear,input.startsAt,input.endsAt,input.active?1:0).run();
  return json({ok:true});
 }
 if(data.action==='save_student'){
  const input=parse(z.object({email:z.string().email().max(200),name:z.string().trim().min(1).max(200),usn:z.string().trim().min(1).max(50),cohortId:z.string().min(1),status:z.enum(['active','graduated','withdrawn','suspended'])}),data);
  if(!isPilotEmail(input.email))throw new HttpError(400,'Use an official @bmsit.in or @bmsit.ac.in email.');
  if(!await one('SELECT id FROM cohorts WHERE id=? AND org_id=?',input.cohortId,PILOT_ORG_ID))throw new HttpError(400,'Select a valid BMSIT batch.');
  const email=normaliseEmail(input.email),duplicate=await one('SELECT email FROM student_records WHERE org_id=? AND usn=? AND email<>?',PILOT_ORG_ID,input.usn.toUpperCase(),email);
  if(duplicate)throw new HttpError(409,'That USN already belongs to another student email.');
  await stmt('INSERT INTO student_records (id,org_id,email,name,usn,cohort_id,status,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(org_id,email) DO UPDATE SET name=excluded.name,usn=excluded.usn,cohort_id=excluded.cohort_id,status=excluded.status,updated_at=excluded.updated_at',uid(),PILOT_ORG_ID,email,input.name,input.usn.toUpperCase(),input.cohortId,input.status,Date.now()).run();
  return json({ok:true});
 }
 if(data.action==='import_students'){
  // The browser reads the file and sends it in chunks; every chunk is checked again here,
  // and with commit:true each chunk is written in one statement, all of its rows or none.
  const input=parse(z.object({cohortId:z.string().max(100).default(''),commit:z.boolean().default(false)}),data),rows=(data as {rows?:unknown}).rows;
  // A plain shape check: running hundreds of rows through zod costs more CPU than the import itself.
  if(!Array.isArray(rows)||!rows.length||rows.length>ROSTER_CHUNK_ROWS||!rows.every(isRosterCells))throw new HttpError(400,'Some rows could not be read. Check the file again.');
  const cohorts=await all<RosterCohort>('SELECT id,name FROM cohorts WHERE org_id=?',PILOT_ORG_ID);
  if(input.cohortId&&!cohorts.some(cohort=>cohort.id===input.cohortId))throw new HttpError(400,'Select a valid BMSIT batch.');
  const officialEmail=z.string().email(),checked=checkRoster(rows,{allowedEmail:email=>officialEmail.safeParse(email).success&&isPilotEmail(email)});
  // One lookup finds every existing record that shares an email or a USN with these rows.
  const existing=checked.rows.length?await all<RosterRecord>("SELECT email,usn,name,cohort_id,status FROM student_records WHERE org_id=? AND (email IN (SELECT value FROM json_each(?)) OR usn IN (SELECT value FROM json_each(?)))",PILOT_ORG_ID,JSON.stringify(checked.rows.map(row=>row.email)),JSON.stringify(checked.rows.map(row=>row.usn))):[];
  const plan=planRoster(checked,{cohorts,defaultCohortId:input.cohortId,existing});
  const report={summary:plan.summary,problems:plan.problems.slice(0,100),problemCount:plan.problems.length};
  if(!input.commit)return json({...report,imported:false});
  if(plan.problems.length)throw new HttpError(400,'Fix the problems listed for this file, then check it again. Nothing was imported.');
  if(plan.writes.length){
   const rows=JSON.stringify(plan.writes.map(row=>[uid(),row.email,row.name,row.usn,row.cohortId,row.status]));
   try{await stmt("INSERT INTO student_records (id,org_id,email,name,usn,cohort_id,status,updated_at) SELECT json_extract(value,'$[0]'),?,json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]'),? FROM json_each(?) WHERE true ON CONFLICT(org_id,email) DO UPDATE SET name=excluded.name,usn=excluded.usn,cohort_id=excluded.cohort_id,status=excluded.status,updated_at=excluded.updated_at",PILOT_ORG_ID,Date.now(),rows).run();}
   catch(error){if(/unique|constraint/i.test(error instanceof Error?error.message:''))throw new HttpError(409,'The student list changed while importing, so these rows were not saved. Check the file again, then import it.');throw error;}
  }
  return json({...report,imported:true});
 }
 throw new HttpError(404,'Unknown action.');
 }catch(error){return safeError(error);}}
