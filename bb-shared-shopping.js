/* Shared extras belong to the verified household. Purchases and stock keep
   their original owners: this module never edits pantry quantities. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const ENDPOINT='/api/household',KEY='basketboss_shared_shopping_requests_v1';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const UNITS=['each','pack','g','kg','ml','l','clove','tin','loaf','slice','bulb'];
 const clone=value=>JSON.parse(JSON.stringify(value));
 const quantity=(value,unit)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1000000&&Math.abs(value*1000000-Math.round(value*1000000))<0.0001&&(unit!=='pack'||Number.isInteger(value));
 function validItem(item){return !!item&&UUID.test(item.id)&&UUID.test(item.household_id)&&typeof item.name==='string'&&item.name.trim().length>0&&item.name.length<=70&&UNITS.includes(item.unit)&&quantity(item.quantity,item.unit)&&typeof item.completed==='boolean'&&Number.isSafeInteger(item.revision)&&item.revision>=1&&(item.created_by===null||UUID.test(item.created_by))&&(item.added_by_name===null||typeof item.added_by_name==='string'&&item.added_by_name.length<=60)&&(item.completed_by===null||item.completed_by===undefined||UUID.test(item.completed_by));}
 function creatorLabel(item){return item.created_by===null?'Former household member':item.added_by_name?.trim()||'Household member';}
 function create(options){
  let generation=0,identity=null,household=null,items=[],phase='signed-out',notice='',premium=false,configured=false,role=null,epoch=0,readJob=null,readAgain=false,lastRead=0;
  const jobs=new Map(),recordJobs=new Map();
  const pin=()=>{if(options.isBlocked?.())return null;const s=options.getSession();return UUID.test(s?.user?.id||'')&&typeof s?.access_token==='string'&&Number(s.expires_at)*1000>Date.now()+5000?{actor:s.user.id,token:s.access_token}:null;};
  function same(a,b){return !!a&&!!b&&a.actor===b.actor&&a.token===b.token;}
  function syncIdentity(){const next=pin();if(!same(next,identity)){generation++;identity=next;household=null;items=[];phase=next?'loading':'signed-out';notice='';premium=false;configured=false;role=null;epoch++;lastRead=0;readJob=null;readAgain=false;jobs.clear();recordJobs.clear();}return next;}
  const current=(who,serial,hid)=>serial===generation&&same(who,pin())&&(!hid||household===hid);
  function load(who){try{const raw=JSON.parse(options.storage.getItem(KEY+':'+who.actor)||'null');return raw?.version===1?{version:1,adds:Array.isArray(raw.adds)?raw.adds:[],completions:Array.isArray(raw.completions)?raw.completions:[]}:{version:1,adds:[],completions:[]};}catch{throw Error('storage');}}
  function save(who,value){const key=KEY+':'+who.actor,text=JSON.stringify(value);options.storage.setItem(key,text);if(options.storage.getItem(key)!==text)throw Error('storage');}
  function pending(){if(!identity||!household)return {adds:[],completions:[]};try{const value=load(identity);return {adds:value.adds.filter(x=>x.household_id===household&&UUID.test(x.id)),completions:value.completions.filter(x=>x.household_id===household&&UUID.test(x.id))};}catch{return {adds:[],completions:[]};}}
  function snapshot(){const out=pending();return clone({phase,household_id:household,items,notice,premium,configured,role,busyIds:[...jobs.keys(),...recordJobs.keys()],pendingAdds:out.adds,pendingCompletions:out.completions,lastRead});}
  function publish(){options.onChange?.(snapshot());}
  function say(message){notice=message;publish();}
  async function request(who,serial,path,body,hid){
   const response=await options.fetch(ENDPOINT+path,{method:body?'POST':'GET',headers:{Accept:'application/json',Authorization:'Bearer '+who.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'same-origin',redirect:'manual',cache:'no-store'});
   const data=await response.json().catch(()=>null);if(!current(who,serial,hid))throw Error('changed');return {response,data};
  }
  function merge(item){const previous=items.find(row=>row.id===item.id);if(previous&&previous.revision>item.revision)return;items=items.filter(row=>row.id!==item.id);items.push(clone(item));}
  function changeStored(who,fn){const value=load(who);fn(value);save(who,value);}
  async function acknowledge(who,serial,operation){
   if(!current(who,serial,operation.household_id))return false;
   if(recordJobs.has(operation.id))return recordJobs.get(operation.id);
   const run=async()=>{try{
    if(!current(who,serial,operation.household_id))return false;
    const item=operation.item;if(!validItem(item))throw Error('invalid');
    // Another member can satisfy the request first. Their checkmark is shared,
    // but it is never turned into a second local purchase on this device.
    if(item.completed&&item.completed_by!==who.actor){changeStored(who,value=>{value.completions=value.completions.filter(row=>row.id!==operation.id||row.household_id!==operation.household_id);});notice='This item was already ticked off by another household member.';publish();return true;}
    const saved=await options.recordPurchase(item,operation.completed,{actor:who.actor,household_id:operation.household_id});
    if(!current(who,serial,operation.household_id))return false;
    if(saved!==true)throw Error('local');
    changeStored(who,value=>{value.completions=value.completions.filter(row=>row.id!==operation.id||row.household_id!==operation.household_id);});notice='';publish();return true;
   }catch{if(current(who,serial,operation.household_id))say('Bought is saved online. Retry saving the purchase on this device before finishing your shop.');return false;}
   finally{if(recordJobs.get(operation.id)===job)recordJobs.delete(operation.id);publish();}};
   const job=Promise.resolve().then(run);recordJobs.set(operation.id,job);publish();return job;
  }
  function refresh({force=false}={}){
   const who=syncIdentity();if(!who){publish();return Promise.resolve(false);}
   if(readJob)return readJob;
   if(!force&&Date.now()-lastRead<10000)return Promise.resolve(phase==='ready');
   const serial=generation,startedEpoch=epoch;
   const run=async()=>{try{
    const status=await request(who,serial,'?mode=status');
    if(!status.response.ok||!status.data||typeof status.data.configured!=='boolean')throw Error('status');
    configured=status.data.configured===true;premium=status.data.premium===true;role=status.data.role||null;
    if(!configured||!premium||!UUID.test(status.data.household_id||'')){household=null;items=[];phase=!configured?'unavailable':!premium?'premium':'unlinked';notice='';lastRead=Date.now();publish();return true;}
    const hid=status.data.household_id;
    if(household&&household!==hid){items=[];epoch++;}
    household=hid;
    const result=await request(who,serial,'?mode=shopping',undefined,hid);
    if(!result.response.ok||result.data?.ok!==true||result.data.household_id!==hid||!Array.isArray(result.data.items)||result.data.items.length>1050||result.data.items.some(row=>!validItem(row)||row.household_id!==hid)||new Set(result.data.items.map(row=>row.id)).size!==result.data.items.length)throw Error('shopping');
    if(startedEpoch!==epoch){readAgain=true;return false;}
    items=clone(result.data.items);phase='ready';lastRead=Date.now();if(!pending().adds.length&&!pending().completions.length)notice='';publish();
    for(const operation of pending().completions){const item=items.find(row=>row.id===operation.id);if(operation.serverAck)void acknowledge(who,serial,operation);else if(item&&item.completed===operation.completed){const accepted={...operation,item,serverAck:true};changeStored(who,value=>{value.completions=value.completions.filter(row=>row.id!==operation.id||row.household_id!==hid);value.completions.push(accepted);});void acknowledge(who,serial,accepted);}}
    return true;
   }catch{if(current(who,serial)){phase=household&&items.length?'ready':'error';say('Shared shopping could not refresh. Reconnect and retry; your saved list has not been replaced.');}return false;}
   finally{if(readJob===job)readJob=null;if(readAgain&&current(who,serial)){readAgain=false;void refresh({force:true});}}};
   const job=Promise.resolve().then(run);readJob=job;publish();return job;
  }
  function runAdd(record){
   const who=syncIdentity();if(!who||phase!=='ready'||record.household_id!==household)return Promise.resolve(false);
   if(jobs.has(record.id))return jobs.get(record.id);
   const serial=generation,hid=household;
   const run=async()=>{try{
    const result=await request(who,serial,'',{action:'shopping_add',id:record.id,name:record.name,quantity:record.quantity,unit:record.unit},hid);
    if(result.response.status===409&&result.data?.limit_reached){say('Complete some shared items before adding more. Your addition is saved here for retry.');return false;}
    if(!result.response.ok||result.data?.ok!==true||result.data.household_id!==hid||!validItem(result.data.item)||result.data.item.id!==record.id||result.data.item.household_id!==hid||result.data.item.created_by!==who.actor)throw Error('add');
    epoch++;merge(result.data.item);changeStored(who,value=>{value.adds=value.adds.filter(row=>row.id!==record.id||row.household_id!==hid);});notice=result.data.item.completed?'This addition was already ticked off.':'Added to your shared shopping list.';publish();return true;
   }catch{if(current(who,serial,hid))say('Not shared yet. Retry this addition when connected; it will use the same item reference.');return false;}
   finally{if(jobs.get(record.id)===job)jobs.delete(record.id);publish();}};
   const job=Promise.resolve().then(run);jobs.set(record.id,job);publish();return job;
  }
  function add(raw){
   const who=syncIdentity();if(!who||phase!=='ready'||!household){say('Connect your Premium household before adding a shared item.');return Promise.resolve(false);}
   const name=String(raw?.name||'').trim().replace(/\s+/g,' '),unit=raw?.unit,amount=Number(raw?.quantity);
   if(!name||name.length>70||/[\u0000-\u001f\u007f]/.test(name)||!UNITS.includes(unit)||!quantity(amount,unit)){say('Enter an item and a valid quantity; use whole numbers for packs.');return Promise.resolve(false);}
   try{const value=load(who),prior=value.adds.find(row=>row.household_id===household&&row.name===name&&row.quantity===amount&&row.unit===unit);if(prior)return runAdd(prior);
    const id=options.uuid();if(!UUID.test(id))throw Error('id');const record={id,household_id:household,name,quantity:amount,unit};value.adds.push(record);save(who,value);publish();return runAdd(record);
   }catch{say('This device could not save a retry reference. Nothing was added online.');return Promise.resolve(false);}
  }
  function complete(id,completed=true){
   const who=syncIdentity(),item=items.find(row=>row.id===id);if(!who||phase!=='ready'||!household||!item||typeof completed!=='boolean')return Promise.resolve(false);
   if(jobs.has(id))return jobs.get(id);
   const serial=generation,hid=household;
   let operation;try{const value=load(who),prior=value.completions.find(row=>row.id===id&&row.household_id===hid);if(prior?.serverAck)return acknowledge(who,serial,prior);operation=prior||{id,household_id:hid,expectedRevision:item.revision,completed,serverAck:false};value.completions=value.completions.filter(row=>row.id!==id||row.household_id!==hid);value.completions.push(operation);save(who,value);}catch{say('This device could not save the shopping change safely. Nothing was changed online.');return Promise.resolve(false);}
   const run=async()=>{try{
    const result=await request(who,serial,'',{action:'shopping_complete',id,expectedRevision:operation.expectedRevision,completed:operation.completed},hid);
    if(!result.response.ok||result.data?.ok!==true||result.data.household_id!==hid||!validItem(result.data.item)||result.data.item.id!==id||result.data.item.household_id!==hid||result.data.item.completed!==operation.completed){if(result.response.status===409){changeStored(who,value=>{value.completions=value.completions.filter(row=>row.id!==id||row.household_id!==hid);});void refresh({force:true});say('This item changed on another device. Refresh the list before trying again.');}else say('The checkmark could not be confirmed. Retry when connected.');return false;}
    epoch++;merge(result.data.item);const accepted={...operation,item:result.data.item,serverAck:true};changeStored(who,value=>{value.completions=value.completions.filter(row=>row.id!==id||row.household_id!==hid);value.completions.push(accepted);});publish();return acknowledge(who,serial,accepted);
   }catch{if(current(who,serial,hid))say('The checkmark could not be confirmed. Retry when connected.');return false;}
   finally{if(jobs.get(id)===job)jobs.delete(id);publish();}};
   const job=Promise.resolve().then(run);jobs.set(id,job);publish();return job;
  }
  function knownCompletedItems(){const who=syncIdentity();if(!who)return [];try{const values=[...items,...load(who).completions.filter(row=>row.serverAck&&row.item).map(row=>row.item)],out=new Map();for(const row of values)if(row.completed&&row.completed_by===who.actor&&validItem(row))out.set(row.household_id+':'+row.id+':'+row.revision,row);return clone([...out.values()]);}catch{return [];}}
  function retry(id){const who=syncIdentity();if(!who)return Promise.resolve(false);const value=pending(),addition=value.adds.find(row=>row.id===id);if(addition)return runAdd(addition);const operation=value.completions.find(row=>row.id===id);if(operation?.serverAck)return acknowledge(who,generation,operation);return operation?complete(id,operation.completed):Promise.resolve(false);}
  function invalidate(){identity=null;syncIdentity();publish();}
  return Object.freeze({refresh,add,complete,retry,invalidate,snapshot,knownCompletedItems});
 }
 function install(root){
  const doc=root.document;if(!doc||root.BBSharedShopping)return;
  let card,ui,scheduled=false,formOpen=false,submitting=false,draftActor=null,draftHousehold=null,renderStamp='',poll,lastFetchStarted=0;
  const el=(tag,text,className)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const session=()=>{try{return JSON.parse(root.localStorage.getItem('basketboss_cloud_session_v1')||'null');}catch{return null;}};
  const blocked=()=>root.BBAccountDeletion?.isDeleting?.()===true;
  const controller=create({getSession:session,isBlocked:blocked,storage:root.localStorage,fetch:(...args)=>root.fetch(...args),uuid:()=>root.crypto.randomUUID(),recordPurchase:(item,checked,pin)=>root.BBSharedShoppingHost?.recordPurchase?.(item,checked,pin)??false,onChange:()=>schedule()});
  function openSharing(){if(root.BBSharedShoppingHost?.openSharing)return root.BBSharedShoppingHost.openSharing();doc.querySelector('[data-bbhs-trigger]')?.click();}
  function make(){if(card)return;
   card=el('section',undefined,'bb-shared-shopping');card.id='bbSharedShopping';card.setAttribute('aria-labelledby','bbSharedShoppingTitle');
   const header=el('div',undefined,'bbss-header'),copy=el('div'),title=el('h2','Shared Household Additions');title.id='bbSharedShoppingTitle';const count=el('span','', 'bbss-count');title.append(count);copy.append(title);
   const badge=el('span','PREMIUM','bbss-premium');
   const add=el('button','＋ Add item','bbss-add');add.type='button';add.setAttribute('aria-controls','bbSharedShoppingForm');add.setAttribute('aria-expanded','false');add.addEventListener('click',()=>{formOpen=!formOpen;render();if(formOpen)ui.name.focus();});header.append(copy,badge,add);
   const intro=el('p','Add mid-week extras like toothpaste or eggs anytime. Everyone in your linked household sees them, with who added each item.','bbss-intro');
   const gate=el('div',undefined,'bbss-gate'),gateText=el('p'),connect=el('button','Partner Sharing');connect.type='button';connect.addEventListener('click',openSharing);gate.append(gateText,connect);
   const form=el('form',undefined,'bbss-form');form.id='bbSharedShoppingForm';form.hidden=true;
   const nameLabel=el('label','Item','bbss-name'),name=el('input');name.name='name';name.maxLength=70;name.required=true;name.placeholder='e.g. milk or washing-up liquid';name.autocomplete='off';nameLabel.append(name);
   const quantityLabel=el('label','Extra quantity'),amount=el('input');amount.name='quantity';amount.type='number';amount.min='.001';amount.max='1000000';amount.step='any';amount.inputMode='decimal';amount.value='1';amount.required=true;quantityLabel.append(amount);
   const unitLabel=el('label','Unit'),unit=el('select');unit.name='unit';unit.setAttribute('aria-label','Unit');for(const value of UNITS){const option=el('option',value==='each'?'each':value==='pack'?'packs':value);option.value=value;unit.append(option);}unitLabel.append(unit);
   const note=el('p','Add only what you want to buy extra. Nothing is added to At home until the purchase is confirmed.','bbss-form-note');
   const submit=el('button','Add to shared list','bbss-submit');submit.type='submit';const cancel=el('button','Cancel','bbss-cancel');cancel.type='button';cancel.addEventListener('click',()=>{formOpen=false;render();});const actions=el('div',undefined,'bbss-actions');actions.append(submit,cancel);form.append(nameLabel,quantityLabel,unitLabel,note,actions);
   form.addEventListener('submit',async event=>{event.preventDefault();if(submitting)return;submitting=true;render();try{const added=await controller.add({name:name.value,quantity:Number(amount.value),unit:unit.value});if(added){formOpen=false;name.value='';amount.value='1';unit.value='each';}}finally{submitting=false;render();}});
   const list=el('div',undefined,'bbss-list'),pending=el('div',undefined,'bbss-pending-list'),history=el('details',undefined,'bbss-history'),historyTitle=el('summary','Bought'),historyList=el('div');history.append(historyTitle,historyList);
   const status=el('p','', 'bbss-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');const footer=el('div',undefined,'bbss-footer'),refresh=el('button','Refresh shared list','bbss-refresh');refresh.type='button';refresh.addEventListener('click',()=>void controller.refresh({force:true}));footer.append(refresh);
   card.append(header,intro,gate,form,list,pending,history,status,footer);ui={header,title,count,badge,add,intro,gate,gateText,connect,form,name,amount,unit,submit,cancel,list,pending,history,historyTitle,historyList,status,refresh};
  }
  function row(item,history=false){
   const node=el('div',undefined,'bbss-item'+(history?' is-complete':''));node.dataset.sharedItem=item.id;
   const text=el('div',undefined,'bbss-item-copy'),title=el('strong',item.name),quantityText=el('span',item.quantity+' '+(item.unit==='pack'?(item.quantity===1?'pack':'packs'):item.unit),'bbss-quantity');const attribution=el('small','Added by '+creatorLabel(item),'bbss-attribution');text.append(title,quantityText,attribution);
   if(!history){const label=el('label',undefined,'bbss-check'),check=el('input');check.type='checkbox';check.setAttribute('aria-label','Bought '+item.name);check.disabled=controller.snapshot().busyIds.includes(item.id);check.addEventListener('change',()=>{check.checked=false;if(!check.disabled)void controller.complete(item.id,true);});label.append(check);node.append(label);}
   else node.append(el('span','✓','bbss-done'));
   node.append(text);return node;
  }
  function render(){make();const state=controller.snapshot(),actor=session()?.user?.id||null;
   if(actor!==draftActor||state.household_id&&draftHousehold&&state.household_id!==draftHousehold){draftActor=actor;draftHousehold=state.household_id;formOpen=false;submitting=false;ui.name.value='';ui.amount.value='1';ui.unit.value='each';renderStamp='';}
   if(state.household_id)draftHousehold=state.household_id;
   const ready=state.phase==='ready',pendingItems=state.items.filter(item=>!item.completed),completeItems=state.items.filter(item=>item.completed).sort((a,b)=>String(b.completed_at||'').localeCompare(String(a.completed_at||'')));
   card.classList.toggle('is-gated',!ready);
   ui.count.textContent=ready?' · '+pendingItems.length:'';ui.badge.hidden=state.premium;ui.add.hidden=!ready;ui.intro.hidden=!ready;ui.gate.hidden=ready;ui.form.hidden=!ready||!formOpen;ui.add.setAttribute('aria-expanded',String(ready&&formOpen));ui.submit.disabled=submitting;ui.cancel.disabled=submitting;ui.name.disabled=submitting;ui.amount.disabled=submitting;ui.unit.disabled=submitting;
   ui.gateText.textContent=state.phase==='loading'?'Checking your shared household…':state.phase==='signed-out'?'Link a Premium household to add extras and see who added each item.':state.phase==='premium'?'Partner Sharing is included with Premium.':state.phase==='unlinked'?'Link your partner to share shopping extras.':state.phase==='unavailable'?'Partner Sharing is not available on this site yet.': 'Reconnect to refresh your shared shopping list.';
   ui.connect.hidden=state.phase==='loading';ui.connect.textContent=state.phase==='signed-out'?'Sign in & Partner Sharing':'Partner Sharing';
   const stamp=JSON.stringify([state.items,state.busyIds,state.pendingAdds,state.pendingCompletions]);
   if(stamp!==renderStamp){renderStamp=stamp;ui.list.replaceChildren();ui.historyList.replaceChildren();ui.pending.replaceChildren();
    if(ready&&!pendingItems.length)ui.list.append(el('p','No shared extras to buy.','bbss-empty'));
    for(const item of pendingItems)ui.list.append(row(item));for(const item of completeItems)ui.historyList.append(row(item,true));
    for(const record of state.pendingAdds){const node=el('div',undefined,'bbss-retry');node.append(el('span',record.name+' · '+record.quantity+' '+record.unit+' · Not shared yet'));const retry=el('button','Retry addition');retry.type='button';retry.disabled=state.busyIds.includes(record.id);retry.addEventListener('click',()=>void controller.retry(record.id));node.append(retry);ui.pending.append(node);}
    for(const record of state.pendingCompletions){const node=el('div',undefined,'bbss-retry');node.append(el('span',record.serverAck?'Bought saved online · device save needs retry':'Checkmark awaiting confirmation'));const retry=el('button',record.serverAck?'Save purchase on this device':'Retry checkmark');retry.type='button';retry.disabled=state.busyIds.includes(record.id);retry.addEventListener('click',()=>void controller.retry(record.id));node.append(retry);ui.pending.append(node);}
   }
   ui.list.hidden=!ready;ui.pending.hidden=!ready||!state.pendingAdds.length&&!state.pendingCompletions.length;ui.history.hidden=!ready||!completeItems.length;ui.historyTitle.textContent='Bought ('+completeItems.length+')';ui.status.textContent=state.notice;ui.status.hidden=!state.notice;ui.refresh.hidden=state.phase!=='error'&&!/could not refresh|Reconnect|Not shared yet|checkmark could not|changed on another/i.test(state.notice);
  }
  function inView(){return doc.body.classList.contains('bb172-storefront-visible')||(doc.body.dataset.bbnextView||doc.querySelector('.tab.active')?.dataset.tab)==='shop-list';}
  function place(){
   scheduled=false;make();const visible=inView();card.hidden=!visible;if(!visible)return;
   const advanced=doc.body.classList.contains('bb172-storefront-visible')?doc.querySelector('#bb172Storefront .bb172-storefront-shell'):null;
   if(advanced){if(advanced.firstElementChild!==card)advanced.prepend(card);}
   else{const app=doc.getElementById('app'),anchor=doc.getElementById('bbReleaseShopOverview')||app;if(anchor&&card.nextSibling!==anchor)anchor.before(card);}
   render();if(Date.now()-lastFetchStarted>10000){lastFetchStarted=Date.now();void controller.refresh();}
  }
  function schedule(){if(!scheduled){scheduled=true;root.queueMicrotask?root.queueMicrotask(place):Promise.resolve().then(place);}}
  function isolate(){formOpen=false;lastFetchStarted=0;controller.invalidate();schedule();if(inView())void controller.refresh({force:true});}
  function start(){
   schedule();const observer=new root.MutationObserver(records=>{if(records.some(record=>record.type==='attributes'&&record.target===doc.body||record.type==='childList'&&(record.target===doc.getElementById('app')||Array.from(record.addedNodes||[]).some(node=>node.nodeType===1&&(node.matches?.('#app,#bbReleaseShopOverview,#bb172Storefront,.bb172-storefront-shell,.bb172-storefront-controls')||node.querySelector?.('#bb172Storefront,.bb172-storefront-controls'))))))schedule();});observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-bbnext-view']});
   root.addEventListener('basketboss:session-changed',isolate);root.addEventListener('storage',event=>{if(event.key===null||event.key==='basketboss_cloud_session_v1')isolate();});
   for(const name of ['basketboss:account-deletion-started','basketboss:account-deletion-deleted','basketboss:account-deletion-cancelled'])root.addEventListener(name,isolate);
   for(const name of ['focus','online'])root.addEventListener(name,()=>{if(inView())void controller.refresh({force:true});});
   doc.addEventListener('visibilitychange',()=>{if(!doc.hidden&&inView())void controller.refresh({force:true});});
   poll=root.setInterval(()=>{if(!doc.hidden&&inView())void controller.refresh({force:true});},20000);
  }
  root.BBSharedShopping=Object.freeze({afterRender:schedule,refresh:options=>controller.refresh(options),add:controller.add,complete:controller.complete,snapshot:controller.snapshot,knownCompletedItems:controller.knownCompletedItems});
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
 }
 return Object.freeze({create,install,validItem,creatorLabel,KEY,ENDPOINT,UNITS});
});
