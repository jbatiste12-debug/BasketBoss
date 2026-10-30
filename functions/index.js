/* Public BasketBoss Beta marketing entry. This is NOT the app or an auth route.
 * The original app continues at /index.html, preserving PWA identity, recipes,
 * session, saved plans, Premium/Paddle and Household API behaviour.
 * Pages Functions: functions/index.js matches / exactly.
 */
export async function onRequest({request,env}){
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const source=new URL(request.url);
  const destination=new URL(source);
  destination.pathname='/welcome'; // Cloudflare Pages asset serving uses pretty paths.
  destination.search='';
  const asset=await env.ASSETS.fetch(new Request(destination.toString(),{method:request.method}));
  const headers=new Headers(asset.headers);
  headers.set('Cache-Control','no-cache, must-revalidate');
  headers.set('X-Content-Type-Options','nosniff');
  if(!['basketboss.co.uk','www.basketboss.co.uk'].includes(source.hostname))headers.set('X-Robots-Tag','noindex, nofollow');
  return new Response(asset.body,{status:asset.status,headers});
}
