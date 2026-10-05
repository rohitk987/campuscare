// This fixed upstream retains CampusCare's existing database and private photos.
// The browser uses its public Cloudflare origin and its own sign-in cookie.
const UPSTREAM_ORIGIN='https://campuscare-facility-hub.sepia-pastime9v.chatgpt.site';

const error=(status,message)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});

export default {
 async fetch(request){
  const publicURL=new URL(request.url),origin=request.headers.get('Origin');
  // Validate before rewriting: an arbitrary Origin must never gain same-origin access.
  if(origin&&origin!==publicURL.origin)return error(403,'This request must come from CampusCare.');
  const target=new URL(UPSTREAM_ORIGIN);
  target.pathname=publicURL.pathname;target.search=publicURL.search;
  const forwarded=new Request(target,request);
  for(const name of [...forwarded.headers.keys()]){
   const lower=name.toLowerCase();
   if(['host','forwarded','authorization','x-real-ip'].includes(lower)||lower.startsWith('x-forwarded-')||lower.startsWith('oai-'))
    forwarded.headers.delete(name);
  }
  // Other cookies on the public hostname are not credentials for the upstream.
  const session=request.headers.get('Cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith('__Host-campuscare-session='));
  forwarded.headers.delete('Cookie');if(session)forwarded.headers.set('Cookie',session);
  if(origin)forwarded.headers.set('Origin',UPSTREAM_ORIGIN);
  try{
   // Do not follow redirects with session cookies or submitted login codes.
   const response=await fetch(forwarded,{redirect:'manual',cf:{cacheTtl:0}});
   const headers=new Headers(response.headers);
   headers.set('Cache-Control','no-store');
   headers.delete('Access-Control-Allow-Origin');headers.delete('Access-Control-Allow-Credentials');
   const location=headers.get('Location');
   if(location){
    const redirect=new URL(location,target);
    // A browser can replay POST bodies on a 307/308. Never relay a foreign
    // destination, even though the server fetch itself does not follow it.
    if(redirect.origin!==UPSTREAM_ORIGIN)return error(502,'CampusCare returned an unexpected redirect. Please try again.');
    const visible=new URL(publicURL.origin);
    visible.pathname=redirect.pathname;visible.search=redirect.search;visible.hash=redirect.hash;
    headers.set('Location',visible.href);
   }
   // Keep response streaming and separate Set-Cookie headers. Domainless __Host
   // cookies are set on the public origin; no secret or cookie is stored here.
   return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }catch{return error(502,'CampusCare is temporarily unavailable. Please try again.');}
 }
};
