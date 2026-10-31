/* Regional supermarket preferences. Selecting a shop never invents retailer prices. */
(function(root){
 'use strict';
 const PREFIX='basketboss_321_v10_price_retailer_';
 const stores=Object.freeze({
  UK:Object.freeze(['Tesco','Sainsbury’s','Asda','Morrisons','Aldi','Lidl','Waitrose & Partners','M&S Food','Co-op','Iceland','Ocado']),
  Jersey:Object.freeze(['Channel Islands Coop','Waitrose & Partners','Alliance','Morrisons Daily','M&S Food']),
  Guernsey:Object.freeze(['Channel Islands Coop','Waitrose & Partners','Alliance','Morrisons Daily','M&S Food']),
  US:Object.freeze(['Walmart','Kroger','Aldi','Lidl','Target','Costco','Trader Joe’s','Safeway','Publix','Whole Foods Market','H-E-B'])
 });
 const aliases=Object.freeze({'Waitrose':'Waitrose & Partners',"Sainsbury's":'Sainsbury’s',"Trader Joe's":'Trader Joe’s'});
 const remembered=new Map();
 const forRegion=market=>Object.hasOwn(stores,market)?stores[market]:Object.freeze([]);
 function canonical(market,value){
  if(typeof value!=='string')return null;
  const name=Object.hasOwn(aliases,value)?aliases[value]:value;
  return forRegion(market).includes(name)?name:null;
 }
 function getSelected(market){
  if(!Object.hasOwn(stores,market))return null;
  try{
   const selected=canonical(market,root.localStorage.getItem(PREFIX+market));
   remembered.set(market,selected);
   return selected;
  }catch(_){return remembered.get(market)??null;}
 }
 function setSelected(market,value){
  if(!Object.hasOwn(stores,market)||typeof value!=='string')return false;
  const selected=value===''?null:canonical(market,value);
  if(value!==''&&!selected)return false;
  // Prime the last readable value before writing so blocked storage cannot make
  // either picker appear to have accepted a preference that was not saved.
  getSelected(market);
  try{
   if(selected===null)root.localStorage.removeItem(PREFIX+market);
   else root.localStorage.setItem(PREFIX+market,selected);
   remembered.set(market,selected);
   return true;
  }catch(_){return false;}
 }
 const api=Object.freeze({forRegion,getSelected,setSelected});
 root.BBSupermarkets=api;
 if(!root.document)return;
 const doc=root.document;
 let queued=false;
 function activeMarket(){
  try{const market=root.bb307ActiveMarket?.();if(Object.hasOwn(stores,market))return market;}catch(_){}
  return 'Jersey';
 }
 function status(row,text){const node=row.querySelector('[data-bb-supermarket-status]');if(node&&node.textContent!==text)node.textContent=text;}
 function createPicker(kind){
  const row=doc.createElement('div');row.className='bb-supermarket-picker';
  row.dataset.bbSupermarketPicker=kind;
  const label=doc.createElement('label');label.htmlFor='bb-supermarket-'+kind;label.textContent='Where are you shopping?';
  const select=doc.createElement('select');select.id=label.htmlFor;
  select.setAttribute('aria-describedby',select.id+'-help '+select.id+'-status');
  const helper=doc.createElement('p');helper.id=select.id+'-help';helper.className='bb-supermarket-help';
  helper.textContent='Prices use sourced online guides where available, otherwise regional estimates.';
  const message=doc.createElement('p');message.id=select.id+'-status';message.className='bb-supermarket-status';
  message.dataset.bbSupermarketStatus='';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  select.addEventListener('change',()=>{
   const market=activeMarket(),previous=getSelected(market);
   let saved=false;
   try{saved=typeof root.bb307SelectPricingRetailer==='function'&&root.bb307SelectPricingRetailer(select.value)===true;}catch(_){}
   if(!saved){select.value=previous||'';status(row,'Could not save your supermarket. Your previous choice is unchanged.');}
   else status(row,select.value?'Supermarket preference saved.':'Supermarket preference cleared.');
   queue();
  });
  row.append(label,select,helper,message);
  return row;
 }
 function syncPicker(row,market,selected){
  const select=row.querySelector('select');
  if(row.dataset.bbSupermarketMarket!==market){
   const options=[];
   for(const name of ['',...forRegion(market)]){
    const option=doc.createElement('option');option.value=name;option.textContent=name||'Choose supermarket';options.push(option);
   }
   select.replaceChildren(...options);row.dataset.bbSupermarketMarket=market;
   status(row,'');
  }
  const value=selected||'';
  if(select.value!==value)select.value=value;
 }
 function render(){
  queued=false;
  const market=activeMarket(),selected=getSelected(market);
  for(const [kind,host] of [['region',doc.getElementById('bb17RegionCard')],['shopping',doc.querySelector('#app .bb321-shop-summary')],['snapshot',doc.getElementById('bbReleaseShopOverview')],['shopmode',doc.querySelector('#bb172Storefront .bb172-storefront-controls')]]){
   if(!host)continue;
   let row=host.querySelector('[data-bb-supermarket-picker="'+kind+'"]');
   if(!row){row=createPicker(kind);if(kind==='snapshot')host.insertBefore(row,host.querySelector('.bb-r6-begin'));else host.append(row);}
   syncPicker(row,market,selected);
  }
 }
 function queue(){if(queued)return;queued=true;if(root.requestAnimationFrame)root.requestAnimationFrame(render);else root.setTimeout(render,0);}
 function mount(){
  if(!doc.getElementById('bb-supermarkets-style')){
   const style=doc.createElement('style');style.id='bb-supermarkets-style';
   style.textContent='.bb-supermarket-picker{display:grid;grid-template-columns:minmax(0,1fr);grid-column:1/-1;flex:1 0 100%;width:100%;min-width:0;box-sizing:border-box;gap:7px;margin-top:12px;padding-top:12px;border-top:1px solid #dbe6df;text-align:left}.bb-supermarket-picker label{font-size:14px;font-weight:700;color:#224b38}.bb-supermarket-picker select{box-sizing:border-box;width:100%;min-height:44px;padding:9px 11px;border:1px solid #b9ccbf;border-radius:9px;background:#fff;color:#173c2b;font:inherit}.bb-supermarket-picker select:focus-visible{outline:3px solid #268252;outline-offset:2px}.bb-supermarket-picker .bb-supermarket-help,.bb-supermarket-picker .bb-supermarket-status{margin:0;font-size:12px;line-height:1.45;color:#526758}.bb-supermarket-picker .bb-supermarket-status:empty{display:none}';
   (doc.head||doc.documentElement).append(style);
  }
  root.addEventListener('basketboss:market-changed',queue);
  root.addEventListener('basketboss:supermarket-changed',queue);
  root.addEventListener('storage',event=>{if(event.key===null||event.key?.startsWith(PREFIX))queue();});
  if(root.MutationObserver&&doc.body)new root.MutationObserver(queue).observe(doc.body,{childList:true,subtree:true});
  render();
 }
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})(typeof window!=='undefined'?window:globalThis);
