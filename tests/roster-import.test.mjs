import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Drive the roster import dialog with a small hook renderer. UI components are boundaries;
// reading the file, the local checks and the chunked requests are the production code.
let hooks=[],cursor=0,dirty=false,tree,draft,calls=[],respond,imported=[],failures=[];
class AccessRequestError extends Error{constructor(message,status){super(message);this.status=status;}}
const harness={
 useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;dirty=true;}];},
 useRef(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:{current:initial}};return hooks[index].value;},
 useCallback(callback){cursor++;return callback;},
 useEffect(){cursor++;},
 AccessRequestError,
 async accessAction(action,data){calls.push({action,...data,rows:data.rows.map(row=>[...row])});return respond(data,calls.length);},
};
globalThis.__rosterImportTest=harness;
const bundle=await build({entryPoints:['app/access-panel.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'roster-import-boundaries',setup(plugin){
 plugin.onResolve({filter:/^(react(?:\/jsx-runtime)?|@\/components\/ui\/.*|\.\/ui|\.\/access-client)$/},args=>({path:args.path,namespace:'boundary'}));
 plugin.onLoad({filter:/.*/,namespace:'boundary'},args=>{
  if(args.path==='react')return {contents:'export const {useState,useEffect,useRef,useCallback}=globalThis.__rosterImportTest;'};
  if(args.path==='react/jsx-runtime')return {contents:"export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment';"};
  if(args.path==='./access-client')return {contents:'export const {AccessRequestError,accessAction}=globalThis.__rosterImportTest;'};
  const names=['Table','TableBody','TableCell','TableHead','TableHeader','TableRow','Button','Dialog','DialogContent','DialogDescription','DialogHeader','DialogTitle','Switch','Input','Textarea','Field','Picker','SelectField','Busy'];
  return {contents:names.map(name=>`export function ${name}(){return null;}`).join('\n')};
 });
}}]});
const {RosterImport}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const cohorts=[{id:'b24',name:'Batch 2024',admission_year:2024,starts_at:0,ends_at:1,active:1}];
function render(){dirty=false;cursor=0;tree=RosterImport({cohorts,draft,onDraft:next=>{draft=next;dirty=true;},onClose(){},onImported:summary=>imported.push(summary),onAccessFailure:failure=>failures.push(failure)});}
async function flush(){for(let i=0;i<40;i++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));}if(dirty)render();}
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node.props?text(node.props.children):'';
function find(value,predicate){if(!value||typeof value!=='object')return null;if(predicate(value))return value;for(const item of Object.values(value)){if(typeof item==='function')continue;const found=Array.isArray(item)?item.map(child=>find(child,predicate)).find(Boolean):find(item,predicate);if(found)return found;}return null;}
const button=label=>find(tree,node=>node.type?.name==='Button'&&text(node).includes(label));
const shown=()=>text(tree);
const roster=count=>['email,name,usn',...Array.from({length:count},(_,index)=>{const number=String(index).padStart(4,'0');return `roster${number}@bmsit.in,Roster Student ${number},1BY24CS${number}`;})].join('\n');
const fresh=data=>({summary:{rows:data.rows.length,create:data.rows.length,update:0,unchanged:0,reactivate:0},problems:[],problemCount:0,imported:!!data.commit});
beforeEach(()=>{hooks=[];cursor=0;dirty=false;calls=[];imported=[];failures=[];draft={text:'',fileName:''};respond=fresh;});
after(()=>{delete globalThis.__rosterImportTest;});

test('checking sends every chunk without saving, then importing sends the same chunks to be saved',async()=>{
 draft={text:roster(1201),fileName:'batch-2024.csv'};render();
 button('Check the file').props.onClick();await flush();
 assert.deepEqual(calls.map(call=>[call.commit,call.cohortId,call.rows.length,call.rows[0][0]]),[[false,'b24',500,2],[false,'b24',500,502],[false,'b24',201,1002]]);
 assert.match(shown(),/1,201 student rows checked\. 1,201 new, 0 updated, 0 already up to date\./);
 assert.match(shown(),/no status column/);assert.equal(imported.length,0);
 button('Import 1,201 records').props.onClick();await flush();
 assert.deepEqual(calls.slice(3).map(call=>[call.commit,call.rows.length]),[[true,500],[true,500],[true,201]]);
 assert.deepEqual(imported,[{rows:1201,create:1201,update:0,unchanged:0,reactivate:0}]);
});

test('problems found in the browser are listed by line without contacting the server',async()=>{
 draft={text:'email,name,usn\nok@bmsit.in,OK,1BY1\nsomeone@gmail.com,Outside,1BY2\nok@bmsit.in,Again,1BY3',fileName:''};render();
 button('Check the file').props.onClick();await flush();
 assert.equal(calls.length,0);assert.match(shown(),/Fix 2 problems below, then check the file again\. Nothing has been imported\./);
 assert.match(shown(),/Line 3Use an official @bmsit\.in or @bmsit\.ac\.in email\./);assert.match(shown(),/Line 4This email is also on line 2\./);
 assert.equal(button('Import'),null);
});

test('problems the server finds block the import, and editing the file asks for a fresh check',async()=>{
 respond=data=>({...fresh(data),summary:{...fresh(data).summary,create:data.rows.length-1},problems:[{line:3,message:'USN 1BY0001 already belongs to taken@bmsit.in.'}],problemCount:1});
 draft={text:roster(2),fileName:''};render();
 button('Check the file').props.onClick();await flush();
 assert.match(shown(),/Fix 1 problem below/);assert.match(shown(),/Line 3USN 1BY0001 already belongs to taken@bmsit\.in\./);assert.equal(button('Import'),null);
 respond=fresh;button('Check the file').props.onClick();await flush();assert.ok(button('Import 2 records'));
 find(tree,node=>node.type?.name==='Textarea').props.onChange({currentTarget:{value:roster(3)}});await flush();
 assert.equal(button('Import'),null);assert.ok(button('Check the file'));assert.doesNotMatch(shown(),/student rows checked/);
});

test('a failed chunk reports the rows already saved and how to finish',async()=>{
 draft={text:roster(1201),fileName:''};render();
 button('Check the file').props.onClick();await flush();
 respond=(data,count)=>{if(count===5)throw new AccessRequestError('The student list changed while importing, so these rows were not saved.',409);return fresh(data);};
 button('Import 1,201 records').props.onClick();await flush();
 assert.equal(calls.length,5);assert.equal(imported.length,0);
 assert.match(shown(),/so these rows were not saved\. Rows up to line 501 were saved\. Import the same file again to finish; rows already saved are skipped\./);
});

test('an expired sign-in during the import is handed to the access handler',async()=>{
 respond=()=>{throw new AccessRequestError('Sign in with your BMSIT email and verification code to access CampusCare.',401);};
 draft={text:roster(3),fileName:''};render();
 button('Check the file').props.onClick();await flush();
 assert.equal(failures.length,1);assert.equal(failures[0].status,401);
});

test('a spreadsheet file is refused with save-as advice, and a CSV file fills the draft',async()=>{
 render();const input=()=>find(tree,node=>node.type?.name==='Input');
 const target=file=>({currentTarget:{files:[file],value:'C:\\fakepath\\'+file.name}});
 await input().props.onChange(target({name:'students.xlsx',size:9000,text:async()=>'binary'}));await flush();
 assert.match(shown(),/Save the spreadsheet as CSV first/);assert.equal(draft.text,'');
 await input().props.onChange(target({name:'students.csv',size:40,text:async()=>'email,name,usn\na@bmsit.in,A,1A'}));await flush();
 assert.deepEqual(draft,{text:'email,name,usn\na@bmsit.in,A,1A',fileName:'students.csv'});assert.match(shown(),/Loaded students\.csv\./);assert.doesNotMatch(shown(),/Save the spreadsheet/);
});
