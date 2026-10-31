/* Public policy documents. No session, account or database access is needed. */
const documents=new Set(['privacy','terms']);
const publicHosts=new Set(['basketboss.co.uk','www.basketboss.co.uk']);

export async function servePublicLegal({request,env},document){
 if(!documents.has(document))return new Response('Not found',{status:404});
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
 const source=new URL(request.url),destination=new URL(source);
 destination.pathname='/'+document;destination.search='';destination.hash='';
 // ASSETS is the static namespace: fetching the pretty asset path does not
 // re-enter this Pages Function or redirect the .html alias back into it.
 const asset=await env.ASSETS.fetch(new Request(destination.href,{method:request.method}));
 const headers=new Headers(asset.headers);
 headers.set('Cache-Control','no-cache, must-revalidate');
 headers.set('X-Content-Type-Options','nosniff');
 headers.set('Referrer-Policy','no-referrer');
 if(!publicHosts.has(source.hostname))headers.set('X-Robots-Tag','noindex, nofollow');
 return new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,statusText:asset.statusText,headers});
}
