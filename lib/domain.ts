export const categories=['Electrical','Plumbing','Furniture','Classroom technology','Drinking water','Appliances','Lifts','Gym equipment','Other'];
export const roles=['admin','verifier','technician','reporter'];
export type Position={latitude:number;longitude:number;accuracy:number;timestamp:number};
export type SiteBoundary={enabled:number;latitude:number|null;longitude:number|null;radius:number};
export type BuildingBoundary={latitude:number|null;longitude:number|null;radius:number};
export type AccessMember={id:string;role:string;site_scope:string};
export type ComplaintState={status:string;verification:string;reopen:string;assignee_id:string|null};
export type TransitionArguments={assigneeId?:string;duplicateId?:string};
export type TransitionPatch={verification?:string;status?:string;reopen?:string;duplicate_id?:string;assignee_id?:string;resolved_at?:number|null;priority?:string;updated_at?:number;last_event_id?:string;[key:string]:string|number|null|undefined};
export function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){const rad=Math.PI/180,p=(b.latitude-a.latitude)*rad,q=(b.longitude-a.longitude)*rad;const h=Math.sin(p/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(q/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
export function checkPosition(p:Position,site:SiteBoundary,maxAccuracy=50,now=Date.now()){
 if(![p.latitude,p.longitude,p.accuracy,p.timestamp].every(Number.isFinite)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180||p.accuracy<=0)throw new Error('Invalid location reading.');
 if(now-p.timestamp>30000||p.timestamp-now>10000)throw new Error('Your location reading has expired. Please check your location again.');
 if(!site.enabled||site.latitude==null||site.longitude==null)throw new Error('An administrator must configure and enable this site’s reporting boundary first.');
 if(p.accuracy>maxAccuracy)throw new Error(`Location accuracy is ±${Math.round(p.accuracy)} m. Move to a clearer area and retry (required: ±${maxAccuracy} m or better).`);
 const d=distance(p,{latitude:site.latitude!,longitude:site.longitude!});if(d-p.accuracy>site.radius)throw new Error('You appear to be outside this site. You can still track existing complaints from anywhere.');
 if(d+p.accuracy>site.radius)throw new Error('Your location overlaps the site boundary. Move further inside and check again.');
 return {distance:Math.round(d),result:'passed'};
}
export function buildingCandidates<T extends BuildingBoundary>(p:Position,buildings:T[]){return buildings.filter(b=>b.latitude!=null&&b.longitude!=null&&distance(p,{latitude:b.latitude,longitude:b.longitude})<=b.radius+p.accuracy).map(b=>({...b,confident:distance(p,{latitude:b.latitude!,longitude:b.longitude!})+p.accuracy<=b.radius}));}
export function withinScope(member:AccessMember,siteId:string){return member.role==='admin'||member.site_scope==='*'||member.site_scope.split(',').includes(siteId);}
const statusLabels:Record<string,string>={awaiting_assignment:'Awaiting assignment',assigned:'Assigned',in_progress:'In progress',on_hold:'On hold',resolved:'Resolved',closed:'Closed'};
export function statusLabel(t:Pick<ComplaintState,'reopen'|'verification'|'status'>){if(t.reopen==='pending')return 'Reopening requested';if(t.verification==='pending')return 'Pending verification';if(t.verification==='needs_info')return 'Needs information';if(t.verification==='not_confirmed')return 'Not confirmed';if(t.verification==='duplicate')return 'Duplicate';return statusLabels[t.status]||'Submitted';}
export function statusColor(t:Pick<ComplaintState,'reopen'|'verification'|'status'>){const s=statusLabel(t);return ['Resolved','Closed'].includes(s)?'green':['Pending verification','Needs information','On hold','Reopening requested'].includes(s)?'amber':s==='Not confirmed'?'rose':'blue';}
export function transition(t:ComplaintState&{id:string;version:number},action:string,member:AccessMember,owner:boolean,args:TransitionArguments):TransitionPatch{
 const admin=member.role==='admin',reviewer=admin||member.role==='verifier',worker=admin||(member.role==='technician'&&t.assignee_id===member.id);
 const patch:TransitionPatch={};const need=(ok:boolean,message='This action is not permitted for your role or the current ticket status.')=>{if(!ok)throw new Error(message)};
 if(action==='verify'||action==='needs_info'||action==='not_confirmed'||action==='duplicate'){
  need(reviewer&&['pending','needs_info'].includes(t.verification));patch.verification=action==='verify'?'verified':action;patch.status=action==='verify'?'awaiting_assignment':'not_started';if(action==='duplicate'){need(!!args.duplicateId,'Select the original ticket.');patch.duplicate_id=args.duplicateId;}
 }else if(action==='clarify'){need(owner&&['needs_info','not_confirmed'].includes(t.verification));patch.verification='pending';patch.status='not_started';}
 else if(action==='assign'){need(admin&&t.verification==='verified'&&['awaiting_assignment','assigned','on_hold'].includes(t.status));need(!!args.assigneeId,'Select an assignee.');patch.assignee_id=args.assigneeId;patch.status='assigned';}
 else if(action==='start'){need(worker&&t.verification==='verified'&&['assigned','on_hold'].includes(t.status));patch.status='in_progress';}
 else if(action==='hold'){need(worker&&['assigned','in_progress'].includes(t.status));patch.status='on_hold';}
 else if(action==='resolve'){need(worker&&t.verification==='verified'&&['assigned','in_progress','on_hold'].includes(t.status));patch.status='resolved';patch.resolved_at=Date.now();patch.reopen='none';}
 else if(action==='close'){need((owner||admin)&&t.status==='resolved'&&t.reopen!=='pending');patch.status='closed';}
 else if(action==='request_reopen'){need(owner&&['resolved','closed'].includes(t.status)&&t.reopen!=='pending');patch.reopen='pending';}
 else if(action==='approve_reopen'){need(reviewer&&t.reopen==='pending');patch.reopen='none';patch.status=t.assignee_id?'assigned':'awaiting_assignment';patch.resolved_at=null;}
 else if(action==='decline_reopen'){need(reviewer&&t.reopen==='pending');patch.reopen='declined';}
 else if(action==='comment'){need(owner||reviewer||worker);}
 else throw new Error('Unknown action.');
 return patch;
}
