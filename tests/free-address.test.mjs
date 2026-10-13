import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

const script=await readFile(new URL('../hosting/free-address/worker.mjs',import.meta.url),'utf8');
const upstream='https://campuscare-facility-hub.sepia-pastime9v.chatgpt.site';
const workerConfig=JSON.parse(await readFile(new URL('../hosting/free-address/wrangler.jsonc',import.meta.url),'utf8'));
const pagesConfig=JSON.parse(await readFile(new URL('../hosting/free-address/pages/wrangler.jsonc',import.meta.url),'utf8'));
for(const [publicOrigin,config] of [['https://campuscare.pilot.workers.dev',workerConfig],['https://campuscare-dln.pages.dev',pagesConfig]]){
async function run(path,init,outbound){
 const worker=new Miniflare({modules:true,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,script,outboundService:outbound});
 try{
  const response=await worker.dispatchFetch(publicOrigin+path,{...init,redirect:'manual'});
  return {status:response.status,headers:response.headers,body:await response.text()};
 }finally{await worker.dispose();}
}

test(`${publicOrigin}: login preserves method, body and session`,async()=>{
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

test(`${publicOrigin}: foreign and opaque origins are denied before forwarding`,async()=>{
 for(const origin of ['https://evil.test','null',publicOrigin+'.evil.test']){
  let calls=0;
  const result=await run('/api/access',{method:'POST',headers:{Origin:origin,'X-Campuscare-Request':'1'},body:'{}'},async()=>{calls++;return new Response('unexpected');});
  assert.equal(result.status,403);assert.equal(calls,0);
 }
});

test(`${publicOrigin}: upstream stays pinned and photo bytes stay intact`,async()=>{
 const result=await run('//untrusted.example/photo?ticket=123',{method:'GET'},async request=>{
  assert.equal(new URL(request.url).origin,upstream);assert.equal(new URL(request.url).pathname,'//untrusted.example/photo');
  return new Response('synthetic-photo-bytes',{headers:{'Content-Type':'image/jpeg'}});
 });
 assert.equal(result.body,'synthetic-photo-bytes');assert.equal(result.headers.get('Content-Type'),'image/jpeg');
});

test(`${publicOrigin}: redirects stay on the public address`,async()=>{
 for(const destination of [upstream+'/login?next=home','https://untrusted.example/path']){
  let calls=0;
  const result=await run('/redirect',{},async()=>{calls++;return new Response(null,{status:302,headers:{Location:destination}});});
  assert.equal(calls,1);assert.equal(result.status,destination.startsWith(upstream)?302:502);
  assert.equal(result.headers.get('Location'),destination.startsWith(upstream)?publicOrigin+'/login?next=home':null);
 }
});

test(`${publicOrigin}: only anonymous home documents use the short cache`,async()=>{
 let calls=0;
 const worker=new Miniflare({modules:true,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,script,outboundService:async()=>{
  calls++;
  return new Response(`upstream-${calls}`,{headers:{'Content-Type':calls===1?'text/html':'application/json','Cache-Control':'no-store'}});
 }});
 try{
  const first=await worker.dispatchFetch(publicOrigin+'/',{method:'GET'});
  assert.equal(await first.text(),'upstream-1');
  assert.equal(first.headers.get('Cache-Control'),'public, max-age=60');
  const cached=await worker.dispatchFetch(publicOrigin+'/',{method:'GET'});
  assert.equal(await cached.text(),'upstream-1');
  assert.equal(calls,1);
  const authenticated=await worker.dispatchFetch(publicOrigin+'/',{method:'GET',headers:{Cookie:'__Host-campuscare-session=private-session'}});
  assert.equal(await authenticated.text(),'upstream-2');
  assert.equal(authenticated.headers.get('Cache-Control'),'no-store');
  const api=await worker.dispatchFetch(publicOrigin+'/api/access?op=status',{method:'GET'});
  assert.equal(await api.text(),'upstream-3');
  assert.equal(api.headers.get('Cache-Control'),'no-store');
  const queried=await worker.dispatchFetch(publicOrigin+'/?refresh=1',{method:'GET'});
  assert.equal(await queried.text(),'upstream-4');
  assert.equal(queried.headers.get('Cache-Control'),'no-store');
 }finally{await worker.dispose();}
});

test(`${publicOrigin}: public home shell ignores only the upstream-scoped bot cookie`,async()=>{
 let calls=0;
 const worker=new Miniflare({modules:true,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,script,outboundService:async request=>{
  calls++;
  const headers=new Headers({'Content-Type':'text/html','Cache-Control':'no-store','Vary':'RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Url, X-Vinext-Interception-Context, X-Vinext-Mounted-Slots, X-Vinext-Rsc-Render-Mode'});
  headers.append('Set-Cookie','__cf_bm=upstream-only; Path=/; Domain=chatgpt.site; Secure; HttpOnly; SameSite=None');
  return new Response(request.headers.has('RSC')?'rsc-variant':'public-home-shell',{headers});
 }});
 try{
  const first=await worker.dispatchFetch(publicOrigin+'/',{method:'GET'});
  assert.equal(await first.text(),'public-home-shell');
  assert.equal(first.headers.get('Cache-Control'),'public, max-age=60');
  assert.equal(first.headers.get('Set-Cookie'),null);
  const cached=await worker.dispatchFetch(publicOrigin+'/',{method:'GET'});
  assert.equal(await cached.text(),'public-home-shell');
  assert.equal(calls,1);
  const rsc=await worker.dispatchFetch(publicOrigin+'/',{method:'GET',headers:{RSC:'1','Next-Router-State-Tree':'variant'}});
  assert.equal(await rsc.text(),'rsc-variant');
  assert.equal(rsc.headers.get('Cache-Control'),'no-store');
  assert.equal(calls,2);
  const navigation=await worker.dispatchFetch(publicOrigin+'/',{method:'GET'});
  assert.equal(await navigation.text(),'public-home-shell');
  assert.equal(calls,2);
 }finally{await worker.dispose();}
});

test(`${publicOrigin}: hashed public assets are edge and browser cacheable`,async()=>{
 let calls=0;
 const path='/_next/static/chunks/campuscare-AbCd1234.js';
 const worker=new Miniflare({modules:true,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,script,outboundService:async request=>{
  calls++;assert.equal(request.url,upstream+path);
  const headers=new Headers({'Content-Type':'text/javascript','Cache-Control':'no-store'});
  headers.append('Set-Cookie','__cf_bm=upstream-only; Path=/; Domain=chatgpt.site; Secure; HttpOnly; SameSite=None');
  return new Response('public-fingerprinted-asset',{headers});
 }});
 try{
  const first=await worker.dispatchFetch(publicOrigin+path,{method:'GET'});
  assert.equal(await first.text(),'public-fingerprinted-asset');
  assert.equal(first.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
  assert.equal(first.headers.get('Set-Cookie'),null);
  const cached=await worker.dispatchFetch(publicOrigin+path,{method:'GET'});
  assert.equal(await cached.text(),'public-fingerprinted-asset');
  assert.equal(cached.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
  assert.equal(calls,1);
 }finally{await worker.dispose();}
});

test(`${publicOrigin}: private asset cookies and variable assets are never cached`,async()=>{
 let calls=0;
 const path='/_next/static/chunks/campuscare-AbCd5678.js';
 const worker=new Miniflare({modules:true,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,script,outboundService:async request=>{
  calls++;
  const headers=new Headers({'Content-Type':'text/javascript','Cache-Control':'no-store'});
  if(request.headers.get('Cookie')?.includes('__Host-campuscare-session='))headers.append('Set-Cookie','__Host-campuscare-session=private-session; Path=/; Secure; HttpOnly; SameSite=Lax');
  if(calls===2)headers.set('Vary','Cookie');
  return new Response(`response-${calls}`,{headers});
 }});
 try{
  const sessionResponse=await worker.dispatchFetch(publicOrigin+path,{method:'GET',headers:{Cookie:'__Host-campuscare-session=active'}});
  assert.equal(await sessionResponse.text(),'response-1');
  assert.equal(sessionResponse.headers.get('Cache-Control'),'no-store');
  assert.equal(sessionResponse.headers.getSetCookie()[0].startsWith('__Host-campuscare-session='),true);
  const variable=await worker.dispatchFetch(publicOrigin+path,{method:'GET'});
  assert.equal(await variable.text(),'response-2');
  assert.equal(variable.headers.get('Cache-Control'),'no-store');
  const retry=await worker.dispatchFetch(publicOrigin+path,{method:'GET'});
  assert.equal(await retry.text(),'response-3');
  assert.equal(retry.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
  const cached=await worker.dispatchFetch(publicOrigin+path,{method:'GET'});
  assert.equal(await cached.text(),'response-3');
  assert.equal(cached.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
  assert.equal(calls,3);
 }finally{await worker.dispose();}
});

test(`${publicOrigin}: foreign 307 cannot replay an OTP body`,async()=>{
 let calls=0;
 const result=await run('/api/access',{method:'POST',headers:{Origin:publicOrigin,'X-Campuscare-Request':'1'},body:'{"action":"verify_code","code":"004217"}'},async()=>{
  calls++;return new Response(null,{status:307,headers:{Location:'https://untrusted.example/capture'}});
 });
 assert.equal(calls,1);assert.equal(result.status,502);assert.equal(result.headers.get('Location'),null);
 assert.ok(!result.body.includes('004217'));
});
}
