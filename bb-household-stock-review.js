/* Reviewed repair for household purchases previously filed as food stock.
 * Reads and proposals are pure; the host owns its existing guarded journal. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBHouseholdStockReview=Object.freeze(api);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const MAX=1000000,UNITS=new Set(['each','pack','bag','tin','bunch','loaf','g','ml']);
 const KEYS={stock:'basketboss_321_v7_measured_pantry',inventory:'basketboss_makeameal_v1_inventory',features:'basketboss_321_features_v1'};
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const clone=value=>JSON.parse(JSON.stringify(value));
 const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX;
 const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim():'';
 const safe=value=>!!value&&!['__proto__','constructor','prototype'].includes(value)&&value.length<=200&&!value.includes('|');
 const ordered=value=>Array.isArray(value)?value.map(ordered):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
 function nameKey(value,options){const text=clean(value);if(!safe(text))return '';let result=text.toLowerCase();try{if(options.canonicalize)result=clean(options.canonicalize(text)).toLowerCase();}catch{return '';}return safe(result)?result:'';}
 function keysFor(options){const keys={...KEYS,...options.keys};if(Object.values(keys).some(key=>typeof key!=='string'||!key||key.length>240)||new Set(Object.values(keys)).size!==3)throw Error('Household storage is still loading.');return keys;}
 function validate(snapshot,options){
  if(!object(snapshot)||typeof snapshot.actor!=='string'||!snapshot.actor||typeof snapshot.trip!=='string'||!snapshot.trip||!object(snapshot.stock)||!object(snapshot.inventory)||!object(snapshot.features)||!Array.isArray(snapshot.features.essentials)||typeof options.isHousehold!=='function'||typeof options.reconcile!=='function')throw Error('Household stock is still loading.');
  if(Object.keys(snapshot.stock).length>2000||Object.keys(snapshot.inventory).length>2000||snapshot.features.essentials.length>500)throw Error('Review your saved household list first.');
  return keysFor(options);
 }
 function fingerprint(snapshot){return JSON.stringify(ordered({actor:snapshot.actor,trip:snapshot.trip,session:snapshot.session??null,stock:snapshot.stock,inventory:snapshot.inventory,features:snapshot.features,expected:snapshot.expected||{}}));}
 function scan(snapshot,options={}){
  validate(snapshot,options);const groups=new Map(),pin=fingerprint(snapshot);
  for(const [stockKey,quantity]of Object.entries(snapshot.stock)){
   const at=stockKey.lastIndexOf('|');if(at<1||stockKey.indexOf('|')!==at||!amount(quantity))continue;
   const name=clean(stockKey.slice(0,at)),unit=stockKey.slice(at+1),canonical=nameKey(name,options);
   if(!canonical||!UNITS.has(unit)||options.isHousehold(name)!==true)continue;
   const id=canonical+'|'+unit,group=groups.get(id)||{id,name,unit,sourceQuantity:0,sourceKeys:[],inventoryIds:[],fingerprint:pin};
   group.sourceQuantity+=quantity;group.sourceKeys.push(stockKey);groups.set(id,group);
  }
  for(const group of groups.values()){
   for(const [id,row]of Object.entries(snapshot.inventory)){
    if(!object(row))continue;const linked=group.sourceKeys.includes(row.bb173StockKey)||group.sourceKeys.includes(row.stockKey);
    const unlinked=!row.bb173StockKey&&!row.stockKey&&row.unit===group.unit&&nameKey(row.name,options)===nameKey(group.name,options)&&options.isHousehold(row.name)===true;
    if(linked||unlinked)group.inventoryIds.push(id);
   }
   const related=snapshot.features.essentials.filter(row=>object(row)&&nameKey(row.name,options)===nameKey(group.name,options));
   const matches=related.filter(row=>row.unit===group.unit);
   if(matches.length>1)group.problem='More than one Weekly essentials entry matches. Review those entries first.';
   else if(related.length&&!matches.length)group.problem='Weekly essentials uses a different unit. Review that unit before moving this stock.';
   if(group.sourceQuantity>MAX)group.problem='Review these saved amounts before moving the stock.';
   if(matches.length===1){
    const row=matches[0],q=options.reconcile(row);group.essentialId=row.id;group.existingOwned=amount(row.ownedQty)?row.ownedQty:q.valid&&amount(q.alreadyGot)?q.alreadyGot:null;
    group.targetQty=amount(row.targetQty)?row.targetQty:q.valid&&amount(q.totalNeeded)?q.totalNeeded:null;
    if(typeof row.id!=='string'||!safe(row.id)||group.targetQty===null)group.problem='Review this Weekly essentials target before moving the stock.';
   }else{group.existingOwned=0;group.targetQty=0;}
   group.combinedQuantity=group.existingOwned!==null&&group.sourceQuantity+group.existingOwned<=MAX?group.sourceQuantity+group.existingOwned:null;
   group.defaultTotal=group.sourceQuantity>0?group.sourceQuantity:group.existingOwned??0;
  }
  return [...groups.values()];
 }
 function proposal(snapshot,choice,options={}){
  const keys=validate(snapshot,options);
  if(!object(choice)||choice.fingerprint!==fingerprint(snapshot))throw Error('Your account, shop or stock changed. Reopen this review.');
  const candidate=scan(snapshot,options).find(row=>row.id===choice.id);if(!candidate)throw Error('This household stock changed. Reopen the review.');
  if(candidate.problem)throw Error(candidate.problem);
  const total=choice.totalOwned;if(!amount(total)||!['g','ml'].includes(candidate.unit)&&!Number.isInteger(total))throw Error('Enter a valid total in the displayed unit. Use whole counts for items and packs.');
  if(!object(snapshot.expected)||Object.values(keys).some(key=>!Object.hasOwn(snapshot.expected,key)))throw Error('Reopen this review to check the latest saved stock.');
  const stock=clone(snapshot.stock),inventory=clone(snapshot.inventory),features=clone(snapshot.features);
  for(const key of candidate.sourceKeys)delete stock[key];
  for(const id of candidate.inventoryIds){const row=inventory[id];row.selected=false;row.qty=0;delete row.bb173StockKey;delete row.bb173StockValue;delete row.stockKey;}
  let row=candidate.essentialId?features.essentials.find(row=>row.id===candidate.essentialId):null;
  if(!row){let index=1;while(features.essentials.some(row=>row.id==='household-stock-review-'+index))index++;row={id:'household-stock-review-'+index,name:candidate.name,unit:candidate.unit,qty:1};features.essentials.push(row);}
  Object.assign(row,{targetQty:candidate.targetQty,ownedQty:total,manualPending:true,selected:true});
  const quantities=options.reconcile(row);if(!quantities?.valid)throw Error('Review the household target and unit before saving.');row.owned=quantities.toBuy===0;
  return {ok:true,updates:{[keys.stock]:stock,[keys.inventory]:inventory,[keys.features]:features},expected:{...snapshot.expected},beforeStock:clone(snapshot.stock),stock,candidate,essentialId:row.id,ownedQty:total,toBuy:quantities.toBuy};
 }
 function mergeChanges(base,queue){
  if(!queue)return base;if(!object(queue.updates)||!object(queue.expected))throw Error('Saved stock sync is still loading.');
  const expected={...base.expected},updates={...base.updates};
  for(const [key,value]of Object.entries(queue.expected)){if(Object.hasOwn(expected,key)&&expected[key]!==value)throw Error('Your saved stock changed. Reopen this review.');expected[key]=value;}
  for(const [key,value]of Object.entries(queue.updates)){if(Object.hasOwn(updates,key)&&JSON.stringify(updates[key])!==JSON.stringify(value))throw Error('Your saved stock changed. Reopen this review.');updates[key]=value;}
  return {...base,updates,expected};
 }
 function createController(options={}){
  const doc=options.document||(typeof document==='undefined'?null:document);let mount=null,card=null,destroyed=false,busy=false,lastPin=null,dismissed=null;
  const el=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const format=(value,unit)=>{
   if(value===null)return 'Amount unknown';
   if(typeof options.formatDisplayQty==='function')try{const shown=options.formatDisplayQty(value,unit,{market:options.market||'UK',countMode:'balance'});if(typeof shown==='string'&&shown)return shown;}catch{}
   const measured=['g','ml'].includes(unit),digits=measured?0:1;
   const shown=value>0&&value<(measured?1:.1)?(measured?'<1':'<0.1'):new Intl.NumberFormat(options.market==='US'?'en-US':'en-GB',{maximumFractionDigits:digits}).format(value);
   return shown+' '+unit;
  };
  function render(container=mount){
   if(destroyed||!doc||!container)return;mount=container;if(busy)return;
   let snapshot,candidates;try{snapshot=options.read();candidates=scan(snapshot,options);}catch{card?.remove();card=null;return;}
   const pin=fingerprint(snapshot);if(card?.isConnected&&pin===lastPin)return;
   card?.remove();card=null;lastPin=pin;if(!candidates.length||dismissed===pin)return;
   card=el('section','bb-household-stock-review');card.setAttribute('aria-label','Review household stock');
   Object.assign(card.style,{padding:'18px',margin:'14px 0',borderRadius:'22px',background:'#fff',boxShadow:'0 8px 24px rgba(16,42,29,0.06)',color:'#1B4D33'});
   card.append(el('h3','','Move household items to Weekly essentials'),el('p','','Confirm how much you actually have. Choose Combine only if the two records describe separate amounts.'));
   for(const candidate of candidates){
    const group=el('section','bb-household-stock-review-item');group.style.marginTop='18px';group.append(el('strong','',candidate.name));
    group.append(el('p','','Recorded with food: '+format(candidate.sourceQuantity,candidate.unit)),el('p','','Already in Weekly essentials: '+format(candidate.existingOwned,candidate.unit)));
    const label=el('label','','Total you actually have ('+candidate.unit+')'),input=el('input');input.type='number';input.inputMode=['g','ml'].includes(candidate.unit)?'decimal':'numeric';input.min='0';input.max=String(MAX);input.step=['g','ml'].includes(candidate.unit)?'any':'1';input.value=String(candidate.defaultTotal);input.setAttribute('aria-label','Actual total of '+candidate.name+' in '+candidate.unit);Object.assign(input.style,{minHeight:'44px',width:'100%',boxSizing:'border-box',fontVariantNumeric:'tabular-nums'});label.append(input);group.append(label);
    const buttons=el('div','bb-household-stock-review-choices');Object.assign(buttons.style,{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'10px'});
    const button=(text,action)=>{const node=el('button','btn',text);node.type='button';Object.assign(node.style,{minHeight:'44px',textDecoration:'none'});node.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(!busy)action();});return node;};
    buttons.append(button('Use '+format(candidate.defaultTotal,candidate.unit)+' total',()=>input.value=String(candidate.defaultTotal)));
    if(candidate.sourceQuantity>0&&candidate.existingOwned>0&&candidate.combinedQuantity!==null)buttons.append(button('Combine to '+format(candidate.combinedQuantity,candidate.unit)+' total',()=>input.value=String(candidate.combinedQuantity)));
    const status=el('p','bb-household-stock-review-status',candidate.problem||'');status.setAttribute('role',candidate.problem?'alert':'status');
    const confirm=button('Move to Weekly essentials',async()=>{
     let prepared,controls=[];try{
      if(input.value.trim()==='')throw Error('Enter the total you actually have.');
      const current=options.read();prepared=proposal(current,{id:candidate.id,totalOwned:Number(input.value),fingerprint:candidate.fingerprint},options);
      prepared=mergeChanges(prepared,options.preparePurchasedPantry?.({stock:prepared.stock,beforeStock:prepared.beforeStock,shopSessionId:current.trip}));
      if(typeof options.write!=='function')throw Error('Household saving is still loading.');
      busy=true;controls=[...card.querySelectorAll('button,input')].map(node=>({node,disabled:node.disabled}));for(const {node}of controls)node.disabled=true;status.textContent='Saving household stock…';
      const result=await options.write(prepared.updates,prepared.expected);if(result!==true&&result?.ok!==true)throw Error('Your stock could not be saved. Review it and try again.');
      try{options.onSaved?.(prepared);}catch{}busy=false;lastPin=null;render();
     }catch(error){busy=false;if(card?.isConnected){for(const {node,disabled}of controls)node.disabled=disabled;status.setAttribute('role','alert');status.textContent=error?.message||'Your stock could not be saved.';}}
    });confirm.disabled=!!candidate.problem;buttons.append(confirm);group.append(buttons,status);card.append(group);
   }
   const close=el('button','btn','Not now');close.type='button';close.style.minHeight='44px';close.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(!busy){dismissed=pin;card.remove();card=null;options.onDismiss?.();}});card.append(close);mount.append(card);
  }
  return {render,refresh:()=>render(),destroy(){destroyed=true;card?.remove();card=null;mount=null;}};
 }
 return {scan,proposal,createController,keys:Object.freeze({...KEYS})};
});
