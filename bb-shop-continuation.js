/* Saved shortfalls are a read-only trip snapshot. Continuing opens the live list. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root){
  root.BBShopContinuation=api;
  const ready=()=>root.BBShopContinuationHost?.refresh?.();
  if(root.document?.readyState==='loading')root.document.addEventListener('DOMContentLoaded',ready,{once:true});
  else ready();
 }
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const ARCHIVE_KEY='basketboss_shop_session_archive_v7';
 const MARKETS=new Set(['UK','Guernsey','Jersey','US']);
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const text=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
 const date=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
 const shop=value=>text(value,512)&&value.startsWith('shop-');
 function scope(context){
  if(!object(context))return null;
  const actor=context.actor??context.actorId;
  if(!text(actor,200)||!MARKETS.has(context.market)||context.actor!==undefined&&context.actorId!==undefined&&context.actor!==context.actorId)return null;
  return {actorId:actor,market:context.market};
 }
 function rowsCopy(rows){
  if(!Array.isArray(rows)||rows.length>1000)return null;
  const ids=new Set(),copy=[];
  for(const row of rows){
   if(!object(row)||!text(row.id,512)||!text(row.name,200)||!text(row.unit,40)||row.checked===true||ids.has(row.id))return null;
   const unknown=row.quantity===null&&row.quantityNeedsReview===true;
   if(!unknown&&(typeof row.quantity!=='number'||!Number.isFinite(row.quantity)||row.quantity<=0||row.quantity>1000000||row.quantityNeedsReview===true))return null;
   if(row.kind!==undefined&&!['food','household'].includes(row.kind)||row.manualBuyId!==undefined&&!text(row.manualBuyId,512))return null;
   ids.add(row.id);
   copy.push(Object.freeze({id:row.id,name:row.name,unit:row.unit,quantity:row.quantity,...(unknown?{quantityNeedsReview:true}:{}),...(row.kind!==undefined?{kind:row.kind}:{}),...(row.manualBuyId!==undefined?{manualBuyId:row.manualBuyId}:{})}));
  }
  return Object.freeze(copy);
 }
 function snapshotCopy(value){
  if(!object(value)||value.version!==1||!shop(value.shopSessionId)||value.status!=='pending'||!date(value.savedAt))return null;
  const context=scope(value),rows=rowsCopy(value.rows);
  if(!context||!rows?.length)return null;
  return Object.freeze({version:1,shopSessionId:value.shopSessionId,...context,savedAt:value.savedAt,status:'pending',rows});
 }
 function prepareContinuation(session,remainingRows,context){
  const who=scope(context);
  if(!object(session)||session.version!==7||!shop(session.id)||!who)return {ok:false,error:'Invalid shopping context'};
  const rows=rowsCopy(remainingRows);
  if(!rows)return {ok:false,error:'Review the remaining items and quantities before saving'};
  if(!rows.length)return {ok:true,snapshot:null};
  const savedAt=context.savedAt??session.closedAt??session.createdAt;
  if(!date(savedAt))return {ok:false,error:'Invalid shopping date'};
  return {ok:true,snapshot:Object.freeze({version:1,shopSessionId:session.id,...who,savedAt,status:'pending',rows})};
 }
 function listPending(archive,context){
  const who=scope(context);
  if(!who||!object(archive))return [];
  const result=[];
  for(const [id,entry]of Object.entries(archive)){
   if(!object(entry)||entry.version!==7||entry.id!==id||!shop(id))continue;
   const snapshot=snapshotCopy(entry.savedRemaining);
   if(!snapshot||snapshot.shopSessionId!==id||snapshot.actorId!==who.actorId||snapshot.market!==who.market)continue;
   const receipt=entry.receiptContext;
   if(receipt!==undefined&&(!object(receipt)||receipt.actorId!==who.actorId||receipt.market!==who.market))continue;
   result.push(snapshot);
  }
  return result.sort((a,b)=>Date.parse(b.savedAt)-Date.parse(a.savedAt)||a.shopSessionId.localeCompare(b.shopSessionId));
 }
 function readPending(storage,context){
  try{return listPending(JSON.parse(storage.getItem(ARCHIVE_KEY)||'{}'),context);}catch{return [];}
 }
 function formatList(snapshot){
  const value=snapshotCopy(snapshot);
  return value?'Saved shopping list\n'+value.rows.map(row=>(row.quantityNeedsReview?'Check quantity':String(row.quantity)+' '+row.unit)+' '+row.name).join('\n'):'';
 }
 function mount({container,win,context,onContinue,onCopy}){
  const doc=container.ownerDocument||win?.document;
  if(!doc)throw Error('A shopping view container is required');
  let disposed=false,generation=0;
  const wrap=doc.createElement('section');wrap.className='bb-shop-continuation';wrap.setAttribute('aria-label','Saved shopping');container.append(wrap);
  const make=(tag,cls,value)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=value;return node;};
  const current=()=>{try{return scope(typeof context==='function'?context():context);}catch{return null;}};
  const same=(left,right)=>!!left&&!!right&&left.actorId===right.actorId&&left.market===right.market;
  const blocked=()=>win?.BBAccountDeletion?.isDeleting?.()===true;
  function render(){
   if(disposed)return;
   const serial=++generation,who=current();wrap.replaceChildren();
   const pending=blocked()?[]:readPending(win?.localStorage,who);
   wrap.hidden=!pending.length;
   for(const snapshot of pending){
    const card=make('article','bb-shop-continuation-card'),head=make('div','bb-shop-continuation-head');
    const title=make('h3','','Continue your shop'),count=snapshot.rows.length;
    const dateLabel=new Intl.DateTimeFormat(snapshot.market==='US'?'en-US':'en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(snapshot.savedAt));
    head.append(title,make('span','bb-shop-continuation-count',count+' item'+(count===1?'':'s')+' saved'),make('span','bb-shop-continuation-date',dateLabel));
    const description=make('p','bb-shop-continuation-note','Open your current list to see what is still needed.');
    const details=make('details','bb-shop-continuation-details'),summary=make('summary','','Saved list from your last shop'),list=make('ul','bb-shop-continuation-list');
    for(const row of snapshot.rows){const item=make('li'),name=make('span','',row.name),quantity=make('strong','',row.quantityNeedsReview?'Check quantity':String(row.quantity)+' '+row.unit);item.append(name,quantity);list.append(item);}
    details.append(summary,list);
    const actions=make('div','bb-shop-continuation-actions'),resume=make('button','bb-shop-continuation-resume','Continue shopping'),copy=make('button','bb-shop-continuation-copy','Copy saved list');resume.type=copy.type='button';resume.disabled=typeof onContinue!=='function';
    const status=make('p','bb-shop-continuation-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const alive=()=>!disposed&&serial===generation&&card.isConnected&&same(who,current())&&!blocked();
    let busy=false;
    resume.onclick=async()=>{
     if(busy||!alive())return;
     busy=true;resume.disabled=true;resume.setAttribute('aria-busy','true');
     try{await onContinue(snapshot);}catch{if(alive())status.textContent='Your saved list is safe. Try opening shopping again.';}
     finally{busy=false;if(alive()){resume.disabled=false;resume.removeAttribute('aria-busy');}}
    };
    copy.onclick=async()=>{
     if(busy||!alive())return;
     busy=true;copy.disabled=true;copy.setAttribute('aria-busy','true');const value=formatList(snapshot);
     try{
      if(typeof onCopy==='function'){if(await onCopy(value,snapshot)===false)throw Error('Copy unavailable');}
      else if(typeof win?.navigator?.clipboard?.writeText==='function')await win.navigator.clipboard.writeText(value);
      else throw Error('Copy unavailable');
      if(alive())status.textContent='Saved shopping list copied.';
     }catch{
      if(alive()){
       let field=card.querySelector('textarea');
       if(!field){field=make('textarea','bb-shop-continuation-copy-text');field.readOnly=true;field.setAttribute('aria-label','Saved shopping list to copy');card.append(field);}
       field.value=value;field.rows=Math.min(8,count+1);details.open=true;status.textContent='Select and copy your saved list below.';field.focus();field.select?.();
      }
     }finally{busy=false;if(alive()){copy.disabled=false;copy.removeAttribute('aria-busy');}}
    };
    actions.append(resume,copy);card.append(head,description,details,actions,status);wrap.append(card);
   }
  }
  const refresh=()=>render();
  const storage=event=>{if(event.key===ARCHIVE_KEY||event.key==='basketboss_cloud_session_v1'||event.key===null)render();};
  const events=['basketboss:session-changed','basketboss:account-changed','basketboss:account-deletion-started','basketboss:market-changed','basketboss:shopping-changed'];
  for(const name of events)win?.addEventListener?.(name,refresh);
  win?.addEventListener?.('storage',storage);render();
  return Object.freeze({refresh,dispose(){if(disposed)return;disposed=true;generation++;wrap.remove();for(const name of events)win?.removeEventListener?.(name,refresh);win?.removeEventListener?.('storage',storage);}});
 }
 return Object.freeze({prepareContinuation,listPending,readPending,formatList,mount});
});
