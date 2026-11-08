/* Named, reusable meal weeks. Only reviewed planning fields are copied;
 * account data, pantry stock, purchases and shopping history never enter them. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBSavedWeeks=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const DAYS=Object.freeze(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
 const WEEKDAYS=DAYS.slice(0,5),KEY='basketboss_saved_weeks_v1:',MAX=25;
 const layouts=new WeakMap();let layoutSequence=0;
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
 class SavedWeekError extends Error{}
 const fail=message=>{throw new SavedWeekError(message);};
 const safeMessage=(error,fallback)=>error instanceof SavedWeekError?error.message:fallback;
 const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v)?v.trim():null;
 const id=v=>text(v,256)&&!['__proto__','constructor','prototype'].includes(v),count=v=>Number.isInteger(v)&&v>=1&&v<=12;
 function slots(value,label){
  if(!Array.isArray(value)||value.length>7)fail('Review the '+label+' before saving this week.');
  const days=new Set();return value.map(row=>{
   if(!object(row)||!DAYS.includes(row.day)||!id(row.recipeId)||days.has(row.day))fail('Review the '+label+' before saving this week.');
   if(own(row,'servings')&&!count(row.servings))fail('Review meal servings before saving this week.');
   days.add(row.day);return {day:row.day,recipeId:row.recipeId,...(own(row,'servings')?{servings:row.servings}:{})};
  });
 }
 function lunchbox(value){
  const source=value===undefined?{children:1,days:{},menus:{}}:value;
  if(!object(source)||!Number.isInteger(source.children)||source.children<1||source.children>8||!object(source.days)||!object(source.menus||{}))fail('Review school lunches before saving this week.');
  const days={},menus={};
  for(const day of WEEKDAYS){
   const rows=source.days[day]||[];
   if(!Array.isArray(rows)||rows.length>35)fail('Review school lunches before saving this week.');
   days[day]=rows.map(row=>{
    if(!object(row)||!text(row.name,75)||!Number.isFinite(row.qty)||row.qty<=0||row.qty>1000||!['each','g','ml','pack'].includes(row.unit))fail('Review school lunch amounts before saving this week.');
    return {name:row.name,qty:row.qty,unit:row.unit};
   });
   const menu=source.menus?.[day]||'';
   if(typeof menu!=='string'||menu.length>350||/[\u0000-\u001f\u007f]/.test(menu))fail('Review school lunch descriptions before saving this week.');
   menus[day]=menu;
  }
  return {version:1,children:source.children,days,menus};
 }
 function capture({plan,lunch,notes}={}){
  if(!object(plan)||!count(plan.servings))fail('Review household servings before saving this week.');
  const planned=slots(plan.planned,'dinners'),plannedDesserts=slots(plan.plannedDesserts||[],'desserts');
  const plannedBreakfasts=slots(plan.plannedBreakfasts===undefined?[]:plan.plannedBreakfasts,'breakfasts');
  const recipeIds=new Set([...planned,...plannedBreakfasts,...plannedDesserts].map(row=>row.recipeId)),mealServings={},dayServings={};
  for(const [recipeId,amount]of Object.entries(plan.mealServings||{}))if(recipeIds.has(recipeId)){
   if(!count(amount))fail('Review meal servings before saving this week.');mealServings[recipeId]=amount;
  }
  for(const row of planned){
   const amount=plan.dayServings?.[row.day];if(amount?.recipeId!==row.recipeId)continue;
   if(amount.count!==null&&!count(amount.count))fail('Review daily servings before saving this week.');
   dayServings[row.day]={recipeId:row.recipeId,count:amount.count};
  }
  const flags=value=>{
   if(value!==undefined&&!object(value))fail('Review leftover links before saving this week.');
   const output={};for(const [key,selected]of Object.entries(value||{})){
    if(selected===true){if(!id(key)||Object.keys(output).length>=50)fail('Review leftover links before saving this week.');output[key]=true;}
   }return output;
  };
  let bbManualBatch=null,bb81Batch=null;
  if(plan.bbManualBatch!==undefined&&plan.bbManualBatch!==null){
   const value=plan.bbManualBatch;
   if(value.version!==1||!Array.isArray(value.pairs)||value.pairs.length>3)fail('Review batch cooking before saving this week.');
   const occupied=new Set();
   bbManualBatch={version:1,pairs:value.pairs.map(pair=>{
    if(!object(pair)||!DAYS.includes(pair.sourceDay)||DAYS.indexOf(pair.leftoverDay)!==DAYS.indexOf(pair.sourceDay)+1||!id(pair.recipeId)||!planned.some(row=>row.day===pair.sourceDay&&row.recipeId===pair.recipeId)||planned.some(row=>row.day===pair.leftoverDay)||occupied.has(pair.sourceDay)||occupied.has(pair.leftoverDay))fail('Review batch cooking before saving this week.');
    occupied.add(pair.sourceDay);occupied.add(pair.leftoverDay);
    return {sourceDay:pair.sourceDay,leftoverDay:pair.leftoverDay,recipeId:pair.recipeId};
   })};
  }
  if(plan.bb81Batch!==undefined&&plan.bb81Batch!==null){
   if(plan.bb81Batch.version!==1||!id(plan.bb81Batch.monday)||!id(plan.bb81Batch.wednesday)||!planned.some(row=>row.day==='Monday'&&row.recipeId===plan.bb81Batch.monday)||!planned.some(row=>row.day==='Wednesday'&&row.recipeId===plan.bb81Batch.wednesday)||planned.some(row=>['Tuesday','Thursday'].includes(row.day))||bbManualBatch?.pairs.length)fail('Review batch cooking before saving this week.');
   bb81Batch={version:1,monday:plan.bb81Batch.monday,wednesday:plan.bb81Batch.wednesday};
  }
  if(notes!==undefined&&!object(notes))fail('Review custom dinners before saving this week.');
  const reserved=new Set([...(bbManualBatch?.pairs||[]).map(pair=>pair.leftoverDay),...(bb81Batch?['Tuesday','Thursday']:[])]);
  const customDinners={};for(const day of DAYS)if(own(notes||{},day)){
   if(!text(notes[day],110)||planned.some(row=>row.day===day)||reserved.has(day))fail('Review custom dinners before saving this week.');customDinners[day]=notes[day];
  }
  return {version:1,planned,plannedBreakfasts,plannedDesserts,servings:plan.servings,feedingSet:plan.feedingSet===true,mealServings,dayServings,
   leftoverSources:flags(plan.leftoverSources),leftoverConfirmed:flags(plan.leftoverConfirmed),bbManualBatch,bb81Batch,lunch:lunchbox(lunch),customDinners};
 }
 function validateWeek(value){
  if(!object(value)||value.version!==1)fail('This saved week needs review.');
  return capture({plan:value,lunch:value.lunch,notes:value.customDinners});
 }
 const title=value=>{
  const name=typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
  if(!text(name,60))fail('Name your week using 1–60 characters.');return name;
 };
 const summary=week=>{
  const dinnerDays=new Set([...week.planned.map(row=>row.day),...Object.keys(week.customDinners||{}),...(week.bbManualBatch?.pairs||[]).map(pair=>pair.leftoverDay),...(week.bb81Batch?['Tuesday','Thursday']:[])]);
  const dinners=dinnerDays.size,breakfasts=(week.plannedBreakfasts||[]).length,desserts=week.plannedDesserts.length,lunches=WEEKDAYS.filter(day=>week.lunch.days[day].length).length;
  return dinners+' dinner'+(dinners===1?'':'s')+(breakfasts?' · '+breakfasts+' breakfast'+(breakfasts===1?'':'s'):'')+' · '+desserts+' dessert'+(desserts===1?'':'s')+' · '+lunches+' lunch day'+(lunches===1?'':'s');
 };
 function createStore({storage,context=()=>({actor:'guest',ready:true}),now=Date.now,makeId}={}){
  let sequence=0;
  const scope=()=>{
   const value=context();if(!value||value.ready!==true)fail(value?.message||'Saving weeks is paused.');
   const actor=value.actor||'guest';if(!text(actor,256))fail('Check your account before using saved weeks.');
   return {actor,key:KEY+encodeURIComponent(actor)};
  };
  function read(){
   try{
    const pin=scope(),raw=storage.getItem(pin.key),parsed=raw===null?{version:1,weeks:[]}:JSON.parse(raw);
    if(!object(parsed)||parsed.version!==1||!Array.isArray(parsed.weeks)||parsed.weeks.length>MAX)fail('Saved weeks could not be read. Existing data has been kept.');
    const ids=new Set(),names=new Set(),weeks=parsed.weeks.map(row=>{
     if(!object(row)||!text(row.id,100)||ids.has(row.id)||!text(row.name,60)||!Number.isSafeInteger(row.savedAt)||row.savedAt<0)fail('Saved weeks could not be read. Existing data has been kept.');
     const name=title(row.name),key=name.toLocaleLowerCase();if(names.has(key))fail('Saved weeks could not be read. Existing data has been kept.');ids.add(row.id);names.add(key);
     return {id:row.id,name,savedAt:row.savedAt,week:validateWeek(row.week)};
    });return {ok:true,...pin,raw,weeks};
   }catch(error){return {ok:false,message:safeMessage(error,'Saved weeks could not be read. Existing data has been kept.')};}
  }
  function write(before,weeks){
   let next;
   try{
    const pin=scope();if(pin.actor!==before.actor||storage.getItem(pin.key)!==before.raw)fail('Saved weeks changed. Review the list and try again.');
    next=JSON.stringify({version:1,weeks});if(next.length>300000)fail('Saved weeks are full. Delete an old week first.');
    storage.setItem(pin.key,next);if(storage.getItem(pin.key)!==next)fail('Could not verify the saved week.');return {ok:true,weeks};
   }catch(error){
    try{if(next!==undefined&&storage.getItem(before.key)===next){if(before.raw===null)storage.removeItem(before.key);else storage.setItem(before.key,before.raw);}}catch{}
    return {ok:false,message:safeMessage(error,'Could not save this week. Existing weeks have been kept.')};
   }
  }
  function save(name,week,{replaceId}={}){
   try{
    const before=read();if(!before.ok)return before;
    const cleaned=validateWeek(week),label=title(name);
    if(!cleaned.planned.length&&!cleaned.plannedBreakfasts.length&&!cleaned.plannedDesserts.length&&!Object.keys(cleaned.customDinners).length&&!WEEKDAYS.some(day=>cleaned.lunch.days[day].length))fail('Choose meals or school lunches before saving a week.');
    const duplicate=before.weeks.find(row=>row.name.toLocaleLowerCase()===label.toLocaleLowerCase());
    if(duplicate&&duplicate.id!==replaceId)return {ok:false,duplicateId:duplicate.id,expected:before.raw,actor:before.actor,message:'A week with that name already exists.'};
    if(replaceId&&!before.weeks.some(row=>row.id===replaceId))fail('That saved week changed. Review the list and try again.');
    if(!replaceId&&before.weeks.length>=MAX)fail('You can save up to 25 weeks. Delete an old week first.');
    const savedAt=now();let nextId=replaceId||(makeId?makeId():'week-'+savedAt.toString(36)+'-'+(++sequence));
    if(!replaceId&&!makeId)while(before.weeks.some(row=>row.id===nextId))nextId='week-'+savedAt.toString(36)+'-'+(++sequence);
    if(!replaceId&&before.weeks.some(row=>row.id===nextId))fail('Could not create a unique saved week. Try again.');
    const record={id:nextId,name:label,savedAt,week:cleaned};
    if(!text(record.id,100)||!Number.isSafeInteger(savedAt)||savedAt<0)fail('Could not create a saved week.');
    return write(before,replaceId?before.weeks.map(row=>row.id===replaceId?record:row):[...before.weeks,record]);
   }catch(error){return {ok:false,message:safeMessage(error,'Could not save this week. Existing saved weeks have been kept.')};}
  }
  function remove(id){const before=read();if(!before.ok)return before;if(!before.weeks.some(row=>row.id===id))return {ok:false,message:'That saved week is no longer listed.'};return write(before,before.weeks.filter(row=>row.id!==id));}
  return Object.freeze({read,save,remove});
 }
 function mount({container,host,selections=null,selectionsCount=0,collapseOnMount=false,window:win=globalThis.window}={}){
  if(!container||!host?.context||!host?.snapshot||!host?.restore||!host?.confirm||!win?.document)return null;
  const doc=win.document,create=(tag,name,text)=>{const node=doc.createElement(tag);node.className=name;if(text!==undefined)node.textContent=text;return node;};
  const store=createStore({storage:win.localStorage,context:host.context});
  const panel=create('section','bb-saved-weeks'),heading=create('h3','','Saved weeks'),hint=create('p','bbsw-hint','Reuse a full week with its days and servings. Saved on this device.');
  const form=create('form','bbsw-form'),label=create('label','bbsw-name-label','Week name'),input=create('input','field'),save=create('button','btn primary','Save this week');
  input.type='text';input.maxLength=60;input.placeholder='e.g. Week 1';input.required=true;label.append(input);save.type='submit';form.append(label,save);
  const status=create('p','bbsw-status'),list=create('div','bbsw-list');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(heading,hint,form,status,list);container.prepend(panel);
  let pending=false,disposed=false,layout=null;
  if(selections){
   const actor=()=>host.context()?.actor||'guest',pin=actor(),previous=layouts.get(win),prefix='bbSavedTools'+(++layoutSequence);
   // Entering Plan starts with both secondary tools closed. Same-Plan updates
   // keep the chosen pane available while its original form owns the draft.
   let active=collapseOnMount===true?null:previous?.actor===pin?previous.active:null,layoutActor=pin;
   container.classList.add('bbsw-tools');
   const bar=create('div','bbsw-tabs');bar.setAttribute('role','group');bar.setAttribute('aria-label','Saved planning tools');
   const icon=(path)=>{const node=create('span','bbsw-tab-icon');node.setAttribute('aria-hidden','true');node.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>';return node;};
   const toggle=(key,title,path)=>{const button=create('button','bbsw-tab');button.type='button';button.dataset.bbswTab=key;button.setAttribute('aria-controls',prefix+'-'+key);button.setAttribute('aria-expanded','false');const badge=create('span','bbsw-tab-count');badge.setAttribute('aria-hidden','true');const arrow=icon('<path d="m8 10 4 4 4-4"/>');arrow.classList.add('bbsw-tab-arrow');button.append(icon(path),create('span','bbsw-tab-label',title),badge,arrow);bar.append(button);return {key,title,button,badge,pane:key==='weeks'?panel:selections};};
   const tools=[toggle('weeks','Saved weeks','<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 4h2m3 0h2m-7 3h2"/>'),toggle('meals','Saved meals','<path d="M7 4h10a1 1 0 0 1 1 1v16l-6-4-6 4V5a1 1 0 0 1 1-1Z"/>')];
   for(const tool of tools){tool.pane.id=prefix+'-'+tool.key;tool.pane.setAttribute('aria-label',tool.title);tool.button.addEventListener('click',()=>{active=active===tool.key?null:tool.key;apply();});tool.pane.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();active=null;apply();tool.button.focus();}});}
   function apply(){for(const tool of tools){const open=active===tool.key;tool.pane.hidden=!open;tool.button.setAttribute('aria-expanded',String(open));}layouts.set(win,{actor:layoutActor,active});}
   layout={refresh(count){const nextActor=actor();if(nextActor!==layoutActor){layoutActor=nextActor;active=null;}for(const tool of tools){const amount=tool.key==='weeks'?count:selectionsCount;tool.badge.textContent=String(amount);tool.badge.hidden=!(amount>0);tool.button.setAttribute('aria-label',tool.title+(amount>0?', '+amount+' saved':''));}apply();},dispose(){bar.remove();}};
   container.prepend(bar);apply();
  }
  const message=value=>{if(!disposed)status.textContent=value;};
  const current=pin=>{try{const next=host.context();return !disposed&&container.isConnected!==false&&next.ready===true&&(next.actor||'guest')===pin;}catch{return false;}};
  async function confirm(messageText,headingText,action){try{return await host.confirm(messageText,headingText,action)===true;}catch{return false;}}
  function render(){
   if(disposed)return;const state=store.read();layout?.refresh(state.ok?state.weeks.length:0);list.replaceChildren();save.disabled=pending||!state.ok;
   if(!state.ok){message(state.message);return;}
   if(!state.weeks.length){list.append(create('p','bbsw-empty','No saved weeks yet.'));return;}
   for(const row of state.weeks){
    const item=create('div','bbsw-item'),copy=create('div','bbsw-copy'),name=create('strong','',row.name),detail=create('small','',summary(row.week)),actions=create('div','bbsw-actions'),load=create('button','btn','Use week'),remove=create('button','btn','Delete');
    load.type=remove.type='button';load.disabled=remove.disabled=pending;load.setAttribute('aria-label','Use saved week '+row.name);remove.setAttribute('aria-label','Delete saved week '+row.name);copy.append(name,detail);actions.append(load,remove);item.append(copy,actions);list.append(item);
    load.addEventListener('click',async()=>{
     if(pending)return;let before;try{before=host.snapshot();}catch{message('Could not read your current week.');return;}if(before?.ready!==true){message(before?.message||'Your current week needs review.');return;}
     pending=true;render();
     try{
      if(!await confirm('Replace your current meal plan with “'+row.name+'”? Its days, servings, breakfasts, desserts and school lunches will be restored. Your At home stock is kept.','Use saved week?','Use this week'))return;
      if(!current(state.actor)){message('Your account or page changed. Reopen Saved weeks.');return;}
      const latest=store.read();if(!latest.ok||latest.raw!==state.raw){message('Saved weeks changed. Review the list and try again.');return;}
      const result=await host.restore({week:validateWeek(row.week),expected:before.fingerprint,actor:state.actor});message(result?.message||(result?.ok?'Saved week loaded.':'Could not load this saved week.'));
     }catch{message('Could not load this saved week. Your current plan has been kept.');}
     finally{pending=false;render();}
    });
    remove.addEventListener('click',async()=>{
     if(pending)return;pending=true;render();
     try{if(!await confirm('Delete saved week “'+row.name+'”? Your current meal plan stays as it is.','Delete saved week?','Delete week'))return;if(!current(state.actor))return;const latest=store.read();if(!latest.ok||latest.raw!==state.raw){message('Saved weeks changed. Review the list and try again.');return;}const result=store.remove(row.id);message(result.ok?'Saved week deleted.':result.message);}
     finally{pending=false;render();}
    });
   }
  }
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(pending)return;const pin=host.context()?.actor||'guest';let snapshot;
   try{snapshot=host.snapshot();if(snapshot?.ready!==true){message(snapshot?.message||'Your current plan needs review.');return;}}catch{message('Could not read your current week.');return;}
   let week;try{week=capture(snapshot);}catch(error){message(safeMessage(error,'Could not read your current week.'));return;}
   pending=true;render();
   try{
    let result=store.save(input.value,week);
    if(result.duplicateId){
     if(!await confirm('Replace the saved version of “'+title(input.value)+'” with this meal plan?','Update saved week?','Replace saved week'))return;
     if(!current(pin)){message('Your account or page changed. Reopen Saved weeks.');return;}
     const latest=store.read();if(!latest.ok||latest.raw!==result.expected||latest.actor!==result.actor){message('Saved weeks changed. Review the list and try again.');return;}
     if(host.snapshot()?.fingerprint!==snapshot.fingerprint){message('Your meal plan changed. Review it before saving.');return;}
     result=store.save(input.value,week,{replaceId:result.duplicateId});
    }
    message(result.ok?'Week saved. Plan → At home → Shop when you are ready to shop.':result.message);if(result.ok)input.value='';
   }catch{message('Could not save this week. Existing saved weeks have been kept.');}
   finally{pending=false;render();}
  });
  const refresh=()=>{if(!pending)render();};
  for(const name of ['basketboss:session-changed','basketboss:account-deletion-started'])win.addEventListener?.(name,refresh);
  const storage=event=>{if(event.key?.startsWith(KEY))refresh();};win.addEventListener?.('storage',storage);render();
  return Object.freeze({refresh,dispose(){disposed=true;for(const name of ['basketboss:session-changed','basketboss:account-deletion-started'])win.removeEventListener?.(name,refresh);win.removeEventListener?.('storage',storage);layout?.dispose();panel.remove();}});
 }
 return Object.freeze({capture,validateWeek,summary,createStore,mount,KEY});
});
