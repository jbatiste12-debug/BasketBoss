/* Conservative shopping avoided by recorded pantry stock. This presentation
 * never writes purchases, stock, account data, storage or analytics. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBShopValue=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const MARKETS=new Set(['UK','Guernsey','Jersey','US']),MAX=1000000;
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=100000&&!/[\u0000-\u001f\u007f]/.test(value);
 const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX;
 const copy=value=>JSON.parse(JSON.stringify(value));
 function context(value){
  if(!object(value)||!text(value.actor)||!MARKETS.has(value.market)||!text(value.sessionId)||!text(value.planKey)||value.retailer!==null&&!text(value.retailer))return null;
  return {actor:value.actor,market:value.market,retailer:value.retailer,sessionId:value.sessionId,planKey:value.planKey};
 }
 const same=(a,b)=>!!a&&!!b&&['actor','market','retailer','sessionId','planKey'].every(key=>a[key]===b[key]);
 function purchased(session){
  if(!object(session)||session.version!==7||!text(session.id))return true;
  for(const key of ['bought','purchases','partials','completedPurchases','completedPurchaseHistory','shelfEdits','reducedPurchases']){
   const rows=session[key];if(rows!==undefined&&!object(rows))return true;
   if(key==='bought'){if(Object.values(rows||{}).some(Boolean))return true;}
   else if(key==='partials'){
    // Closing a trip retains historical partial records. Only evidence for
    // this trip (or an ambiguous record) prevents a new pre-purchase baseline.
    for(const [id,row]of Object.entries(rows||{}))if(id.startsWith(session.id+'|')||!object(row)||!text(row.week)||row.week===session.id)return true;
   }else if(Object.keys(rows||{}).length)return true;
  }
  return false;
 }
 function usable(row){
  return object(row)&&text(row.key||row.name)&&text(row.unit)&&amount(row.required)&&row.required>0&&amount(row.owned)&&row.measured===true&&row.essential!==true&&row.staple!==true&&row.assumed!==true&&row.manual!==true&&row.needsReview!==true&&row.quantityEstimated!==true&&!(row.pantryMismatch?.length)&&!row.bb172Assumed&&!row.needsRecipeReview&&!row.shopOwnedAnchor;
 }
 function quoteCents(value){
  if(!object(value)||value.needsReview===true||value.priceNeeded===true||value.costBasis&&value.costBasis!=='full_packs'||!amount(value.amount))return null;
  const cents=Math.round(value.amount*100);return Number.isSafeInteger(cents)?cents:null;
 }
 function prepare({session,context:pin,rows,quote,canonicalId,hasPurchases=false}={}){
  pin=context(pin);if(!pin||session?.id!==pin.sessionId||purchased(session)||hasPurchases!==false||!Array.isArray(rows)||rows.length>1000||typeof quote!=='function'||typeof canonicalId!=='function')return null;
  const groups=new Map(),unsafe=new Set();
  for(const row of rows){
   let id;try{id=canonicalId(row);}catch{continue;}if(!text(id))continue;
   if(!usable(row)){unsafe.add(id);continue;}
   // Requirements are already aggregated by the app. An exact alias duplicate
   // is one row; conflicting duplicates are withheld rather than added twice.
   const prior=groups.get(id);
   if(prior&&(prior.required!==row.required||prior.owned!==row.owned||prior.unit!==row.unit)){unsafe.add(id);continue;}
   groups.set(id,{...row});
  }
  let coveredCount=0,partialCount=0,pricedCount=0,unknownPriceCount=0,avoidedCents=0;
  for(const [id,row]of groups){
   if(unsafe.has(id)||/^(?:tap |lukewarm )?water(?:\||$)/i.test(id))continue;
   const owned=Math.min(row.required,row.owned);if(!(owned>0))continue;
   const needed=Math.max(0,row.required-owned);
   if(needed<=0.000001)coveredCount++;else partialCount++;
   let full,net;
   try{full=quoteCents(quote(row,row.required));net=needed===0?0:quoteCents(quote(row,needed));}catch{full=null;net=null;}
   if(full===null||net===null||net>full||!Number.isSafeInteger(avoidedCents+full-net)){unknownPriceCount++;continue;}
   pricedCount++;avoidedCents+=full-net;
  }
  if(!coveredCount&&!partialCount)return null;
  return Object.freeze({version:1,...pin,coveredCount,partialCount,pricedCount,unknownPriceCount,estimatedAvoided:avoidedCents/100});
 }
 function create(){
  let baseline=null;const completed=new Set();
  const key=pin=>pin.actor+'|'+pin.market+'|'+pin.sessionId;
  function capture(input){
   const pin=context(input?.context);if(!pin||completed.has(key(pin)))return null;
   // A later purchase, receipt, plan or stock update cannot rewrite this trip.
   if(baseline&&baseline.actor===pin.actor&&baseline.sessionId===pin.sessionId)return same(baseline,pin)?copy(baseline):null;
   baseline=prepare(input);return baseline?copy(baseline):null;
  }
  function preview(pin){pin=context(pin);return pin&&same(baseline,pin)&&!completed.has(key(pin))?copy(baseline):null;}
  function complete(pin){const summary=preview(pin);if(!summary)return null;completed.add(key(summary));if(completed.size>32)completed.delete(completed.values().next().value);baseline=null;return summary;}
  function reset(){baseline=null;}
  return Object.freeze({capture,preview,complete,reset});
 }
 function mount(summary,{document:doc,parent}={}){
  if(!doc||!parent||!context(summary)||summary.version!==1||!Number.isInteger(summary.coveredCount)||!Number.isInteger(summary.partialCount)||summary.coveredCount<0||summary.partialCount<0||!(summary.coveredCount+summary.partialCount)||!amount(summary.estimatedAvoided))return null;
  doc.getElementById('bbShopValueSummary')?.remove();
  const el=(tag,text,className)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const card=el('section',undefined,'bb-shop-value');card.id='bbShopValueSummary';card.setAttribute('role','status');card.setAttribute('aria-labelledby','bbShopValueHeading');
  const title=el('h3','You shopped your kitchen first.');title.id='bbShopValueHeading';
  const close=el('button','×','bb-shop-value__close');close.type='button';close.setAttribute('aria-label','Dismiss pantry value summary');close.addEventListener('click',()=>card.remove());
  const head=el('div',undefined,'bb-shop-value__head');head.append(title,close);card.append(head);
  const n=summary.coveredCount,p=summary.partialCount;
  if(n)card.append(el('p','Your pantry already covered '+n+' planned ingredient'+(n===1?'':'s')+'.'));
  if(p)card.append(el('p',(n?'You also had':'You already had')+' part of '+p+' planned ingredient'+(p===1?'':'s')+'.'));
  if(summary.estimatedAvoided>0){
   const money=new Intl.NumberFormat(summary.market==='US'?'en-US':'en-GB',{style:'currency',currency:summary.market==='US'?'USD':'GBP'}).format(summary.estimatedAvoided);
   card.append(el('p','About '+money+' less to buy at guide prices.','bb-shop-value__amount'));
  }
  if(summary.unknownPriceCount>0)card.append(el('p','No reliable price estimate for '+summary.unknownPriceCount+' of these ingredients.','bb-shop-value__note'));
  card.append(el('p','For the plan when you started this shop, based on recorded pantry amounts and full-pack guide prices. Actual checkout prices may vary.','bb-shop-value__note'));
  parent.insertBefore(card,parent.firstChild);return card;
 }
 return Object.freeze({prepare,create,mount,purchased});
});
