'use client';
import {useMemo,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {statusLabel} from '@/lib/domain';
import type {Hotspot} from '@/lib/algorithms';
import type {Building,Complaint,Site} from '@/lib/models';

export type MapPoint={id:string;latitude:number;longitude:number};
export type StatusGroup='review'|'active'|'hold'|'done'|'rejected';
export const STATUS_GROUPS:{key:StatusGroup;label:string}[]=[{key:'review',label:'Waiting for review'},{key:'active',label:'Being repaired'},{key:'hold',label:'On hold'},{key:'done',label:'Resolved'},{key:'rejected',label:'Not confirmed or duplicate'}];
export function statusGroup(t:Pick<Complaint,'status'|'verification'|'reopen'>):StatusGroup{
 const label=statusLabel(t);
 if(['Pending verification','Needs information','Reopening requested'].includes(label))return 'review';
 if(['Not confirmed','Duplicate'].includes(label))return 'rejected';
 if(label==='On hold')return 'hold';
 if(['Resolved','Closed'].includes(label))return 'done';
 return 'active';
}

const W=800,H=460,PAD=36,GOLDEN=2.399963;
type Props={sites:Site[];buildings:Building[];points:MapPoint[];tickets:Complaint[];hotspots:Hotspot[];hidden:Set<StatusGroup>;onOpen:(id:string)=>void};

/**
 * A map of the configured geofences, not a picture: an equirectangular projection around the site
 * centre, x = Δλ·cos φ₀·111 320 m, y = Δφ·110 540 m, scaled uniformly so circles stay circles.
 * Reports that share a capture point fan out on a golden-angle spiral so each stays clickable.
 */
export default function CampusMap({sites,buildings,points,tickets,hotspots,hidden,onOpen}:Props){
 const [hover,setHover]=useState<string|null>(null);
 const byId=useMemo(()=>new Map(tickets.map(t=>[t.id,t])),[tickets]);
 const geo=useMemo(()=>{
  const anchors=[...sites.filter(s=>s.latitude!=null&&s.longitude!=null).map(s=>({lat:s.latitude!,lng:s.longitude!,r:s.radius})),...buildings.filter(b=>b.latitude!=null&&b.longitude!=null).map(b=>({lat:b.latitude!,lng:b.longitude!,r:b.radius})),...points.map(p=>({lat:p.latitude,lng:p.longitude,r:10}))];
  if(!anchors.length)return null;
  const lat0=anchors.reduce((s,a)=>s+a.lat,0)/anchors.length,lng0=anchors.reduce((s,a)=>s+a.lng,0)/anchors.length,k=Math.cos(lat0*Math.PI/180);
  const local=(lat:number,lng:number)=>({x:(lng-lng0)*k*111_320,y:(lat-lat0)*110_540});
  const box=anchors.map(a=>({...local(a.lat,a.lng),r:a.r}));
  const minX=Math.min(...box.map(b=>b.x-b.r)),maxX=Math.max(...box.map(b=>b.x+b.r)),minY=Math.min(...box.map(b=>b.y-b.r)),maxY=Math.max(...box.map(b=>b.y+b.r));
  const scale=Math.min((W-2*PAD)/Math.max(1,maxX-minX),(H-2*PAD)/Math.max(1,maxY-minY));
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const project=(lat:number,lng:number)=>{const p=local(lat,lng);return {x:W/2+(p.x-cx)*scale,y:H/2-(p.y-cy)*scale};};
  return {project,scale};
 },[sites,buildings,points]);
 const placed=useMemo(()=>{
  if(!geo)return [];
  const seen=new Map<string,number>();
  return points.map(p=>{
   const base=geo.project(p.latitude,p.longitude),key=Math.round(base.x/4)+'|'+Math.round(base.y/4),n=seen.get(key)||0;seen.set(key,n+1);
   const r=n?9*Math.sqrt(n):0,a=n*GOLDEN;
   return {...p,x:base.x+r*Math.cos(a),y:base.y+r*Math.sin(a),ticket:byId.get(p.id)};
  }).filter(p=>p.ticket&&!hidden.has(statusGroup(p.ticket)));
 },[geo,points,byId,hidden]);
 if(!geo)return <div className="map-empty"><h3>No mapped locations yet</h3><p className="body-copy">Add a site boundary and buildings with coordinates in Locations to see the campus map.</p></div>;
 const bar=[10,25,50,100,200,500].find(m=>m*geo.scale>=70)||500,active=placed.find(p=>p.id===hover);
 // Building names draw after the hotspots so a hotspot ring never hides them.
 const mappedBuildings=buildings.filter(b=>b.latitude!=null&&b.longitude!=null).map(b=>{const c=geo.project(b.latitude!,b.longitude!);return {id:b.id,name:b.name,x:c.x,y:c.y,r:Math.max(10,b.radius*geo.scale)};});
 const key=(id:string)=>(e:KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(id);}};
 return <figure className="campus-map">
  <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Campus map of complaints, buildings and hotspots">
   <rect className="map-ground" x="0" y="0" width={W} height={H} rx="12"/>
   {sites.filter(s=>s.latitude!=null&&s.longitude!=null).map(s=>{const c=geo.project(s.latitude!,s.longitude!);return <g key={s.id} className="map-site"><circle cx={c.x} cy={c.y} r={s.radius*geo.scale}/><text x={c.x} y={c.y-s.radius*geo.scale+16} textAnchor="middle">{s.name}</text></g>;})}
   {mappedBuildings.map(b=><circle key={b.id} className="map-building" cx={b.x} cy={b.y} r={b.r}/>)}
   {hotspots.map((h,i)=>{const c=geo.project(h.latitude,h.longitude),r=Math.max(18,h.radius*geo.scale+16),tx=c.x+r*0.71,ty=c.y-r*0.71;return <g key={h.id} className="map-hotspot" aria-label={`Hotspot ${i+1}, ${h.members.length} reports`}><circle cx={c.x} cy={c.y} r={r}/><circle className="map-hotspot-tag" cx={tx} cy={ty} r="9"/><text x={tx} y={ty+4} textAnchor="middle">{i+1}</text></g>;})}
   {mappedBuildings.map(b=><text key={b.id} className="map-building-label" x={b.x} y={b.y-b.r-6} textAnchor="middle">{b.name}</text>)}
   {placed.map(p=><g key={p.id} className={'map-point is-'+statusGroup(p.ticket!)+(hover===p.id?' is-hover':'')} transform={`translate(${p.x} ${p.y})`} tabIndex={0} role="button" aria-label={`${p.ticket!.ticket_no}, ${p.ticket!.title}, ${statusLabel(p.ticket!)}`} onMouseEnter={()=>setHover(p.id)} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover(p.id)} onBlur={()=>setHover(null)} onClick={()=>onOpen(p.id)} onKeyDown={key(p.id)}><circle className="hit" r="14"/><circle className="dot" r="7"/></g>)}
   <g className="map-scale" transform={`translate(${PAD} ${H-PAD/2})`}><line x1="0" x2={bar*geo.scale} y1="0" y2="0"/><text x={bar*geo.scale+8} y="4">{bar} m</text></g>
  </svg>
  {active&&<div className="map-tooltip" style={{left:`${active.x/W*100}%`,top:`${active.y/H*100}%`}} role="status"><b>{active.ticket!.title}</b><span>{active.ticket!.ticket_no}, {active.ticket!.building}, {active.ticket!.room}</span><span>{statusLabel(active.ticket!)}{active.ticket!.priority_score!=null?`, priority ${active.ticket!.priority_score}`:''}</span></div>}
 </figure>;
}
