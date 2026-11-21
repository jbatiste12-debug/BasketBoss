import {PRODUCTION_ORIGIN,isNativeBillingURL,nativePageURL} from './routing.mjs';

export const ANDROID_ORIGIN='https://localhost';
const hosts=new Set(['basketboss.co.uk','www.basketboss.co.uk']);
const fallback='Purchases are not available in this Android test build. You can sign in to an existing account.';
function address(input,base){try{return new URL(typeof input==='string'||input instanceof URL?String(input):input.url,base);}catch{return null;}}
function allowed(url){return url&&!url.username&&!url.password&&!url.port&&url.protocol==='https:'&&(url.hostname==='localhost'||hosts.has(url.hostname));}
function iosEquivalent(url){return url.origin===ANDROID_ORIGIN?'capacitor://localhost'+url.pathname+url.search+url.hash:url.href;}

export function androidApiURL(input,base=ANDROID_ORIGIN+'/index.html'){
 const url=address(input,base);
 return allowed(url)&&url.pathname.startsWith('/api/')?PRODUCTION_ORIGIN+url.pathname+url.search:null;
}
export function androidMembershipURL(base=ANDROID_ORIGIN+'/index.html'){return new URL('/pricing-sandbox.html',base).href;}
export function isAndroidBillingURL(input,base=ANDROID_ORIGIN+'/index.html'){
 const url=address(input,base);return !!url&&isNativeBillingURL(iosEquivalent(url),'capacitor://localhost/index.html');
}
export function androidPageURL(input,base=ANDROID_ORIGIN+'/index.html'){
 const url=address(input,base);if(!allowed(url))return null;
 const local=nativePageURL(iosEquivalent(url),'capacitor://localhost/index.html');
 if(!local)return null;
 const target=new URL(local);return new URL(target.pathname+target.search+target.hash,ANDROID_ORIGIN).href;
}
export function installAndroidFetch({window:win=globalThis.window}={}){
 const original=win.fetch.bind(win);
 win.fetch=(input,init)=>{
  const value=typeof input==='string'||input instanceof URL?String(input):input.url;
  if(isAndroidBillingURL(value,win.location.href))return Promise.resolve(new Response(JSON.stringify({error:fallback}),{status:403,headers:{'Content-Type':'application/json'}}));
  const target=androidApiURL(value,win.location.href);
  if(!target)return original(input,init);
  const request=typeof input==='string'||input instanceof URL?target:new Request(target,input);
  return original(request,{...init,credentials:'omit',mode:'cors',redirect:'error'});
 };
 return original;
}
export function installAndroidXHR({window:win=globalThis.window}={}){
 if(!win.XMLHttpRequest)return;
 const open=win.XMLHttpRequest.prototype.open;
 win.XMLHttpRequest.prototype.open=function(method,value,...rest){
  if(isAndroidBillingURL(String(value),win.location.href))throw Error(fallback);
  return open.call(this,method,androidApiURL(String(value),win.location.href)||value,...rest);
 };
}
export function installAndroidWindowOpen({window:win=globalThis.window,openExternal}={}){
 const original=win.open?.bind(win);
 win.open=(value='',...rest)=>{
  if(!value||value==='about:blank')return original?.(value,...rest)||null;
  if(isAndroidBillingURL(value,win.location.href)){win.location.assign(androidMembershipURL(win.location.href));return null;}
  const local=androidPageURL(value,win.location.href);
  if(local){win.location.assign(local);return null;}
  const url=address(value,win.location.href);
  if(url?.protocol==='https:'&&!url.username&&!url.password)void Promise.resolve(openExternal(url.href)).catch(()=>{});
  return null;
 };
}
