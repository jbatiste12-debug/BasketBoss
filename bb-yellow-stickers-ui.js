/* A small estimated markdown window and anonymous aggregate sightings. Own
   offline observations are labelled on-device, never presented as a crowd fact. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root&&!root.BBYellowStickersUI)root.BBYellowStickersUI=api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_yellow_sticker_reports_v1',LIMIT=500,COOLDOWN=5*60000;
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 function createController(options){
  const now=options.now||Date.now,api=options.api,store=options.storage;
  let deniedPremium=false;let generation=0,selected='',remote=null,notice='',busy=false,flight=null,lastPoll=0;
  function context(){try{const value=options.getContext(),resolved=api.resolveStore(value?.region,value?.store||value?.retailer);if(!resolved||options.isBlocked?.())return null;return {...resolved,actor:typeof value.actor==='string'&&value.actor?value.actor:'guest',premium:options.isPremium?.()===true};}catch{return null;}}
  const identity=value=>value?value.region+'|'+value.id+'|'+value.actor+'|'+value.premium:'';
  function sync(){const current=context(),key=identity(current);if(key!==selected){generation++;selected=key;deniedPremium=false;remote=null;notice='';busy=false;flight=null;lastPoll=0;}return current;}
  function read(){try{const value=JSON.parse(store?.getItem(KEY)||'null');return value?.version===1&&Array.isArray(value.reports)?value.reports.filter(object).slice(-LIMIT):[];}catch{return [];}}
  function local(current){return read().filter(row=>row.scope===identity(current)&&api.validTimestamp(row.at,now())!==null).sort((a,b)=>b.at-a.at)[0]||null;}
  function saveLocal(current,status,requestId,{receiptId,shared=false}={}){
   const at=now(),rows=read().filter(row=>typeof row.at==='number'&&(row.receiptId||row.at>at-api.TTL)&&!(row.scope===identity(current)&&row.requestId===requestId));
   rows.push({scope:identity(current),status,at,requestId,shared,...(receiptId?{receiptId}:{})});
   const value=JSON.stringify({version:1,reports:rows.slice(-LIMIT)});try{store.setItem(KEY,value);return store.getItem(KEY)===value;}catch{return false;}
  }
  function snapshot(){
   const current=sync();if(!current)return null;if(!current.premium||deniedPremium)return {context:current,locked:true,live:false,local:false,label:'🏷️ Yellow sticker helper · Premium',busy:false,notice:''};const own=local(current),positive=remote&&api.validTimestamp(remote.lastSpottedAt,now()),localPositive=own?.status==='spotted'&&api.validTimestamp(own.at,now());
   const label=positive!==null&&positive!==false&&positive!==undefined?api.sightingLabel(remote.lastSpottedAt,{now:now()}):localPositive!==null&&localPositive!==false&&localPositive!==undefined?api.sightingLabel(own.at,{now:now(),local:true}):api.typicalLabel(api.nextWindow({region:current.region,store:current.id,now:now()}));
   return {context:current,label,live:!!(remote&&api.validTimestamp(remote.lastSpottedAt,now())!==null),local:!!(!remote?.lastSpottedAt&&localPositive),busy,notice,ownStatus:own?.status||null,cooldownUntil:own?own.at+COOLDOWN:0,latestNotYetAt:remote?.latestNotYetAt||null};
  }
  function publish(){options.onState?.(snapshot());}
  function current(pin,serial){return serial===generation&&identity(sync())===identity(pin);}
  function accept(data,pin){
   if(!object(data)||data.ok!==true||data.region!==pin.region||data.store!==pin.id)return false;
   // Server timestamps are validated again when displayed; malformed remote
   // dates cannot manufacture a live status or an unbounded expiry.
   const latest=(previous,incoming)=>{const a=api.validTimestamp(previous,now()),b=api.validTimestamp(incoming,now());return a!==null&&(b===null||a>b)?previous:b!==null?incoming:null;};remote={lastSpottedAt:latest(remote?.lastSpottedAt,data.lastSpottedAt),latestNotYetAt:latest(remote?.latestNotYetAt,data.latestNotYetAt)};return true;
  }
  async function request(pin,method,body,token){
   const path='/api/yellow-stickers'+(method==='GET'?'?region='+encodeURIComponent(pin.region)+'&store='+encodeURIComponent(pin.id):'');
   const response=await options.fetch(path,{method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'same-origin',redirect:'error',cache:'no-store',...(typeof AbortSignal!=='undefined'&&AbortSignal.timeout?{signal:AbortSignal.timeout(12000)}:{})});
   let data;try{data=await response.json();}catch{}return {response,data};
  }
  function refresh({force=false}={}){
   const pin=sync();if(!pin||!pin.premium||deniedPremium||options.isBlocked?.()||options.isOffline?.())return Promise.resolve(snapshot());if(flight)return flight;
   if(!force&&lastPoll&&now()-lastPoll<60000)return Promise.resolve(snapshot());lastPoll=now();const serial=generation;
   const job=(async()=>{try{const session=await options.getSession?.();if(!current(pin,serial)||!session?.access_token||session.user?.id!==pin.actor)return snapshot();const {response,data}=await request(pin,'GET',null,session.access_token);if(current(pin,serial)){if(response.ok)accept(data,pin);else if(response.status===403&&data?.error==='yellow_sticker_premium_required')deniedPremium=true;publish();}}catch{}finally{if(flight===job)flight=null;}return snapshot();})();flight=job;return job;
  }
  async function report(status,{receiptId}={}){
   const pin=sync();if(!pin||!['spotted','not_yet'].includes(status))return {ok:false,ignored:true};if(!pin.premium||deniedPremium)return {ok:false,locked:true};if(busy)return {ok:false,busy:true};
   const previous=local(pin),savedReceipt=receiptId&&read().find(row=>row.scope===identity(pin)&&row.receiptId===receiptId);if(savedReceipt)return {ok:true,duplicate:true,local:!savedReceipt.shared};
   if(previous&&now()-previous.at<COOLDOWN){notice='Thanks — wait a few minutes before reporting again.';publish();return {ok:false,cooldown:true};}
   const serial=generation;busy=true;notice='Saving your report…';publish();
   let requestId;if(receiptId)requestId='receipt:'+receiptId;try{requestId||=options.uuid();}catch{requestId='report-'+now().toString(36)+'-'+Math.random().toString(36).slice(2,12);}
   const fallback=()=>{const saved=saveLocal(pin,status,requestId,{receiptId});notice=saved?'Saved on this device. Connect and sign in to share with other shoppers.':'Could not save your report on this device. Please try again.';return {ok:saved,local:true};};
   try{
    let session;try{session=await options.getSession?.();}catch{}
    if(!current(pin,serial))return {ok:false,ignored:true};
    if(options.isOffline?.()||!session?.access_token||session.user?.id!==pin.actor)return fallback();
    const {response,data}=await request(pin,'POST',{region:pin.region,store:pin.id,status,requestId},session.access_token);
    if(!current(pin,serial))return {ok:false,ignored:true};
    if(response.ok&&accept(data,pin)){saveLocal(pin,status,requestId,{receiptId,shared:true});notice=status==='spotted'?'Thanks — your sighting is shared with other shoppers.':'Thanks — your “Not yet” report is shared.';return {ok:true,shared:true};}
    if(response.status===429){notice='Thanks — wait a few minutes before reporting again.';return {ok:false,cooldown:true};}
    if([400,401,403].includes(response.status)){if(response.status===403&&data?.error==='yellow_sticker_premium_required')deniedPremium=true;notice=response.status===400?'This report needs checking. Choose your supermarket again.':'Sign in again to share your report.';return {ok:false,rejected:true};}
    return fallback();
   }catch{if(current(pin,serial))return fallback();return {ok:false,ignored:true};}
   finally{if(current(pin,serial)){busy=false;publish();}}
  }
  function reportReceipt(packet){
   const pin=sync(),resolved=api.resolveStore(packet?.region,packet?.retailer||packet?.store);
   if(!pin||!pin.premium||packet?.reduced!==true||packet.source!=='receipt'||typeof packet.receiptId!=='string'||!packet.receiptId||packet.receiptId.length>152||!resolved||pin.region!==resolved.region||pin.id!==resolved.id)return Promise.resolve({ok:false,ignored:true});
   if(!packet.purchasedAt||api.localDate(packet.purchasedAt)!==api.localDate(now())||api.validTimestamp(packet.confirmedAt,now())===null)return Promise.resolve({ok:false,ignored:true});
   if(typeof packet.purchasedAt==='string'&&packet.purchasedAt.includes('T')&&api.validTimestamp(packet.purchasedAt,now())===null)return Promise.resolve({ok:false,ignored:true});
   return report('spotted',{receiptId:packet.receiptId});
  }
  function invalidate(){generation++;selected='';deniedPremium=false;remote=null;notice='';busy=false;flight=null;lastPoll=0;publish();}
  return Object.freeze({snapshot,refresh,report,reportReceipt,invalidate});
 }
 function install(win){
  const doc=win.document;if(!doc?.createElement)return {refresh(){},reportReceipt:()=>Promise.resolve({ok:false,ignored:true}),destroy(){}};
  let host={};let controller=null,queued=false,destroyed=false,timer=null,observer=null;
  const banners=new Set(),make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  function session(){try{return win.BasketBossSession?.read?.()||JSON.parse(win.localStorage.getItem('basketboss_cloud_session_v1')||'null');}catch{return null;}}
  function context(){const region=win.bb307ActiveMarket?.(),retailer=win.BBSupermarkets?.getSelected?.(region);return {region,retailer,actor:session()?.user?.id||'guest'};}
  function ensure(){if(!controller&&win.BBYellowStickers)controller=createController({api:win.BBYellowStickers,storage:win.localStorage,fetch:win.fetch.bind(win),getContext:context,getSession:async()=>win.BasketBossSession?.ensureFresh?await win.BasketBossSession.ensureFresh():session(),isPremium:()=>host.isPremium?host.isPremium()===true:win.BasketBossVerifiedPremium?.isActive?.()===true,isBlocked:()=>win.BBAccountDeletion?.isDeleting?.()===true,isOffline:()=>win.navigator?.onLine===false,uuid:()=>win.crypto.randomUUID(),onState:schedule});return controller;}
  function schedule(){if(queued||destroyed)return;queued=true;(win.requestAnimationFrame||win.setTimeout).call(win,render);}
  function build(picker){
   const details=make('details','bb-yellow-stickers'),summary=make('summary'),summaryLabel=make('span','bb-yellow-stickers-label'),copy=make('p','bb-yellow-stickers-copy'),buttons=make('div','bb-yellow-stickers-actions'),prompt=make('span','','Out now?'),spotted=make('button','','👍 Spotted'),notYet=make('button','','🕒 Not yet'),status=make('p','bb-yellow-stickers-status');
   details.dataset.bbYellowStickers='';summary.append(summaryLabel);summary.addEventListener('click',event=>{if(controller?.snapshot()?.locked){event.preventDefault();if(host.openUpgrade)host.openUpgrade(summary);else win.BasketBossPremiumPreview?.show?.(summary);}});spotted.type=notYet.type='button';spotted.addEventListener('click',()=>void controller?.report('spotted'));notYet.addEventListener('click',()=>void controller?.report('not_yet'));status.setAttribute('role','status');status.setAttribute('aria-live','polite');buttons.append(prompt,spotted,notYet);details.append(summary,copy,buttons,status);picker.querySelector('select')?.after(details);details.bbElements={summary,summaryLabel,copy,spotted,notYet,status};banners.add(details);return details;
  }
  function render(){
   queued=false;if(destroyed)return;const api=ensure(),state=api?.snapshot();
   for(const banner of banners)if(!banner.isConnected)banners.delete(banner);
   const pickers=[...doc.querySelectorAll('[data-bb-supermarket-picker="snapshot"],[data-bb-supermarket-picker="shopping"],[data-bb-supermarket-picker="shopmode"]')];
   for(const picker of pickers){let banner=picker.querySelector('[data-bb-yellow-stickers]');if(!state){banner?.remove();continue;}if(!banner)banner=build(picker);const e=banner.bbElements;if(!e)continue;
    const shortLabel=state.live||state.local||state.locked?state.label:state.label.replace(/^🏷️ Yellow stickers: .*? typically /,'🏷️ Typically ').replace(/(\d(?::\d\d)?) (am|pm)–(\d(?::\d\d)?) \2/,'$1–$3 $2');text(e.summaryLabel,shortLabel);e.summary.setAttribute('aria-label',state.label);e.summary.title=state.label;banner.classList.toggle('is-live',!!state.live);e.copy.hidden=e.spotted.parentElement.hidden=e.status.hidden=!!state.locked;if(state.locked)banner.open=false;text(e.copy,state.locked?'':(state.live?'':state.label+'. ')+'Reports for '+state.context.label+' in '+state.context.region+'; branch availability varies.');
    text(e.status,state.notice||'');e.spotted.disabled=e.notYet.disabled=state.busy;banner.setAttribute('aria-busy',String(state.busy));
   }
   const visible=doc.visibilityState!=='hidden'&&[...banners].some(node=>node.isConnected&&node.getClientRects().length>0);if(visible&&!state?.locked)void api?.refresh();
  }
  const changed=()=>{controller?.invalidate();schedule();};
  for(const event of ['basketboss:market-changed','basketboss:supermarket-changed','basketboss:session-changed','basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.addEventListener(event,changed);
  const storage=event=>{if(event.key===null||event.key===KEY||event.key==='basketboss_cloud_session_v1'||event.key?.startsWith('basketboss_321_v10_price_retailer_'))changed();};win.addEventListener('storage',storage);
  doc.addEventListener('basketboss:premium-verified',changed);
  const resume=()=>{if(doc.visibilityState!=='hidden')schedule();};doc.addEventListener('visibilitychange',resume);win.addEventListener('online',resume);
  if(win.MutationObserver){observer=new win.MutationObserver(schedule);observer.observe(doc.body||doc.documentElement,{childList:true,subtree:true});}
  if(win.setInterval)timer=win.setInterval(schedule,60000);schedule();
  return Object.freeze({configure(value){host={...host,...value};controller?.invalidate();schedule();return this;},refresh:schedule,reportReceipt:packet=>ensure()?.reportReceipt(packet)||Promise.resolve({ok:false,ignored:true}),destroy(){destroyed=true;controller?.invalidate();observer?.disconnect();if(timer!==null)win.clearInterval?.(timer);for(const banner of banners)banner.remove();for(const event of ['basketboss:market-changed','basketboss:supermarket-changed','basketboss:session-changed','basketboss:account-deletion-started','basketboss:account-deletion-deleted'])win.removeEventListener(event,changed);win.removeEventListener('storage',storage);doc.removeEventListener('basketboss:premium-verified',changed);doc.removeEventListener('visibilitychange',resume);win.removeEventListener('online',resume);}});
 }
 return Object.freeze({createController,install});
});
