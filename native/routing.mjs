export const PRODUCTION_ORIGIN='https://basketboss.co.uk';
export const NATIVE_ORIGIN='capacitor://localhost';
const productionHosts=new Set(['basketboss.co.uk','www.basketboss.co.uk']);
const providerHost=/(?:^|\.)(?:stripe\.com|stripe\.network|stripepay\.com|paddle\.com|paddle\.net|link\.com|payments\.link)$/i;
const checkoutHost=/^(?:(?:checkout|buy|sandbox-checkout|pay|payments|invoice)\.(?:stripe\.com|paddle\.com)|checkout\.stripepay\.com)$/i;
const purchasePages=/^\/(?:pricing(?:-sandbox)?|premium|plans|subscribe|subscriptions?|checkout|buy|payments?|compare)(?:\.html)?(?:\/|$)/i;
const paymentAPI=/^\/api\/(?:(?:stripe|paddle)(?:\/|$)|(?:(?:subscriptions?|billing|payments?)\/)?(?:checkout(?:-(?:config|sessions?))?|create-checkout-session|(?:create-)?payment-?links?|prices?|portal|customer-portal|billing-portal)(?:\/|$))/i;
const legalProviderPath=/^\/(?:legal(?:\/(?:privacy|privacy-policy|terms|terms-of-service|terms-of-use))?|privacy(?:-policy)?|terms(?:-of-service|-of-use)?)\/?$/i;

function address(input,base){
 try{return new URL(typeof input==='string'||input instanceof URL?String(input):input.url,base);}catch{return null;}
}
function appOrigin(url){
 return !url.username&&!url.password&&!url.port&&((url.protocol==='capacitor:'&&url.hostname==='localhost')||(url.protocol==='https:'&&productionHosts.has(url.hostname)));
}
function pathname(url){
 try{return decodeURIComponent(url.pathname);}catch{return url.pathname;}
}
function providerLegal(url){return url.protocol==='https:'&&!url.search&&legalProviderPath.test(pathname(url));}

export function productionApiURL(input,base=NATIVE_ORIGIN+'/index.html'){
 const url=address(input,base);
 return url&&appOrigin(url)&&url.pathname.startsWith('/api/')?PRODUCTION_ORIGIN+url.pathname+url.search:null;
}
export function nativeMembershipURL(base=NATIVE_ORIGIN+'/index.html'){
 return new URL('/pricing-sandbox.html',base).href;
}
export function nativePageURL(input,base=NATIVE_ORIGIN+'/index.html'){
 const url=address(input,base);if(!url||!appOrigin(url))return null;
 if(purchasePages.test(pathname(url)))return nativeMembershipURL(base);
 const routes={'/':'index.html','/app':'index.html','/app.html':'index.html','/index.html':'index.html','/make-a-meal':'make-a-meal.html','/make-a-meal.html':'make-a-meal.html','/privacy':'privacy.html','/privacy/':'privacy.html','/privacy.html':'privacy.html','/terms':'terms.html','/terms/':'terms.html','/terms.html':'terms.html'};
 const route=routes[url.pathname];
 return route?new URL('/'+route+url.search+url.hash,base).href:null;
}
export function isCheckoutURL(input,base=NATIVE_ORIGIN+'/index.html'){
 const url=address(input,base);if(!url)return false;
 const host=url.hostname.replace(/\.$/,'');
 return (paymentAPI.test(pathname(url))&&/checkout|payment-?link|prices?/i.test(pathname(url)))||
  (['https:','http:'].includes(url.protocol)&&(checkoutHost.test(host)||host==='payments.link'));
}
// The iOS app uses StoreKit instead of opening web payment-provider
// storefronts or customer portals that could lead to purchases or upgrades.
// Public processor legal documents remain available as privacy disclosures.
export function isNativeBillingURL(input,base=NATIVE_ORIGIN+'/index.html'){
 const url=address(input,base);if(!url)return false;
 const host=url.hostname.replace(/\.$/,'');
 if(['stripe:','paddle:'].includes(url.protocol))return true;
 if(providerHost.test(host))return !providerLegal(url);
 return (appOrigin(url)||productionHosts.has(host))&&(paymentAPI.test(pathname(url))||purchasePages.test(pathname(url)));
}

export function installNativeFetch({window:win=globalThis.window}={}){
 const original=win.fetch.bind(win);
 win.fetch=(input,init)=>{
  const value=typeof input==='string'||input instanceof URL?String(input):input.url;
  if(isNativeBillingURL(value,win.location.href))return Promise.resolve(new Response(JSON.stringify({error:'Purchases are not available in this iOS build. View your account status in Settings.'}),{status:403,headers:{'Content-Type':'application/json'}}));
  const target=productionApiURL(value,win.location.href);
  if(!target)return original(input,init);
  const request=typeof input==='string'||input instanceof URL?target:new Request(target,input);
  return original(request,{...init,credentials:'omit',mode:'cors',redirect:'error'});
 };
 return original;
}

export function installNativeXHR({window:win=globalThis.window}={}){
 if(!win.XMLHttpRequest)return;
 const open=win.XMLHttpRequest.prototype.open;
 win.XMLHttpRequest.prototype.open=function(method,value,...rest){
  if(isNativeBillingURL(String(value),win.location.href))throw Error('Purchases are not available in this iOS build.');
  return open.call(this,method,productionApiURL(String(value),win.location.href)||value,...rest);
 };
}

export function installNativeWindowOpen({window:win=globalThis.window,openExternal}={}){
 const original=win.open?.bind(win);
 win.open=(value='',...rest)=>{
  // Preserve existing local print/backup windows without introducing a network
  // destination. The app never returns a browser window for a billing URL.
  if(!value||value==='about:blank')return original?.(value,...rest)||null;
  if(isNativeBillingURL(value,win.location.href)){win.location.assign(nativeMembershipURL(win.location.href));return null;}
  const local=nativePageURL(value,win.location.href);
  if(local){win.location.assign(local);return null;}
  const url=address(value,win.location.href);
  if(url?.protocol==='https:'){void Promise.resolve(openExternal(url.href)).catch(()=>{});return null;}
  return original?.(value,...rest)||null;
 };
}
