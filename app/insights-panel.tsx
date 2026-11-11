'use client';
import {useEffect,useId,useMemo,useState} from 'react';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {read,Busy,Empty,CategoryChip,PriorityBadge,Avatar} from './ui';
import CampusMap,{STATUS_GROUPS,type StatusGroup} from './campus-map';
import {ASSIGNMENT,DUPLICATE_THRESHOLD,HOTSPOT,PRIORITY_WEIGHTS,SCAN,SEED_CORPUS,duplicatePairs,evaluateClassifier,haversine,predictNaiveBayes,priorityScore,ruleBaselineDuplicate,spaceTimeScan,stDbscan,suggestAssignments,trainNaiveBayes} from '@/lib/algorithms';
import type {PriorityWeights} from '@/lib/algorithms';
import type {Organisation,Workspace,WorkspaceInsights} from '@/lib/models';
import TodoView,{LEVELS,readLevel,saveLevel,type Level} from './insights-todo';

type Data=WorkspaceInsights;
type LabProps={data:Data;workspace:Workspace;onOpen:(id:string)=>void};
const pct=(x:number)=>Math.round(x*100)+'%';
const DAY=86_400_000;
const FACTORS:{key:keyof PriorityWeights;label:string;slot:number}[]=[{key:'severity',label:'Category severity',slot:1},{key:'safety',label:'Safety words',slot:2},{key:'crowd',label:'Others affected',slot:3},{key:'age',label:'Waiting time',slot:4},{key:'staff',label:'Staff priority',slot:5},{key:'credibility',label:'Reporter record',slot:7}];
const slotColour=(slot:number)=>({['--seg' as string]:`var(--color-category-${slot})`});

function Slider({label,value,min,max,step,onChange,format=(v:number)=>String(v)}:{label:string;value:number;min:number;max:number;step:number;onChange:(v:number)=>void;format?:(v:number)=>string}){
 const id=useId();
 return <div className="slider"><label htmlFor={id}><span>{label}</span><b>{format(value)}</b></label><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.currentTarget.value))}/></div>;
}
function PartBars({parts}:{parts:{text:number;space:number;time:number;photo:number|null}}){
 return <span className="match-bars" aria-label={`Wording ${pct(parts.text)}, place ${pct(parts.space)}, time ${pct(parts.time)}${parts.photo==null?'':`, photo ${pct(parts.photo)}`}`}><i style={{['--v' as string]:parts.text}} data-label="Wording"/><i style={{['--v' as string]:parts.space}} data-label="Place"/><i style={{['--v' as string]:parts.time}} data-label="Time"/>{parts.photo!=null&&<i style={{['--v' as string]:parts.photo}} data-label="Photo"/>}</span>;
}

/* Hotspots on the campus map: ST-DBSCAN to explore, the space-time permutation scan to test */
function MapLab({data,workspace,onOpen}:LabProps){
 const [method,setMethod]=useState<'density'|'scan'>('density');
 const [eps,setEps]=useState(HOTSPOT.epsMetres),[days,setDays]=useState(HOTSPOT.epsDays),[minPoints,setMinPoints]=useState(HOTSPOT.minPoints),[hidden,setHidden]=useState<Set<StatusGroup>>(()=>new Set(['rejected']));
 const result=useMemo(()=>stDbscan(data.points,{epsMetres:eps,epsDays:days,minPoints}),[data.points,eps,days,minPoints]);
 const scan=useMemo(()=>method==='scan'?spaceTimeScan(data.points):null,[method,data.points]);
 const significant=scan?scan.clusters.filter(c=>c.significant):[];
 const mapped=workspace.buildings.filter(b=>b.latitude!=null&&b.longitude!=null);
 const nearest=(lat:number,lng:number)=>mapped.map(b=>({name:b.name,d:haversine({latitude:lat,longitude:lng},{latitude:b.latitude!,longitude:b.longitude!})})).sort((a,b)=>a.d-b.d)[0]?.name;
 const where=(lat:number,lng:number)=>mapped.length?`, ${nearest(lat,lng)}`:'';
 const span=(h:{start:number;end:number})=>{const n=Math.max(1,Math.round((h.end-h.start)/DAY));return n===1?"1 day":`${n} days`;};
 const toggle=(g:StatusGroup)=>setHidden(prev=>{const next=new Set(prev);if(next.has(g))next.delete(g);else next.add(g);return next;});
 return <div className="lab lab-map">
  <div className="lab-main">
   <div className="map-legend" role="group" aria-label="Show or hide complaints by status">{STATUS_GROUPS.map(g=><button type="button" key={g.key} className={'legend-toggle is-'+g.key+(hidden.has(g.key)?' is-off':'')} aria-pressed={!hidden.has(g.key)} onClick={()=>toggle(g.key)}><i aria-hidden="true"/>{g.label}</button>)}<span className="legend-hotspot"><i aria-hidden="true"/>{method==='scan'?'Significant hotspot':'Hotspot'}</span></div>
   <CampusMap sites={workspace.sites} buildings={workspace.buildings} points={data.points} tickets={workspace.tickets} hotspots={method==='scan'?significant:result.hotspots} hidden={hidden} onOpen={onOpen}/>
  </div>
  <aside className="lab-side">
   <div className="lab-switch" role="group" aria-label="Hotspot method"><button type="button" aria-pressed={method==='density'} onClick={()=>setMethod('density')}>Density</button><button type="button" aria-pressed={method==='scan'} onClick={()=>setMethod('scan')}>Significance</button></div>
   {method==='density'?<>
    <h3>ST-DBSCAN</h3>
    <p className="body-copy">A report is a core point when at least {minPoints} reports, itself included, lie within {eps} m and {days} days of it. Clusters grow from core points; isolated reports are noise.</p>
    <Slider label="Distance ε₁" value={eps} min={5} max={200} step={5} onChange={setEps} format={v=>v+' m'}/>
    <Slider label="Time window ε₂" value={days} min={1} max={120} step={1} onChange={setDays} format={v=>v+' days'}/>
    <Slider label="Minimum reports" value={minPoints} min={2} max={8} step={1} onChange={setMinPoints}/>
    <p className="lab-result"><b>{result.hotspots.length}</b> hotspot{result.hotspots.length===1?'':'s'} and <b>{result.noise.length}</b> isolated of {data.points.length} mapped reports</p>
    {result.hotspots.length?<ol className="hotspot-list">{result.hotspots.map((h,i)=>{const top=Object.entries(h.categories).sort((a,b)=>b[1]-a[1])[0];return <li key={h.id}><b>Hotspot {i+1}{where(h.latitude,h.longitude)}</b><span>{h.members.length} reports in {span(h)}, within {Math.round(h.radius)} m</span>{top&&<span className="row">Mostly <CategoryChip category={top[0]}/> {top[1]} of {h.members.length}</span>}<button type="button" className="button-link" onClick={()=>onOpen(h.members[0])}>Open the latest report</button></li>;})}</ol>:<p className="body-copy">No cluster at these settings. Widen the distance or the time window, or lower the minimum.</p>}
   </>:<>
    <h3>Space-time permutation scan</h3>
    <p className="body-copy">Each place keeps its own usual rate: a cluster counts only when a circle of {SCAN.radii.join(', ')} m holds more reports in {SCAN.windows.join(', ')} days than its share of all reports predicts. Shuffling the dates {SCAN.replicates} times gives each cluster a p-value.</p>
    {scan&&<p className="lab-result"><b>{significant.length}</b> significant at p ≤ {SCAN.alpha} from {scan.candidates} candidate areas</p>}
    {scan&&scan.clusters.length?<ol className="hotspot-list">{scan.clusters.slice(0,5).map((h,i)=><li key={h.id} className={h.significant?'is-significant':''}><b>Cluster {i+1}{where(h.latitude,h.longitude)}</b><span>{h.observed} reports in {h.windowDays} days where {h.expected.toFixed(1)} were expected</span><span className="row">p = {h.p.toFixed(2)}, {h.significant?'significant':'could be chance'}</span><button type="button" className="button-link" onClick={()=>onOpen(h.members[0])}>Open the latest report</button></li>)}</ol>:<p className="body-copy">Too few mapped reports to test. The scan needs at least {SCAN.minPoints} in one place.</p>}
   </>}
  </aside>
 </div>;
}

/* Explainable priority with live weights */
function PriorityLab({data,onOpen}:LabProps){
 const [weights,setWeights]=useState<PriorityWeights>(PRIORITY_WEIGHTS);
 const open=useMemo(()=>data.tickets.filter(t=>t.priorityInput.open!==false),[data.tickets]);
 const baseline=useMemo(()=>new Map([...open].sort((a,b)=>b.priority.score-a.priority.score).map((t,i)=>[t.id,i+1])),[open]);
 const ranked=useMemo(()=>open.map(t=>({t,r:priorityScore(t.priorityInput,weights)})).sort((a,b)=>b.r.score-a.r.score),[open,weights]);
 const changed=FACTORS.some(f=>weights[f.key]!==PRIORITY_WEIGHTS[f.key]);
 return <div className="lab lab-split">
  <aside className="lab-side">
   <h3>Weights</h3>
   <p className="body-copy">P = 100 · Σ wᵢfᵢ / Σ wᵢ over the factors each complaint has. Move a weight and the queue re-ranks.</p>
   {FACTORS.map(f=><Slider key={f.key} label={f.label} value={weights[f.key]} min={0} max={1} step={0.05} onChange={v=>setWeights(w=>({...w,[f.key]:v}))} format={v=>v.toFixed(2)}/>)}
   {changed&&<button type="button" className="button-link" onClick={()=>setWeights(PRIORITY_WEIGHTS)}>Reset to the default weights</button>}
  </aside>
  <div className="lab-main">
   <div className="factor-legend">{FACTORS.map(f=><span key={f.key}><i style={slotColour(f.slot)} aria-hidden="true"/>{f.label}</span>)}</div>
   {ranked.length?<ol className="rank-list">{ranked.map(({t,r},i)=>{const before=baseline.get(t.id)!,move=before-(i+1);return <li key={t.id}><span className="rank">{i+1}{move!==0&&<small className={move>0?'is-up':'is-down'}>{move>0?`up ${move}`:`down ${-move}`}</small>}</span><button type="button" className="rank-title" onClick={()=>onOpen(t.id)}><b>{t.title}</b><small>{t.ticketNo}<CategoryChip category={t.category}/></small></button><span className="stack" role="img" aria-label={r.factors.map(f=>`${f.label} ${f.contribution.toFixed(0)}`).join(', ')}>{r.factors.map(f=><i key={f.key} style={{...slotColour(FACTORS.find(x=>x.key===f.key)!.slot),flexGrow:f.contribution}} title={`${f.label}: +${f.contribution.toFixed(1)} (${f.detail})`}/>)}<i className="stack-rest" style={{flexGrow:Math.max(0,100-r.score)}}/></span><PriorityBadge score={r.score} band={r.band}/></li>;})}</ol>:<Empty title="No open complaints">Scores appear when complaints are waiting or in repair.</Empty>}
  </div>
 </div>;
}

/* The duplicate score versus the same-room rule; photo reuse */
function DuplicateLab({data,onOpen}:LabProps){
 const [threshold,setThreshold]=useState(DUPLICATE_THRESHOLD);
 const pairs=useMemo(()=>duplicatePairs(data.reports,threshold),[data.reports,threshold]);
 const rule=useMemo(()=>{const out=new Set<string>();for(let i=0;i<data.reports.length;i++)for(let j=i+1;j<data.reports.length;j++)if(ruleBaselineDuplicate(data.reports[i],data.reports[j]))out.add(data.reports[i].id+'|'+data.reports[j].id);return out;},[data.reports]);
 const agree=pairs.filter(p=>rule.has(p.a+'|'+p.b)||rule.has(p.b+'|'+p.a)).length;
 const ticket=(id:string)=>data.tickets.find(t=>t.id===id);
 return <div className="lab lab-split">
  <aside className="lab-side">
   <h3>Duplicate score</h3>
   <p className="body-copy">S = c · place · time · (0.4 + 0.6 × wording). Place is 1 in the same room and falls off over 25 m; time halves in about a week. A near-identical photo closes a quarter of the remaining gap. c = 0.75 when categories differ.</p>
   <Slider label="Match threshold" value={threshold} min={0.1} max={0.9} step={0.05} onChange={setThreshold} format={pct}/>
   <dl className="lab-facts"><div><dt>Score pairs</dt><dd>{pairs.length}</dd></div><div><dt>Same-room rule pairs</dt><dd>{rule.size}</dd></div><div><dt>Found by both</dt><dd>{agree}</dd></div></dl>
   <p className="footnote">The rule is what most civic systems use: same room and category within 7 days. The score also catches reworded reports from the next room or under another category, and ranks same-room reports about different faults lower.</p>
   <h3 className="mt-6">Reused photos</h3>
   {data.reuse.length?<ul className="reuse-list">{data.reuse.map(p=><li key={p.a+p.b}><button type="button" className="button-link" onClick={()=>onOpen(p.a)}>{ticket(p.a)?.ticketNo}</button> and <button type="button" className="button-link" onClick={()=>onOpen(p.b)}>{ticket(p.b)?.ticketNo}</button><small>{p.distance} of 64 bits differ</small></li>)}</ul>:<p className="body-copy">No two photos are within 6 of 64 bits of each other.</p>}
  </aside>
  <div className="lab-main">
   {pairs.length?<ul className="pair-list">{pairs.slice(0,30).map(p=>{const a=ticket(p.a),b=ticket(p.b);return <li key={p.a+p.b}><div className="pair-titles"><button type="button" onClick={()=>onOpen(p.a)}><b>{a?.title}</b><small>{a?.ticketNo}</small></button><button type="button" onClick={()=>onOpen(p.b)}><b>{b?.title}</b><small>{b?.ticketNo}</small></button></div><PartBars parts={p.match.parts}/><span className="match-score">{pct(p.match.score)}<small>match</small></span></li>;})}</ul>:<Empty title="No pairs above the threshold">Lower the threshold to see weaker matches.</Empty>}
  </div>
 </div>;
}

/* Hungarian assignment with capacity slots */
function AssignmentLab({data,onOpen}:LabProps){
 const [capacity,setCapacity]=useState(ASSIGNMENT.capacity),[loadWeight,setLoadWeight]=useState(ASSIGNMENT.loadWeight);
 const plan=useMemo(()=>suggestAssignments(data.jobs,data.technicians,{capacity,loadWeight,skillWeight:1-loadWeight}),[data.jobs,data.technicians,capacity,loadWeight]);
 const ticket=(id:string)=>data.tickets.find(t=>t.id===id),tech=(id:string|null)=>data.technicians.find(t=>t.id===id);
 return <div className="lab lab-split">
  <aside className="lab-side">
   <h3>Optimal assignment</h3>
   <p className="body-copy">Each technician becomes {capacity} slots. A slot costs wL · load + wS · (1 − category match). The Hungarian algorithm picks the cheapest one-to-one plan in O(n³).</p>
   <Slider label="Jobs per technician" value={capacity} min={1} max={5} step={1} onChange={setCapacity}/>
   <Slider label="Workload weight wL" value={loadWeight} min={0} max={1} step={0.05} onChange={setLoadWeight} format={v=>`${v.toFixed(2)} (skill ${(1-v).toFixed(2)})`}/>
   <dl className="lab-facts"><div><dt>Waiting jobs</dt><dd>{data.jobs.length}</dd></div><div><dt>Technicians</dt><dd>{data.technicians.length}</dd></div><div><dt>Total cost</dt><dd>{plan.total.toFixed(2)}</dd></div></dl>
  </aside>
  <div className="lab-main">
   {!data.jobs.length?<Empty title="Nothing is waiting for assignment">Verified complaints without a technician appear here with a suggested assignee.</Empty>:!data.technicians.length?<Empty title="No technicians yet">Approve maintenance workers in People to plan assignments.</Empty>:<div className="cost-table-wrap"><table className="cost-table"><thead><tr><th>Job</th>{data.technicians.map(t=><th key={t.id}><span className="row"><Avatar name={t.name} size="sm"/>{t.name}</span><small>{t.load} open</small></th>)}<th>Suggested</th></tr></thead><tbody>{plan.jobs.map((jobId,i)=>{const s=plan.suggestions[i],tk=ticket(jobId);return <tr key={jobId}><th><button type="button" className="button-link" onClick={()=>onOpen(jobId)}>{tk?.ticketNo}</button><small>{tk?.title}</small></th>{plan.costTable[i].map((c,j)=>{const feasible=c<ASSIGNMENT.infeasible;return <td key={j} className={(data.technicians[j].id===s.technicianId?'is-chosen ':'')+(feasible?'':'is-out')} style={feasible?{['--v' as string]:Math.max(0,1-c)}:undefined}>{feasible?c.toFixed(2):'out of scope'}</td>;})}<td>{s.technicianId?<b>{tech(s.technicianId)?.name}</b>:'Leave unassigned'}</td></tr>;})}</tbody></table></div>}
  </div>
 </div>;
}

/* Lexicon-augmented Naive Bayes */
function ClassifierLab({workspace}:LabProps){
 const training=useMemo(()=>[...SEED_CORPUS,...workspace.tickets.filter(t=>!['duplicate','not_confirmed'].includes(t.verification)).map(t=>({text:`${t.title} ${t.item} ${t.description}`,label:t.category}))],[workspace.tickets]);
 const model=useMemo(()=>trainNaiveBayes(training),[training]);
 const [text,setText]=useState('Water is leaking from the pipe under the washroom sink');
 const result=useMemo(()=>predictNaiveBayes(model,text),[model,text]);
 const [evaluation,setEvaluation]=useState<{lexicon:ReturnType<typeof evaluateClassifier>;plain:ReturnType<typeof evaluateClassifier>}|null>(null);
 return <div className="lab lab-split">
  <aside className="lab-side">
   <h3>Category classifier</h3>
   <p className="body-copy">Multinomial Naive Bayes with Laplace smoothing, plus a domain word list as pseudo-counts. It suggests the category while a student types.</p>
   <dl className="lab-facts"><div><dt>Training examples</dt><dd>{training.length}</dd></div><div><dt>From this campus</dt><dd>{training.length-SEED_CORPUS.length}</dd></div><div><dt>Vocabulary</dt><dd>{model.vocabulary.length}</dd></div></dl>
   <Button type="button" onClick={()=>setEvaluation({lexicon:evaluateClassifier(training),plain:evaluateClassifier(training,1,null)})}>Evaluate leave-one-out</Button>
   {evaluation&&<dl className="lab-facts"><div><dt>Accuracy with word list</dt><dd>{pct(evaluation.lexicon.accuracy)}</dd></div><div><dt>Accuracy without</dt><dd>{pct(evaluation.plain.accuracy)}</dd></div><div><dt>Macro F1 with word list</dt><dd>{evaluation.lexicon.macroF1.toFixed(2)}</dd></div></dl>}
  </aside>
  <div className="lab-main">
   <label className="try-label" htmlFor="classifier-try">Try a complaint</label>
   <Textarea id="classifier-try" value={text} onChange={e=>setText(e.currentTarget.value)} className="try-input"/>
   <ul className="prediction-list">{result.predictions.slice(0,5).map(p=><li key={p.label}><CategoryChip category={p.label}/><span className="meter-bar" style={{['--v' as string]:p.probability}}/><b>{pct(p.probability)}</b></li>)}</ul>
   {!!result.evidence.length&&<p className="evidence-terms">Strongest evidence for {result.predictions[0]?.label}: {result.evidence.map(e=><span key={e.term}>{e.word}<small>+{e.weight.toFixed(1)}</small></span>)}</p>}
   {evaluation&&<><h3 className="mt-6">Leave-one-out confusion matrix</h3><div className="confusion-wrap"><table className="confusion"><thead><tr><th>Actual, predicted</th>{evaluation.lexicon.labels.map(l=><th key={l}>{l}</th>)}<th>Recall</th></tr></thead><tbody>{evaluation.lexicon.labels.map(a=>{const row=evaluation.lexicon.confusion[a],total=Object.values(row).reduce((s,n)=>s+n,0)||1,stats=evaluation.lexicon.perClass.find(c=>c.label===a)!;return <tr key={a}><th>{a}</th>{evaluation.lexicon.labels.map(b=><td key={b} className={a===b?'is-diagonal':''} style={{['--v' as string]:row[b]/total}}>{row[b]||''}</td>)}<td>{pct(stats.recall)}</td></tr>;})}</tbody></table></div></>}
  </div>
 </div>;
}

/* Beta reputation */
function ReporterLab({data}:LabProps){
 const rows=[...data.reporters].sort((a,b)=>b.credibility.score-a.credibility.score);
 return <div className="lab">
  <p className="body-copy lab-intro">Credibility is the expected value of Beta(1 + verified, 1 + not confirmed). The band is its 95% range, wide for new reporters and narrowing with every reviewed report. Duplicates count for neither side.</p>
  {rows.length?<ul className="reporter-list">{rows.map(r=><li key={r.id}><span className="row"><Avatar name={r.name}/><span><b>{r.name}</b><small>{r.verified} verified, {r.rejected} not confirmed</small></span></span><span className="interval" role="img" aria-label={`${pct(r.credibility.score)}, range ${pct(r.credibility.low)} to ${pct(r.credibility.high)}`}><i className="band" style={{left:pct(r.credibility.low),width:pct(r.credibility.high-r.credibility.low)}}/><i className="mark" style={{left:pct(r.credibility.score)}}/></span><span className={'credibility is-'+r.credibility.label.split(' ')[0].toLowerCase()}><b>{pct(r.credibility.score)}</b>{r.credibility.label}</span></li>)}</ul>:<Empty title="No reporters yet">Credibility appears once complaints are reviewed.</Empty>}
 </div>;
}

/* Weekly reported versus resolved */
function TrendLab({data}:LabProps){
 const [focus,setFocus]=useState<number|null>(null);
 const weeks=data.trend,max=Math.max(1,...weeks.flatMap(w=>[w.reported,w.resolved])),W=720,H=260,L=36,B=36,step=(W-L)/weeks.length,bar=Math.min(22,step/3);
 const y=(v:number)=>H-B-(H-B-12)*v/max,label=(t:number)=>new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short'});
 const ticks=Array.from(new Set([0,Math.round(max/2),max]));
 const f=focus==null?null:weeks[focus];
 return <div className="lab">
  <div className="factor-legend"><span><i style={slotColour(1)} aria-hidden="true"/>Reported</span><span><i style={slotColour(2)} aria-hidden="true"/>Resolved</span></div>
  <figure className="trend-chart"><svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Complaints reported and resolved per week, last eight weeks">
   {ticks.map(t=><g key={t} className="grid"><line x1={L} x2={W} y1={y(t)} y2={y(t)}/><text x={L-8} y={y(t)+4} textAnchor="end">{t}</text></g>)}
   {weeks.map((w,i)=>{const x=L+i*step+step/2;return <g key={w.from} className={'week'+(focus===i?' is-focus':'')} tabIndex={0} role="img" aria-label={`Week of ${label(w.from)}: ${w.reported} reported, ${w.resolved} resolved`} onMouseEnter={()=>setFocus(i)} onMouseLeave={()=>setFocus(null)} onFocus={()=>setFocus(i)} onBlur={()=>setFocus(null)}><rect className="hit" x={L+i*step} y="0" width={step} height={H-B}/><rect className="bar s1" x={x-bar-1} y={y(w.reported)} width={bar} height={Math.max(0,H-B-y(w.reported))} rx="4"/><rect className="bar s2" x={x+1} y={y(w.resolved)} width={bar} height={Math.max(0,H-B-y(w.resolved))} rx="4"/><text x={x} y={H-12} textAnchor="middle">{label(w.from)}</text></g>;})}
   <line className="baseline" x1={L} x2={W} y1={H-B} y2={H-B}/>
  </svg><figcaption aria-live="polite">{f?`Week of ${label(f.from)}: ${f.reported} reported, ${f.resolved} resolved.`:'Point at a week to read its numbers.'}</figcaption></figure>
 </div>;
}

/* The research view: every algorithm with its parameters, for the project report and for tuning. */
function HowItWorks({data,workspace,onOpen}:LabProps){
 const [tab,setTab]=useState('map');
 const props={data,workspace,onOpen};
 const open=data.tickets.filter(t=>t.priorityInput.open!==false);
 const summary:[string,string,number,string][]=[['map','Hotspots',data.hotspots.length,'ST-DBSCAN'],['priority','Critical or high',open.filter(t=>['Critical','High'].includes(t.priority.band)).length,'Priority score'],['duplicates','Likely duplicates',data.duplicates.length,'Duplicate score'],['duplicates','Reused photos',data.reuse.length,'dHash'],['assignment','Ready to assign',data.jobs.length,'Hungarian'],['reporters','Reporters rated',data.reporters.length,'Beta reputation']];
 return <div className="insights">
  <p className="footnote">The algorithms behind the To do list, with their settings. Changes here are for exploring and are not saved. docs/ALGORITHMS.md explains each one.</p>
  <div className="insight-summary">{summary.map(([target,label,value,method])=><button type="button" key={label} className={tab===target?'is-current':''} onClick={()=>setTab(target)}><b className="num">{value}</b><span>{label}</span><small>{method}</small></button>)}</div>
  <Tabs value={tab} onValueChange={setTab}>
   <TabsList className="insights-tabs"><TabsTrigger value="map">Campus map</TabsTrigger><TabsTrigger value="priority">Priority</TabsTrigger><TabsTrigger value="duplicates">Duplicates</TabsTrigger><TabsTrigger value="assignment">Assignment</TabsTrigger><TabsTrigger value="classifier">Classifier</TabsTrigger><TabsTrigger value="reporters">Reporters</TabsTrigger><TabsTrigger value="trends">Trends</TabsTrigger></TabsList>
   <TabsContent value="map"><MapLab {...props}/></TabsContent>
   <TabsContent value="priority"><PriorityLab {...props}/></TabsContent>
   <TabsContent value="duplicates"><DuplicateLab {...props}/></TabsContent>
   <TabsContent value="assignment"><AssignmentLab {...props}/></TabsContent>
   <TabsContent value="classifier"><ClassifierLab {...props}/></TabsContent>
   <TabsContent value="reporters"><ReporterLab {...props}/></TabsContent>
   <TabsContent value="trends"><TrendLab {...props}/></TabsContent>
  </Tabs>
 </div>;
}

type PanelProps={org:Organisation;workspace:Workspace;onOpen:(id:string)=>void;onChanged:()=>void|Promise<void>};
export default function InsightsPanel({org,workspace,onOpen,onChanged}:PanelProps){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[view,setView]=useState<'todo'|'how'>('todo');
 const [level,setLevel]=useState<Level>(()=>readLevel(org.id));
 useEffect(()=>{let live=true;read<Data>('op=insights&org='+encodeURIComponent(org.id)).then(d=>{if(live){setData(d);setError('');}}).catch(e=>{if(live)setError((e as Error).message);});return()=>{live=false;};},[org.id,workspace.tickets]);
 if(error)return <div role="alert" className="error-box">{error}</div>;
 if(!data)return <div className="insights-loading" role="status"><Busy/>Checking your complaints…</div>;
 const choose=(l:Level)=>{setLevel(l);saveLevel(org.id,l);};
 return <div className="insights-shell">
  <div className="insights-bar">
   <div className="view-switch" role="group" aria-label="View"><button type="button" aria-pressed={view==='todo'} onClick={()=>setView('todo')}>To do</button><button type="button" aria-pressed={view==='how'} onClick={()=>setView('how')}>How it works</button></div>
   {view==='todo'&&<div className="flag-level"><span id="flag-level-label">Flag</span><div className="view-switch" role="group" aria-labelledby="flag-level-label">{LEVELS.map(l=><button type="button" key={l.key} aria-pressed={level===l.key} onClick={()=>choose(l.key)}>{l.label}</button>)}</div></div>}
  </div>
  {view==='todo'?<TodoView data={data} workspace={workspace} org={org} level={level} onOpen={onOpen} onChanged={onChanged}/>:<HowItWorks data={data} workspace={workspace} onOpen={onOpen}/>}
 </div>;
}
