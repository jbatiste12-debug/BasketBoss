/* Versioned optional meal planning backup. Legacy whole-plan uploads never
 * write this table. Pantry quantities and cooking receipts are not copied. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBPlanExtrasSync=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 const KEY='basketboss_planner_extras_v1:',SESSION='basketboss_cloud_session_v1';
 const TABLE='/rest/v1/basketboss_planner_extras_v1',RPC='/rest/v1/rpc/bb_save_planner_extras_v1';
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const text=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
 const portion=value=>Number.isInteger(value)&&value>=1&&value<=12;
 const generation=value=>typeof value==='string'&&value.length>=1&&value.length<=80&&!/[^A-Za-z0-9_-]/.test(value);
 const uuid=value=>typeof value==='string'&&value.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
 const clone=value=>JSON.parse(JSON.stringify(value));
 const fail=()=>{throw Error('Review the optional meals and servings before syncing.');};
 function slots(value){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>7)fail();
  const days=new Set();return value.map(row=>{
   if(!object(row)||!DAYS.includes(row.day)||!text(row.recipeId)||days.has(row.day)||Object.hasOwn(row,'servings')&&!portion(row.servings))fail();
   days.add(row.day);return {day:row.day,recipeId:row.recipeId,...(Object.hasOwn(row,'servings')?{servings:row.servings}:{})};
  });
 }
 function capture(plan){
  if(!object(plan))fail();
  const breakfast=slots(plan.plannedBreakfasts),groups={dinner:slots(plan.planned),breakfast,dessert:slots(plan.plannedDesserts)};
  return {version:1,plannedBreakfasts:breakfast.map(({day,recipeId})=>({day,recipeId})),portionOverrides:Object.entries(groups).flatMap(([kind,rows])=>rows.filter(row=>Object.hasOwn(row,'servings')).map(({day,recipeId,servings})=>({kind,day,recipeId,servings})))};
 }
 function validate(payload){
  if(!object(payload)||payload.version!==1||Object.keys(payload).sort().join(',')!=='plannedBreakfasts,portionOverrides,version'||!Array.isArray(payload.portionOverrides)||payload.portionOverrides.length>21)fail();
  const breakfast=slots(payload.plannedBreakfasts);
  if(!Array.isArray(payload.plannedBreakfasts)||breakfast.some((row,index)=>Object.keys(payload.plannedBreakfasts[index]).sort().join(',')!=='day,recipeId'))fail();
  const seen=new Set(),portionOverrides=payload.portionOverrides.map(row=>{
   if(!object(row)||Object.keys(row).sort().join(',')!=='day,kind,recipeId,servings'||!['dinner','breakfast','dessert'].includes(row.kind)||!DAYS.includes(row.day)||!text(row.recipeId)||!portion(row.servings))fail();
   const key=JSON.stringify([row.kind,row.day,row.recipeId]);
   if(seen.has(key)||row.kind==='breakfast'&&!breakfast.some(slot=>slot.day===row.day&&slot.recipeId===row.recipeId))fail();
   seen.add(key);return {kind:row.kind,day:row.day,recipeId:row.recipeId,servings:row.servings};
  });
  return {version:1,plannedBreakfasts:breakfast,portionOverrides};
 }
 function apply(plan,payload){
  if(!object(plan))fail();const cleaned=validate(payload);
  const output={...plan,plannedBreakfasts:cleaned.plannedBreakfasts};
  for(const [kind,field]of [['dinner','planned'],['breakfast','plannedBreakfasts'],['dessert','plannedDesserts']]){
   const rows=output[field]===undefined?[]:output[field];slots(rows);
   output[field]=rows.map(({servings,...row})=>{
    const override=cleaned.portionOverrides.find(value=>value.kind===kind&&value.day===row.day&&value.recipeId===row.recipeId);
    return {...row,...(override?{servings:override.servings}:{})};
   });
  }
  return output;
 }
 function create({storage,request,current:defaultCurrent=()=>true}={}){
  const paused=new Map(),conflicted=new Set(),busy=new Set();
  const result=(status,message,extra={})=>({ok:status==='local'||status==='synced'||status==='loaded'||status==='missing',status,message,...extra});
  const keyOf=(actor,cycle)=>{if(!text(actor)||!generation(cycle))fail();return KEY+encodeURIComponent(actor)+':'+encodeURIComponent(cycle);};
  const session=()=>{const raw=storage.getItem(SESSION);return {raw,value:raw===null?null:JSON.parse(raw)};};
  function context(actor,cycle,token,current,remote=false){
   const key=keyOf(actor,cycle),pin=session(),check=current||defaultCurrent;
   if(typeof check!=='function'||check()!==true||(pin.value?.user?.id||'guest')!==actor||remote&&(!uuid(actor)||typeof token!=='string'||!token||pin.value?.access_token!==token))throw Error('account');
   return {key,live:()=>{try{return check()===true&&storage.getItem(SESSION)===pin.raw;}catch{return false;}}};
  }
  function read(key,actor,cycle){
   const raw=storage.getItem(key);if(raw===null)return {raw,entry:null};const value=JSON.parse(raw);
   if(!object(value)||value.version!==1||value.actor!==actor||value.generation!==cycle||value.revision!==null&&(!Number.isSafeInteger(value.revision)||value.revision<0))throw Error('cache');
   return {raw,entry:{version:1,actor,generation:cycle,payload:validate(value.payload),revision:value.revision}};
  }
  function write(pin,raw,entry){
   if(!pin.live()||storage.getItem(pin.key)!==raw)throw Error('changed');const after=JSON.stringify(entry);
   try{storage.setItem(pin.key,after);if(!pin.live()||storage.getItem(pin.key)!==after)throw Error('changed');}
   catch(error){try{if(storage.getItem(pin.key)===after){if(raw===null)storage.removeItem(pin.key);else storage.setItem(pin.key,raw);}}catch{}throw error;}
   return after;
  }
  function remember({actor,generation:cycle,plan,current}={}){
   try{
    const pin=context(actor,cycle,null,current),before=read(pin.key,actor,cycle),payload=capture(plan);
    const entry={version:1,actor,generation:cycle,payload,revision:before.entry?.revision??null};
    if(JSON.stringify(entry)!==before.raw)write(pin,before.raw,entry);
    return result('local','Optional meals are saved on this device.',{payload:clone(payload),revision:entry.revision});
   }catch{return result('local-unavailable','Optional meals could not be backed up. Your current plan has been kept.');}
  }
  function readLocal({actor,generation:cycle,current}={}){
   try{
    const pin=context(actor,cycle,null,current),before=read(pin.key,actor,cycle);
    if(!pin.live())return result('stale','Your account changed. Reopen the current plan.');
    if(!before.entry)return result('missing','No optional meal backup is saved on this device for this week.',{payload:null,revision:null,source:'device'});
    return result('local','Optional meals are saved on this device.',{payload:clone(before.entry.payload),revision:before.entry.revision,source:'device'});
   }catch{return result('local-unavailable','This device’s optional meal backup needs review. Existing data has been kept.');}
  }
  function unavailable(error){
   const code=String(error?.code||''),message=String(error?.message||'');
   return ['PGRST202','PGRST205','42P01','42883'].includes(code)||/could not find (?:the )?(?:table|function).*?(?:basketboss_planner_extras_v1|bb_save_planner_extras_v1)|(?:relation|function).*?(?:basketboss_planner_extras_v1|bb_save_planner_extras_v1).*?does not exist/i.test(message);
  }
  function failure(error,actor,key){
   if(unavailable(error)){paused.set(actor,'setup');return result('unavailable','Optional meals are kept on this device. Their cloud backup needs setup.');}
   if(String(error?.code)==='40001'||/planner_extras_conflict/i.test(String(error?.message||''))){conflicted.add(key);return result('conflict','Optional meals changed in the cloud. Restore and review the cloud plan before uploading again.');}
   return result('error','Optional meals are kept on this device. Their cloud backup could not be completed.');
  }
  function row(value){
   if(!Array.isArray(value)||value.length>1)throw Error('response');if(!value.length)return null;
   const entry=value[0];if(!object(entry)||!Number.isSafeInteger(entry.revision)||entry.revision<1)throw Error('response');
   return {payload:validate(entry.payload),revision:entry.revision};
  }
  async function load({actor,generation:cycle,token,current,force=false,stage=false}={}){
   let pin,before,ownsBusy=false;
   try{
    pin=context(actor,cycle,token,current,true);if(force)paused.delete(actor);
    if(paused.has(actor))return result('unavailable','Optional meals are kept on this device. Their cloud backup needs setup.');
    if(busy.has(pin.key))return result('busy','Optional meals are already syncing.');
    before=read(pin.key,actor,cycle);busy.add(pin.key);ownsBusy=true;
    const found=row(await request(TABLE+'?select=payload,revision&user_id=eq.'+encodeURIComponent(actor)+'&plan_generation=eq.'+encodeURIComponent(cycle)+'&limit=1','GET',null,token));
    if(!pin.live()||storage.getItem(pin.key)!==before.raw)return result('stale','Your account or optional meals changed. Review the latest plan before restoring.');
    if(!found)return result('missing','No optional meal backup exists for this week.',{payload:null,revision:0});
    const entry={version:1,actor,generation:cycle,...found};
    if(stage)return result('loaded','Optional meals are ready to restore for this week.',{...clone(found),cache:{key:pin.key,expected:before.raw,value:clone(entry)}});
    write(pin,before.raw,entry);conflicted.delete(pin.key);
    return result('loaded','Optional meals restored for this week.',clone(found));
   }catch(error){return failure(error,actor,pin?.key);}
   finally{if(ownsBusy)busy.delete(pin.key);}
  }
  async function save({actor,generation:cycle,token,plan,current,force=false}={}){
   let pin,before,ownsBusy=false;
   try{
    pin=context(actor,cycle,token,current,true);if(force)paused.delete(actor);
    if(paused.has(actor))return result('unavailable','Optional meals are kept on this device. Their cloud backup needs setup.');
    if(conflicted.has(pin.key))return result('conflict','Restore and review the cloud optional meals before uploading again.');
    if(busy.has(pin.key))return result('busy','Optional meals are already syncing.');
    const local=remember({actor,generation:cycle,plan,current});if(!local.ok)return local;
    before=read(pin.key,actor,cycle);busy.add(pin.key);ownsBusy=true;const payload=before.entry.payload;
    const live=()=>pin.live()&&storage.getItem(pin.key)===before.raw;
    const stale=()=>result('stale','Your account or optional meals changed. Your latest local choices have been kept.');
    const fetchRemote=()=>request(TABLE+'?select=payload,revision&user_id=eq.'+encodeURIComponent(actor)+'&plan_generation=eq.'+encodeURIComponent(cycle)+'&limit=1','GET',null,token);
    const accept=found=>{const entry={...before.entry,revision:found.revision};if(JSON.stringify(entry)!==before.raw)write(pin,before.raw,entry);return result('synced','Optional meals are synced.',clone(found));};
    const remote=await fetchRemote();if(!live())return stale();const found=row(remote);
    if(found&&JSON.stringify(found.payload)===JSON.stringify(payload))return accept(found);
    const revision=found?.revision||0;
    if(found&&before.entry.revision!==revision||!found&&before.entry.revision!==null&&before.entry.revision!==0){conflicted.add(pin.key);return result('conflict','Optional meals changed in the cloud. Restore and review them before uploading.');}
    let saved;
    try{saved=await request(RPC,'POST',{p_generation:cycle,p_payload:payload,p_expected_revision:revision},token);}
    catch(error){
     if(String(error?.code)!=='40001'&&!/planner_extras_conflict/i.test(String(error?.message||'')))throw error;
     if(!live())return stale();
     // An identical concurrent save can converge without another write. A
     // different concurrent choice still requires deliberate restore/review.
     const raced=await fetchRemote();if(!live())return stale();const currentRow=row(raced);
     if(currentRow&&JSON.stringify(currentRow.payload)===JSON.stringify(payload))return accept(currentRow);
     throw error;
    }
    if(!pin.live()||storage.getItem(pin.key)!==before.raw)return result('stale','Your account or optional meals changed. Your latest local choices have been kept.');
    if(!object(saved)||saved.ok!==true||saved.revision!==revision+1||JSON.stringify(validate(saved.payload))!==JSON.stringify(payload))throw Error('response');
    write(pin,before.raw,{...before.entry,revision:saved.revision});return result('synced','Optional meals are synced.',{payload:clone(payload),revision:saved.revision});
   }catch(error){return failure(error,actor,pin?.key);}
   finally{if(ownsBusy)busy.delete(pin.key);}
  }
  return Object.freeze({remember,readLocal,load,save});
 }
 return Object.freeze({KEY,TABLE,RPC,capture,apply,validate,create});
});
