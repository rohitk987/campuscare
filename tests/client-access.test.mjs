import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

// Exercise the production root component with a small hook renderer and synthetic
// API responses. Visual child components are boundaries; access effects are real.
const original={window:globalThis.window,document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
let hooks=[],cursor=0,effects=[],dirty=false,tree,visitor,delayed=[],delayWorkspace=false;
const listeners=new Map();
const admin={id:'admin-id',email:'admin@bmsit.in',name:'Admin'},student={id:'student-id',email:'student@bmsit.in',name:'Student'};
const org={id:'bmsit-pilot',name:'BMSIT',color:'#305bea',demo:0};
const copy=value=>JSON.parse(JSON.stringify(value));
function workspace(identity){return {accessIdentity:{id:identity.id,email:identity.email},member:{role:identity.id===admin.id?'admin':'reporter'},sites:[],buildings:[],locations:[],members:[],notifications:[],following:[],tickets:identity.id===admin.id?[{id:'private',title:'Private admin-only issue',category:'Electrical',ticket_no:'CC-1',verification:'verified',status:'open',reopen:'none',priority:'Normal',building:'A',room:'Office',floor:'1',created_at:Date.now()}]:[]};}
const harness={
 useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;dirty=true;}];},
 useRef(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:{current:initial}};return hooks[index].value;},
 useCallback(callback,deps){const index=cursor++,previous=hooks[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))hooks[index]={deps,value:callback};return hooks[index].value;},
 useMemo(factory,deps){const index=cursor++,previous=hooks[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))hooks[index]={deps,value:factory()};return hooks[index].value;},
 useEffect(fn,deps){const index=cursor++,previous=hooks[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){hooks[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{previous?.cleanup?.();hooks[index].cleanup=fn();});}},
 api:async()=>({ok:true}),
 accessStatus:async()=>({userId:visitor.id,email:visitor.email,verified:true,configured:true}),
 async read(query){
  const identity=copy(visitor);
  if(query==='op=bootstrap')return {user:identity,organisations:[{...org,role:identity.id===admin.id?'admin':'reporter'}]};
  const response=workspace(identity);
  if(delayWorkspace){delayWorkspace=false;return new Promise(resolve=>delayed.push(()=>resolve(response)));}
  return response;
 },
};
globalThis.__campuscareClientTest=harness;
const source=await readFile(new URL('../app/campuscare.tsx',import.meta.url),'utf8');
const iconNames=source.match(/import \{([^}]+)\} from 'lucide-react'/)[1].split(',');
const uiNames=['Sidebar','SidebarContent','SidebarFooter','SidebarHeader','SidebarInset','SidebarMenu','SidebarMenuButton','SidebarMenuItem','SidebarProvider','SidebarTrigger','Button','Input','Table','TableBody','TableCell','TableHead','TableHeader','TableRow','DropdownMenu','DropdownMenuTrigger','DropdownMenuContent','DropdownMenuItem','DropdownMenuSeparator','DropdownMenuLabel','Tabs','TabsList','TabsTrigger','Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription','AlertDialog','AlertDialogContent','AlertDialogHeader','AlertDialogTitle','AlertDialogDescription','AlertDialogFooter','AlertDialogCancel','AlertDialogAction','Toaster','Picker','Field','Empty','Busy','VerificationPanel','StudentAccessPanel'];
const placeholders=names=>names.map(name=>`export function ${name}(){return null;}`).join('\n');
const bundle=await build({entryPoints:['app/campuscare.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'client-test-boundaries',setup(plugin){
 plugin.onResolve({filter:/^(react(?:\/jsx-runtime)?|lucide-react|sonner|@\/components\/ui\/.*|\.\/ui|\.\/access-panel|\.\/signin-panel|\.\/access-client|\.\/admin-dialog|\.\/report-dialog|\.\/ticket-sheet)$/},args=>({path:args.path,namespace:'client-boundary'}));
 plugin.onLoad({filter:/.*/,namespace:'client-boundary'},args=>{
  if(args.path==='react')return {contents:"export const {useState,useEffect,useRef,useCallback,useMemo}=globalThis.__campuscareClientTest;"};
  if(args.path==='react/jsx-runtime')return {contents:"export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment';"};
  if(args.path==='lucide-react')return {contents:placeholders(iconNames)};
  if(args.path==='./ui')return {contents:placeholders(['Picker','Field','Empty','Busy'])+"\nexport const {api,read}=globalThis.__campuscareClientTest;export const initials=()=>'';export const ago=()=>'';"};
  if(args.path==='./access-panel')return {contents:placeholders(['VerificationPanel','StudentAccessPanel'])+"\nexport const {accessStatus}=globalThis.__campuscareClientTest;export const signOut=async()=>{};"};
  if(args.path==='./signin-panel')return {contents:"export default function VerificationPanel(){return null;}"};
  if(args.path==='./access-client')return {contents:"export const {accessStatus}=globalThis.__campuscareClientTest;export const signOut=async()=>{};"};
  if(['./admin-dialog','./report-dialog','./ticket-sheet'].includes(args.path)){const name={'./admin-dialog':'AdminDialog','./report-dialog':'ReportDialog','./ticket-sheet':'TicketSheet'}[args.path];return {contents:`export default function ${name}(){return null;}`};}
  return {contents:placeholders(uiNames)+"\nexport const toast={success(){},error(){}};"};
 });
}}]});
const {default:CampusCare}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function render(){dirty=false;cursor=0;tree=CampusCare({});const work=effects;effects=[];for(const effect of work)effect();}
async function flush(){for(let i=0;i<30;i++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));}if(dirty)render();}
function find(value,predicate){if(!value||typeof value!=='object')return null;if(predicate(value))return value;for(const item of Object.values(value)){if(typeof item==='function')continue;if(Array.isArray(item)){for(const child of item){const found=find(child,predicate);if(found)return found;}}else{const found=find(item,predicate);if(found)return found;}}return null;}
const containsPrivate=()=>JSON.stringify(tree).includes('Private admin-only issue');
beforeEach(()=>{
 hooks=[];cursor=0;effects=[];dirty=true;tree=null;visitor=copy(admin);delayed=[];delayWorkspace=false;listeners.clear();
 globalThis.window={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);},setTimeout,clearTimeout};
 globalThis.document={documentElement:{style:{setProperty(){}}}};
 globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
});
after(()=>{for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}delete globalThis.__campuscareClientTest;});

test('focus after switching from admin to student removes the old privileged workspace',async()=>{
 await flush();assert.equal(containsPrivate(),true);visitor=copy(student);listeners.get('focus')();await flush();assert.equal(containsPrivate(),false);assert.equal(hooks[0].value.id,student.id);assert.equal(hooks[3].value.member.role,'reporter');
});
test('a delayed admin workspace response cannot restore private data after an account switch',async()=>{
 await flush();const complaints=find(tree,node=>node.type?.name==='ComplaintTable');assert.ok(complaints);complaints.props.open('private');await flush();const detail=find(tree,node=>node.type?.name==='TicketSheet');assert.ok(detail);
 delayWorkspace=true;const oldRequest=detail.props.onChanged();await flush();assert.equal(delayed.length,1);
 visitor=copy(student);listeners.get('focus')();await flush();assert.equal(containsPrivate(),false);assert.equal(hooks[3].value.member.role,'reporter');
 delayed[0]();await oldRequest;await flush();assert.equal(containsPrivate(),false);assert.equal(hooks[3].value.member.role,'reporter');
});
test('workspace response from a newly switched account forces a fresh bootstrap',async()=>{
 await flush();const complaints=find(tree,node=>node.type?.name==='ComplaintTable');complaints.props.open('private');await flush();const detail=find(tree,node=>node.type?.name==='TicketSheet');visitor=copy(student);await detail.props.onChanged();await flush();assert.equal(hooks[0].value.id,student.id);assert.equal(containsPrivate(),false);
});
test('switching account during the initial workspace load cannot expose the delayed admin response',async()=>{
 delayWorkspace=true;await flush();assert.equal(delayed.length,1);assert.equal(containsPrivate(),false);visitor=copy(student);listeners.get('focus')();await flush();assert.equal(hooks[0].value.id,student.id);delayed[0]();await flush();assert.equal(containsPrivate(),false);assert.equal(hooks[3].value.member.role,'reporter');
});
