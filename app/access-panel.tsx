'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Switch} from '@/components/ui/switch';
import {Field,Picker,Busy} from './ui';
import {AccessRequestError,accessAction} from './access-client';
import type {AccessCohort,ApiError,StudentAccessData,StudentAccessEditorRecord} from '@/lib/models';

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

export function StudentAccessPanel({onAccessFailure}:AccessPanelProps){
 const [data,setData]=useState<StudentAccessData>({cohorts:[],students:[],pagination:{page:1,pageSize:100,total:0,totalPages:1}});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[editor,setEditor]=useState<StudentAccessEditorRecord|null>(null),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[loading,setLoading]=useState(false),[now,setNow]=useState(()=>Date.now());
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
 async function save(action:string,payload:Record<string,unknown>){setBusy(true);setError('');try{await accessAction(action,payload);setEditor(null);await refresh();}catch(caught:unknown){const failure=caught instanceof AccessRequestError?caught:Object.assign(new Error(caught instanceof Error?caught.message:'Unable to save student access.'),{status:500});setError(failure.message);if([401,403,428].includes(failure.status))void accessFailureRef.current(failure);}finally{setBusy(false);}}
 const pagination=data.pagination;
 return <div className="access">{error&&<div role="alert" className="error-box">{error}</div>}<p className="body-copy">Approve records using the college’s current-student list. Email OTP proves mailbox access. A student must also have an active record and an enabled batch within its access dates. Graduation or deactivation applies on the next protected request.</p>
 <section><div className="section-head"><h2>Student batches</h2><Button variant="outline" size="sm" onClick={()=>setEditor({type:'cohort',name:'',admissionYear:new Date().getFullYear(),starts:dateInput(Date.now()),ends:'',active:true})}>Add batch</Button></div>{data.cohorts.length===0?<p className="body-copy">Add the confirmed current batches and access end dates. No dates are guessed automatically.</p>:<ul className="batch-list">{data.cohorts.map(cohort=><li key={cohort.id}><div><strong>{cohort.name}</strong><span className="muted">Admission {cohort.admission_year}</span></div><span className="muted">Access ends {dateInput(cohort.ends_at-1)}</span><span className={'pill '+(!cohort.active||now>=cohort.ends_at?'rose':'green')}>{!cohort.active?'Disabled':now>=cohort.ends_at?'Expired':'Enabled'}</span><Button variant="outline" size="sm" onClick={()=>setEditor({type:'cohort',id:cohort.id,name:cohort.name,admissionYear:cohort.admission_year,starts:dateInput(cohort.starts_at),ends:dateInput(cohort.ends_at-1),active:!!cohort.active})}>Edit</Button></li>)}</ul>}</section>
 <section className="ledger"><div className="section-head"><h2 className="row">Approved student records {loading&&<Busy/>}</h2><Button variant="outline" size="sm" disabled={!data.cohorts.length} onClick={()=>setEditor({type:'student',name:'',email:'',usn:'',cohortId:data.cohorts[0]?.id||'',status:'active'})}>Add student</Button></div><div className="access-search"><Field label="Find a student" value={search} onChange={setSearch}/></div>{data.students.length>0&&<Table><TableHeader><TableRow><TableHead>Student</TableHead><TableHead>USN</TableHead><TableHead>Batch</TableHead><TableHead>Status</TableHead><TableHead/></TableRow></TableHeader><TableBody>{data.students.map(student=><TableRow key={student.id}><TableCell><div className="issue-cell"><strong>{student.name}</strong><small className="break-all">{student.email}</small></div></TableCell><TableCell data-label="USN">{student.usn}</TableCell><TableCell data-label="Batch">{student.cohort_name}</TableCell><TableCell><span className={'pill capitalize '+(student.status==='active'?'green':'rose')}>{student.status}</span></TableCell><TableCell><Button variant="outline" size="sm" onClick={()=>setEditor({type:'student',...student,cohortId:student.cohort_id})}>Edit access</Button></TableCell></TableRow>)}</TableBody></Table>}{data.students.length===0&&<p className="body-copy">{loading?'Loading student records…':'No student records match. Unlisted students cannot complete OTP sign-in.'}</p>}<div className="pager"><p className="muted" aria-live="polite">{pagination.total} matching records, page {pagination.page} of {pagination.totalPages}</p><div className="row"><Button variant="outline" size="sm" disabled={loading||page<=1} onClick={()=>setPage(page-1)}>Previous page</Button><Button variant="outline" size="sm" disabled={loading||page>=pagination.totalPages} onClick={()=>setPage(page+1)}>Next page</Button></div></div></section>
 {editor&&<AccessEditor key={editor.type+(editor.id||'')} record={editor} cohorts={data.cohorts} error={error} busy={busy} onClose={()=>!busy&&setEditor(null)} onSave={save}/>}</div>;
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
