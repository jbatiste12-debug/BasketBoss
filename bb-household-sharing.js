/* BasketBoss partner sharing — preview feature, fail-closed. No legacy restore.
   Per-leaf CAS; conflicting keys are NEVER silently overwritten. */
(()=>{'use strict';
const ROOT='/api/household';
const STATE='basketboss_321_unified_state_v1',STOCK='basketboss_321_v7_measured_pantry';
const KITCHEN='basketboss_makeameal_v1_inventory';
const TICKS='basketboss_321_v11_shop_ticks',SESSION='basketboss_active_shop_session_v7',BUDGET='basketboss_v172_weekly_budget_target_v1';
const SYNC_KEYS=[STATE,STOCK,KITCHEN,TICKS,SESSION,BUDGET];
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
let status=null,busy=false,dialog=null,lastPoll=0,booted=false,conflicts=[];
const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??d}catch{return d}};
const raw=(k)=>{try{return localStorage.getItem(k)}catch{return null}};
const copy=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const userSession=()=>{const s=read('basketboss_cloud_session_v1',null);return s?.access_token?s:null};
async function api(path,body){
 const session=userSession();if(!session)throw Error('Sign in to your BasketBoss account first.');
 const r=await fetch(ROOT+path,{method:body?'POST':'GET',headers:{'Authorization':'Bearer '+session.access_token,'Content-Type':'application/json'},
  body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});
 const data=await r.json().catch(()=>({}));if(!r.ok){const e=Error(data.error||'Sharing unavailable');e.status=r.status;e.data=data;throw e;}return data;
}
const key=(s,k)=>s+'\u001f'+k;
function snapshot(){
 const out=new Map(),state=read(STATE,null);if(!state||state.version!==2||!Array.isArray(state.planned))return null;
 for(const day of DAYS){const p=state.planned.find(x=>x?.day===day);if(p?.recipeId){
  out.set(key('planned_day',day),{section:'planned_day',entry_key:day,value:{recipeId:p.recipeId}});
  const perDay=state.dayServings?.[day];
  const n=perDay?.recipeId===p.recipeId?perDay.count:state.mealServings?.[p.recipeId];
  if(Number.isInteger(n)&&n>=1&&n<=12)
   out.set(key('servings',day),{section:'servings',entry_key:day,value:{count:n}});
 }}
 for(const [k,v] of Object.entries(state.pantry||{}))if(k.length<=170)
  out.set(key('pantry_item','simple:'+k),{section:'pantry_item',entry_key:'simple:'+k,value:v});
 for(const [k,v] of Object.entries(read(STOCK,{})||{}))if(k.length<=170)
  out.set(key('pantry_item','measured:'+k),{section:'pantry_item',entry_key:'measured:'+k,value:v});
 for(const [k,v] of Object.entries(read(KITCHEN,{})||{}))if(k.length<=180)
  out.set(key('kitchen_item',k),{section:'kitchen_item',entry_key:k,value:v});
 const feeding=Number(state.servings);if(Number.isInteger(feeding)&&feeding>=1&&feeding<=12)
  out.set(key('household_servings','default'),{section:'household_servings',entry_key:'default',value:{count:feeding}});
 for(const [k,v] of Object.entries(read(TICKS,{})||{}))if(k.length<=180)
  out.set(key('shopping_checked',k),{section:'shopping_checked',entry_key:k,value:!!v});
 const n=Number(raw(BUDGET));if(Number.isFinite(n)&&n>=1&&n<=10000)
  out.set(key('budget_target','weekly'),{section:'budget_target',entry_key:'weekly',value:{amount:n}});
 return out;
}
function baselineKey(hid){
 const userId=userSession()?.user?.id;
 if(!userId||!/^[-0-9a-f]{30,40}$/i.test(userId))throw Error('Verified account identity required for sharing baseline');
 return 'bb_partner_baseline_v1_'+hid+'_'+userId;
}
function baseline(hid){return read(baselineKey(hid),{});}
function writeBaseline(hid,v){localStorage.setItem(baselineKey(hid),JSON.stringify(v));}
function applyLeaves(remoteChanges){
 if(!remoteChanges.length)return false;
 const expectedKeys=[STATE,STOCK,KITCHEN,TICKS,SESSION,BUDGET],before={};
 for(const k of expectedKeys)before[k]=raw(k);
 const state=read(STATE,null);if(!state||state.version!==2||!Array.isArray(state.planned))throw Error('Saved plan unavailable; no merge performed.');
 const next=copy(state),stock=copy(read(STOCK,{})||{}),kitchen=copy(read(KITCHEN,{})||{}),ticks=copy(read(TICKS,{})||{});
 const session=copy(read(SESSION,{})||{});
 let budget=before[BUDGET];
 for(const {section,entry_key,value} of remoteChanges){const deleted=!!value?.deleted;
  if(section==='planned_day'){
   if(!DAYS.includes(entry_key)||(!deleted&&(typeof value?.recipeId!=='string'||!value.recipeId||value.recipeId.length>256)))throw Error('Invalid shared day');
   const original=next.planned.find(x=>x.day===entry_key);
   next.planned=next.planned.filter(x=>x.day!==entry_key);
   if(!deleted)next.planned.push({day:entry_key,recipeId:value.recipeId});
   // Day overrides carry the original recipe ID; stale overrides cannot
   // affect a replacement dinner. Preserve legacy overrides for other days.
   if(original?.recipeId&&original.recipeId!==value?.recipeId&&next.dayServings)
     delete next.dayServings[entry_key];
  }else if(section==='servings'){
   if(!DAYS.includes(entry_key)||(!deleted&&(!Number.isInteger(value?.count)||value.count<1||value.count>12)))throw Error('Invalid servings');
   const p=next.planned.find(x=>x.day===entry_key);if(!p)continue;
   if(!next.dayServings)next.dayServings={};
   if(deleted)next.dayServings[entry_key]={recipeId:p.recipeId,count:null};
   else if(Number.isInteger(value?.count)&&value.count>=1&&value.count<=12)
     next.dayServings[entry_key]={recipeId:p.recipeId,count:value.count};
  }else if(section==='pantry_item'){
   const simple=entry_key.startsWith('simple:'),measured=entry_key.startsWith('measured:');
   if(!simple&&!measured)throw Error('Invalid pantry key');
   if(!deleted && (simple?typeof value!=='boolean':!(typeof value==='number'&&Number.isFinite(value)&&value>=0)))throw Error('Invalid pantry value');
   const id=entry_key.slice(simple?7:9),target=simple?(next.pantry||(next.pantry={})):stock;
   if(deleted)delete target[id];else target[id]=value;
  }else if(section==='kitchen_item'){
   if(!entry_key || entry_key.length>180 || (!deleted&&(!value||typeof value!=='object'||Array.isArray(value))))throw Error('Invalid kitchen inventory item');
   if(deleted)delete kitchen[entry_key];else kitchen[entry_key]=value;
  }else if(section==='shopping_checked'){
   if(!deleted&&typeof value!=='boolean')throw Error('Invalid shopping checkmark');
   if(deleted||value===false)delete ticks[entry_key];else ticks[entry_key]=true;
  }else if(section==='household_servings'){
   if(entry_key!=='default'||(!deleted&&(!Number.isInteger(value?.count)||value.count<1||value.count>12)))throw Error('Invalid household servings');
   if(!deleted){next.servings=value.count;next.feedingSet=true;}
  }else if(section==='budget_target'){
   if(entry_key!=='weekly'||(!deleted&&(!Number.isFinite(value?.amount)||value.amount<1||value.amount>10000)))throw Error('Invalid budget target');
   if(!deleted)budget=String(value.amount);
  }
 }
 // Guard against unexpected concurrent same-device writes between snapshot and save.
 for(const k of expectedKeys)if(raw(k)!==before[k])throw Error('This device changed during sync; no merge performed.');
 // Store a full recovery copy BEFORE the first modification. Abort on quota error.
 const backupKey='bb_partner_premerge_'+Date.now();
 localStorage.setItem(backupKey,JSON.stringify(before));
 try{
  localStorage.setItem(STATE,JSON.stringify(next));
  localStorage.setItem(STOCK,JSON.stringify(stock));
  localStorage.setItem(KITCHEN,JSON.stringify(kitchen));
  localStorage.setItem(TICKS,JSON.stringify(ticks));
  if(session.version===7&&typeof session.id==='string'&&session.id.startsWith('shop-')){session.bought=copy(ticks);localStorage.setItem(SESSION,JSON.stringify(session));}
  if(budget!==null)localStorage.setItem(BUDGET,budget);
 }catch(e){for(const [k,v] of Object.entries(before)){try{v===null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}}
  throw Error('Insufficient device storage; original data restored where possible.');}
 return true;
}
async function synchronize({allowInitialImport=false}={}){
 if(busy||!status?.premium||!status?.household_id||document.hidden||!navigator.onLine)return;
 busy=true;let applied=false;try{
  const hid=status.household_id,prior=baseline(hid),local=snapshot();if(!local)return;
  // Record the phone's exact local state before the asynchronous request. If a
  // user edits Plan or Shop while the request is pending, abort instead of
  // overwriting that newer edit with an obsolete remote snapshot.
  const observed=Object.fromEntries(SYNC_KEYS.map(k=>[k,raw(k)]));
  const unchanged=()=>SYNC_KEYS.every(k=>raw(k)===observed[k]);
  const requireUnchanged=()=>{if(!unchanged())throw Error('Device changed during sharing sync; no local merge performed.');};
  const fetched=await api('?mode=entries');
  requireUnchanged();if(fetched.household_id!==hid)throw Error('Household changed');
  const remote=new Map((fetched.entries||[]).map(x=>[key(x.section,x.entry_key),x]));
  const nextBaseline={...prior},changes=[];conflicts=[];
  const initialSync=Object.keys(prior).length===0;
  // A fresh device is never permitted to replace existing remote entries.
  const union=new Set([...remote.keys(),...local.keys(),...Object.keys(prior)]);
  for(const k of union){const r=remote.get(k),l=local.get(k),b=prior[k];
   const localValue=l?.value??{deleted:true},remoteValue=r?.value??{deleted:true};
   if(!b){
    if(r&&l&&!eq(localValue,remoteValue)){conflicts.push(k);continue;}
    if(r&&!l){changes.push(r);nextBaseline[k]={revision:r.revision,value:remoteValue};continue;}
    if(!r&&l){
     // Never upload an unknown device's existing data to a new household
     // without an explicit initial import confirmed by the PREMIUM OWNER.
     if(initialSync&&(!allowInitialImport||status.role!=='owner')){
      nextBaseline[k]={revision:0,value:localValue,held:true};conflicts.push(k);continue;
     }
     requireUnchanged();const response=await api('',{action:'patch',section:l.section,key:l.entry_key,value:localValue,expected:0});
     nextBaseline[k]={revision:response.revision,value:localValue};continue;}
    if(r&&l)nextBaseline[k]={revision:r.revision,value:remoteValue};
    continue;
   }
   // A held entry came from an unknown local device on first sign-in.
   // Never release it just because another unrelated remote entry synced.
   if(b.held){
    if(allowInitialImport&&status.role==='owner'&&!r&&l){
     requireUnchanged();const response=await api('',{action:'patch',section:l.section,key:l.entry_key,value:localValue,expected:0});
     nextBaseline[k]={revision:response.revision,value:localValue};
    }else conflicts.push(k);
    continue;
   }
   const localEdited=!eq(localValue,b.value),remoteEdited=!eq(remoteValue,b.value)||Number(r?.revision||0)!==b.revision;
   if(localEdited&&remoteEdited){if(eq(localValue,remoteValue)){nextBaseline[k]={revision:r?.revision||0,value:remoteValue};}
     else conflicts.push(k);continue;}
   if(localEdited&&!remoteEdited){requireUnchanged();const parts=k.split('\u001f'),response=await api('',{action:'patch',section:parts[0],key:parts[1],value:localValue,expected:b.revision});
    nextBaseline[k]={revision:response.revision,value:localValue};continue;}
   if(remoteEdited&&!localEdited){if(r)changes.push(r);else changes.push({section:k.split('\u001f')[0],entry_key:k.split('\u001f')[1],value:{deleted:true}});
    nextBaseline[k]={revision:r?.revision||0,value:remoteValue};continue;}
   nextBaseline[k]={revision:r?.revision||0,value:remoteValue};
  }
  // Never mark a remote change as applied if the local write fails.
  requireUnchanged();if(changes.length)applied=applyLeaves(changes);
  writeBaseline(hid,nextBaseline);
  if(conflicts.length)message(`${conflicts.length} item(s) need review or an owner-approved initial import. No conflicting data was overwritten.`);
  else message('Household synced safely.');
 }catch(e){message(e.status===409?'Another device changed the same item. No data was overwritten.':'Sharing unavailable; this device remains unchanged.');}
 finally{busy=false;if(applied)location.reload();}
}
function message(t){const el=dialog?.querySelector('[data-bbhs-message]');if(el)el.textContent=t;}
function makeModal(){if(dialog)return dialog;
 dialog=document.createElement('dialog');dialog.id='bbhs-dialog';dialog.className='bbhs-dialog';
 dialog.setAttribute('aria-label','Household Partner Sharing');
 dialog.innerHTML='<div class="bbhs-card"><button type="button" class="bbhs-close" aria-label="Close sharing dialog">×</button><h2>👥 Household Partner Sharing</h2><p>Share one Premium household plan with one confirmed-email partner.</p><div data-bbhs-body></div><p class="bbhs-message" role="status" data-bbhs-message></p></div>';
 document.body.append(dialog);
 dialog.querySelector('.bbhs-close').onclick=()=>dialog.close();
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});return dialog;
}
async function refreshStatus(){
 if(!userSession()){status=null;return null;}
 try{status=await api('?mode=status');return status}catch{status=null;return null;}
}
async function open(){makeModal();if(!dialog.open)dialog.showModal();const body=dialog.querySelector('[data-bbhs-body]');
 body.textContent='Checking account…';message('');const s=await refreshStatus();
 if(!s){body.innerHTML='<p>Sign in to link a partner, or explore BasketBoss Premium. Your saved plan is unchanged.</p><a class="bbhs-primary" href="pricing-sandbox.html">Explore Premium</a>';return;}
 if(!s.configured){body.innerHTML='<p>Household Partner Sharing is being prepared. It is not activated yet; your saved plan remains private on this device.</p><a class="bbhs-primary" href="pricing-sandbox.html">Explore Premium</a>';return;}
 if(s.invite){body.innerHTML='<p>You have been invited to share a BasketBoss household.</p><button class="bbhs-primary" data-accept>Accept &amp; Sync</button>';
  body.querySelector('[data-accept]').onclick=async()=>{try{await api('',{action:'accept',household_id:s.invite.household_id});message('Invite accepted. Your existing device data is preserved.');await refreshStatus();await synchronize();await open();}catch{message('Unable to accept now; nothing changed on this device.')}};return;}
 if(!s.premium){body.innerHTML='<p>Partner Sharing is part of BasketBoss Premium.</p><a href="pricing-sandbox.html" class="bbhs-primary">Explore Premium plans</a>';return;}
 if(s.role==='partner'){body.innerHTML='<p>Connected to your shared Premium household. Any conflicting changes are kept for review.</p><button data-sync class="bbhs-primary">Sync safely now</button>';}
 else{body.innerHTML=`<label>Partner email <input data-email type="email" autocomplete="email" placeholder="partner@example.com" value="${esc(s.partner_email||'')}"></label><p>${s.invite_status==='accepted'?'Connected':s.invite_status==='pending'?'Invitation pending':'No partner linked'}</p><button class="bbhs-primary" data-invite>Create Partner Invite</button><button data-unlink ${s.invite_status==='none'?'disabled':''}>Unlink partner</button><button data-sync>Sync safely now</button><button data-init-import>Start sharing this device’s saved plan</button><small>One partner only. A pending invite appears when the partner signs in with the matching confirmed email. No invitation email is sent yet.</small>`;
  body.querySelector('[data-invite]').onclick=async()=>{try{const email=body.querySelector('[data-email]').value;const result=await api('',{action:'invite',email});message(result.message);await refreshStatus();}catch(e){message(e.message)}};
  body.querySelector('[data-init-import]').onclick=async()=>{
   if(!confirm('Share this device’s saved meals, pantry, servings and shopping checkmarks with your linked household? Only do this if the saved plan belongs to this account.'))return;
   await synchronize({allowInitialImport:true});
  };
  body.querySelector('[data-unlink]').onclick=async()=>{if(!confirm('Unlink your partner? Their device will keep its existing local plan.'))return;
   try{await api('',{action:'unlink'});message('Partner unlinked; your stored plan remains.');await refreshStatus();await open();}catch(e){message(e.message)}};
 }
 body.querySelector('[data-sync]')?.addEventListener('click',()=>synchronize());
}
function attach(){const app=document.getElementById('app');if(!app)return;
 // Add independent buttons without moving existing elements or changing grids.
 // The My Week Feeding control is intentionally left untouched.
 const targets=[app.querySelector('.bb321-shop-summary-top'),
  document.getElementById('bbuiAccountSection'),document.getElementById('cloud-signed')].filter(Boolean);
 for(const target of targets){if(target.querySelector('[data-bbhs-trigger]'))continue;
  const btn=document.createElement('button');btn.type='button';btn.className='bbhs-trigger';btn.dataset.bbhsTrigger='1';btn.textContent='👥 Share with Partner';btn.onclick=e=>{e.preventDefault();e.stopPropagation();open()};target.append(btn);
 }
}
function boot(){if(booted)return;booted=true;const app=document.getElementById('app');if(!app)return;
 const observer=new MutationObserver(()=>{if(!document.hidden)attach()});observer.observe(app,{childList:true,subtree:false});
 attach();window.addEventListener('basketboss:session-changed',()=>{status=null;refreshStatus()});
 window.addEventListener('focus',async()=>{if(Date.now()-lastPoll<7000)return;lastPoll=Date.now();await refreshStatus();synchronize()});
 window.addEventListener('online',()=>synchronize());
 setInterval(()=>{if(!document.hidden&&Date.now()-lastPoll>20000){lastPoll=Date.now();synchronize()}},20000);
 refreshStatus().then(s=>{if(s?.invite){const banner=document.createElement('button');banner.className='bbhs-invite-notice';banner.textContent='👥 You have a BasketBoss partner invitation · Accept & Sync';banner.onclick=()=>{banner.remove();open()};document.body.append(banner);}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
