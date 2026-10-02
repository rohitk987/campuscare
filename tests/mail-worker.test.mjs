import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const sender='24ug1bybs030@bmsit.in';
const scope='openid email https://www.googleapis.com/auth/gmail.send';
// Execute the production adapter inside workerd, not Node's Fetch implementation.
// A host-side outbound service substitutes every provider; no email or credential leaves.
const bundle=await build({stdin:{contents:`
 import {deliverVerificationCode,mailFailureDetails} from './lib/mail.ts';
 export default {async fetch(){try{
  const result=await deliverVerificationCode('${sender}','123456','synthetic-challenge');
  return Response.json(result);
 }catch(error){return Response.json(mailFailureDetails(error),{status:503});}}};
`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});

async function run(outboundService){
 const worker=new Miniflare({modules:true,compatibilityDate:'2026-05-15',script:bundle.outputFiles[0].text,
  bindings:{OTP_HMAC_SECRET:'synthetic-secret-at-least-32-characters',OTP_MAIL_PROVIDER:'gmail',GMAIL_CLIENT_ID:'synthetic.apps.googleusercontent.com',
   GMAIL_CLIENT_SECRET:'synthetic-client-secret',GMAIL_REFRESH_TOKEN:'synthetic-refresh-token',GMAIL_SENDER_EMAIL:sender},outboundService});
 try{const response=await worker.dispatchFetch('http://localhost');return {status:response.status,body:await response.json()};}
 finally{await worker.dispose();}
}

test('production Gmail adapter can construct and execute each request in workerd',async()=>{
 const calls=[];
 const result=await run(async request=>{
  calls.push(request.url);
  if(request.url==='https://oauth2.googleapis.com/token'){
   assert.equal(new URLSearchParams(await request.text()).get('refresh_token'),'synthetic-refresh-token');
   return Response.json({access_token:'synthetic-access-token',token_type:'Bearer',scope});
  }
  assert.equal(request.headers.get('Authorization'),'Bearer synthetic-access-token');
  if(request.url==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({email:sender,email_verified:true});
  assert.equal(request.url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  const mime=Buffer.from((await request.json()).raw,'base64url').toString('utf8');
  assert.ok(mime.includes(`To: <${sender}>\r\n`));
  return Response.json({id:'synthetic-message-id'});
 });
 assert.equal(result.status,200);assert.equal(result.body.provider,'gmail');assert.equal(calls.length,3);
});

test('workerd refuses provider redirects at every stage without forwarding credentials',async()=>{
 for(const target of ['token','userinfo','send']){
  const calls=[];
  const result=await run(async request=>{
   calls.push(request.url);
   const stage=request.url.includes('/token')?'token':request.url.includes('/userinfo')?'userinfo':'send';
   if(stage===target)return new Response(null,{status:307,headers:{Location:'https://untrusted.example/credentials'}});
   if(stage==='token')return Response.json({access_token:'synthetic-access-token',token_type:'Bearer',scope});
   if(stage==='userinfo')return Response.json({email:sender,email_verified:true});
   throw new Error('Unexpected provider call');
  });
  assert.equal(result.status,503);assert.deepEqual(result.body,{stage:target,status:307,reason:'redirect_blocked'});
  assert.equal(calls.some(url=>url.includes('untrusted.example')),false);
 }
});
