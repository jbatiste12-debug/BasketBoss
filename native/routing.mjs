export const PRODUCTION_ORIGIN='https://basketboss.co.uk';
export const NATIVE_ORIGIN='capacitor://localhost';
const productionHosts=new Set(['basketboss.co.uk','www.basketboss.co.uk']);

export function productionApiURL(input,base=NATIVE_ORIGIN+'/index.html'){
 const url=new URL(typeof input==='string'?input:input.url,base);
 const local=url.protocol==='capacitor:'&&url.hostname==='localhost'&&!url.port;
 const production=url.protocol==='https:'&&productionHosts.has(url.hostname)&&!url.port;
 return (local||production)&&url.pathname.startsWith('/api/')?PRODUCTION_ORIGIN+url.pathname+url.search:null;
}
export function nativePageURL(input,base=NATIVE_ORIGIN+'/index.html'){
 const url=new URL(input,base);
 if(!((url.protocol==='capacitor:'&&url.hostname==='localhost')||(url.protocol==='https:'&&productionHosts.has(url.hostname))))return null;
 const routes={'/':'index.html','/app':'index.html','/app.html':'index.html','/index.html':'index.html','/make-a-meal':'make-a-meal.html','/make-a-meal.html':'make-a-meal.html','/pricing-sandbox':'pricing-sandbox.html','/pricing-sandbox.html':'pricing-sandbox.html','/compare.html':'compare.html','/subscriptions.html':'subscriptions.html'};
 const route=routes[url.pathname];
 return route?new URL(route+url.search+url.hash,base).href:null;
}
export function isCheckoutURL(input,base=NATIVE_ORIGIN+'/index.html'){
 const url=new URL(input,base);
 return /^\/(?:api\/subscription\/checkout(?:-config)?)(?:\/|$)/.test(url.pathname)||
  url.protocol==='https:'&&(/^(?:checkout|buy|sandbox-checkout)\.paddle\.com$/i.test(url.hostname));
}

export function installNativeFetch({window:win=globalThis.window}={}){
 const original=win.fetch.bind(win);
 win.fetch=(input,init)=>{
  const address=typeof input==='string'||input instanceof URL?String(input):input.url;
  const parsed=new URL(address,win.location.href);
  if(parsed.hostname==='kbhyosxuvlcazyzzinqv.supabase.co'&&parsed.pathname==='/auth/v1/signup')return Promise.resolve(new Response(JSON.stringify({message:'Account creation is not available in this iOS build. Sign in with an existing account or continue with Free recipes.'}),{status:403,headers:{'Content-Type':'application/json'}}));
  if(isCheckoutURL(address,win.location.href))return Promise.resolve(new Response(JSON.stringify({error:'Purchases are not available in this iOS build.'}),{status:403,headers:{'Content-Type':'application/json'}}));
  const target=productionApiURL(address,win.location.href);
  if(!target)return original(input,init);
  const request=typeof input==='string'||input instanceof URL?target:new Request(target,input);
  return original(request,{...init,credentials:'omit',mode:'cors',redirect:'error'});
 };
 return original;
}
