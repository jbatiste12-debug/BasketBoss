/* Selected pack metadata only. Physical stock remains in the receipt pantry
 * ledger; this channel never reads a level back into a stock quantity. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root&&!root.BBPantryPackSync){root.BBPantryPackSync=api.install(root);root.BBPantryPackSync.start();}})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const PREFIX='pantry-pack-v1:',LOCAL='basketboss_pantry_pack_sync_v1:',SESSION='basketboss_cloud_session_v1',OWNER='basketboss_receipt_projection_owner_v1',DELETION='basketboss_account_deletion_v1';
 const MAX=500,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value),copy=value=>JSON.parse(JSON.stringify(value));
 const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
 const fields=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
 const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000;
 const unit=value=>['g','ml','each'].includes(value);
 const error=()=>Error('Pack sizes need checking before syncing. Your pantry amounts have been kept.');
 function name(value){if(typeof value!=='string'||value!==value.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase()||!value||value.length>160||/[|\u0000-\u001f\u007f]/.test(value)||['__proto__','prototype','constructor'].includes(value))throw error();return value;}
 function hash(value,seed){let result=seed;for(let index=0;index<value.length;index++){result^=value.charCodeAt(index);result=Math.imul(result,16777619);}return (result>>>0).toString(16).padStart(8,'0');}
 function entryKey(value){const identity=name(value.name);if(!['cupboard','fridge','freezer'].includes(value.loc))throw error();const text=value.loc+'|'+identity;return PREFIX+value.loc+':'+hash(text,2166136261)+hash(text,2246822507);}
 function validateLevel(value){
  if(!fields(value,['version','capacity','unit','spares','portion','source','estimated','capacityEstimated','confirmedQuantity','confirmedUnit','scope','confirmedAt'])||value.version!==1||!amount(value.capacity)||value.capacity<=0||!unit(value.unit)||!Number.isInteger(value.spares)||value.spares<0||value.spares>100||!['full','half','low','out'].includes(value.portion)||!['label','receipt','catalogue','photo'].includes(value.source)||typeof value.estimated!=='boolean'||typeof value.capacityEstimated!=='boolean'||!amount(value.confirmedQuantity)||value.confirmedUnit!==value.unit)throw error();
  const quantity=Math.round(value.capacity*(value.spares+({full:1,half:.5,low:.25,out:0})[value.portion])*1000000)/1000000;
  if(!amount(quantity)||quantity!==value.confirmedQuantity||quantity===0&&value.portion!=='out'||!value.estimated&&(value.capacityEstimated||['half','low'].includes(value.portion)))throw error();
  if(value.scope!==undefined&&(!fields(value.scope,['kind','id'])||Object.keys(value.scope).length!==2||!['user','household'].includes(value.scope.kind)||!UUID.test(value.scope.id||'')))throw error();
  if(value.confirmedAt!==undefined&&(typeof value.confirmedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.confirmedAt)||!Number.isFinite(Date.parse(value.confirmedAt))||new Date(value.confirmedAt).toISOString()!==value.confirmedAt))throw error();
  return copy(value);
 }
 function validatePack(value){if(!fields(value,['quantity','unit','estimated','source'])||Object.keys(value).length!==4||!amount(value.quantity)||value.quantity<=0||!unit(value.unit)||typeof value.estimated!=='boolean'||!['label','receipt','catalogue','photo'].includes(value.source))throw error();return copy(value);}
 function validateValue(value,key){
  if(!fields(value,['version','name','loc','stockLevel','pack'])||!Object.hasOwn(value,'stockLevel')||value.version!==1)throw error();
  const result={version:1,name:name(value.name),loc:value.loc,stockLevel:value.stockLevel===null?null:validateLevel(value.stockLevel)};
  if(Object.hasOwn(value,'pack')){
   result.pack=validatePack(value.pack);const level=result.stockLevel;
   if(level&&(result.pack.quantity!==level.capacity||result.pack.unit!==level.unit||level.capacityEstimated&&!result.pack.estimated))throw error();
  }
  if(key!==undefined&&entryKey(result)!==key)throw error();entryKey(result);return result;
 }
 function parseDocument(raw,pin){
  if(raw===null)return {version:1,actorId:pin.actor,scope:{kind:'household',id:pin.household},entries:{},outbox:{},fetchedAt:0};
  let value;try{value=JSON.parse(raw);}catch{throw error();}
  if(!fields(value,['version','actorId','scope','entries','outbox','fetchedAt'])||value.version!==1||value.actorId!==pin.actor||!equal(value.scope,{kind:'household',id:pin.household})||!object(value.entries)||!object(value.outbox)||Object.keys(value.entries).length>MAX||Object.keys(value.outbox).length>MAX||typeof value.fetchedAt!=='number'||!Number.isFinite(value.fetchedAt)||value.fetchedAt<0)throw error();
  const scoped=(metadata,key)=>{const row=validateValue(metadata,key);if(row.stockLevel?.scope&&!equal(row.stockLevel.scope,value.scope))throw error();return row;};
  for(const [key,row]of Object.entries(value.entries))if(!fields(row,['revision','value'])||!Number.isSafeInteger(row.revision)||row.revision<1||!scoped(row.value,key))throw error();
  for(const [key,row]of Object.entries(value.outbox)){
   if(!fields(row,['expectedRevision','baseline','value','attempt','conflict'])||!Number.isSafeInteger(row.expectedRevision)||row.expectedRevision<0||!scoped(row.value,key)||row.baseline!==null&&!scoped(row.baseline,key)||row.attempt!==undefined&&row.attempt!==null&&!scoped(row.attempt,key)||row.conflict!==undefined&&typeof row.conflict!=='boolean')throw error();
  }
  return value;
 }
 function install(win,options={}){
  const store=options.storage||win.localStorage,doc=win.document,fetcher=options.fetch||win.fetch?.bind(win),now=options.now||Date.now,later=options.setTimeout||win.setTimeout?.bind(win);
  let flight=null,started=false,scheduled=false,deletionPaused=false,generation=0,lastResult={ok:true,queued:false};const requested=new Map(),invalidScopes=new Map();
  const host=()=>options.getHost?.()||win.BBReceiptHost;
  function context(){
   if(deletionPaused||win.BBAccountDeletion?.isDeleting?.()===true)return null;
   const deletionRaw=store.getItem(DELETION);let deletion,session;const sessionRaw=store.getItem(SESSION),ownerRaw=store.getItem(OWNER);
   try{deletion=JSON.parse(deletionRaw||'null');session=JSON.parse(sessionRaw||'null');}catch{throw error();}
   if(deletion&&['pending','deleting','deleted'].includes(deletion.phase))return null;
   if(!UUID.test(session?.user?.id||'')||typeof session.access_token!=='string'||!session.access_token||session.access_token.length>16000||/[\r\n]/.test(session.access_token))return null;
   if(session.expires_at!==undefined&&(!Number.isFinite(Number(session.expires_at))||Number(session.expires_at)*1000<=now()+5000))return null;
   const projection=host()?.getProjection?.();if(!projection||projection.actorId!==session.user.id||projection.scope?.kind!=='household'||!UUID.test(projection.scope.id||'')||!Number.isSafeInteger(projection.inventoryRevision)||projection.inventoryRevision<0)return null;
   const key=LOCAL+session.user.id+':'+projection.scope.id;if(invalidScopes.get(key)===JSON.stringify([sessionRaw,ownerRaw]))return null;
   return {actor:session.user.id,household:projection.scope.id,sessionRaw,ownerRaw,deletionRaw,token:session.access_token,generation,key};
  }
  function current(pin){const value=context();return !!value&&['actor','household','sessionRaw','ownerRaw','deletionRaw','generation'].every(key=>value[key]===pin[key]);}
  const expected=pin=>({[SESSION]:pin.sessionRaw,[OWNER]:pin.ownerRaw,[DELETION]:pin.deletionRaw});
  function load(pin){const raw=store.getItem(pin.key);return {raw,value:parseDocument(raw,pin)};}
  function save(pin,raw,value){
   if(!current(pin)||store.getItem(pin.key)!==raw)throw error();const text=JSON.stringify(value);
   try{store.setItem(pin.key,text);if(store.getItem(pin.key)!==text||!current(pin))throw error();}
   catch(failure){try{if(store.getItem(pin.key)===text){if(raw===null)store.removeItem(pin.key);else store.setItem(pin.key,raw);}}catch{}throw failure;}
  }
  function identity(row){
   let value=row?.name;try{value=win.BBPantryPolicy?.canonicalName?.(value,win.BBPantryAliasCanonical||win.BBPriceV19?.canonical)||value;}catch{throw error();}
   if(typeof value!=='string')throw error();return {name:name(value.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase()),loc:row.loc};
  }
  const packStamp=row=>row?.packReviewed===true?[row.packQuantity,row.packUnit,row.packEstimated===true]:null;
  function reviewedPack(row,level=null){
   if(row.packReviewed!==true)return null;
   const quantity=row.packQuantity,units=row.packUnit;let normalized;
   if(!amount(quantity)||quantity<=0)throw error();
   if(unit(units))normalized={quantity,unit:units};
   else if(units==='kg'||units==='l')normalized={quantity:Math.round(quantity*1000*1000000)/1000000,unit:units==='kg'?'g':'ml'};
   else try{normalized=win.BBPantryPolicy?.normalize?.(row.name,quantity,units,{market:row.inputMarket||win.bb307ActiveMarket?.()||'UK',reviewed:true});}catch{throw error();}
   if(!normalized||!unit(normalized.unit)||!amount(normalized.quantity)||normalized.quantity<=0)throw error();
   return validatePack({quantity:normalized.quantity,unit:normalized.unit,estimated:row.packEstimated===true||level?.capacityEstimated===true,source:level?.source||'label'});
  }
  function preparedValue(row,pin){
   const level=row.stockLevel==null?null:validateLevel(row.stockLevel),core=win.BBPantryStockLevels;
   if(level&&core?.validate){const checked=core.validate(level);if(checked===false||checked===null||checked?.ok===false)throw error();}
   if(level?.scope&&!equal(level.scope,{kind:'household',id:pin.household}))throw error();
   if(level)level.scope={kind:'household',id:pin.household};
   const pack=reviewedPack(row,level)||(level?{quantity:level.capacity,unit:level.unit,estimated:level.capacityEstimated,source:level.source}:null);
   return validateValue({version:1,...identity(row),stockLevel:level,...(pack?{pack}:{})});
  }
  function prepare({beforeInventory,afterInventory}={}){
   if(!object(beforeInventory)||!object(afterInventory))throw error();
   const changed=Object.entries(afterInventory).filter(([id,row])=>object(row)&&(Object.hasOwn(row,'stockLevel')&&!equal(row.stockLevel,beforeInventory[id]?.stockLevel)||!equal(packStamp(row),packStamp(beforeInventory[id]))));
   if(!changed.length)return null;const pin=context();if(!pin)return null;
   const {raw,value}=load(pin);let dirty=false;
   for(const [,row]of changed){
    const metadata=preparedValue(row,pin),key=entryKey(metadata),pending=value.outbox[key],baseline=value.entries[key];
    for(const other of Object.values(afterInventory))if(other!==row&&other?.selected!==false&&other?.name&&['cupboard','fridge','freezer'].includes(other.loc)&&equal(identity(other),{name:metadata.name,loc:metadata.loc})){
     const otherPack=reviewedPack(other,other.stockLevel==null?null:validateLevel(other.stockLevel));
     if(metadata.pack&&otherPack&&(metadata.pack.quantity!==otherPack.quantity||metadata.pack.unit!==otherPack.unit))throw error();
    }
    if([pending?.value,baseline?.value].some(previous=>previous&&(previous.name!==metadata.name||previous.loc!==metadata.loc)))throw error();
    if(pending&&equal(pending.value,metadata)||!pending&&baseline&&equal(baseline.value,metadata))continue;
    value.outbox[key]=pending?{...pending,value:metadata}:{expectedRevision:baseline?.revision||0,baseline:baseline?.value||null,value:metadata};dirty=true;
   }
   if(!dirty)return null;if(Object.keys(value.outbox).length>MAX)throw error();
   return {updates:{[pin.key]:value},expected:{...expected(pin),[pin.key]:raw}};
  }
  function matched(row,level){
   let quantity=row.qty,units=row.unit;
   if(quantity===null||quantity===undefined||quantity===''||!Number.isFinite(Number(quantity)))return false;
   try{const normalized=win.BBPantryPolicy?.normalize?.(row.name,Number(quantity),units,{market:row.inputMarket||win.bb307ActiveMarket?.()||'UK',packReviewed:row.packReviewed===true,packQuantity:row.packQuantity,packUnit:row.packUnit});if(normalized){quantity=normalized.quantity;units=normalized.unit;}}catch{return false;}
   if(units==='kg'){quantity=Number(quantity)*1000;units='g';}if(units==='l'){quantity=Number(quantity)*1000;units='ml';}
   return units===level.confirmedUnit&&Math.abs(Number(quantity)-level.confirmedQuantity)<=.000001;
  }
  function read(row){
   try{
    const pin=context();if(!pin||!row?.name)return null;const saved=load(pin).value,requestedIdentity=identity(row),key=entryKey(requestedIdentity),pending=saved.outbox[key],metadata=pending?.value||saved.entries[key]?.value;
    schedule();if(!metadata)return null;
    if(metadata.name!==requestedIdentity.name||metadata.loc!==requestedIdentity.loc)return null;
    const level=metadata.stockLevel===null?null:copy(metadata.stockLevel),pack=metadata.pack||(level?{quantity:level.capacity,unit:level.unit,estimated:level.capacityEstimated,source:level.source}:null),matches=level?matched(row,level):true,conflict=pending?.conflict===true;
    return {stockLevel:level,packQuantity:pack?.quantity??null,packUnit:pack?.unit??null,packReviewed:!!pack,packEstimated:pack?.estimated===true,packSource:pack?.source??null,packAssumption:pack?.estimated?'Estimated pack size confirmed for this pantry.':undefined,matched:matches&&!conflict,needsCheck:!matches||conflict,conflict};
   }catch{return null;}
  }
  const foreground=()=>!doc||doc.hidden!==true&&doc.visibilityState!=='hidden';
  function ready(){if(!foreground()||win.navigator?.onLine===false)return false;try{const status=host()?.getAccountPantryStatus?.();return !status||!['blocked','conflict','signed-out'].includes(status.status)&&status.queued!==true;}catch{return false;}}
  async function request(pin,body){
   if(!fetcher||!current(pin))throw error();const response=await fetcher('/api/household'+(body?'':'?mode=pantry_packs'),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+pin.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
   const data=await response.json().catch(()=>null);if(!current(pin))throw error();
   if(!response.ok){if(response.status===401||response.status===403)invalidScopes.set(pin.key,JSON.stringify([pin.sessionRaw,pin.ownerRaw]));const failure=error();failure.conflict=response.status===409;throw failure;}
   if(data?.household_id!==pin.household){invalidScopes.set(pin.key,JSON.stringify([pin.sessionRaw,pin.ownerRaw]));throw error();}return data;
  }
  function changed(){try{if(options.onChange)options.onChange();else{win.BBPantryInline?.refresh?.();if(win.CustomEvent)win.dispatchEvent?.(new win.CustomEvent('bb:pantry-pack-metadata'));}}catch{}}
  async function run(){
   const pin=context();if(!pin||!ready())return {ok:true,skipped:true,queued:!!pin&&Object.keys(load(pin).value.outbox).length>0};requested.set(pin.key,now());
   const remote=await request(pin),entries={};if(!Array.isArray(remote.entries)||remote.entries.length>MAX)throw error();
   for(const row of remote.entries){if(!fields(row,['section','entry_key','value','revision'])||row.section!=='kitchen_item'||!Number.isSafeInteger(row.revision)||row.revision<1||Object.hasOwn(entries,row.entry_key))throw error();entries[row.entry_key]={revision:row.revision,value:validateValue(row.value,row.entry_key)};}
   let saved=load(pin),value=saved.value;const before=JSON.stringify(value.entries);value.entries=entries;value.fetchedAt=now();
   for(const [key,pending]of Object.entries(value.outbox)){
    const remoteEntry=entries[key],remoteValue=remoteEntry?.value||null,revision=remoteEntry?.revision||0;
    if(equal(remoteValue,pending.value)){delete value.outbox[key];continue;}
    if(pending.attempt&&equal(remoteValue,pending.attempt)){pending.expectedRevision=revision;pending.baseline=remoteValue;pending.attempt=null;continue;}
    if(revision!==pending.expectedRevision||!equal(remoteValue,pending.baseline))pending.conflict=true;
   }
   save(pin,saved.raw,value);if(before!==JSON.stringify(entries))changed();
   for(const key of Object.keys(value.outbox)){
    if(!ready())break;saved=load(pin);value=saved.value;let pending=value.outbox[key];if(!pending||pending.conflict)continue;
    const attempt=copy(pending.value),expectedRevision=pending.expectedRevision;pending.attempt=attempt;save(pin,saved.raw,value);
    let result;try{result=await request(pin,{action:'patch',section:'kitchen_item',key,value:attempt,expected:expectedRevision,expectedHouseholdId:pin.household});}
    catch(failure){if(failure.conflict&&current(pin)){saved=load(pin);pending=saved.value.outbox[key];if(pending){pending.conflict=true;save(pin,saved.raw,saved.value);}}throw failure;}
    if(result.ok!==true||!Number.isSafeInteger(result.revision)||result.revision!==expectedRevision+1)throw error();
    saved=load(pin);value=saved.value;pending=value.outbox[key];value.entries[key]={revision:result.revision,value:attempt};
    if(pending){if(equal(pending.value,attempt))delete value.outbox[key];else Object.assign(pending,{expectedRevision:result.revision,baseline:attempt,attempt:null});}
    save(pin,saved.raw,value);changed();
   }
   const pending=Object.values(load(pin).value.outbox);return {ok:!pending.some(row=>row.conflict),queued:pending.length>0,needsReview:pending.some(row=>row.conflict)};
  }
  function retry(){if(flight)return flight;flight=Promise.resolve().then(run).catch(failure=>({ok:false,queued:true,needsReview:failure?.conflict===true,retryable:failure?.conflict!==true,message:failure?.conflict?'Pack sizes changed on another device. Your pantry amounts have been kept.':'Pack sizes are saved on this device and will sync when available.'})).then(result=>(lastResult=result)).finally(()=>{flight=null;});return flight;}
  function schedule(force=false){if(!started||scheduled||!foreground()||win.navigator?.onLine===false||!later)return;try{const pin=context();if(!pin||force!==true&&requested.has(pin.key)&&now()-requested.get(pin.key)<30000)return;}catch{return;}scheduled=true;later(()=>{scheduled=false;void retry();},0);}
  function committed(){schedule(true);return true;}
  function start(){if(started)return;started=true;for(const event of ['focus','pageshow','online','basketboss:native-resumed','basketboss:session-changed','basketboss:household-changed','bb:pantry-editor'])win.addEventListener?.(event,schedule);doc?.addEventListener?.('visibilitychange',schedule);win.addEventListener?.('basketboss:account-deletion-started',()=>{deletionPaused=true;generation++;});win.addEventListener?.('basketboss:account-deletion-deleted',()=>{deletionPaused=true;generation++;});win.addEventListener?.('basketboss:account-deletion-cancelled',()=>{deletionPaused=false;generation++;schedule();});if(doc?.readyState==='loading')doc.addEventListener?.('DOMContentLoaded',schedule,{once:true});else schedule();}
  function scope(){try{const pin=context();return pin?{kind:'household',id:pin.household}:null;}catch{return null;}}
  function state(){try{const pin=context(),pending=pin?Object.values(load(pin).value.outbox):[];return {...lastResult,ready:!!pin,queued:pending.length>0,needsReview:lastResult.needsReview===true||pending.some(row=>row.conflict),refreshing:!!flight};}catch{return {ok:false,needsReview:true,queued:true};}}
  return Object.freeze({prepare,committed,retry,read,start,state,scope});
 }
 return Object.freeze({install,entryKey,validateValue,validateLevel,validatePack,PREFIX,LOCAL});
});
