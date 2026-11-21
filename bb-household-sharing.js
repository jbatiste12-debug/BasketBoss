/* BasketBoss partner sharing — preview feature, fail-closed. No legacy restore.
   Per-leaf CAS; conflicting keys are NEVER silently overwritten. */
(()=>{'use strict';
const ROOT='/api/household';
const STATE='basketboss_321_unified_state_v1',STOCK='basketboss_321_v7_measured_pantry';
const KITCHEN='basketboss_makeameal_v1_inventory';
const TICKS='basketboss_321_v11_shop_ticks',SESSION='basketboss_active_shop_session_v7',BUDGET='basketboss_v172_weekly_budget_target_v1';
const SYNC_KEYS=[STATE,STOCK,KITCHEN,TICKS,SESSION,BUDGET];
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
let status=null,busy=false,dialog=null,lastPoll=0,booted=false,conflicts=[],heldConflicts=[],deletionPaused=false,generation=0,openRevision=0;
let invitationNotice=null,actionInFlight=null,polling=false,entryRequested=false,pendingRefresh=null,statusRevision=0;
const deleting=()=>deletionPaused||window.BBAccountDeletion?.isDeleting?.()===true;
const pauseDeletion=()=>{deletionPaused=true;generation++;status=null;conflicts=[];heldConflicts=[];pendingRefresh=null;invitationNotice?.remove?.();invitationNotice=null;dialog?.close?.();};
window.addEventListener('basketboss:account-deletion-started',pauseDeletion);
window.addEventListener('basketboss:account-deletion-deleted',pauseDeletion);
window.addEventListener('basketboss:account-deletion-cancelled',()=>{deletionPaused=false;generation++;});
const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??d}catch{return d}};
const raw=(k)=>{try{return localStorage.getItem(k)}catch{return null}};
const copy=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const userSession=()=>{if(deleting())return null;const s=read('basketboss_cloud_session_v1',null);return s?.access_token?s:null};
const accountPin=()=>{const s=userSession();return {actor:s?.user?.id,token:s?.access_token,serial:generation};};
const sameAccount=pin=>{const s=userSession();return !deleting()&&pin.serial===generation&&pin.actor===s?.user?.id&&pin.token===s?.access_token;};
const hostPin=pin=>({actor:pin.actor,token:pin.token,expected:raw(STATE)});
function prepareReadablePlan(pin){
 if(!sameAccount(pin))return false;
 if(raw(STATE)!==null)return true;
 return window.BBHomeHost?.prepareEmptySharedHousehold?.(hostPin(pin))===true&&sameAccount(pin);
}
const readyToRender=pin=>sameAccount(pin)&&window.BBHomeHost?.canRefreshSharedHousehold?.(hostPin(pin))===true;
function refreshRenderedHousehold(pin){
 if(!sameAccount(pin))return false;
 const expected=raw(STATE);
 if(window.BBHomeHost?.refreshSharedHousehold?.({actor:pin.actor,token:pin.token,expected})===true){pendingRefresh=null;return true;}
 pendingRefresh={...pin,expected};return false;
}
async function accountRequest(url,body){
 const session=userSession(),serial=generation;if(!session)throw Error('Sign in to your BasketBoss account first.');
 const r=await fetch(url,{method:body?'POST':'GET',headers:{'Authorization':'Bearer '+session.access_token,'Content-Type':'application/json'},
  body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});
 const data=await r.json().catch(()=>({}));const current=userSession();if(deleting()||serial!==generation||current?.user?.id!==session.user?.id||current?.access_token!==session.access_token)throw Error('Account changed during sharing request.');if(!r.ok){const e=Error(data?.error||'Sharing unavailable');e.status=r.status;e.data=data;throw e;}return data;
}
async function api(path,body){return accountRequest(ROOT+path,body);}
const key=(s,k)=>s+'\u001f'+k;
// Receipt inventory has its own revision-checked whole-stock transaction. Do
// not replay the older per-leaf pantry channel over that authoritative stock.
const receiptInventoryOwnsLeaf=(section,entryKey)=>!!window.BBReceiptHost?.handlesInventorySync?.()&&
 (section==='kitchen_item'||section==='pantry_item'&&String(entryKey).startsWith('measured:'));
function snapshot(){
 const out=new Map(),state=read(STATE,null);if(!state||state.version!==2||!Array.isArray(state.planned))return null;
 for(const day of DAYS){const p=state.planned.find(x=>x?.day===day);if(p?.recipeId){
  out.set(key('planned_day',day),{section:'planned_day',entry_key:day,value:{recipeId:p.recipeId}});
  const perDay=state.dayServings?.[day];
  // Match the existing meal resolver: an explicit slot count wins over a
  // recipe-bound day override, then the legacy recipe-scoped value.
  const slotCount=Number(p.servings),n=Number.isInteger(slotCount)&&slotCount>=1&&slotCount<=12?slotCount:Number(perDay?.recipeId===p.recipeId?perDay.count:state.mealServings?.[p.recipeId]);
  if(Number.isInteger(n)&&n>=1&&n<=12)
   out.set(key('servings',day),{section:'servings',entry_key:day,value:{count:n}});
 }}
 for(const [k,v] of Object.entries(state.pantry||{}))if(k.length<=170)
  out.set(key('pantry_item','simple:'+k),{section:'pantry_item',entry_key:'simple:'+k,value:v});
 for(const [k,v] of Object.entries(read(STOCK,{})||{}))if(k.length<=170&&!receiptInventoryOwnsLeaf('pantry_item','measured:'+k))
  out.set(key('pantry_item','measured:'+k),{section:'pantry_item',entry_key:'measured:'+k,value:v});
 for(const [k,v] of Object.entries(read(KITCHEN,{})||{}))if(k.length<=180&&!receiptInventoryOwnsLeaf('kitchen_item',k))
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
function writeBaseline(hid,v){if(deleting())throw Error('Account deletion is in progress.');localStorage.setItem(baselineKey(hid),JSON.stringify(v));}
function applyLeaves(remoteChanges,{baselineStorageKey=null,baselineValue=null,expectedBaseline=null}={}){
 if(deleting())throw Error('Account deletion is in progress.');
 if(!remoteChanges.length)return false;
 const expectedKeys=[STATE,STOCK,KITCHEN,TICKS,SESSION,BUDGET],before={};
 if(baselineStorageKey)expectedKeys.push(baselineStorageKey);
 for(const k of expectedKeys)before[k]=raw(k);
 if(baselineStorageKey&&before[baselineStorageKey]!==expectedBaseline)throw Error('Sharing baseline changed; no merge performed.');
 const state=read(STATE,null);if(!state||state.version!==2||!Array.isArray(state.planned))throw Error('Saved plan unavailable; no merge performed.');
 const next=copy(state),stock=copy(read(STOCK,{})||{}),kitchen=copy(read(KITCHEN,{})||{}),ticks=copy(read(TICKS,{})||{});
 const session=copy(read(SESSION,{})||{});
 let budget=before[BUDGET];
 for(const {section,entry_key,value} of remoteChanges){const deleted=!!value?.deleted;
  if(receiptInventoryOwnsLeaf(section,entry_key))continue;
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
 const backupBase='bb_partner_premerge_'+Date.now();let backupKey=backupBase,backupSerial=0;
 while(raw(backupKey)!==null)backupKey=backupBase+'_'+(++backupSerial);
 localStorage.setItem(backupKey,JSON.stringify(before));
 try{
  localStorage.setItem(STATE,JSON.stringify(next));
  localStorage.setItem(STOCK,JSON.stringify(stock));
  localStorage.setItem(KITCHEN,JSON.stringify(kitchen));
  localStorage.setItem(TICKS,JSON.stringify(ticks));
  if(session.version===7&&typeof session.id==='string'&&session.id.startsWith('shop-')){session.bought=copy(ticks);localStorage.setItem(SESSION,JSON.stringify(session));}
  if(budget!==null)localStorage.setItem(BUDGET,budget);
  if(baselineStorageKey)localStorage.setItem(baselineStorageKey,JSON.stringify(baselineValue));
 }catch(e){for(const [k,v] of Object.entries(before)){try{v===null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}}
  throw Error('Insufficient device storage; original data restored where possible.');}
 return true;
}
async function synchronize({allowInitialImport=false,automatic=false}={}){
 if(deleting())return;
 const serial=generation;
 if(busy){message('A household sync is already running.');return;}
 if(!status?.premium||!status?.household_id){message('Household access needs refreshing. Close and reopen Partner Sharing.');return;}
 if(document.hidden){message('Return to the BasketBoss tab before syncing.');return;}
 if(!navigator.onLine){message('You are offline. Nothing was changed on this device.');return;}
 const pin=accountPin();
 // Do not replace visible app state while a meal or pantry editor is in use.
 // The host bridge validates the exact account and saved plan before rendering.
 if(!prepareReadablePlan(pin))return;
 if(automatic&&!readyToRender(pin))return;
 message('Checking your shared household for changes…');
 busy=true;let applied=false;try{
  const hid=status.household_id,prior=baseline(hid),baselineStorageKey=baselineKey(hid),expectedBaseline=raw(baselineStorageKey),local=snapshot();
  if(!local){message('This device has no readable local plan yet. The household remains connected.');return;}
  // Record the phone's exact local state before the asynchronous request. If a
  // user edits Plan or Shop while the request is pending, abort instead of
  // overwriting that newer edit with an obsolete remote snapshot.
  const observed=Object.fromEntries(SYNC_KEYS.map(k=>[k,raw(k)]));
  const receiptOwnedAtStart=!!window.BBReceiptHost?.handlesInventorySync?.();
  const unchanged=()=>sameAccount(pin)&&serial===generation&&status?.configured===true&&status?.premium===true&&status.household_id===hid&&raw(baselineStorageKey)===expectedBaseline&&SYNC_KEYS.every(k=>raw(k)===observed[k])&&receiptOwnedAtStart===!!window.BBReceiptHost?.handlesInventorySync?.();
  const requireUnchanged=()=>{if(!unchanged())throw Error('Device changed during sharing sync; no local merge performed.');};
  const fetched=await api('?mode=entries');
  requireUnchanged();if(fetched.household_id!==hid)throw Error('Household changed');
  const remote=new Map((fetched.entries||[]).map(x=>[key(x.section,x.entry_key),x]));
  const nextBaseline={...prior},changes=[];conflicts=[];heldConflicts=[];
  const initialSync=Object.keys(prior).length===0;
  // A fresh device is never permitted to replace existing remote entries.
  const union=new Set([...remote.keys(),...local.keys(),...Object.keys(prior)]);
  // A day and its recipe-bound headcount form one shared choice. Preflight
  // both leaves before ANY patch: otherwise a private count could be sent to
  // another device's replacement recipe even though each leaf's CAS succeeds.
  const valueOf=(entries,k)=>entries.get(k)?.value??{deleted:true};
  const unresolved=k=>{const r=remote.get(k),l=local.get(k),b=prior[k];
   if(!b)return !!(r&&l&&!eq(l.value,r.value)||!r&&l&&initialSync&&(!allowInitialImport||status.role!=='owner'));
   if(b.held)return !(allowInitialImport&&status.role==='owner'&&!r&&l);
   if(b.localOnly)return true;
   const lv=valueOf(local,k),rv=valueOf(remote,k);
   return !eq(lv,b.value)&&(!eq(rv,b.value)||Number(r?.revision||0)!==b.revision)&&!eq(lv,rv);
  };
  const blockedDays=new Set();
  for(const day of DAYS){const keys=[key('planned_day',day),key('servings',day)],known=keys.some(k=>prior[k]);
   const localChanged=known&&keys.some(k=>!eq(valueOf(local,k),prior[k]?.value??{deleted:true}));
   const remoteChanged=known&&keys.some(k=>!eq(valueOf(remote,k),prior[k]?.value??{deleted:true})||Number(remote.get(k)?.revision||0)!==Number(prior[k]?.revision||0));
   if(keys.some(unresolved)||localChanged&&remoteChanged&&keys.some(k=>!eq(valueOf(local,k),valueOf(remote,k))))blockedDays.add(day);
  }
  for(const k of union){const r=remote.get(k),l=local.get(k),b=prior[k];
   const parts=k.split('\u001f');if(receiptInventoryOwnsLeaf(parts[0],parts[1]))continue;
   const localValue=l?.value??{deleted:true},remoteValue=r?.value??{deleted:true};
   if((parts[0]==='planned_day'||parts[0]==='servings')&&blockedDays.has(parts[1])){
    conflicts.push(k);
    if(b)nextBaseline[k]=b;
    else if(!r&&l&&initialSync&&(!allowInitialImport||status.role!=='owner')){nextBaseline[k]={revision:0,value:localValue,held:true};heldConflicts.push(k);}
    else delete nextBaseline[k];
    continue;
   }
   if(!b){
    if(r&&l&&!eq(localValue,remoteValue)){conflicts.push(k);continue;}
    if(r&&!l){changes.push(r);nextBaseline[k]={revision:r.revision,value:remoteValue};continue;}
    if(!r&&l){
     // Never upload an unknown device's existing data to a new household
     // without an explicit initial import confirmed by the PREMIUM OWNER.
     if(initialSync&&(!allowInitialImport||status.role!=='owner')){
      nextBaseline[k]={revision:0,value:localValue,held:true};conflicts.push(k);heldConflicts.push(k);continue;
     }
     requireUnchanged();if(!readyToRender(pin))throw Error('Finish editing before sharing this device.');const response=await api('',{action:'patch',section:l.section,key:l.entry_key,value:localValue,expected:0});
     nextBaseline[k]={revision:response.revision,value:localValue};continue;}
    if(r&&l)nextBaseline[k]={revision:r.revision,value:remoteValue};
    continue;
   }
   // A held entry came from an unknown local device on first sign-in.
   // Never release it just because another unrelated remote entry synced.
   if(b.held){
    if(allowInitialImport&&status.role==='owner'&&!r&&l){
     requireUnchanged();if(!readyToRender(pin))throw Error('Finish editing before sharing this device.');const response=await api('',{action:'patch',section:l.section,key:l.entry_key,value:localValue,expected:0});
     nextBaseline[k]={revision:response.revision,value:localValue};
    }else{conflicts.push(k);heldConflicts.push(k);}
    continue;
   }
   // A reviewed item can remain private to this device without being uploaded.
   // If an owner adds the same key to the household later, flag it for review.
   if(b.localOnly){
    if(r){conflicts.push(k);continue;}
    nextBaseline[k]={...b,value:localValue};continue;
   }
   const localEdited=!eq(localValue,b.value),remoteEdited=!eq(remoteValue,b.value)||Number(r?.revision||0)!==b.revision;
   if(localEdited&&remoteEdited){if(eq(localValue,remoteValue)){nextBaseline[k]={revision:r?.revision||0,value:remoteValue};}
     else conflicts.push(k);continue;}
   if(localEdited&&!remoteEdited){requireUnchanged();if(!readyToRender(pin))throw Error('Finish editing before sharing this device.');const parts=k.split('\u001f'),response=await api('',{action:'patch',section:parts[0],key:parts[1],value:localValue,expected:b.revision});
    nextBaseline[k]={revision:response.revision,value:localValue};continue;}
   if(remoteEdited&&!localEdited){if(r)changes.push(r);else changes.push({section:k.split('\u001f')[0],entry_key:k.split('\u001f')[1],value:{deleted:true}});
    nextBaseline[k]={revision:r?.revision||0,value:remoteValue};continue;}
   nextBaseline[k]={revision:r?.revision||0,value:remoteValue};
  }
  for(const change of [...changes])if(change.section==='planned_day'&&!change.value?.deleted){
   const day=change.entry_key,planKey=key('planned_day',day),servingKey=key('servings',day),saved=nextBaseline[servingKey];
   if(conflicts.includes(servingKey)||saved?.held||saved?.localOnly){
    // A dinner and its headcount must not be applied separately while that
    // day's serving choice is still held or conflicting.
    changes.splice(changes.indexOf(change),1);if(!conflicts.includes(planKey))conflicts.push(planKey);
    if(prior[planKey])nextBaseline[planKey]=prior[planKey];else delete nextBaseline[planKey];
    continue;
   }
   // Reapply the authoritative day count even when it was unchanged relative
   // to the baseline. A replacement recipe must not revive a private legacy
   // override. Include any count just confirmed by our successful CAS patch.
   const count=saved||remote.get(servingKey),value=count?.value??{deleted:true},revision=count?.revision||0;
   changes.push({section:'servings',entry_key:day,value});nextBaseline[servingKey]={revision,value};
  }
  // Never mark a remote change as applied if the local write fails.
  requireUnchanged();if(changes.length){if(!readyToRender(pin)){message('Your shared changes are ready. Finish editing, then tap Sync safely now.');return;}applied=applyLeaves(changes,{baselineStorageKey,baselineValue:nextBaseline,expectedBaseline});}
  else writeBaseline(hid,nextBaseline);
  if(conflicts.length)message(`${conflicts.length} item(s) need review. Your existing data was preserved; other changes can still sync.`);
  else message(changes.length?'Household changes received and saved safely.':'Sync complete. No new household changes to apply.');
  showHeldReview();
  return {ok:true,conflicts:conflicts.length,applied};
 }catch(e){message(e.status===409?'Another device changed the same item. No data was overwritten.':'Sharing unavailable; this device remains unchanged.');}
 finally{busy=false;if(applied&&sameAccount(pin)&&!refreshRenderedHousehold(pin))message('Household changes were saved. Finish editing, then tap Sync safely now to refresh this screen.');}
}
function message(t){const el=dialog?.querySelector('[data-bbhs-message]');if(el)el.textContent=t;}
function showHeldReview(){
 const area=dialog?.querySelector('[data-bbhs-review]');if(!area)return;
 area.replaceChildren();
 if(!heldConflicts.length)return;
 const info=document.createElement('p');
 info.textContent=`${heldConflicts.length} existing local item(s) are held back. You can keep them private on this device without deleting or uploading them.`;
 area.append(info);
 const button=document.createElement('button');button.type='button';button.textContent='Keep held item(s) on this device only';
 button.onclick=async()=>{
  if(busy||actionInFlight){message('Finish the current sync first.');return;}
  if(!status?.household_id){message('Reconnect to your household first.');return;}
  if(!confirm('Keep held local items on THIS device only? They will not be shared, deleted or overwrite household data.'))return;
  const pin=accountPin(),hid=status.household_id,view=openRevision;
  const current=()=>sameAccount(pin)&&dialog?.open&&view===openRevision&&status?.configured===true&&status?.premium===true&&status.household_id===hid;
  if(!current())return;
  const action={};actionInFlight=action;button.disabled=true;
  try{
   const keys=[...new Set(heldConflicts)],prior=baseline(hid),local=snapshot();
   if(!local||keys.some(k=>!prior[k]?.held||!local.has(k)))throw Error('Local review has changed. Sync again.');
   const before=Object.fromEntries(SYNC_KEYS.map(k=>[k,raw(k)]));
   const latest=await api('?mode=entries');
   if(!current()||latest.household_id!==hid)throw Error('Household changed.');
   const remote=new Set((latest.entries||[]).map(e=>key(e.section,e.entry_key)));
   if(keys.some(k=>remote.has(k)))throw Error('A shared version now exists. Review the change before deciding.');
   if(SYNC_KEYS.some(k=>raw(k)!==before[k]))throw Error('Your device changed during review. Sync again.');
   const next={...prior};
   for(const k of keys)next[k]={revision:0,value:copy(local.get(k).value),localOnly:true};
   writeBaseline(hid,next);
   heldConflicts=[];showHeldReview();
   message('Held items remain on this device only. Nothing was deleted or uploaded. Tap Sync safely now to check again.');
  }catch(e){message(e?.message||'Review could not complete; nothing was changed.');}
  finally{if(actionInFlight===action)actionInFlight=null;button.disabled=false;}
 };
 area.append(button);
}
function makeModal(){if(dialog)return dialog;
 dialog=document.createElement('dialog');dialog.id='bbhs-dialog';dialog.className='bbhs-dialog';
 dialog.setAttribute('aria-label','Household Partner Sharing');
 dialog.innerHTML='<div class="bbhs-card"><button type="button" class="bbhs-close" aria-label="Close sharing dialog">×</button><h2>👥 Household Partner Sharing</h2><p>Share one Premium household plan with one confirmed-email partner.</p><div data-bbhs-body></div><p class="bbhs-message" role="status" data-bbhs-message></p><div data-bbhs-review></div></div>';
 document.body.append(dialog);
 dialog.querySelector('.bbhs-close').onclick=()=>dialog.close();
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});return dialog;
}
async function refreshStatus({throwErrors=false}={}){
 if(deleting())return null;
 const revision=++statusRevision;
 if(!userSession()){status=null;updateInvitationNotice();return null;}
 try{const next=await api('?mode=status');if(revision!==statusRevision)return status;status=next;updateInvitationNotice();return status;}
 catch(error){if(revision===statusRevision){status=null;updateInvitationNotice();}if(throwErrors)throw error;return null;}
}
function householdChanged(action){
 if(deleting())return;
 // The account pantry lifecycle rechecks the server-derived scope. This is
 // only a notification; sharing never chooses or migrates that scope here.
 try{const event=new Event('basketboss:household-changed');event.detail={action};window.dispatchEvent?.(event);}catch{}
 // Refresh the same authenticated membership check; this event grants nothing.
 try{void window.BasketBossVerifiedPremium?.refresh?.(true)?.catch?.(()=>{});}catch{}
}
async function connectPantry(pin,hid){
 if(!sameAccount(pin))throw Error('Account changed. Reopen Partner Sharing.');
 const host=window.BBReceiptHost;
 if(host?.accountPantrySyncEnabled?.()!==true)return {ok:true,legacy:true};
 const result=await host.connectHouseholdPantry?.();
 if(!sameAccount(pin))throw Error('Account changed. Reopen Partner Sharing.');
 if(result?.ok!==true||result.adoptedScope?.kind!=='household'||result.adoptedScope.id!==hid)
  throw Error(result?.waitingForOwner?'Invitation accepted. The household lead needs to finish connecting the shared pantry. Your previous pantry is kept.':'The household is connected, but the pantry needs review in Account & cloud sync. Your previous pantry is kept.');
 return result;
}
async function adoptRemote(pin,hid){
 if(!sameAccount(pin)||status?.configured!==true||status?.premium!==true||status?.role!=='partner'||status.household_id!==hid)throw Error('Refresh your household access before using shared data.');
 if(!prepareReadablePlan(pin))throw Error('This device has unfinished or recovered data. Your saved data has been kept; finish reviewing it before using shared household data.');
 const prepare=window.BBHomeHost?.prepareSharedHouseholdRecipes;
 if(typeof prepare==='function'){
  if(!await prepare(hostPin(pin))||!sameAccount(pin)||!readyToRender(pin))throw Error('Finish editing, then tap Use shared household data to connect safely.');
 }
 const local=snapshot();if(!local)return {ok:false,message:'Invitation accepted. Open Plan once, then return here to connect your saved household data.'};
 if(!readyToRender(pin))return {ok:false,message:'Invitation accepted. Finish editing, then tap Use shared household data to connect safely.'};
 const observed=Object.fromEntries(SYNC_KEYS.map(k=>[k,raw(k)])),baselineStorageKey=baselineKey(hid),expectedBaseline=raw(baselineStorageKey);
 const receiptOwned=!!window.BBReceiptHost?.handlesInventorySync?.();
 const unchanged=()=>sameAccount(pin)&&status?.household_id===hid&&raw(baselineStorageKey)===expectedBaseline&&SYNC_KEYS.every(k=>raw(k)===observed[k])&&receiptOwned===!!window.BBReceiptHost?.handlesInventorySync?.();
 const fetched=await api('?mode=entries');
 if(!unchanged()||!readyToRender(pin))throw Error('Your device changed. Your previous plan is kept; tap Use shared household data when ready.');
 if(fetched.household_id!==hid||!Array.isArray(fetched.entries))throw Error('Shared data could not be checked. Your previous plan is kept.');
 const sections=new Set(['planned_day','servings','pantry_item','kitchen_item','shopping_checked','household_servings','budget_target']),remote=new Map();
 for(const row of fetched.entries){
  if(!sections.has(row?.section))continue;
  if(typeof row.entry_key!=='string'||!Number.isSafeInteger(row.revision)||row.revision<1)throw Error('Shared data needs review. Your previous plan is kept.');
  if(receiptInventoryOwnsLeaf(row.section,row.entry_key))continue;
  const k=key(row.section,row.entry_key);if(remote.has(k))throw Error('Shared data needs review. Your previous plan is kept.');remote.set(k,row);
 }
 if(!remote.size)return {ok:false,message:'Invitation accepted. The household lead has not shared any dinners or list data yet. Your previous plan is kept.'};
 const changes=[...remote.values()].sort((a,b)=>Number(b.section==='planned_day')-Number(a.section==='planned_day'));
 const next={};
 for(const [k,row] of remote)next[k]={revision:row.revision,value:copy(row.value)};
 for(const [k,row] of local)if(!remote.has(k)){
  // Missing optional household defaults stay private; absence never uploads a
  // partner's old budget or serving preference to the owner's shared plan.
  if(row.section==='budget_target'||row.section==='household_servings'){next[k]={revision:0,value:copy(row.value),localOnly:true};continue;}
  changes.push({...row,value:{deleted:true}});next[k]={revision:0,value:{deleted:true}};
 }
 for(const row of remote.values())if(row.section==='planned_day'&&!row.value?.deleted&&!remote.has(key('servings',row.entry_key))){
  // An absent shared day override means use the shared household default,
  // never this partner's older private recipe-scoped serving preference.
  const k=key('servings',row.entry_key);
  if(!next[k])changes.push({section:'servings',entry_key:row.entry_key,value:{deleted:true}});
  next[k]={revision:0,value:{deleted:true}};
 }
 if(!unchanged())throw Error('Your device changed. Your previous plan is kept.');
 // applyLeaves validates every supported value and writes its durable recovery
 // copy before changing any plan/list key. This path never uploads local leaves.
 const applied=applyLeaves(changes,{baselineStorageKey,baselineValue:next,expectedBaseline});conflicts=[];heldConflicts=[];
 if(applied&&!refreshRenderedHousehold(pin))return {ok:true,message:'Shared household data was saved and your previous device data backed up. Finish editing, then tap Sync safely now to refresh this screen.'};
 return {ok:true,message:'Shared dinners, pantry and shopping list connected. Your previous device data is kept as a backup. Updates are checked while the app is open.'};
}
function invitationFeedback(result){
 if(result?.email_sent===true)return 'Invitation saved. The email provider accepted the invitation for sending. Ask your partner to sign in with the same email and accept it.';
 return 'Invitation saved. An email could not be sent'+(result?.email_status==='not_configured'?' from this site yet': ' right now')+'. Share the link below and ask your partner to sign in with the invited email.';
}
function sharingLink(){return 'https://www.basketboss.co.uk/app#partner-sharing';}
function linkMarkup(){return '<div class="bbhs-link"><label>Partner invitation link<input data-invite-link readonly aria-label="Partner invitation link" value="'+sharingLink()+'"></label><button type="button" data-copy-link>Copy invitation link</button><small>The link opens BasketBoss. Only the invited, confirmed email can accept. Pending invitations expire automatically and can be revoked with Unlink partner.</small></div>';}
function wireCopy(body){body.querySelector('[data-copy-link]')?.addEventListener('click',async()=>{
 const pin=accountPin();try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(sharingLink());if(sameAccount(pin)&&dialog?.open)message('Invitation link copied. Send it to your partner.');}
 catch{if(!sameAccount(pin)||!dialog?.open)return;body.querySelector('[data-invite-link]')?.select?.();message('Select and copy the invitation link above.');}
});}
function finishConfirmedSharingInput(){const active=document.activeElement;if(dialog?.contains?.(active)&&active?.matches?.('input,textarea,select,[contenteditable="true"]'))active.blur();}
async function runAction(button,current,work){
 if(actionInFlight||busy){message('Please wait for the current sharing action.');return;}
 if(!current())return;
 if(!navigator.onLine){message('You are offline. Reconnect to continue.');return;}
 const action={};actionInFlight=action;button.disabled=true;
 try{await work();}catch(error){if(current())message(error?.message||'Sharing could not complete. Please try again.');}
 finally{if(actionInFlight===action)actionInFlight=null;if(current())button.disabled=false;}
}
async function open(){if(deleting())return;makeModal();if(!dialog.open)dialog.showModal();const body=dialog.querySelector('[data-bbhs-body]');
 const session=userSession(),serial=generation,view=++openRevision;
 const current=()=>{const active=userSession();return !deleting()&&dialog.open&&view===openRevision&&serial===generation&&active?.user?.id===session?.user?.id&&active?.access_token===session?.access_token;};
 const signIn=(copy='Sign in to your BasketBoss account to check Partner Sharing. Your saved plan is unchanged.')=>{body.innerHTML='<p>'+esc(copy)+'</p><button class="bbhs-primary" data-signin>Sign in to BasketBoss</button>';body.querySelector('[data-signin]').onclick=()=>{const button=document.getElementById('cloud-open');if(button){dialog.close();button.click();}else message('Close this panel and sign in from Settings, then try again.');};};
 const retry=copy=>{body.innerHTML='<p>'+esc(copy)+'</p><button class="bbhs-primary" data-retry>Try again</button>';body.querySelector('[data-retry]').onclick=()=>open();};
 body.textContent='Checking account…';message('');dialog.querySelector('[data-bbhs-review]').replaceChildren();let s,problem;
 try{s=await refreshStatus({throwErrors:true});}catch(error){problem=error;}
 if(!current())return;
 if(!session||problem?.status===401){signIn();return;}
 if(s?.configured===true&&s.invite){body.innerHTML='<div class="bbhs-summary"><h3>You’re invited</h3><p>Use your household’s shared dinners, pantry and shopping list. Your previous device data will be kept as a backup before it is replaced.</p><p>Only accept if this is the household you want to join.</p></div><button class="bbhs-primary" data-accept>Accept &amp; use shared data</button><button type="button" data-not-now>Not now</button>';
  body.querySelector('[data-not-now]')?.addEventListener('click',()=>dialog.close());
  const button=body.querySelector('[data-accept]');button.onclick=()=>runAction(button,current,async()=>{
   finishConfirmedSharingInput();if(!current())return;
   const pin=accountPin(),hid=s.invite.household_id;
   await api('',{action:'accept',household_id:hid});if(!current())return;
   await refreshStatus({throwErrors:true});if(!current())return;
   if(status?.configured!==true||status?.premium!==true||status?.role!=='partner'||status.household_id!==hid)throw Error('Invitation accepted, but household access needs refreshing. Your previous device data is kept.');
   let feedback='Invitation accepted. Your previous device data is kept.';
   try{await connectPantry(pin,hid);if(!current())return;const adopted=await adoptRemote(pin,hid);feedback=adopted.message;}
   catch(error){feedback=error?.message||'Invitation accepted. Your shared data needs connecting; your previous device data is kept.';}
   if(!current())return;householdChanged('accept');await open();if(sameAccount(pin)&&dialog.open)message(feedback);
  });return;}
 if(s?.configured!==true||s.premium!==true){
  // Membership only explains this unavailable state. The household response
  // remains the sole authority for invitation and shared-data controls.
  let membership;
  try{membership=await accountRequest('/api/subscription/status');if(membership?.authenticated!==true||typeof membership.premiumAccess!=='boolean')throw Error('Membership unavailable');}
  catch(error){if(!current())return;if(error.status===401)signIn();else retry('Your membership and Partner Sharing could not be checked. Please try again. Your saved plan is unchanged.');return;}
  if(!current())return;
  if(problem?.status===403){
   signIn(membership.premiumAccess?'Your Premium membership is recognised. Sign in again on this device to refresh Partner Sharing access. You do not need another subscription.':undefined);return;
  }
  if(membership.premiumAccess){
   retry('Your Premium membership is recognised. '+(s?.configured===false?'Partner Sharing is not available on this site right now.':problem?'Partner Sharing is temporarily unavailable.':'Partner Sharing is not available for your account right now.')+' You do not need another subscription. Your saved plan is unchanged.');return;
  }
  if(problem||typeof s?.configured!=='boolean'||typeof s?.premium!=='boolean'){retry('Partner Sharing could not be checked. Please try again. Your saved plan is unchanged.');return;}
  body.innerHTML=(s.configured?'':'<p>Partner Sharing is not available on this site right now. Your saved plan remains private on this device.</p>')+'<p>Partner Sharing is part of BasketBoss Premium.</p><a href="pricing-sandbox.html" class="bbhs-primary">Explore Premium plans</a>';return;
 }
 if(s.role==='partner'){body.innerHTML='<div class="bbhs-summary"><h3>Your shared household</h3><p>Shared dinners, pantry and shopping list. Updates are checked while the app is open; conflicting edits are kept for review.</p></div><button data-sync class="bbhs-primary">Sync safely now</button><button data-adopt>Use shared household data</button><small>Use shared household data replaces the supported dinners and list on this device with the household’s saved version. Your previous device data is backed up first.</small>';
  const button=body.querySelector('[data-adopt]');button?.addEventListener('click',()=>runAction(button,current,async()=>{
   if(!confirm('Use the shared household dinners, pantry and shopping list on this device? Your previous device data will be kept as a backup.'))return;
   finishConfirmedSharingInput();if(!current())return;
   const pin=accountPin();await refreshStatus({throwErrors:true});if(!current())return;
   if(status?.role!=='partner'||status.household_id!==s.household_id)throw Error('Household changed. Close and reopen Partner Sharing.');
   await connectPantry(pin,s.household_id);if(!current())return;
   const result=await adoptRemote(pin,s.household_id);if(current())message(result.message);
  }));
 }
 else{body.innerHTML=`<div class="bbhs-summary"><h3>Shop your kitchen first, together</h3><p>Invite one partner to share dinners, pantry and shopping list. They sign in with their own account and choose whether to use your shared data.</p></div><label>Partner email <input data-email type="email" autocomplete="email" placeholder="partner@example.com" value="${esc(s.partner_email||'')}"></label><p class="bbhs-connection">${s.invite_status==='accepted'?'Partner connected':s.invite_status==='pending'?'Invitation pending':'No partner linked'}</p><button class="bbhs-primary" data-invite>Send invitation</button>${s.invite_status==='pending'?linkMarkup():''}<div class="bbhs-secondary-actions"><button data-sync>Sync safely now</button><button data-init-import>Share this device’s saved dinners</button><button data-unlink ${s.invite_status==='none'?'disabled':''}>Unlink partner</button></div><small>Updates are checked while the app is open. A pending invitation also appears when your partner signs in with the matching confirmed email.</small>`;
  wireCopy(body);
  const inviteButton=body.querySelector('[data-invite]');inviteButton.onclick=()=>runAction(inviteButton,current,async()=>{
   const email=body.querySelector('[data-email]').value.trim();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){message('Enter your partner’s email address.');return;}
   if(!confirm('Send this invitation and share this device’s saved dinners, pantry and shopping list with your household? Only continue if this data belongs to your account. Existing shared conflicts will be kept for review.'))return;
   finishConfirmedSharingInput();if(!current())return;
   const pin=accountPin(),result=await api('',{action:'invite',email});if(!current())return;
   await refreshStatus({throwErrors:true});if(!current())return;
   let feedback=invitationFeedback(result);
   if(status?.configured===true&&status?.premium===true&&status?.role==='owner'&&status.household_id===result.household_id){
    try{await connectPantry(pin,status.household_id);if(!current())return;const synced=await synchronize({allowInitialImport:true});feedback+=synced?.ok?(synced.conflicts?' Some existing items need review before they can be shared.':' Your saved dinners and list are shared.'):' Your invitation is saved; tap Share this device’s saved dinners to finish connecting the plan.';}
    catch(error){feedback+=' '+(error?.message||'Your saved data still needs connecting.');}
   }else feedback+=' Household access needs refreshing before your saved data can be shared.';
   if(!current())return;householdChanged('invite');await open();if(sameAccount(pin)&&dialog.open)message(feedback);
  });
  const importButton=body.querySelector('[data-init-import]');importButton.disabled=!s.household_id;importButton.onclick=()=>runAction(importButton,current,async()=>{
   if(!s.household_id){message('Send an invitation to start your shared household first.');return;}
   if(!confirm('Share this device’s saved dinners, pantry, servings and shopping checkmarks with your linked household? Only do this if the saved plan belongs to this account.'))return;
   finishConfirmedSharingInput();if(!current())return;
   const pin=accountPin();await connectPantry(pin,s.household_id);if(current())await synchronize({allowInitialImport:true});
  });
  const unlinkButton=body.querySelector('[data-unlink]');unlinkButton.onclick=()=>runAction(unlinkButton,current,async()=>{
   if(!confirm('Unlink your partner and revoke any pending invitation? Their device will keep its existing local plan.'))return;
   if(!current())return;
   await api('',{action:'unlink'});if(!current())return;await refreshStatus({throwErrors:true});if(!current())return;householdChanged('unlink');await open();message('Partner unlinked. Your stored plan remains.');
  });
 }
 body.querySelector('[data-sync]')?.addEventListener('click',()=>{if(actionInFlight)return;if(pendingRefresh){if(!refreshRenderedHousehold(pendingRefresh)){message('Finish editing before refreshing the shared screen.');return;}}return synchronize();});
}
function openFromTrigger(trigger){
 if(deleting())return;
 // This is an explicit navigation from Account/Settings into Sharing. Close
 // only those entry layers through their own controls; other editors continue
 // to block the existing safe refresh bridge.
 const account=trigger?.closest?.('#cloud-panel');
 const settings=trigger?.closest?.('.bbui-settings-overlay')||(account?document.querySelector('.bbui-settings-overlay:not([hidden])'):null);
 if(account)document.getElementById('cloud-close')?.click();
 settings?.querySelector('.bbui-settings-close')?.click();
 return open();
}
function attach(){if(deleting())return;const app=document.getElementById('app');if(!app)return;
 // Add independent buttons without moving existing elements or changing grids.
 // The My Week Feeding control is intentionally left untouched.
 const targets=[app.querySelector('.bb321-shop-summary-top'),
  document.getElementById('bbuiAccountSection'),document.getElementById('cloud-signed')].filter(Boolean);
 for(const target of targets){if(target.querySelector('[data-bbhs-trigger]'))continue;
  const btn=document.createElement('button');btn.type='button';btn.className='bbhs-trigger';btn.dataset.bbhsTrigger='1';btn.textContent='👥 Share with Partner';btn.onclick=e=>{e.preventDefault();e.stopPropagation();openFromTrigger(btn)};target.append(btn);
 }
}
function updateInvitationNotice(){
 const pending=!deleting()&&userSession()&&status?.configured===true&&status.invite?.household_id;
 if(!pending){invitationNotice?.remove?.();invitationNotice=null;return;}
 if(invitationNotice)return;
 invitationNotice=document.createElement('button');invitationNotice.type='button';invitationNotice.className='bbhs-invite-notice';
 invitationNotice.textContent='You have a partner invitation · Review invitation';
 invitationNotice.onclick=()=>open();document.body.append(invitationNotice);
}
async function foregroundCheck({force=false}={}){
 if(deleting()||document.hidden||!navigator.onLine||polling||actionInFlight||busy)return;
 if(!force&&Date.now()-lastPoll<4000)return;
 const pin=accountPin();lastPoll=Date.now();polling=true;
 try{
  if(pendingRefresh){if(!sameAccount(pendingRefresh))pendingRefresh=null;else if(!refreshRenderedHousehold(pendingRefresh))return;}
  // Status checks discover invitations as soon as the signed-in app is awake.
  // API-selected membership and per-leaf revisions remain the only authority.
  const previous=JSON.stringify(status);await refreshStatus();if(!sameAccount(pin)||actionInFlight||busy)return;
  if(entryRequested){entryRequested=false;await open();return;}
  if(dialog?.open){
   if(previous!==JSON.stringify(status)&&!document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]'))await open();
   // Linked households still receive changes while this read-only panel is
   // open. Invitations and active actions keep their existing explicit flow.
   if(!sameAccount(pin)||actionInFlight||busy||status?.invite_status!=='accepted'||!['owner','partner'].includes(status?.role))return;
  }
  await synchronize({automatic:true});
 }finally{polling=false;}
}
function invitationEntry(){
 if(window.location?.hash!=='#partner-sharing')return;
 entryRequested=true;foregroundCheck({force:true});
}
function boot(){if(booted)return;booted=true;const app=document.getElementById('app');if(!app)return;
 const observer=new MutationObserver(()=>{if(!document.hidden)attach()});observer.observe(app,{childList:true,subtree:false});
 attach();window.addEventListener('basketboss:session-changed',()=>{generation++;statusRevision++;status=null;pendingRefresh=null;updateInvitationNotice();if(window.location?.hash==='#partner-sharing')entryRequested=true;foregroundCheck({force:true});});
 window.addEventListener('focus',()=>foregroundCheck({force:true}));
 window.addEventListener('online',()=>foregroundCheck({force:true}));
 window.addEventListener('hashchange',invitationEntry);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)foregroundCheck({force:true});});
 window.addEventListener('basketboss:app-active',()=>foregroundCheck({force:true}));
 setInterval(()=>foregroundCheck(),4000);
 if(window.location?.hash==='#partner-sharing')entryRequested=true;
 foregroundCheck({force:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
