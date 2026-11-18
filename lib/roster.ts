// Bulk student roster import. The browser reads the file (readRoster) and sends the rows in
// chunks; the API checks each chunk again (checkRoster) and plans the writes against the
// current records (planRoster). Kept free of imports so the browser bundle and the tests can
// load it directly; callers supply the email policy, the batches and the existing records.
export const ROSTER_MAX_ROWS=10_000,ROSTER_MAX_LENGTH=2_000_000;
// Small requests keep each check well inside the Worker's CPU budget on the free plan.
export const ROSTER_CHUNK_ROWS=500;
export const ROSTER_STATUSES=['active','graduated','withdrawn','suspended'] as const;
export type RosterStatus=typeof ROSTER_STATUSES[number];
export type RosterProblem={line:number;message:string};
/** One student row as read from the file: its line number, then email, name, USN, batch and status. */
export type RosterCells=[line:number,email:string,name:string,usn:string,batch:string,status:string];
export type RosterFile={rows:RosterCells[];problems:RosterProblem[];columns:{batch:boolean;status:boolean};ignored:string[]};
export type RosterRow={line:number;email:string;name:string;usn:string;batch:string;status:RosterStatus|''};
export type CheckedRoster={total:number;rows:RosterRow[];problems:RosterProblem[]};
export type RosterCohort={id:string;name:string};
export type RosterRecord={email:string;usn:string;name:string;cohort_id:string;status:string};
export type RosterWrite={email:string;name:string;usn:string;cohortId:string;status:RosterStatus};
export type RosterSummary={rows:number;create:number;update:number;unchanged:number;reactivate:number};
export type RosterPlan={writes:RosterWrite[];summary:RosterSummary;problems:RosterProblem[]};
export type RosterChunkReport={summary:RosterSummary;problems:RosterProblem[];problemCount:number};

type Column='email'|'name'|'usn'|'batch'|'status';
const order:Column[]=['email','name','usn','batch','status'];
// Header cells are compared without case, spaces or punctuation: "E-mail ID" matches "emailid".
const headings:Record<Column,string[]>={
 email:['email','emailaddress','emailid','mail','mailid','collegeemail','officialemail','officialcollegeemail','studentemail'],
 name:['name','studentname','fullname','nameofthestudent','studentfullname'],
 usn:['usn','usnno','usnnumber','universityseatnumber'],
 batch:['batch','batchname','cohort','studentbatch'],
 status:['status','enrollmentstatus','enrolmentstatus','studentstatus'],
};
const labels:Record<Column,string>={email:'email',name:'name',usn:'USN',batch:'batch',status:'status'};
const headingKey=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
/** Batch names match without case, repeated spaces or the kind of dash ("2024–2028" = "2024-2028"). */
export const batchKey=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[‐-―−]/g,'-').replace(/\s+/g,' ').trim();
export const rosterTemplate='email,name,usn,batch,status\r\n';

/** Splits CSV or tab-separated text into records, keeping the line each record starts on. */
export function splitRecords(text:string):{records:{line:number;fields:string[]}[];unclosedAt:number}{
 const source=text.charCodeAt(0)===0xfeff?text.slice(1):text,length=source.length,end=source.search(/[\r\n]/),head=end<0?source:source.slice(0,end);
 // Spreadsheet copies are tab-separated; some regional CSV exports use semicolons.
 const delimiter=head.includes('\t')?9:!head.includes(',')&&head.includes(';')?59:44;
 const records:{line:number;fields:string[]}[]=[];let i=0,line=1;
 // Slices fields instead of building them a character at a time, so large files stay cheap.
 while(i<length){
  const start=line,fields:string[]=[];
  for(;;){
   let value='';
   if(source.charCodeAt(i)===34){
    let close=source.indexOf('"',i+1);
    while(close>=0&&source.charCodeAt(close+1)===34)close=source.indexOf('"',close+2);
    if(close<0)return {records,unclosedAt:start};
    value=source.slice(i+1,close);
    if(value.includes('"'))value=value.replace(/""/g,'"');
    for(let at=value.indexOf('\n');at>=0;at=value.indexOf('\n',at+1))line++;
    i=close+1;
   }
   let stop=i;
   for(let code=source.charCodeAt(stop);stop<length&&code!==delimiter&&code!==10&&code!==13;code=source.charCodeAt(++stop));
   if(stop>i)value+=source.slice(i,stop);
   fields.push(value);i=stop;
   if(i<length&&source.charCodeAt(i)===delimiter){i++;continue;}
   break;
  }
  records.push({line:start,fields});
  if(source.charCodeAt(i)===13&&source.charCodeAt(i+1)===10)i+=2;else i++;
  line++;
 }
 return {records,unclosedAt:0};
}

/** Reads the columns and student rows of a roster file. Values are trimmed, not yet checked. */
export function readRoster(text:string):RosterFile{
 const problems:RosterProblem[]=[],none={rows:[] as RosterCells[],problems,columns:{batch:false,status:false},ignored:[] as string[]};
 if(text.length>ROSTER_MAX_LENGTH){problems.push({line:1,message:'The file is larger than 2 MB. Split it into one file per batch.'});return none;}
 const {records,unclosedAt}=splitRecords(text);
 if(unclosedAt){problems.push({line:unclosedAt,message:'This line opens a quotation mark that is never closed.'});return none;}
 const filled=records.filter(record=>record.fields.some(field=>field.trim()));
 if(!filled.length){problems.push({line:1,message:'The file is empty. Add a first row naming the columns, then one row per student.'});return none;}
 const [header,...body]=filled,index:Partial<Record<Column,number>>={},ignored:string[]=[];
 header.fields.forEach((cell,position)=>{
  const key=headingKey(cell),column=order.find(name=>headings[name].includes(key));
  if(!column){if(cell.trim())ignored.push(cell.trim());return;}
  if(index[column]!==undefined)problems.push({line:header.line,message:`The first row names the ${labels[column]} column twice.`});
  else index[column]=position;
 });
 const missing=order.slice(0,3).filter(name=>index[name]===undefined);
 if(missing.length)problems.push({line:header.line,message:`The first row must name the columns. Missing: ${missing.map(name=>labels[name]).join(', ')}.`});
 const columns={batch:index.batch!==undefined,status:index.status!==undefined};
 if(!problems.length&&!body.length)problems.push({line:header.line,message:'The file has no student rows below the column names.'});
 if(!problems.length&&body.length>ROSTER_MAX_ROWS)problems.push({line:header.line,message:`The file has ${body.length.toLocaleString('en-IN')} student rows. Import at most ${ROSTER_MAX_ROWS.toLocaleString('en-IN')} at a time.`});
 if(problems.length)return {...none,columns,ignored};
 const at=(fields:string[],position:number|undefined)=>position===undefined?'':(fields[position]??'').trim();
 const rows=body.map(({line,fields}):RosterCells=>[line,at(fields,index.email),at(fields,index.name),at(fields,index.usn),at(fields,index.batch),at(fields,index.status)]);
 return {rows,problems,columns,ignored};
}

const cellLimits=[320,400,100,200,40];
/** True for rows in the shape readRoster produces, with cells short enough to check. */
export function isRosterCells(value:unknown):value is RosterCells{
 return Array.isArray(value)&&value.length===6&&Number.isInteger(value[0])&&value[0]>0&&cellLimits.every((limit,i)=>typeof value[i+1]==='string'&&value[i+1].length<=limit);
}

// Collapses runs of spaces, tabs and line breaks inside a cell, without a regex on every row.
const words=(value:string)=>value.includes('  ')||/[\t\n\r ]/.test(value)?value.replace(/\s+/g,' ').trim():value.trim();

/** Normalises and checks each row, including repeated emails and USNs within the rows given. */
export function checkRoster(cells:RosterCells[],{allowedEmail}:{allowedEmail:(email:string)=>boolean}):CheckedRoster{
 const rows:RosterRow[]=[],problems:RosterProblem[]=[],seenEmail=new Map<string,number>(),seenUsn=new Map<string,number>();
 for(const [line,rawEmail,rawName,rawUsn,rawBatch,rawStatus] of cells){
  const email=rawEmail.trim().toLowerCase(),name=words(rawName),usn=rawUsn.trim().toUpperCase(),batch=words(rawBatch),status=rawStatus.trim().toLowerCase();
  const issue=!email?'Add the student’s official college email.':!allowedEmail(email)?'Use an official @bmsit.in or @bmsit.ac.in email.':
   !name?'Add the student’s name.':name.length>200?'The name is longer than 200 characters.':
   !usn?'Add the student’s USN.':usn.length>50?'The USN is longer than 50 characters.':!/^[A-Z0-9][A-Z0-9./-]*$/.test(usn)?'A USN can contain only letters, digits, hyphens, dots and slashes.':
   batch.length>100?'The batch name is longer than 100 characters.':
   status&&!(ROSTER_STATUSES as readonly string[]).includes(status)?'Status must be active, graduated, withdrawn or suspended.':
   seenEmail.has(email)?`This email is also on line ${seenEmail.get(email)}.`:seenUsn.has(usn)?`USN ${usn} is also on line ${seenUsn.get(usn)}.`:'';
  if(issue){problems.push({line,message:issue});continue;}
  seenEmail.set(email,line);seenUsn.set(usn,line);
  rows.push({line,email,name,usn,batch,status:status as RosterStatus|''});
 }
 return {total:cells.length,rows,problems};
}

/** Works out which records to add or update. Rows that cannot be placed become problems. */
export function planRoster(checked:CheckedRoster,{cohorts,defaultCohortId,existing}:{cohorts:RosterCohort[];defaultCohortId:string;existing:RosterRecord[]}):RosterPlan{
 const problems=[...checked.problems],named=new Map<string,string[]>(),writes:RosterWrite[]=[];
 const summary:RosterSummary={rows:checked.total,create:0,update:0,unchanged:0,reactivate:0};
 for(const cohort of cohorts){const key=batchKey(cohort.name);named.set(key,[...(named.get(key)||[]),cohort.id]);}
 const fallback=cohorts.some(cohort=>cohort.id===defaultCohortId)?defaultCohortId:'';
 const byEmail=new Map(existing.map(record=>[record.email,record])),usnOwner=new Map(existing.map(record=>[record.usn,record.email]));
 for(const row of checked.rows){
  let cohortId=fallback;
  if(row.batch){
   const ids=named.get(batchKey(row.batch))||[];
   if(ids.length!==1){problems.push({line:row.line,message:ids.length?`More than one batch is named “${row.batch}”. Rename one under Student batches first.`:`No batch is named “${row.batch}”. Add it under Student batches, or leave the cell empty to use the selected batch.`});continue;}
   cohortId=ids[0];
  }
  else if(!cohortId){problems.push({line:row.line,message:'Choose a batch for rows that do not name one.'});continue;}
  const owner=usnOwner.get(row.usn);
  if(owner&&owner!==row.email){problems.push({line:row.line,message:`USN ${row.usn} already belongs to ${owner}.`});continue;}
  // Without a status in the file, existing students keep theirs; new students start active.
  const current=byEmail.get(row.email),status:RosterStatus=row.status||(current?.status as RosterStatus|undefined)||'active';
  if(!current){summary.create++;writes.push({email:row.email,name:row.name,usn:row.usn,cohortId,status});continue;}
  if(current.name===row.name&&current.usn===row.usn&&current.cohort_id===cohortId&&current.status===status){summary.unchanged++;continue;}
  if(current.status!=='active'&&status==='active')summary.reactivate++;
  summary.update++;writes.push({email:row.email,name:row.name,usn:row.usn,cohortId,status});
 }
 problems.sort((a,b)=>a.line-b.line);
 return {writes,summary,problems};
}

/** Sends the rows in chunks, one after another, adding up what each chunk reports. Stops at the first failure. */
export async function sendRosterChunks(rows:RosterCells[],send:(chunk:RosterCells[],start:number)=>Promise<RosterChunkReport>):Promise<RosterChunkReport>{
 const total:RosterChunkReport={summary:{rows:0,create:0,update:0,unchanged:0,reactivate:0},problems:[],problemCount:0};
 for(let start=0;start<rows.length;start+=ROSTER_CHUNK_ROWS){
  const result=await send(rows.slice(start,start+ROSTER_CHUNK_ROWS),start);
  for(const key of Object.keys(total.summary) as (keyof RosterSummary)[])total.summary[key]+=result.summary[key];
  total.problems.push(...result.problems.slice(0,Math.max(0,100-total.problems.length)));total.problemCount+=result.problemCount;
 }
 return total;
}
