import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readDesktopClient,createAuthorization,checkCallback,exchangeAuthorization,SEND_SCOPE} from '../scripts/gmail-oauth.mjs';
const client={clientId:'123-test.apps.googleusercontent.com',clientSecret:'synthetic-secret'};
const expected='24ug1bybs030@bmsit.in';
test('desktop client parsing uses only validated credentials',()=>{
 assert.deepEqual(readDesktopClient({installed:{client_id:client.clientId,client_secret:client.clientSecret,token_uri:'https://attacker.invalid'}}),client);
 for(const value of [{web:{}},{installed:{client_id:'attacker',client_secret:'secret'}},{installed:{client_id:client.clientId,client_secret:''}}])
  assert.throws(()=>readDesktopClient(value));
});
test('authorization uses offline send-only access with unpredictable state and S256 PKCE',()=>{
 const first=createAuthorization(client.clientId,43210,expected),second=createAuthorization(client.clientId,43210,expected);
 const url=new URL(first.url);
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('scope'),'openid email '+SEND_SCOPE);
 assert.equal(url.searchParams.get('access_type'),'offline');
 assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:43210/');
 assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(first.verifier).digest('base64url'));
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(first.verifier.length,43);assert.notEqual(first.state,second.state);assert.notEqual(first.verifier,second.verifier);
 assert.ok(!url.href.includes(client.clientSecret));
});
test('callback rejects wrong host, state, method, path and duplicate parameters',()=>{
 const auth=createAuthorization(client.clientId,43210,expected);
 const request={method:'GET',host:'127.0.0.1:43210',url:'/?state='+auth.state+'&code=synthetic-code'};
 assert.deepEqual(checkCallback(request,auth),{code:'synthetic-code'});
 for(const change of [{method:'POST'},{host:'evil.invalid'},{url:'//evil.invalid/?state='+auth.state+'&code=code'},
  {url:'/different?state='+auth.state+'&code=code'},{url:'/?state=wrong&code=code'},
  {url:request.url+'&state='+auth.state},{url:request.url+'&code=second'}])assert.equal(checkCallback({...request,...change},auth),null);
 assert.deepEqual(checkCallback({...request,url:'/?state='+auth.state+'&error=access_denied'},auth),{denied:true});
});
test('exchange validates send permission, verified exact sender and refresh token without exposing access token',async()=>{
 const auth=createAuthorization(client.clientId,43210,expected),calls=[];
 const mock=async(url,options)=>{
  calls.push({url,options});
  return Response.json(url.endsWith('/token')?{access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',scope:'openid email '+SEND_SCOPE}:
   {email:expected,email_verified:true});
 };
 const result=await exchangeAuthorization(client,auth,'synthetic-code',mock);
 assert.equal(result.GMAIL_REFRESH_TOKEN,'synthetic-refresh');assert.equal(result.GMAIL_SENDER_EMAIL,expected);
 assert.ok(!JSON.stringify(result).includes('synthetic-access'));
 assert.equal(calls[0].url,'https://oauth2.googleapis.com/token');
 assert.equal(calls[0].options.body.get('code_verifier'),auth.verifier);
 assert.equal(calls[0].options.redirect,'error');assert.equal(calls[1].options.redirect,'error');
 for(const failure of ['no-refresh','no-scope','wrong-account','unverified','http']){
  const bad=async(url)=>{
   if(failure==='http')return Response.json({error:'sensitive-provider-detail'},{status:400});
   return Response.json(url.endsWith('/token')?{access_token:'secret-access',refresh_token:failure==='no-refresh'?undefined:'secret-refresh',
    token_type:'Bearer',scope:failure==='no-scope'?'openid email':'openid email '+SEND_SCOPE}:
    {email:failure==='wrong-account'?'other@bmsit.in':expected,email_verified:failure!=='unverified'});
  };
  await assert.rejects(()=>exchangeAuthorization(client,auth,'private-code',bad),error=>!/secret-|private-code|sensitive-provider/.test(error.message));
 }
});
