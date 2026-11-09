// Serve the isolated web catalogue without changing marketing, API routing,
// origin, auth query parameters, storage keys or the legacy static files.
const DOCUMENTS=Object.freeze({
 '/app':'app','/app/':'app','/app.html':'app','/index':'app','/index.html':'app',
 '/make-a-meal':'make-a-meal','/make-a-meal.html':'make-a-meal',
 '/tutorial':'tutorial','/tutorial.html':'tutorial',
 '/basketboss-latest-guide':'basketboss-latest-guide','/basketboss-latest-guide.html':'basketboss-latest-guide',
 '/pricing-sandbox':'pricing-sandbox','/pricing-sandbox.html':'pricing-sandbox',
 '/compare':'compare','/compare.html':'compare',
 '/subscriptions':'subscriptions','/subscriptions.html':'subscriptions'
});

export async function routePwa700({request,env,next}){
 const source=new URL(request.url),document=DOCUMENTS[source.pathname];
 if(!document)return next();
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 const destination=new URL(source);destination.pathname='/pwa700/'+document;
 destination.search='';destination.hash='';
 // The asset binding needs neither auth nor customer headers. The browser
 // retains its original URL, including password-recovery/cooking handoffs.
 const asset=await env.ASSETS.fetch(new Request(destination,{method:request.method}));
 const headers=new Headers(asset.headers);
 const callback=['code','token_hash','access_token','refresh_token','error_code'].some(key=>source.searchParams.has(key));
 headers.set('Cache-Control',callback?'no-store':'no-cache, must-revalidate');
 if(callback)headers.set('Referrer-Policy','no-referrer');
 headers.set('X-Content-Type-Options','nosniff');
 headers.set('X-Robots-Tag','noindex, nofollow');
 return new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,headers});
}
