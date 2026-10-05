import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

const script=await readFile(new URL('../hosting/free-address/worker.mjs',import.meta.url),'utf8');
const publicOrigin='https://campuscare.pilot.workers.dev';
const upstream='https://campuscare-facility-hub.sepia-pastime9v.chatgpt.site';
async function run(path,init,outbound){
 const worker=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['global_fetch_strictly_public'],script,outboundService:outbound});
 try{
  const response=await worker.dispatchFetch(publicOrigin+path,{...init,redirect:'manual'});
  return {status:response.status,headers:response.headers,body:await response.text()};
 }finally{await worker.dispose();}
}

test('free address forwards a login request without losing method, body or session',async()=>{
 const body=JSON.stringify({action:'verify_code',email:'student@bmsit.in',code:'004217'});
 const result=await run('/api/access?op=status',{method:'POST',headers:{Origin:publicOrigin,'Content-Type':'application/json','X-Campuscare-Request':'1',Cookie:'other=private; __Host-campuscare-session=synthetic-session','OAI-Authenticated-User-Id':'forged','OAI-Sites-Authorization':'untrusted','Authorization':'Bearer unrelated','X-Forwarded-Host':'evil.test'},body},async request=>{
  assert.equal(request.url,upstream+'/api/access?op=status');assert.equal(request.method,'POST');assert.equal(await request.text(),body);
  assert.equal(request.headers.get('Origin'),upstream);assert.equal(request.headers.get('Cookie'),'__Host-campuscare-session=synthetic-session');
  assert.equal(request.headers.get('X-Campuscare-Request'),'1');
  for(const header of ['Authorization','OAI-Authenticated-User-Id','OAI-Sites-Authorization','X-Forwarded-Host'])assert.equal(request.headers.get(header),null);
  const headers=new Headers({'Content-Type':'application/json'});
  headers.append('Set-Cookie','__Host-campuscare-session=synthetic-new; Path=/; Secure; HttpOnly; SameSite=Lax');
  headers.append('Set-Cookie','temporary=; Path=/; Secure; Max-Age=0');
  return new Response('{"verified":true}',{headers});
 });
 assert.equal(result.status,200);assert.equal(result.body,'{"verified":true}');assert.equal(result.headers.get('Cache-Control'),'no-store');
 assert.equal(result.headers.getSetCookie().length,2);assert.ok(result.headers.getSetCookie()[0].includes('HttpOnly'));
});

test('a foreign or opaque Origin is denied before any credentials reach the backend',async()=>{
 for(const origin of ['https://evil.test','null','https://campuscare.pilot.workers.dev.evil.test']){
  let calls=0;
  const result=await run('/api/access',{method:'POST',headers:{Origin:origin,'X-Campuscare-Request':'1'},body:'{}'},async()=>{calls++;return new Response('unexpected');});
  assert.equal(result.status,403);assert.equal(calls,0);
 }
});

test('proxy pins the upstream even for authority-looking paths and returns photos intact',async()=>{
 const result=await run('//untrusted.example/photo?ticket=123',{method:'GET'},async request=>{
  assert.equal(new URL(request.url).origin,upstream);assert.equal(new URL(request.url).pathname,'//untrusted.example/photo');
  return new Response('synthetic-photo-bytes',{headers:{'Content-Type':'image/jpeg'}});
 });
 assert.equal(result.body,'synthetic-photo-bytes');assert.equal(result.headers.get('Content-Type'),'image/jpeg');
});

test('same-backend redirects use the public address and foreign redirects never reach the browser',async()=>{
 for(const destination of [upstream+'/login?next=home','https://untrusted.example/path']){
  let calls=0;
  const result=await run('/redirect',{},async()=>{calls++;return new Response(null,{status:302,headers:{Location:destination}});});
  assert.equal(calls,1);assert.equal(result.status,destination.startsWith(upstream)?302:502);
  assert.equal(result.headers.get('Location'),destination.startsWith(upstream)?publicOrigin+'/login?next=home':null);
 }
});

test('a foreign 307 cannot cause a browser to replay an OTP body to another service',async()=>{
 let calls=0;
 const result=await run('/api/access',{method:'POST',headers:{Origin:publicOrigin,'X-Campuscare-Request':'1'},body:'{"action":"verify_code","code":"004217"}'},async()=>{
  calls++;return new Response(null,{status:307,headers:{Location:'https://untrusted.example/capture'}});
 });
 assert.equal(calls,1);assert.equal(result.status,502);assert.equal(result.headers.get('Location'),null);
 assert.ok(!result.body.includes('004217'));
});
