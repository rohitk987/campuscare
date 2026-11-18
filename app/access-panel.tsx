'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {ChangeEvent,FormEvent} from 'react';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Switch} from '@/components/ui/switch';
import {Field,Picker,SelectField,Busy} from './ui';
import {AccessRequestError,accessAction} from './access-client';
import type {AccessCohort,ApiError,StudentAccessData,StudentAccessEditorRecord} from '@/lib/models';
import {ROSTER_MAX_LENGTH,checkRoster,readRoster,rosterTemplate,sendRosterChunks} from '@/lib/roster';
import type {RosterChunkReport,RosterProblem,RosterSummary} from '@/lib/roster';
import {isPilotEmail} from '@/lib/pilot';

async function readStudents(search:string,page:number):Promise<StudentAccessData>{
 const params=new URLSearchParams({op:'students',search,page:String(page)});
 const response=await fetch('/api/access?'+params,{cache:'no-store'});
 const data=await response.json() as StudentAccessData&{error?:string};
 if(!response.ok)throw new AccessRequestError(data.error||'Student records could not be loaded.',response.status);
 return data;
}

const dateInput=(timestamp:number)=>new Date(timestamp+5.5*3_600_000).toISOString().slice(0,10);
type AccessPanelProps={onAccessFailure:(error:ApiError)=>void|Promise<void>};
type AccessEditorProps={record:StudentAccessEditorRecord;cohorts:AccessCohort[];error:string;busy:boolean;onClose:()=>void;onSave:(action:string,payload:Record<string,unknown>)=>Promise<void>};
type RosterDraft={text:string;fileName:string};
type ImportReport={summary:RosterSummary;problems:RosterProblem[];problemCount:number;columns:{batch:boolean;status:boolean};ignored:string[]};
type RosterImportProps={cohorts:AccessCohort[];draft:RosterDraft;onDraft:(draft:RosterDraft)=>void;onClose:()=>void;onImported:(summary:RosterSummary)=>void;onAccessFailure:(error:ApiError)=>void|Promise<void>};
const count=(value:number)=>value.toLocaleString('en-IN');
const plural=(value:number,one:string,many=one+'s')=>`${count(value)} ${value===1?one:many}`;
const emptySummary=():RosterSummary=>({rows:0,create:0,update:0,unchanged:0,reactivate:0});
function importedNotice(summary:RosterSummary){
 if(!summary.create&&!summary.update)return 'Every row already matched the student records, so nothing changed.';
 return `Imported ${[summary.create?plural(summary.create,'new student record'):'',summary.update?plural(summary.update,'updated record'):''].filter(Boolean).join(' and ')}.${summary.unchanged?` ${plural(summary.unchanged,'row')} already matched.`:''}`;
}
function downloadTemplate(){
 const url=URL.createObjectURL(new Blob([rosterTemplate],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
 link.href=url;link.download='campuscare-student-list.csv';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function StudentAccessPanel({onAccessFailure}:AccessPanelProps){
 const [data,setData]=useState<StudentAccessData>({cohorts:[],students:[],pagination:{page:1,pageSize:100,total:0,totalPages:1}});
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[editor,setEditor]=useState<StudentAccessEditorRecord|null>(null),[importing,setImporting]=useState(false),[draft,setDraft]=useState<RosterDraft>({text:'',fileName:''}),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[loading,setLoading]=useState(false),[now,setNow]=useState(()=>Date.now());
 const requestEpoch=useRef(0);
 const accessFailureRef=useRef(onAccessFailure);
 useEffect(()=>{accessFailureRef.current=onAccessFailure;},[onAccessFailure]);
 const refresh=useCallback(async()=>{
  const generation=++requestEpoch.current;setLoading(true);
  try{setError('');const next=await readStudents(query,page);if(generation!==requestEpoch.current)return;setData(next);if(next.pagination.page!==page)setPage(next.pagination.page);}
  catch(caught:unknown){if(generation!==requestEpoch.current)return;const failure=caught instanceof AccessRequestError?caught:Object.assign(new Error(caught instanceof Error?caught.message:'Unable to load student access records.'),{status:500});setError(failure.message);if([401,403,428].includes(failure.status))void accessFailureRef.current(failure);}
  finally{if(generation===requestEpoch.current)setLoading(false);}
 },[query,page]);
 useEffect(()=>{const timer=window.setTimeout(()=>void refresh(),0);return()=>window.clearTimeout(timer);},[refresh]);
 useEffect(()=>{const timer=window.setTimeout(()=>{setQuery(search.trim());setPage(1);},300);return()=>window.clearTimeout(timer);},[search]);
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60_000);return()=>window.clearInterval(timer);},[]);
 useEffect(()=>()=>{requestEpoch.current++;},[]);
 async function save(action:string,payload:Record<string,unknown>){setBusy(true);setError('');setNotice('');try{await accessAction(action,payload);setEditor(null);await refresh();}catch(caught:unknown){const failure=caught instanceof AccessRequestError?caught:Object.assign(new Error(caught instanceof Error?caught.message:'Unable to save student access.'),{status:500});setError(failure.message);if([401,403,428].includes(failure.status))void accessFailureRef.current(failure);}finally{setBusy(false);}}
 const pagination=data.pagination;
 return <div className="access">{error&&<div role="alert" className="error-box">{error}</div>}{notice&&<p role="status" className="notice">{notice}</p>}<p className="body-copy">Approve records using the college’s current-student list. Email OTP proves mailbox access. A student must also have an active record and an enabled batch within its access dates. Graduation or deactivation applies on the next protected request.</p>
 <section><div className="section-head"><h2>Student batches</h2><Button variant="outline" size="sm" onClick={()=>setEditor({type:'cohort',name:'',admissionYear:new Date().getFullYear(),starts:dateInput(Date.now()),ends:'',active:true})}>Add batch</Button></div>{data.cohorts.length===0?<p className="body-copy">Add the confirmed current batches and access end dates. No dates are guessed automatically.</p>:<ul className="batch-list">{data.cohorts.map(cohort=><li key={cohort.id}><div><strong>{cohort.name}</strong><span className="muted">Admission {cohort.admission_year}</span></div><span className="muted">Access ends {dateInput(cohort.ends_at-1)}</span><span className={'pill '+(!cohort.active||now>=cohort.ends_at?'rose':'green')}>{!cohort.active?'Disabled':now>=cohort.ends_at?'Expired':'Enabled'}</span><Button variant="outline" size="sm" onClick={()=>setEditor({type:'cohort',id:cohort.id,name:cohort.name,admissionYear:cohort.admission_year,starts:dateInput(cohort.starts_at),ends:dateInput(cohort.ends_at-1),active:!!cohort.active})}>Edit</Button></li>)}</ul>}</section>
 <section className="ledger"><div className="section-head"><h2 className="row">Approved student records {loading&&<Busy/>}</h2><div className="row"><Button variant="outline" size="sm" disabled={!data.cohorts.length} onClick={()=>{setNotice('');setImporting(true);}}>Import a file</Button><Button variant="outline" size="sm" disabled={!data.cohorts.length} onClick={()=>setEditor({type:'student',name:'',email:'',usn:'',cohortId:data.cohorts[0]?.id||'',status:'active'})}>Add student</Button></div></div><div className="access-search"><Field label="Find a student" value={search} onChange={setSearch}/></div>{data.students.length>0&&<Table><TableHeader><TableRow><TableHead>Student</TableHead><TableHead>USN</TableHead><TableHead>Batch</TableHead><TableHead>Status</TableHead><TableHead/></TableRow></TableHeader><TableBody>{data.students.map(student=><TableRow key={student.id}><TableCell><div className="issue-cell"><strong>{student.name}</strong><small className="break-all">{student.email}</small></div></TableCell><TableCell data-label="USN">{student.usn}</TableCell><TableCell data-label="Batch">{student.cohort_name}</TableCell><TableCell><span className={'pill capitalize '+(student.status==='active'?'green':'rose')}>{student.status}</span></TableCell><TableCell><Button variant="outline" size="sm" onClick={()=>setEditor({type:'student',...student,cohortId:student.cohort_id})}>Edit access</Button></TableCell></TableRow>)}</TableBody></Table>}{data.students.length===0&&<p className="body-copy">{loading?'Loading student records…':'No student records match. Unlisted students cannot complete OTP sign-in.'}</p>}<div className="pager"><p className="muted" aria-live="polite">{pagination.total} matching records, page {pagination.page} of {pagination.totalPages}</p><div className="row"><Button variant="outline" size="sm" disabled={loading||page<=1} onClick={()=>setPage(page-1)}>Previous page</Button><Button variant="outline" size="sm" disabled={loading||page>=pagination.totalPages} onClick={()=>setPage(page+1)}>Next page</Button></div></div></section>
 {editor&&<AccessEditor key={editor.type+(editor.id||'')} record={editor} cohorts={data.cohorts} error={error} busy={busy} onClose={()=>!busy&&setEditor(null)} onSave={save}/>}
 {importing&&<RosterImport cohorts={data.cohorts} draft={draft} onDraft={setDraft} onClose={()=>setImporting(false)} onImported={summary=>{setImporting(false);setDraft({text:'',fileName:''});setNotice(importedNotice(summary));void refresh();}} onAccessFailure={failure=>accessFailureRef.current(failure)}/>}</div>;
}

// The file is read in the browser and sent in chunks; the server checks every chunk again and
// writes each one whole or not at all. Re-importing a file skips the rows already saved.
export function RosterImport({cohorts,draft,onDraft,onClose,onImported,onAccessFailure}:RosterImportProps){
 const [cohortId,setCohortId]=useState(cohorts[0]?.id||''),[report,setReport]=useState<ImportReport|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
 function edit(next:RosterDraft){onDraft(next);setReport(null);setError('');}
 async function choose(event:ChangeEvent<HTMLInputElement>){
  const input=event.currentTarget,file=input.files?.[0];input.value='';
  if(!file)return;
  if(/\.(xlsx?|xlsm|ods|numbers)$/i.test(file.name)){setError('Save the spreadsheet as CSV first. In Excel, choose File, Save As, CSV UTF-8, then choose that file here.');return;}
  if(file.size>ROSTER_MAX_LENGTH){setError('The file is larger than 2 MB. Split it into one file per batch.');return;}
  try{edit({text:await file.text(),fileName:file.name});}catch{setError('The file could not be read. Save it again as CSV and retry.');}
 }
 async function run(commit:boolean){
  const file=readRoster(draft.text),local=checkRoster(file.rows,{allowedEmail:isPilotEmail}),found=[...file.problems,...local.problems];
  if(found.length){setError('');setReport({summary:{...emptySummary(),rows:file.rows.length},problems:found.slice(0,100),problemCount:found.length,columns:file.columns,ignored:file.ignored});return;}
  setBusy(true);setError('');let saved=0;
  try{
   const total=await sendRosterChunks(file.rows,async(rows,start)=>{
    setProgress(`${commit?'Importing':'Checking'} rows ${count(start+1)} to ${count(start+rows.length)} of ${count(file.rows.length)}…`);
    const result=await accessAction('import_students',{rows,cohortId,commit}) as unknown as RosterChunkReport;
    if(commit)saved+=rows.length;
    return result;
   });
   if(commit){onImported(total.summary);return;}
   setReport({...total,columns:file.columns,ignored:file.ignored});
  }catch(caught:unknown){
   const failure=caught instanceof AccessRequestError?caught:Object.assign(new Error(caught instanceof Error?caught.message:'The import could not be completed.'),{status:500});
   setReport(null);setError(saved?`${failure.message} Rows up to line ${count(file.rows[saved-1][0])} were saved. Import the same file again to finish; rows already saved are skipped.`:failure.message);
   if([401,403,428].includes(failure.status))void onAccessFailure(failure);
  }finally{setBusy(false);setProgress('');}
 }
 const ready=!!report&&!report.problemCount,changes=report?report.summary.create+report.summary.update:0;
 return <Dialog open onOpenChange={open=>!open&&!busy&&onClose()}><DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Import students from a file</DialogTitle><DialogDescription>Use the college’s current-student list. The first row names the columns: email, name and USN, and optionally batch and status.</DialogDescription></DialogHeader>
 <div className="space-y-4">{error&&<p role="alert" className="error-box">{error}</p>}
 <ul className="import-rules"><li>A new email adds a student. An email already on the list updates that student’s name, USN and batch.</li><li>Status changes only when the file has a status column. Students missing from the file are left as they are.</li></ul>
 <div className="field"><label>Choose a CSV file<Input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" onChange={event=>void choose(event)} disabled={busy} className="mt-2"/></label><small>{draft.fileName?`Loaded ${draft.fileName}.`:'From Excel or Google Sheets, save or download the sheet as CSV.'}</small></div>
 <div className="field"><label>Or paste the rows, column names first<Textarea value={draft.text} onChange={event=>edit({text:event.currentTarget.value,fileName:''})} disabled={busy} spellCheck={false} placeholder="email,name,usn,batch" className="mt-2 max-h-56 font-mono text-xs"/></label></div>
 <SelectField label="Batch for rows without one" value={cohortId} onChange={value=>{setCohortId(value);setReport(null);}} options={cohorts.map(cohort=>({value:cohort.id,label:cohort.name}))} disabled={busy}/>
 {report&&<div className="import-report" aria-live="polite"><p>{report.summary.rows>0&&<strong>{plural(report.summary.rows,'student row')} checked. </strong>}{report.problemCount?`Fix ${plural(report.problemCount,'problem')} below, then check the file again. Nothing has been imported.`:changes?`${count(report.summary.create)} new, ${count(report.summary.update)} updated, ${count(report.summary.unchanged)} already up to date.`:'Every row already matches the student records.'}</p>
  {ready&&report.summary.reactivate>0&&<p className="notice">{plural(report.summary.reactivate,'student')} marked graduated, withdrawn or suspended will be set back to active by the status column.</p>}
  {ready&&!report.columns.status&&<p className="muted">The file has no status column, so current students keep their status and new students start as active.</p>}
  {report.ignored.length>0&&<p className="muted">Ignored columns: {report.ignored.join(', ')}.</p>}
  {report.problems.length>0&&<ol className="problem-list">{report.problems.map((problem,index)=><li key={index}><span className="measured">Line {count(problem.line)}</span><span>{problem.message}</span></li>)}</ol>}
  {report.problemCount>report.problems.length&&<p className="muted">There {report.problemCount-report.problems.length===1?'is':'are'} {plural(report.problemCount-report.problems.length,'more problem')} after these.</p>}</div>}
 {progress&&<p className="row muted" role="status"><Busy/>{progress}</p>}
 <div className="form-actions"><Button type="button" variant="ghost" onClick={downloadTemplate} disabled={busy}>Download a blank template</Button>{ready&&changes?<Button type="button" onClick={()=>void run(true)} disabled={busy}>{busy&&<Busy/>}Import {plural(changes,'record')}</Button>:<Button type="button" onClick={()=>void run(false)} disabled={busy||!draft.text.trim()||ready&&!changes}>{busy&&<Busy/>}{ready&&!changes?'Nothing to import':'Check the file'}</Button>}</div>
 </div></DialogContent></Dialog>;
}

function AccessEditor({record,cohorts,error,busy,onClose,onSave}:AccessEditorProps){
 const [value,setValue]=useState(record);
 const set=(key:keyof StudentAccessEditorRecord)=>(next:string|number|boolean)=>setValue(previous=>({...previous,[key]:next}));
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(value.type==='cohort')void onSave('save_cohort',{id:value.id,name:value.name,admissionYear:Number(value.admissionYear),startsAt:Date.parse(`${value.starts}T00:00:00+05:30`),endsAt:Date.parse(`${value.ends}T23:59:59+05:30`)+1000,active:value.active});
  else void onSave('save_student',{email:value.email,name:value.name,usn:value.usn,cohortId:value.cohortId,status:value.status});
 }
 return <Dialog open onOpenChange={open=>!open&&onClose()}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{value.type==='cohort'?'Batch access dates':'Student eligibility record'}</DialogTitle></DialogHeader><form onSubmit={submit} className="space-y-4">{error&&<p role="alert" className="error-box">{error}</p>}<Field label={value.type==='cohort'?'Batch name':'Student name'} value={value.name} onChange={set('name')} required/>{value.type==='cohort'?<><Field label="Admission year" type="number" min={2000} max={2100} value={value.admissionYear||''} onChange={set('admissionYear')} required/><Field label="Access starts (IST)" type="date" value={value.starts||''} onChange={set('starts')} required/><Field label="Access ends (IST)" type="date" value={value.ends||''} onChange={set('ends')} required/><label className="switch-row">Enable batch access<Switch checked={!!value.active} onCheckedChange={set('active')}/></label></>:<><Field label="Official college email" type="email" value={value.email||''} onChange={set('email')} readOnly={!!value.id} required/><Field label="USN" value={value.usn||''} onChange={set('usn')} required/><Picker label="Student batch" value={value.cohortId||''} onChange={set('cohortId')} options={cohorts.map(cohort=>({value:cohort.id,label:cohort.name}))}/><Picker label="Enrollment status" value={value.status||'active'} onChange={set('status')} options={['active','graduated','withdrawn','suspended']}/></>}<Button type="submit" disabled={busy} className="w-full">{busy&&<Busy/>}Save access record</Button></form></DialogContent></Dialog>;
}
