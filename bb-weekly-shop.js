/* One server-approved advanced shopping trip per week for Free accounts.
 * The ordinary list, ticking and planning stay free. Stored trip IDs provide
 * idempotency and recovery only: every open is approved by the server. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)api.install(root);
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_weekly_shop_trip_v1';
 const ENDPOINT='/api/shopping/weekly-trip';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const LAUNCHERS='#bb172ShopModeButton,#bb172StoreMode,.bb1745-go-button,.bbm-begin,.bb-r6-begin';
 function create(options){
  let generation=0,statusVersion=0,grant=null,pending=null,status=null,statusRequest=null,lastRead=null;
  const session=()=>{
   if(options.isBlocked?.())return null;
   const value=options.getSession();
   return value?.user?.id&&typeof value.access_token==='string'&&Number(value.expires_at)*1000>Date.now()+5000?{actor:String(value.user.id),token:value.access_token}:null;
  };
  const shopSession=()=>{try{return options.getShopSessionId();}catch{return null;}};
  const current=(pin,serial,shop)=>{
   const now=session();return serial===generation&&now?.actor===pin.actor&&now?.token===pin.token&&(!shop||shopSession()===shop);
  };
  function read(){try{const value=JSON.parse(options.storage.getItem(KEY)||'null');return value?.version===1&&value.byActor&&typeof value.byActor==='object'&&!Array.isArray(value.byActor)?value:{version:1,byActor:{}};}catch{return {version:1,byActor:{}};}}
  function record(pin,shop){const value=read().byActor[pin.actor];return value?.shopSessionId===shop&&UUID.test(value.sessionId)?value:null;}
  function save(pin,value){
   const data=read();data.byActor[pin.actor]=value;
   const bytes=JSON.stringify(data);options.storage.setItem(KEY,bytes);
   if(options.storage.getItem(KEY)!==bytes)throw Error('storage_unavailable');
  }
  function publish(){options.onState?.(snapshot());}
  function isPending(){const pin=session();return !!(pending&&pin?.actor===pending.actor&&pin?.token===pending.token&&shopSession()===pending.shop);}
  function snapshot(){const pin=session();return status&&pin?.actor===status.actor&&pin?.token===status.token?{...status.data}:null;}
  function mayOpen(shop=shopSession()){
   const pin=session();return !!(pin&&grant&&pin.actor===grant.actor&&pin.token===grant.token&&shop===grant.shopSessionId);
  }
  function invalidate(){generation++;statusVersion++;grant=null;pending=null;status=null;statusRequest=null;lastRead=null;options.closeShop?.();publish();}
  function notice(kind,data,interactive){if(interactive)options.onNotice?.(kind,data||{});}
  async function request(pin,method,body){
   const controller=new AbortController(),timer=(options.setTimeout||setTimeout)(()=>controller.abort(),15000);
   try{
    const response=await options.fetch(ENDPOINT,{method,headers:{Accept:'application/json',Authorization:'Bearer '+pin.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,credentials:'same-origin',redirect:'manual',cache:'no-store'});
    let data=null;try{data=await response.json();}catch{}
    return {response,data};
   }finally{(options.clearTimeout||clearTimeout)(timer);}
  }
  async function refresh(){
   const pin=session(),serial=generation,version=statusVersion;
   if(!pin){status=null;publish();return null;}
   if(statusRequest?.actor===pin.actor&&statusRequest.token===pin.token)return statusRequest.promise;
   if(lastRead?.actor===pin.actor&&lastRead.token===pin.token&&Date.now()-lastRead.time<15000)return snapshot();
   lastRead={...pin,time:Date.now()};
   const job=(async()=>{
    try{
     const {response,data}=await request(pin,'GET');
     if(!current(pin,serial))return null;
     if(version!==statusVersion)return snapshot();
     if(!response.ok||data?.ok!==true||typeof data.premium!=='boolean'){status=null;publish();return null;}
     status={...pin,data};publish();return snapshot();
    }catch{if(current(pin,serial)&&version===statusVersion){status=null;publish();}return null;}
    finally{if(statusRequest?.promise===job)statusRequest=null;}
   })();
   statusRequest={...pin,promise:job};return job;
  }
  function start({interactive=true,resumeOnly=false}={}){
   const pin=session();
   if(!pin){notice(options.isBlocked?.()?'unavailable':'sign-in',null,interactive);return Promise.resolve(false);}
   const shop=shopSession();
   if(typeof shop!=='string'||!shop){notice('unavailable',null,interactive);return Promise.resolve(false);}
   if(pending&&pending.actor===pin.actor&&pending.token===pin.token&&pending.shop===shop)return pending.promise;
   const serial=generation,prior=record(pin,shop);
   if(resumeOnly&&!prior?.approved){options.closeShop?.();return Promise.resolve(false);}
   const run=async()=>{
    let trip=prior;
    try{
     if(!current(pin,serial,shop))return false;
     if(!trip){const id=options.uuid();if(!UUID.test(id))throw Error('secure_id_unavailable');trip={shopSessionId:shop,sessionId:id,approved:false};save(pin,trip);}
     const {response,data}=await request(pin,'POST',{sessionId:trip.sessionId});
     if(!current(pin,serial,shop))return false;
     if(response.status===401){grant=null;statusVersion++;status=null;options.closeShop?.();publish();notice('sign-in',data,interactive);return false;}
     if(response.status===429&&data?.error==='weekly_shop_limit'){
      grant=null;statusVersion++;status={...pin,data:{...data,ok:true,premium:false,used:true}};publish();notice('limit',data,interactive);return false;
     }
     if(!response.ok||data?.ok!==true||data.allowed!==true||typeof data.premium!=='boolean')throw Error('approval_unavailable');
     // Preserve this exact request ID before opening, including after a lost
     // response/retry. An account or plan change can never open an old result.
     save(pin,{...trip,approved:true});
     if(!current(pin,serial,shop))return false;
     grant={...pin,shopSessionId:shop};statusVersion++;status={...pin,data};lastRead={...pin,time:Date.now()};publish();options.openShop();return true;
    }catch{
     if(current(pin,serial,shop)){grant=null;options.closeShop?.();notice('unavailable',null,interactive);}return false;
    }finally{if(pending?.promise===job){pending=null;publish();}}
   };
   // Promise scheduling also makes two synchronous proxy clicks share one POST.
   const job=Promise.resolve().then(run);pending={...pin,shop,promise:job};publish();return job;
  }
  function end(shop){
   if(grant?.shopSessionId===shop)grant=null;
   generation++;pending=null;options.closeShop?.();publish();
  }
  return Object.freeze({start,resume:()=>start({interactive:false,resumeOnly:true}),refresh,mayOpen,invalidate,end,snapshot,isPending});
 }
 function install(root){
  const doc=root.document;if(!doc||root.BBWeeklyShop)return;
  let dialog,message,signIn,upgrade,observer,scheduled=false,statusQueued=false;
  const el=(tag,text,className)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const session=()=>{try{return JSON.parse(root.localStorage.getItem('basketboss_cloud_session_v1')||'null');}catch{return null;}};
  const bridge=()=>root.BBShoppingLaunch;
  const blocked=()=>root.BBAccountDeletion?.isDeleting?.()===true||doc.documentElement.classList.contains('bb-native-starting');
  function uuid(){
   if(root.crypto?.randomUUID)return root.crypto.randomUUID();
   if(!root.crypto?.getRandomValues)throw Error('secure_id_unavailable');
   const bytes=root.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
   const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  function dismiss(){if(dialog?.open)dialog.close();else dialog?.removeAttribute('open');}
  function showNotice(kind,data){
   if(!dialog){
    dialog=el('dialog',undefined,'bb-weekly-shop-dialog');dialog.id='bbWeeklyShopNotice';dialog.setAttribute('aria-labelledby','bbWeeklyShopHeading');
    const title=el('h2','Your weekly shop');title.id='bbWeeklyShopHeading';
    message=el('p');message.setAttribute('role','status');
    signIn=el('button','Sign in');signIn.type='button';signIn.addEventListener('click',()=>{dismiss();doc.getElementById('cloud-open')?.click();});
    upgrade=el('button','Upgrade to Premium');upgrade.type='button';upgrade.addEventListener('click',()=>{dismiss();root.BasketBossMembershipUI?.open?.();});
    const back=el('button','Back to my list');back.type='button';back.addEventListener('click',dismiss);
    const actions=el('div',undefined,'bb-weekly-shop-actions');actions.append(signIn,upgrade,back);
    dialog.append(title,message,actions);doc.body.append(dialog);
    dialog.addEventListener('click',event=>{if(event.target===dialog)dismiss();});
   }
   const reset=typeof data.nextResetAt==='string'&&Number.isFinite(Date.parse(data.nextResetAt))?new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(data.nextResetAt)):null;
   message.textContent=kind==='sign-in'?'Sign in to use your one Free advanced shopping trip each week. Your basic shopping list is always free.':kind==='limit'?'You’ve used your Free advanced shopping trip this week.'+(reset?' Your next trip is available on '+reset+' (00:00 UTC).':' Your allowance resets on Monday at 00:00 UTC.')+' Keep using your basic list, or upgrade for unlimited advanced trips.':'We couldn’t check your shopping allowance. Please try again when connected. Your basic shopping list and saved progress are still available.';
   signIn.hidden=kind!=='sign-in';upgrade.hidden=kind!=='limit';
   if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
   (kind==='sign-in'?signIn:kind==='limit'?upgrade:dialog.querySelector('button:not([hidden])'))?.focus?.({preventScroll:true});
  }
  const controller=create({getSession:session,getShopSessionId:()=>bridge()?.sessionId?.(),openShop:()=>bridge()?.open?.(),closeShop:()=>bridge()?.close?.(),storage:root.localStorage,fetch:(...args)=>root.fetch(...args),uuid,isBlocked:blocked,onNotice:showNotice,onState:()=>{syncLaunchers();schedule();}});
  root.BBWeeklyShop=controller;
  function syncLaunchers(){
   const busy=controller.isPending();
   for(const control of doc.querySelectorAll(LAUNCHERS)){
    if(busy){if(!control.hasAttribute('data-bb-weekly-pending'))control.dataset.bbWeeklyPending=control.disabled?'disabled':'enabled';control.disabled=true;control.setAttribute('aria-busy','true');}
    else if(control.hasAttribute('data-bb-weekly-pending')){control.disabled=control.dataset.bbWeeklyPending==='disabled';delete control.dataset.bbWeeklyPending;control.removeAttribute('aria-busy');}
   }
  }
  function decorate(){
   scheduled=false;observer?.disconnect();
   try{
    syncLaunchers();
    const state=root.BasketBossMembershipUI?.state?.()||root.BasketBossVerifiedPremium?.state?.();
    const verified=controller.snapshot(),paid=verified?verified.premium===true:state==='premium';
    for(const control of doc.querySelectorAll(LAUNCHERS)){
     let badge=control.querySelector('.bb-weekly-shop-badge');
     if(paid){badge?.remove();continue;}
     if(!badge){badge=el('span','1 free/week','bb-weekly-shop-badge');badge.setAttribute('aria-hidden','true');const arrow=control.matches('.bbm-begin,.bb-r6-begin')?control.lastElementChild:null;control.insertBefore(badge,arrow||null);}
     const title='Advanced Shop Mode · 1 Free trip per week. Unlimited with Premium.';if(control.title!==title)control.title=title;
    }
    const overview=doc.getElementById('bbReleaseShopOverview');
    if(overview&&!overview.querySelector('.bb-weekly-basic-list')){
     const basic=el('button','View full list · Free','bb-weekly-basic-list');basic.type='button';
     basic.addEventListener('click',()=>{doc.body.classList.add('bb-weekly-basic-open');doc.getElementById('bb321Printable')?.scrollIntoView?.({block:'start',behavior:'smooth'});});overview.append(basic);
    }
    const app=doc.getElementById('app');
    if(app&&!doc.getElementById('bbWeeklyBasicBack')){
     const back=el('button','← Shopping snapshot','bb-weekly-basic-back');back.id='bbWeeklyBasicBack';back.type='button';back.addEventListener('click',()=>{doc.body.classList.remove('bb-weekly-basic-open');doc.getElementById('bbReleaseShopOverview')?.scrollIntoView?.({block:'start',behavior:'smooth'});});app.before(back);
    }
   }finally{if(observer&&doc.body)observer.observe(doc.body,{childList:true,subtree:true});}
  }
  function schedule(){if(!scheduled){scheduled=true;queueMicrotask(decorate);}}
  function readStatus(){if(statusQueued)return;statusQueued=true;queueMicrotask(()=>{statusQueued=false;if(doc.querySelector(LAUNCHERS))void controller.refresh();});}
  function isolate(){controller.invalidate();dismiss();schedule();}
  function checkGrant(){if(doc.body.classList.contains('bb172-storefront-visible')&&!controller.mayOpen())isolate();}
  function start(){
   if(typeof root.MutationObserver==='function')observer=new root.MutationObserver(records=>{if(records.some(record=>Array.from(record.addedNodes||[]).some(node=>node.nodeType===1&&(node.matches?.(LAUNCHERS+',#bbReleaseShopOverview')||node.querySelector?.(LAUNCHERS))))){schedule();readStatus();}});
   decorate();readStatus();
   root.addEventListener('basketboss:session-changed',isolate);
   root.addEventListener('storage',event=>{if(event.key==='basketboss_cloud_session_v1'||event.key===null)isolate();});
   for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted'])root.addEventListener(name,isolate);
   doc.addEventListener('basketboss:premium-verified',schedule);
   root.addEventListener('focus',()=>{checkGrant();schedule();});
   doc.addEventListener('visibilitychange',checkGrant);
   for(const type of ['pointerdown','keydown'])doc.addEventListener(type,event=>{if(event.target.closest?.('#bb172Storefront')&&!controller.mayOpen()){event.preventDefault();event.stopImmediatePropagation();isolate();showNotice(blocked()?'unavailable':'sign-in',{});}},true);
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
 }
 return Object.freeze({create,install,KEY,ENDPOINT,LAUNCHERS});
});
