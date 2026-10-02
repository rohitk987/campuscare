// One-time local onboarding. No password, authorization code or token is printed.
import {createServer} from 'node:http';
import {readFile,lstat,mkdir,open,chmod} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readDesktopClient,createAuthorization,checkCallback,exchangeAuthorization} from './gmail-oauth.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runtime=resolve(root,'.sites-runtime');
const base=resolve(runtime,'gmail');
const input=resolve(base,'client.json');
const sender=process.argv[2]||'24ug1bybs030@bmsit.in';
async function noLinks(path){
 const parts=relative(root,path).split(sep);
 if(parts.some(part=>part==='..')||!path.startsWith(root+sep))throw new Error('Setup files must remain in the project runtime directory.');
 let current=root;
 for(const part of parts){current=resolve(current,part);const stat=await lstat(current);if(stat.isSymbolicLink())throw new Error('Setup does not accept linked directories or files.');}
}
async function privateDirectory(){
 await mkdir(base,{recursive:true,mode:0o700});await noLinks(base);
 const directory=resolve(base,'setup-'+randomUUID());
 await mkdir(directory,{mode:0o700});
 if(process.platform==='win32'){
  const identity=spawnSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
  const sid=identity.stdout?.match(/S-1-5-\d+(?:-\d+)+/)?.[0];
  if(identity.status!==0||!sid)throw new Error('Unable to identify the Windows account for private credential storage.');
  const acl=spawnSync('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});
  if(acl.status!==0)throw new Error('Unable to restrict credential storage to your Windows account.');
 }else await chmod(directory,0o700);
 return directory;
}
async function main(){
 await noLinks(input);
 const stat=await lstat(input);if(!stat.isFile()||stat.size>64_000)throw new Error('Invalid Desktop app client file.');
 const client=readDesktopClient(JSON.parse(await readFile(input,'utf8')));
 const directory=await privateDirectory();
 let authorization,used=false,settle,reject,timer;
 const result=new Promise((yes,no)=>{settle=yes;reject=no;});
 const server=createServer((request,response)=>{
  response.setHeader('Content-Type','text/plain; charset=utf-8');
  response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  let callback;
  try{callback=authorization&&checkCallback({method:request.method,host:request.headers.host,url:request.url},authorization);}catch{callback=null;}
  if(!callback||used){response.writeHead(400);response.end('Invalid or expired authorization callback.');return;}
  used=true;
  if(callback.denied){response.writeHead(403);response.end('Authorization cancelled. Return to CampusCare setup.');reject(new Error('Sender authorization was cancelled.'));return;}
  response.end('Google authorization received. Return to CampusCare setup for the final result.');
  settle(callback.code);
 });
 server.requestTimeout=10_000;server.headersTimeout=10_000;
 await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
 try{
  authorization=createAuthorization(client.clientId,server.address().port,sender);
  timer=setTimeout(()=>reject(new Error('Authorization timed out. Run setup again.')),10*60_000);
  console.log('Open this Google authorization URL and personally review/approve email sending:');
  console.log(authorization.url);
  const code=await result;
  const values=await exchangeAuthorization(client,authorization,code);
  const output=resolve(directory,'authorized-sender.json');
  const handle=await open(output,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(values,null,2)+'\n');}finally{await handle.close();}
  console.log('Sender authorized: '+values.GMAIL_SENDER_EMAIL);
  console.log('Credentials saved privately to '+output+'. Transfer them to hosting secrets, then remove this temporary file.');
 }finally{clearTimeout(timer);server.closeAllConnections();await new Promise(yes=>server.close(yes));}
}
main().catch(error=>{console.error(error.code==='ENOENT'?'Save the Desktop app client JSON at .sites-runtime/gmail/client.json first.':
 error instanceof SyntaxError?'The Desktop app client JSON is invalid.':error.message.startsWith('Google')||error.message.startsWith('The authorized')||error.message.startsWith('Sender')||error.message.startsWith('Authorization')||error.message.startsWith('Unable')||error.message.startsWith('Setup')||error.message.startsWith('Use ')||error.message.startsWith('Invalid')?error.message:'Sender setup failed; no credentials were printed.');process.exitCode=1;});
