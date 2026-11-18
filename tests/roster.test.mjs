import test from 'node:test';
import assert from 'node:assert/strict';
import {readRoster,checkRoster,planRoster,isRosterCells,batchKey,rosterTemplate,sendRosterChunks,ROSTER_MAX_ROWS,ROSTER_CHUNK_ROWS} from '../lib/roster.ts';
import {isPilotEmail} from '../lib/pilot.ts';

const check=text=>checkRoster(readRoster(text).rows,{allowedEmail:isPilotEmail});
const cohorts=[{id:'b24',name:'2024–2028'},{id:'b25',name:'2025-2029'},{id:'t1',name:'Twin'},{id:'t2',name:'twin'}];

test('quoted commas, doubled quotes, line breaks in quotes, a byte-order mark and CRLF endings are read',()=>{
 const file=readRoster('﻿Email,Student Name,USN\r\n"a@bmsit.in","Rao, ""Ravi""",1by24cs001\r\n\r\nb@bmsit.ac.in,"Line\nbreak",1BY24CS002\r\nc@bmsit.in,C,1BY24CS003\r\n');
 assert.deepEqual(file.problems,[]);
 assert.deepEqual(file.rows,[[2,'a@bmsit.in','Rao, "Ravi"','1by24cs001','',''],[4,'b@bmsit.ac.in','Line\nbreak','1BY24CS002','',''],[6,'c@bmsit.in','C','1BY24CS003','','']]);
 const {rows,problems}=checkRoster(file.rows,{allowedEmail:isPilotEmail});
 assert.deepEqual(problems,[]);assert.equal(rows[0].usn,'1BY24CS001');assert.equal(rows[1].name,'Line break');
});

test('rows pasted from a spreadsheet are tab-separated and headings match loosely',()=>{
 const file=readRoster('E-mail ID\tName of the student\tUSN No.\tBranch\tBatch\tEnrolment status\nx@bmsit.in\tX Student\t1BY24CS010\tCSE\t2024–2028\tActive\n');
 assert.deepEqual(file.problems,[]);assert.deepEqual(file.ignored,['Branch']);assert.deepEqual(file.columns,{batch:true,status:true});
 assert.deepEqual(file.rows,[[2,'x@bmsit.in','X Student','1BY24CS010','2024–2028','Active']]);
 assert.deepEqual(readRoster('email;name;usn\nx@bmsit.in;X;1BY1').rows,[[2,'x@bmsit.in','X','1BY1','','']]);
});

test('missing or repeated columns, an unclosed quote, an empty file and too many rows stop before any row',()=>{
 assert.match(readRoster('email,name\nx@bmsit.in,X').problems[0].message,/Missing: USN\./);
 assert.match(readRoster('email,name,usn,Email\nx@bmsit.in,X,1,y').problems[0].message,/email column twice/);
 assert.deepEqual(readRoster('email,name,usn\n"x@bmsit.in,X,1\ny@bmsit.in,Y,2').problems,[{line:2,message:'This line opens a quotation mark that is never closed.'}]);
 assert.match(readRoster(' \n\n').problems[0].message,/empty/);
 assert.match(readRoster(rosterTemplate).problems[0].message,/no student rows/);assert.deepEqual(readRoster(rosterTemplate).columns,{batch:true,status:true});
 const large=readRoster('email,name,usn\n'+'a@bmsit.in,A,1\n'.repeat(ROSTER_MAX_ROWS+1));
 assert.match(large.problems[0].message,/at most 10,000/);assert.deepEqual(large.rows,[]);
});

test('each row is checked for the domain, required values, USN characters, status and repeats',()=>{
 const {rows,problems}=check(['email,name,usn,status','ok@bmsit.in,OK,1BY24CS001,','someone@gmail.com,Outside,1BY24CS002,','evil@bmsit.in.evil.com,Spoof,1BY24CS003,',',No email,1BY24CS004,','noname@bmsit.in,,1BY24CS005,','nousn@bmsit.in,No USN,,','space@bmsit.in,Space,1BY 24CS006,','status@bmsit.in,Status,1BY24CS007,enrolled','OK@BMSIT.IN,Again,1BY24CS008,','other@bmsit.in,Other,1by24cs001,'].join('\n'));
 assert.deepEqual(rows.map(row=>row.email),['ok@bmsit.in']);
 assert.deepEqual(problems.map(problem=>problem.line),[3,4,5,6,7,8,9,10,11]);
 assert.deepEqual(problems.map(problem=>problem.message),['Use an official @bmsit.in or @bmsit.ac.in email.','Use an official @bmsit.in or @bmsit.ac.in email.','Add the student’s official college email.','Add the student’s name.','Add the student’s USN.','A USN can contain only letters, digits, hyphens, dots and slashes.','Status must be active, graduated, withdrawn or suspended.','This email is also on line 2.','USN 1BY24CS001 is also on line 2.']);
});

test('only well-formed rows pass the API shape check',()=>{
 assert.equal(isRosterCells([2,'a@bmsit.in','A','1A','','']),true);
 for(const value of [[0,'a','b','c','',''],[2.5,'a','b','c','',''],[2,'a','b','c',''],[2,'a','b',3,'',''],[2,'a'.repeat(321),'b','c','',''],'row',null])assert.equal(isRosterCells(value),false);
});

test('batches match by name without case or dash differences; other rows use the selected batch',()=>{
 assert.equal(batchKey(' 2024 –  2028 '),batchKey('2024 - 2028'));
 const plan=planRoster(check('email,name,usn,batch\na@bmsit.in,A,1A,2024-2028\nb@bmsit.in,B,1B,\nc@bmsit.in,C,1C,2030-2034\nd@bmsit.in,D,1D,TWIN'),{cohorts,defaultCohortId:'b25',existing:[]});
 assert.deepEqual(plan.writes.map(write=>[write.email,write.cohortId]),[['a@bmsit.in','b24'],['b@bmsit.in','b25']]);
 assert.deepEqual(plan.problems.map(problem=>problem.line),[4,5]);
 assert.match(plan.problems[0].message,/No batch is named “2030-2034”/);assert.match(plan.problems[1].message,/More than one batch is named “TWIN”/);
 for(const defaultCohortId of ['','deleted-batch'])assert.match(planRoster(check('email,name,usn\na@bmsit.in,A,1A'),{cohorts,defaultCohortId,existing:[]}).problems[0].message,/Choose a batch/);
});

test('existing students keep their status unless the file sets it, and unchanged rows are not rewritten',()=>{
 const existing=[{email:'same@bmsit.in',usn:'1S',name:'Same',cohort_id:'b24',status:'active'},{email:'held@bmsit.in',usn:'1H',name:'Held',cohort_id:'b24',status:'suspended'},{email:'moved@bmsit.in',usn:'1M',name:'Moved',cohort_id:'b24',status:'active'}];
 const plain=planRoster(check('email,name,usn\nsame@bmsit.in,Same,1S\nheld@bmsit.in,Held  Renamed,1H\nmoved@bmsit.in,Moved,1M2\nnew@bmsit.in,New,1N'),{cohorts,defaultCohortId:'b24',existing});
 assert.deepEqual(plain.summary,{rows:4,create:1,update:2,unchanged:1,reactivate:0});
 const held=plain.writes.find(write=>write.email==='held@bmsit.in');assert.equal(held.status,'suspended');assert.equal(held.name,'Held Renamed');
 assert.equal(plain.writes.find(write=>write.email==='new@bmsit.in').status,'active');
 const set=planRoster(check('email,name,usn,status\nheld@bmsit.in,Held,1H,active\nsame@bmsit.in,Same,1S,graduated'),{cohorts,defaultCohortId:'b24',existing});
 assert.deepEqual(set.summary,{rows:2,create:0,update:2,unchanged:0,reactivate:1});
});

test('a USN that already belongs to another student is refused rather than reassigned',()=>{
 const plan=planRoster(check('email,name,usn\nnew@bmsit.in,New,1s'),{cohorts,defaultCohortId:'b24',existing:[{email:'same@bmsit.in',usn:'1S',name:'Same',cohort_id:'b24',status:'active'}]});
 assert.deepEqual(plan.writes,[]);assert.deepEqual(plan.problems,[{line:2,message:'USN 1S already belongs to same@bmsit.in.'}]);
});

test('rows are sent in chunks of at most 500, in order, and the reports add up',async()=>{
 const rows=Array.from({length:ROSTER_CHUNK_ROWS*2+201},(_,index)=>[index+2,`s${index}@bmsit.in`,'S','1S'+index,'','']),sent=[];
 const total=await sendRosterChunks(rows,async(chunk,start)=>{sent.push([start,chunk.length,chunk[0][0]]);return {summary:{rows:chunk.length,create:chunk.length-1,update:1,unchanged:0,reactivate:start?0:2},problems:Array.from({length:60},(_,index)=>({line:start+index+2,message:'Problem'})),problemCount:60};});
 assert.deepEqual(sent,[[0,500,2],[500,500,502],[1000,201,1002]]);
 assert.deepEqual(total.summary,{rows:1201,create:1198,update:3,unchanged:0,reactivate:2});
 assert.equal(total.problems.length,100);assert.equal(total.problemCount,180);assert.equal(total.problems.at(-1).line,541);
});

test('a failing chunk stops the remaining chunks',async()=>{
 const rows=Array.from({length:ROSTER_CHUNK_ROWS*3},(_,index)=>[index+2,`s${index}@bmsit.in`,'S','1S'+index,'','']);let calls=0;
 await assert.rejects(sendRosterChunks(rows,async()=>{if(++calls===2)throw new Error('The student list changed while importing.');return {summary:{rows:500,create:500,update:0,unchanged:0,reactivate:0},problems:[],problemCount:0};}),/changed while importing/);
 assert.equal(calls,2);
});
