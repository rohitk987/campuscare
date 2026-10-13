// This fixed upstream retains CampusCare's existing database and private photos.
// The browser uses its public Cloudflare origin and its own sign-in cookie.
const UPSTREAM_ORIGIN='https://campuscare-facility-hub.sepia-pastime9v.chatgpt.site';

const error=(status,message)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
const homeVaryHeaders=new Set(['rsc','next-router-state-tree','next-router-prefetch','next-router-segment-prefetch','next-url','x-vinext-interception-context','x-vinext-mounted-slots','x-vinext-rsc-render-mode']);
const staticAssetPath=/^\/_next\/static\/.+[.-][A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|avif|svg)$/i;

function hasSafeHomeVary(request,headers){
 const vary=headers.get('Vary');
 if(!vary)return true;
 return vary.split(',').map(value=>value.trim().toLowerCase()).every(name=>homeVaryHeaders.has(name)&&!request.headers.has(name));
}

function stripOnlyUpstreamBotCookie(headers){
 if(!headers.has('Set-Cookie'))return true;
 // Do not cache or strip a CampusCare session or any cookie other than this
 // Cloudflare cookie, which is scoped to the upstream chatgpt.site host.
 if(typeof headers.getSetCookie!=='function')return false;
 const cookies=headers.getSetCookie();
 if(!cookies.length||!cookies.every(cookie=>/^__cf_bm=/i.test(cookie)&&/;\s*domain=\.?chatgpt\.site(?:;|$)/i.test(cookie)))return false;
 headers.delete('Set-Cookie');
 return true;
}

function isPublicStaticAsset(headers){
 const type=headers.get('Content-Type')?.toLowerCase()||'';
 return /^(?:text\/css|text\/javascript|application\/javascript|font\/|image\/(?:svg\+xml|png|jpeg|webp|avif))\b/.test(type)&&!headers.has('Vary');
}

export default {
 async fetch(request,env,ctx){
  const publicURL=new URL(request.url),origin=request.headers.get('Origin');
  // Validate before rewriting: an arbitrary Origin must never gain same-origin access.
  if(origin&&origin!==publicURL.origin)return error(403,'This request must come from CampusCare.');
  const session=request.headers.get('Cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith('__Host-campuscare-session='));
  // Only cache the unpersonalised browser navigation response, never an RSC,
  // prefetched, authenticated, queried, or API response.
  const cacheHome=request.method==='GET'&&publicURL.pathname==='/'&&!publicURL.search&&!origin&&!session&&
   !request.headers.has('RSC')&&!request.headers.has('Next-Router-Prefetch')&&!request.headers.has('Next-Router-State-Tree')&&!request.headers.has('Next-Url');
  // Build-hashed Next assets are public and immutable; the pathname itself
  // identifies their content, so they can be cached safely across sessions.
  const cacheAsset=request.method==='GET'&&!publicURL.search&&!session&&staticAssetPath.test(publicURL.pathname);
  const cacheKey=cacheHome?new Request(`${publicURL.origin}/__campuscare_home_v1`):cacheAsset?new Request(`${publicURL.origin}/__campuscare_asset_v1${publicURL.pathname}`):null;
  if(cacheKey){try{const cached=await caches.default.match(cacheKey);if(cached)return cached;}catch{}}
  const target=new URL(UPSTREAM_ORIGIN);
  target.pathname=publicURL.pathname;target.search=publicURL.search;
  const forwarded=new Request(target,request);
  for(const name of [...forwarded.headers.keys()]){
   const lower=name.toLowerCase();
   if(['host','forwarded','authorization','x-real-ip'].includes(lower)||lower.startsWith('x-forwarded-')||lower.startsWith('oai-'))
    forwarded.headers.delete(name);
  }
  // Other cookies on the public hostname are not credentials for the upstream.
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
   if(cacheHome&&response.status===200&&headers.get('Content-Type')?.toLowerCase().includes('text/html')&&hasSafeHomeVary(request,headers)&&stripOnlyUpstreamBotCookie(headers)){
    headers.set('Cache-Control','public, max-age=60');
    const home=new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    try{ctx.waitUntil(caches.default.put(cacheKey,home.clone()).catch(()=>{}));}catch{}
    return home;
   }
   if(cacheAsset&&response.status===200&&isPublicStaticAsset(headers)&&stripOnlyUpstreamBotCookie(headers)){
    headers.set('Cache-Control','public, max-age=31536000, immutable');
    const asset=new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    try{ctx.waitUntil(caches.default.put(cacheKey,asset.clone()).catch(()=>{}));}catch{}
    return asset;
   }
   // Keep response streaming and separate Set-Cookie headers. Domainless __Host
   // cookies are set on the public origin; no secret or cookie is stored here.
   return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }catch{return error(502,'CampusCare is temporarily unavailable. Please try again.');}
 }
};
