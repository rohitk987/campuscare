'use client';
import {useMemo,useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {api,ago,CategoryChip,PriorityBadge,Avatar} from './ui';
import {DUPLICATE_THRESHOLD,HOTSPOT,duplicatePairs,haversine,stDbscan} from '@/lib/algorithms';
import type {Complaint,Organisation,Workspace,WorkspaceInsights} from '@/lib/models';
import {daysText,listText,matchLabel,matchReasons,priorityReason,reporterLine,technicianReason} from './plain';

export type Level='fewer'|'normal'|'more';
export const LEVELS:{key:Level;label:string}[]=[{key:'fewer',label:'Fewer'},{key:'normal',label:'Normal'},{key:'more',label:'More'}];
// One setting instead of thresholds and distances: how readily the system raises a flag. A work list should
// hold what is worth acting on, so Normal shows likely matches (score ≥ 0.45, the "Likely the same" label) and
// More shows everything at the evaluated threshold; the complaint sheet and report form keep the threshold.
const PRESETS:Record<Level,{threshold:number;hotspot:{epsMetres:number;epsDays:number;minPoints:number}}>={
 fewer:{threshold:0.6,hotspot:{epsMetres:15,epsDays:7,minPoints:5}},
 normal:{threshold:0.45,hotspot:HOTSPOT},
 more:{threshold:DUPLICATE_THRESHOLD,hotspot:{epsMetres:25,epsDays:14,minPoints:3}},
};

const stored=<T,>(key:string,fallback:T):T=>{try{const v=typeof window==='undefined'?null:window.localStorage.getItem(key);return v?JSON.parse(v) as T:fallback;}catch{return fallback;}};
const store=(key:string,value:unknown)=>{try{window.localStorage.setItem(key,JSON.stringify(value));}catch{/* private mode: the choice lasts this visit */}};
export const levelKey=(org:string)=>`campuscare.flags.${org}`;
export const readLevel=(org:string):Level=>{const v=stored<string>(levelKey(org),'normal');return v==='fewer'||v==='more'?v:'normal';};
export const saveLevel=(org:string,level:Level)=>store(levelKey(org),level);

const reviewable=(t:Complaint)=>['pending','needs_info'].includes(t.verification);
const live=(t:Complaint)=>!['duplicate','not_confirmed'].includes(t.verification)&&!['resolved','closed'].includes(t.status);

type Props={data:WorkspaceInsights;workspace:Workspace;org:Organisation;level:Level;onOpen:(id:string)=>void;onChanged:()=>void|Promise<void>};

export default function TodoView({data,workspace,org,level,onOpen,onChanged}:Props){
 const byId=useMemo(()=>new Map(workspace.tickets.map(t=>[t.id,t])),[workspace.tickets]);
 const admin=workspace.member.role==='admin';
 const preset=PRESETS[level];
 const [busy,setBusy]=useState<string|null>(null),[confirm,setConfirm]=useState<string|null>(null);
 const [notSame,setNotSame]=useState<string[]>(()=>stored<string[]>(`campuscare.notsame.${org.id}`,[]));

 /* Same problem reported twice: the reviewable one is merged into the other (the older one when both wait). */
 const pairs=useMemo(()=>duplicatePairs(data.reports,preset.threshold).flatMap(p=>{
  const a=byId.get(p.a),b=byId.get(p.b);
  if(!a||!b||!live(a)||!live(b)||notSame.includes(p.a+'|'+p.b))return [];
  const [dup,orig]=reviewable(a)&&reviewable(b)?(a.created_at>=b.created_at?[a,b]:[b,a]):reviewable(a)?[a,b]:reviewable(b)?[b,a]:[null,null];
  return dup&&orig?[{key:p.a+'|'+p.b,dup,orig,score:p.match.score,reasons:matchReasons(p.match.parts)}]:[];
 }),[data.reports,preset.threshold,byId,notSame]);

 /* A photo used on two reports: ask the reporter of the newer one. */
 const photos=useMemo(()=>data.reuse.flatMap(p=>{
  const a=byId.get(p.a),b=byId.get(p.b);if(!a||!b)return [];
  const [newer,older]=a.created_at>=b.created_at?[a,b]:[b,a];
  return live(newer)?[{key:p.a+'|'+p.b,newer,older}]:[];
 }),[data.reuse,byId]);

 /* Verified jobs with a suggested technician. */
 const techs=useMemo(()=>new Map(data.technicians.map(t=>[t.id,t])),[data.technicians]);
 const jobs=useMemo(()=>data.assignments.suggestions.flatMap(s=>{const t=byId.get(s.jobId);return t&&t.verification==='verified'&&t.status==='awaiting_assignment'?[{t,tech:s.technicianId?techs.get(s.technicianId)||null:null}]:[];}),[data.assignments,byId,techs]);
 const ready=jobs.filter(j=>j.tech);

 /* Repeated problems in one place. */
 const mapped=workspace.buildings.filter(b=>b.latitude!=null&&b.longitude!=null);
 const near=(lat:number,lng:number)=>mapped.map(b=>({name:b.name,d:haversine({latitude:lat,longitude:lng},{latitude:b.latitude!,longitude:b.longitude!})})).sort((x,y)=>x.d-y.d)[0]?.name;
 const spots=useMemo(()=>stDbscan(data.points,preset.hotspot).hotspots,[data.points,preset.hotspot]);

 const fixFirst=useMemo(()=>data.tickets.filter(t=>t.priorityInput.open!==false&&byId.get(t.id)&&live(byId.get(t.id)!)).sort((a,b)=>b.priority.score-a.priority.score).slice(0,5),[data.tickets,byId]);
 const watch=data.reporters.filter(r=>r.credibility.label==='Doubtful');
 const [thisWeek,lastWeek]=[data.trend[data.trend.length-1],data.trend[data.trend.length-2]];

 async function act(key:string,t:Complaint,body:Record<string,unknown>,done:string){
  setBusy(key);
  try{await api('ticket_action',{orgId:org.id,ticketId:t.id,version:t.version,...body});toast.success(done);await onChanged();}
  catch(e){toast.error((e as Error).message);}
  finally{setBusy(null);setConfirm(null);}
 }
 async function assignAll(){
  setBusy('all');let n=0;
  try{for(const j of ready){await api('ticket_action',{orgId:org.id,ticketId:j.t.id,version:j.t.version,event:'assign',assigneeId:j.tech!.id,note:'Assigned from the suggested plan.'});n++;}toast.success(`${n} job${n===1?'':'s'} assigned.`);}
  catch(e){toast.error(`${n} assigned, then: ${(e as Error).message}`);}
  finally{setBusy(null);await onChanged();}
 }
 const dismiss=(key:string)=>setNotSame(prev=>{const next=[...prev,key];store(`campuscare.notsame.${org.id}`,next.slice(-200));return next;});
 const ticketLink=(t:Complaint)=><button type="button" className="button-link" onClick={()=>onOpen(t.id)}>{t.ticket_no}</button>;

 const counts:[string,string,number][]=[['todo-assign','Jobs to assign',ready.length],['todo-duplicates','Possible duplicates',pairs.length],['todo-photos','Photos to check',photos.length],['todo-places','Repeated problems',spots.length]];
 return <div className="todo">
  <nav className="todo-summary" aria-label="What needs a decision">{counts.map(([id,label,n])=><a key={id} href={'#'+id} className={n?'has-items':''}><b className="num">{n}</b><span>{label}</span></a>)}</nav>

  <section className="todo-section" id="todo-assign" aria-labelledby="todo-assign-h">
   <header><div><h2 id="todo-assign-h">Jobs to assign</h2><p>Verified complaints waiting for a technician. The suggestion balances everyone&apos;s workload and who has fixed this kind of problem before.</p></div>{admin&&ready.length>1&&<Button size="sm" onClick={()=>void assignAll()} disabled={!!busy}>{busy==='all'?'Assigning…':`Assign all ${ready.length}`}</Button>}</header>
   {!jobs.length?<p className="todo-empty">Nothing is waiting for a technician.</p>:<ul className="todo-list">{jobs.map(({t,tech})=><li key={t.id}>
    <div className="todo-main"><button type="button" className="todo-title" onClick={()=>onOpen(t.id)}>{t.title}</button><span className="todo-meta">{t.ticket_no}, {t.building}, {t.room}<CategoryChip category={t.category}/></span></div>
    <div className="todo-side">{tech?<span className="todo-who"><Avatar name={tech.name} size="sm"/><span><b>{tech.name}</b><small>{technicianReason(tech,t.category)}</small></span></span>:<span className="todo-note">No technician has room for this job right now.</span>}
     {admin&&tech&&<Button size="sm" variant="outline" onClick={()=>void act('assign-'+t.id,t,{event:'assign',assigneeId:tech.id,note:'Assigned from the suggested plan.'},`${t.ticket_no} assigned to ${tech.name}.`)} disabled={!!busy}>{busy==='assign-'+t.id?'Assigning…':'Assign'}</Button>}</div>
   </li>)}</ul>}
   {!admin&&!!jobs.length&&<p className="todo-note">An administrator assigns jobs.</p>}
   {!data.technicians.length&&<p className="todo-note">Add a technician in People to get suggestions.</p>}
  </section>

  <section className="todo-section" id="todo-duplicates" aria-labelledby="todo-dup-h">
   <header><div><h2 id="todo-dup-h">Possible duplicates</h2><p>Two reports that look like the same problem. Merging keeps one complaint and moves the reporter onto it.</p></div></header>
   {!pairs.length?<p className="todo-empty">No reports look like the same problem.</p>:<ul className="todo-list">{pairs.slice(0,12).map(p=><li key={p.key}>
    <div className="todo-main"><span className="todo-label">{matchLabel(p.score)}</span><span className="todo-pair"><button type="button" className="todo-title" onClick={()=>onOpen(p.dup.id)}>{p.dup.title}</button><span className="todo-meta">{p.dup.ticket_no}, {ago(p.dup.created_at)}</span><button type="button" className="todo-title" onClick={()=>onOpen(p.orig.id)}>{p.orig.title}</button><span className="todo-meta">{p.orig.ticket_no}, {ago(p.orig.created_at)}</span></span>{!!p.reasons.length&&<span className="todo-why">{listText(p.reasons).replace(/^./,c=>c.toUpperCase())}.</span>}</div>
    <div className="todo-side">{confirm===p.key?<><span className="todo-note">Merge {p.dup.ticket_no} into {p.orig.ticket_no}?</span><Button size="sm" onClick={()=>void act('merge-'+p.key,p.dup,{event:'duplicate',duplicateId:p.orig.id,note:`Same problem as ${p.orig.ticket_no}.`},`${p.dup.ticket_no} merged into ${p.orig.ticket_no}.`)} disabled={!!busy}>{busy==='merge-'+p.key?'Merging…':'Yes, merge'}</Button><Button size="sm" variant="ghost" onClick={()=>setConfirm(null)}>Cancel</Button></>:<><Button size="sm" variant="outline" onClick={()=>setConfirm(p.key)} disabled={!!busy}>Merge</Button><Button size="sm" variant="ghost" onClick={()=>dismiss(p.key)}>Not the same</Button></>}</div>
   </li>)}</ul>}
  </section>

  <section className="todo-section" id="todo-photos" aria-labelledby="todo-photo-h">
   <header><div><h2 id="todo-photo-h">Photos to check</h2><p>The same photo was sent with two different reports. It may be a mistake, or an old photo reused.</p></div></header>
   {!photos.length?<p className="todo-empty">Every photo is unique.</p>:<ul className="todo-list">{photos.map(p=><li key={p.key}>
    <div className="todo-main"><button type="button" className="todo-title" onClick={()=>onOpen(p.newer.id)}>{p.newer.title}</button><span className="todo-meta">{ticketLink(p.newer)} uses the same photo as {ticketLink(p.older)}</span></div>
    <div className="todo-side">{reviewable(p.newer)?<Button size="sm" variant="outline" onClick={()=>void act('photo-'+p.key,p.newer,{event:'needs_info',note:'The photo on this report matches another report. Please confirm the problem or send a fresh photo.'},`Asked the reporter of ${p.newer.ticket_no} for a fresh photo.`)} disabled={!!busy}>{busy==='photo-'+p.key?'Sending…':'Ask the reporter'}</Button>:<Button size="sm" variant="ghost" onClick={()=>onOpen(p.newer.id)}>Open</Button>}</div>
   </li>)}</ul>}
  </section>

  <section className="todo-section" id="todo-places" aria-labelledby="todo-place-h">
   <header><div><h2 id="todo-place-h">Repeated problems</h2><p>Several reports from one spot in a short time. Worth inspecting the whole area, not only each fault.</p></div></header>
   {!spots.length?<p className="todo-empty">No spot has repeated reports right now.</p>:<ul className="todo-list">{spots.map(h=>{const members=h.members.map(id=>byId.get(id)).filter((t):t is Complaint=>!!t).sort((a,b)=>b.created_at-a.created_at),top=Object.entries(h.categories).sort((a,b)=>b[1]-a[1])[0];return <li key={h.id}>
    <div className="todo-main"><b className="todo-title-static">{near(h.latitude,h.longitude)||members[0]?.building||'One area'}: {h.members.length} reports in {daysText(h.start,h.end)}</b><span className="todo-meta">{top&&<>Mostly <CategoryChip category={top[0]}/></>}{members.slice(0,4).map(t=><span key={t.id}>{ticketLink(t)}</span>)}</span></div>
    <div className="todo-side">{members[0]&&<Button size="sm" variant="ghost" onClick={()=>onOpen(members[0].id)}>Open the latest</Button>}</div>
   </li>;})}</ul>}
  </section>

  <section className="todo-section" id="todo-first" aria-labelledby="todo-first-h">
   <header><div><h2 id="todo-first-h">Fix first</h2><p>The most urgent open complaints, with the main reason for each.</p></div></header>
   {!fixFirst.length?<p className="todo-empty">No open complaints.</p>:<ul className="todo-list">{fixFirst.map(t=><li key={t.id}>
    <div className="todo-main"><button type="button" className="todo-title" onClick={()=>onOpen(t.id)}>{t.title}</button><span className="todo-meta">{t.ticketNo}<CategoryChip category={t.category}/></span><span className="todo-why">{priorityReason(t.priority.factors)}.</span></div>
    <div className="todo-side"><PriorityBadge score={t.priority.score} band={t.priority.band}/></div>
   </li>)}</ul>}
  </section>

  <div className="todo-foot">
   <section aria-labelledby="todo-people-h"><h2 id="todo-people-h">Reporters to watch</h2>{watch.length?<ul className="todo-plain">{watch.map(r=><li key={r.id}><Avatar name={r.name} size="sm"/><span><b>{r.name}</b><small>{reporterLine(r.credibility)}</small></span></li>)}</ul>:<p className="todo-empty">No reporter has a poor record.</p>}</section>
   <section aria-labelledby="todo-week-h"><h2 id="todo-week-h">This week</h2>{thisWeek?<p className="todo-week"><b className="num">{thisWeek.reported}</b> reported, <b className="num">{thisWeek.resolved}</b> fixed{lastWeek?<small>Last week {lastWeek.reported} reported, {lastWeek.resolved} fixed.</small>:null}</p>:<p className="todo-empty">No reports yet.</p>}</section>
  </div>
 </div>;
}
