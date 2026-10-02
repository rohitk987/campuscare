import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

export const SEND_SCOPE='https://www.googleapis.com/auth/gmail.send';
const SCOPES=['openid','email',SEND_SCOPE];
export function readDesktopClient(document){
 const client=document?.installed;
 if(!client||typeof client.client_id!=='string'||!/^[-a-z0-9]+\.apps\.googleusercontent\.com$/i.test(client.client_id)||
  typeof client.client_secret!=='string'||!client.client_secret.trim())
  throw new Error('Use the downloaded Google Desktop app OAuth client JSON.');
 // Never use endpoints supplied by a downloaded file.
 return {clientId:client.client_id,clientSecret:client.client_secret};
}
export function createAuthorization(clientId,port,expectedEmail){
 if(!Number.isInteger(port)||port<1||port>65535||!/^[-a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId)||
  typeof expectedEmail!=='string'||!/^[-a-z0-9._+]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(expectedEmail))
  throw new Error('Invalid authorization configuration.');
 const state=randomBytes(32).toString('base64url');
 const verifier=randomBytes(32).toString('base64url');
 const redirectUri=`http://127.0.0.1:${port}/`;
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',
  scope:SCOPES.join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),
  code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account',login_hint:expectedEmail}).toString();
 return {url:url.href,state,verifier,redirectUri,expectedEmail:expectedEmail.toLowerCase()};
}
export function checkCallback({method,host,url},authorization){
 const expected=new URL(authorization.redirectUri);
 if(method!=='GET'||host!==expected.host||typeof url!=='string'||!url.startsWith('/'))return null;
 const callback=new URL(url,expected);
 if(callback.origin!==expected.origin||callback.pathname!=='/'||callback.searchParams.getAll('state').length!==1)return null;
 const state=callback.searchParams.get('state');
 if(!state||state.length!==authorization.state.length||
  !timingSafeEqual(Buffer.from(state),Buffer.from(authorization.state)))return null;
 if(callback.searchParams.has('error'))return {denied:true};
 const codes=callback.searchParams.getAll('code');
 if(codes.length!==1||!codes[0]||codes[0].length>4096)return null;
 return {code:codes[0]};
}
export async function exchangeAuthorization(client,authorization,code,fetchImpl=fetch){
 const response=await fetchImpl('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:client.clientId,client_secret:client.clientSecret,code,
   grant_type:'authorization_code',redirect_uri:authorization.redirectUri,code_verifier:authorization.verifier}),
  signal:AbortSignal.timeout(20_000),redirect:'error',
 });
 if(!response.ok)throw new Error('Google did not authorize this sender. Restart setup and complete consent.');
 const token=await response.json();
 if(typeof token.refresh_token!=='string'||!token.refresh_token||typeof token.access_token!=='string'||!token.access_token||
  token.token_type?.toLowerCase()!=='bearer'||typeof token.scope!=='string'||!token.scope.split(' ').includes(SEND_SCOPE))
  throw new Error('Google did not grant offline email sending. Restart setup and select the sending permission.');
 const userResponse=await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo',{
  headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15_000),redirect:'error',
 });
 if(!userResponse.ok)throw new Error('Google could not confirm the sender account.');
 const user=await userResponse.json();
 if(user.email_verified!==true||typeof user.email!=='string'||user.email.toLowerCase()!==authorization.expectedEmail)
  throw new Error('The authorized Google account does not match the selected CampusCare sender.');
 return {OTP_MAIL_PROVIDER:'gmail',GMAIL_SENDER_EMAIL:authorization.expectedEmail,GMAIL_CLIENT_ID:client.clientId,
  GMAIL_CLIENT_SECRET:client.clientSecret,GMAIL_REFRESH_TOKEN:token.refresh_token};
}
