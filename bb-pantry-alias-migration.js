/* Exact household aliases are a representation migration. The existing pantry
 * normalizer owns quantities, conversions and lot separation; this controller
 * only commits its verified proposal together with the ordinary sync outbox. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBPantryAliasMigration=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const DEFAULT_KEYS=Object.freeze({
  stock:'basketboss_321_v7_measured_pantry',inventory:'basketboss_makeameal_v1_inventory',
  owner:'basketboss_receipt_projection_owner_v1',actor:'basketboss_receipt_host_actor_v1',
  session:'basketboss_cloud_session_v1',shop:'basketboss_active_shop_session_v7',
  purchases:'basketboss_ui_next_bought_quantity_v1',partials:'basketboss_partial_purchases_v1',
  ticks:'basketboss_321_v11_shop_ticks'
 });
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const clone=value=>JSON.parse(JSON.stringify(value));
 const ordered=value=>Array.isArray(value)?value.map(ordered):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
 const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
 const problem=code=>{throw Error(code);};
 function parse(raw){
  if(raw===null)return {};
  let value;try{value=JSON.parse(raw);}catch{return problem('pantry_alias_storage_unreadable');}
  if(!object(value))return problem('pantry_alias_storage_unreadable');
  return value;
 }
 function validStock(stock){
  if(!object(stock)||Object.keys(stock).length>2000)return false;
  return Object.entries(stock).every(([key,value])=>{
   const at=key.lastIndexOf('|');
   return key.length<=180&&at>0&&at===key.indexOf('|')&&at<key.length-1&&!/[\u0000-\u001f\u007f]/.test(key)&&
    typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000;
  });
 }
 function activeOwnedMarkers(shop,purchases,partials,ticks){
  if(!object(shop.shelfEdits))return [];
  return Object.entries(shop.shelfEdits).filter(([id,marker])=>marker?.kind==='shop-owned-v1'&&Number(marker.amount)>0&&
   (purchases[id]||shop.purchases?.[id]||partials[shop.id+'|'+id]||shop.partials?.[shop.id+'|'+id]||ticks[id]||shop.bought?.[id]));
 }
 function create(options={}){
  const storage=options.storage,keys={...DEFAULT_KEYS,...options.keys};
  let running=false,serial=0;
  const result=(status,extra={})=>({ok:status!=='error',status,changed:false,...extra});
  function sync(){
   if(running)return result('not-ready');
   running=true;
   try{
    if(options.isReady?.()===false||typeof options.normalizeState!=='function'||typeof options.canonicalize!=='function'||typeof options.atomic!=='function'||!storage)return result('not-ready');
    const actor=options.getActor?.();
    if(typeof actor!=='string'||!actor||actor.length>120||!/^[A-Za-z0-9_-]+$/.test(actor))return result('not-ready');
    const expected=Object.fromEntries(Object.values(keys).map(key=>[key,storage.getItem(key)]));
    const stock=parse(expected[keys.stock]),inventory=parse(expected[keys.inventory]),owner=parse(expected[keys.owner]),marker=parse(expected[keys.actor]);
    const cloud=expected[keys.session]===null?null:parse(expected[keys.session]);
    const shop=parse(expected[keys.shop]),purchases=parse(expected[keys.purchases]),partials=parse(expected[keys.partials]),ticks=parse(expected[keys.ticks]);
    if(!validStock(stock)||Object.keys(inventory).length>2000||Object.values(inventory).some(row=>!object(row)))return problem('pantry_alias_storage_unreadable');
    for(const field of ['shelfEdits','purchases','partials','bought'])if(shop[field]!==undefined&&!object(shop[field]))return problem('pantry_alias_storage_unreadable');
    if(owner.actorId&&owner.actorId!==actor||marker.actorId&&marker.actorId!==actor||cloud?.user?.id&&cloud.user.id!==actor||actor!=='guest'&&!cloud?.user?.id)return result('not-ready');
    const activeMarkers=activeOwnedMarkers(shop,purchases,partials,ticks),ownership=options.ownership;
    if(activeMarkers.length&&(typeof ownership?.rewind!=='function'||typeof ownership?.capture!=='function'))return result('deferred-active-shop');
    const normalizationOptions={canonicalize:options.canonicalize,market:options.getMarket?.()||'UK',exactConversionsOnly:true,preserveDisplayUnits:true};
    const proposal=options.normalizeState(clone(stock),clone(inventory),normalizationOptions);
    if(!object(proposal)||!validStock(proposal.stock)||!object(proposal.inventory)||Object.values(proposal.inventory).some(row=>!object(row)))return problem('pantry_alias_normalization_invalid');
    const issues=Array.isArray(proposal.issues)?proposal.issues:[];
    // The existing normalizer preserves unknown/estimated units per source.
    // An identity, shared-balance or conflicting-location issue is stronger:
    // its complete physical snapshot remains untouched until reviewed.
    if(issues.some(issue=>issue?.identityConflict===true||issue?.estimatedConversion!==true&&issue?.message!=='Unknown container or unit. Existing stock has been kept for review.'))return result('deferred-review',{issues:clone(issues)});
    const nextStock=clone(proposal.stock),nextInventory=clone(proposal.inventory);
    const protectedRows=new Set();
    for(const issue of issues){
     const key=issue.stockKey,at=typeof key==='string'?key.lastIndexOf('|'):-1;
     if(at<1||!Object.hasOwn(stock,key)||nextStock[key]!==stock[key])return result('deferred-review',{issues:clone(issues)});
     const name=key.slice(0,at),unit=key.slice(at+1);
     for(const [id,row]of Object.entries(inventory)){
      const linked=row.bb173StockKey===key||!row.bb173StockKey&&row.selected!==false&&typeof row.name==='string'&&
       options.canonicalize(row.name)===options.canonicalize(name)&&row.unit===unit;
      if(!linked)continue;
      if(!equal(row,nextInventory[id]))return result('deferred-review',{issues:clone(issues)});
      protectedRows.add(id);
     }
    }
    if(typeof options.displayName==='function')for(const [id,row]of Object.entries(nextInventory)){
     if(protectedRows.has(id))continue;
     if(row.selected===false||!(Number(row.qty)>0)||typeof row.name!=='string')continue;
     const name=options.displayName(row.name);
     if(typeof name==='string'&&name.trim()&&name.length<=200&&!/[|\u0000-\u001f\u007f]/.test(name))row.name=name;
    }
    let nextShop=shop;
    if(activeMarkers.length){
     // Rebase only a proven current purchase. A changed/used purchase still
     // fails the original ownership rewind; this migration never bypasses it.
     const physical={[keys.stock]:stock,[keys.inventory]:inventory},after={[keys.stock]:nextStock,[keys.inventory]:nextInventory},touched=new Set();
     nextShop=clone(shop);
     try{
      for(const [id,owned]of activeMarkers){
       if(owned.actor!==actor||!object(owned.changes))return result('deferred-active-shop');
       const changes=Object.fromEntries(Object.entries(owned.changes).filter(([key])=>key===keys.stock||key===keys.inventory));
       if(!Object.keys(changes).length)continue;
       const restored=ownership.rewind(clone(physical),clone(changes)),before={...clone(physical),...restored};
       if(!validStock(before[keys.stock])||!object(before[keys.inventory]))return result('deferred-active-shop');
       const normalizedBefore=options.normalizeState(clone(before[keys.stock]),clone(before[keys.inventory]),normalizationOptions);
       if(!object(normalizedBefore)||!validStock(normalizedBefore.stock)||!object(normalizedBefore.inventory)||normalizedBefore.issues?.length)return result('deferred-active-shop');
       if(typeof options.displayName==='function')for(const row of Object.values(normalizedBefore.inventory)){
        if(row.selected===false||!(Number(row.qty)>0)||typeof row.name!=='string')continue;
        const name=options.displayName(row.name);
        if(typeof name==='string'&&name.trim()&&name.length<=200&&!/[|\u0000-\u001f\u007f]/.test(name))row.name=name;
       }
       const prior={[keys.stock]:normalizedBefore.stock,[keys.inventory]:normalizedBefore.inventory},rebased=ownership.capture(clone(prior),clone(after));
       if(!object(rebased)||Object.keys(rebased).some(key=>key!==keys.stock&&key!==keys.inventory))return result('deferred-active-shop');
       // Independent old markers must remain independently reversible. Two
       // purchases collapsed onto one physical row require explicit review.
       for(const [key,change]of Object.entries(rebased)){
        if(!object(change.rows))return result('deferred-active-shop');
        for(const row of Object.keys(change.rows)){
         const proof=key+'\u0000'+row;if(touched.has(proof))return result('deferred-active-shop');touched.add(proof);
        }
       }
       const roundTrip={...clone(after),...ownership.rewind(clone(after),clone(rebased))};
       if(!equal(roundTrip,prior))return result('deferred-active-shop');
       const preserved=Object.fromEntries(Object.entries(owned.changes).filter(([key])=>key!==keys.stock&&key!==keys.inventory));
       nextShop.shelfEdits[id]={...nextShop.shelfEdits[id],changes:{...preserved,...rebased}};
      }
     }catch{return result('deferred-active-shop');}
    }
    const shopChanged=!equal(shop,nextShop);
    if(equal(stock,nextStock)&&equal(inventory,nextInventory)&&!shopChanged)return result(issues.length?'deferred-review':'unchanged',issues.length?{issues:clone(issues)}:{});
    // Queue preparation reads the untouched persisted stock and verified server
    // baseline. It never rewrites an owner or cached server projection.
    if(actor!=='guest'&&typeof options.preparePurchasedPantry!=='function')return result('not-ready');
    const queue=options.preparePurchasedPantry?.({stock:nextStock,beforeStock:clone(stock),shopSessionId:shop.id})||{updates:{},expected:{}};
    if(!object(queue.updates)||!object(queue.expected))return problem('pantry_alias_sync_invalid');
    const protectedKeys=new Set([keys.stock,keys.inventory,keys.owner,keys.actor,keys.session,keys.shop,keys.purchases,keys.partials,keys.ticks]);
    if(Object.keys(queue.updates).some(key=>protectedKeys.has(key)))return problem('pantry_alias_sync_invalid');
    const now=options.now?.()??Date.now();
    if(!Number.isFinite(now))return problem('pantry_alias_clock_invalid');
    const base='basketboss_pantry_alias_backup_v1:'+encodeURIComponent(actor)+':'+now+':';
    let backupKey;do{backupKey=base+(++serial);}while(storage.getItem(backupKey)!==null);
    const backup={version:1,actorId:actor,createdAt:new Date(now).toISOString(),stockRaw:expected[keys.stock],inventoryRaw:expected[keys.inventory],shopSessionRaw:expected[keys.shop],ownerRaw:expected[keys.owner]};
    const updates={...queue.updates,[keys.stock]:nextStock,[keys.inventory]:nextInventory,...(shopChanged?{[keys.shop]:nextShop}:{}),[backupKey]:backup};
    const pinned={...expected,...queue.expected,[backupKey]:null};
    // Do not permit queue preparation or a callback to replace our captured
    // actor/stock bytes with a newer snapshot from another account or tab.
    for(const [key,raw]of Object.entries(expected))if(Object.hasOwn(queue.expected,key)&&queue.expected[key]!==raw)return problem('pantry_alias_context_changed');
    if(options.getActor?.()!==actor||options.isReady?.()===false)return result('not-ready');
    for(const [key,raw]of Object.entries(pinned))if(storage.getItem(key)!==raw)return problem('pantry_alias_context_changed');
    if(options.atomic(updates,pinned)===false)return problem('pantry_alias_save_failed');
    try{options.scheduleSave?.();}catch{}
    try{options.onSaved?.({stock:nextStock,inventory:nextInventory,queued:queue.queued===true});}catch{}
    return result('changed',{changed:true,queued:queue.queued===true,backupKey,...(issues.length?{preservedIssues:clone(issues)}:{})});
   }catch(error){return result('error',{ok:false,code:error?.message||'pantry_alias_migration_failed'});}
   finally{running=false;}
  }
  return Object.freeze({sync});
 }
 return Object.freeze({create,keys:DEFAULT_KEYS});
});
