/* The camera reuses the existing consent, Premium and review scanner. Photo
 * estimates never become measured stock until a user enters an amount. */
(function(root,factory){'use strict';const api=factory(typeof module==='object'&&module.exports?require('./bb-scan-food-identity.js'):root?.BBScanFoodIdentity,typeof module==='object'&&module.exports?require('./bb-pantry-policy.js'):root?.BBPantryPolicy);if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.BBPantryCamera=api;api.install(root);}})(typeof window==='undefined'?null:window,function(identity,policy){
 'use strict';
 const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory';
 const aliases={potatoes:'potato',eggs:'egg',tomatoes:'tomato',onions:'onion',peppers:'pepper',carrots:'carrot',bananas:'banana',apples:'apple',lemons:'lemon',limes:'lime',courgettes:'courgette',mushrooms:'mushroom',scallops:'scallop',wraps:'wrap'};
 function stockName(value){let name=String(value||'').toLowerCase().replace(/[–—]/g,'-').replace(/,/g,' ').replace(/\s+/g,' ').trim();if(['oil','vegetable oil'].includes(name))name='cooking oil';if(name.startsWith('x g tin '))name='tinned '+name.slice(8);name=name.replace(/\s+(?:(?:washed|cored|drained) and (?:sliced|rinsed)|(?:thinly|thickly|finely|roughly)\s+(?:chopped|sliced|crushed|grated|diced)|cut into (?:thin )?(?:wedges|pieces|slices|chunks|strips|cubes)|(?:chopped|sliced|crushed|grated|halved|quartered|diced|peeled|shredded|drained|rinsed))$/,'').trim();if(['tinned chopped tomatoes','canned chopped tomatoes','chopped tomatoes canned'].includes(name))name='chopped tomatoes';if(['garlic cloves','garlic clove','small garlic clove'].includes(name))name='garlic';name=aliases[name]||name;if(!name||name.length>140||name.includes('|')||['__proto__','constructor','prototype'].includes(name))throw Error('Review the ingredient name.');return name;}
 const round=n=>Math.round(n*1000000)/1000000;
 function measure(quantity,unit){const value=Number(quantity),base=unit==='kg'?'g':unit==='l'?'ml':unit,amount=value*(unit==='kg'||unit==='l'?1000:1);if(quantity===null||quantity===undefined||String(quantity).trim()===''||!Number.isFinite(amount)||amount<0||amount>1000000||!['g','ml','each','pack','clove','tin','bag','loaf','slice','bulb','tsp','tbsp'].includes(base))throw Error('Enter a valid amount and matching unit.');return {quantity:round(amount),unit:base};}
 const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
 function reviewedFood(food){
  const name=String(food.name||'').trim(),product=identity?.resolve(name,food)||{productName:name,canonicalName:name,approved:false,brand:''};
  if(!name||name.length>140)throw Error('Review the ingredient name.');
  let amount=null,problem='';
  if(food.qty===null)problem='Confirm the amount for every product in this food group.';
  else{
   const unit=String(food.unit||'');
   if(['tin','pack','bag','bottle','jar','pouch'].includes(unit)&&(product.approved||food.packReviewed===true)){
    if(food.packReviewed!==true||!(Number(food.packQuantity)>0)||!['g','kg','ml','l','each'].includes(food.packUnit))problem='Confirm each container’s contents before combining these products.';
    else{amount=policy?.normalize(product.canonicalName,food.qty,unit,{packReviewed:true,packQuantity:food.packQuantity,packUnit:food.packUnit});if(!amount)throw Error('Enter a valid reviewed container size.');}
   }else amount=measure(food.qty,unit);
   if(amount?.quantity>0&&amount.unit==='g'&&product.needsBasis)problem='Confirm whether each tuna amount is net or drained weight.';
  }
  return {name:product.canonicalName,loc:food.loc,product,amount,problem,lot:{productName:product.productName,brand:product.brand,checkedQuantity:food.qty,unit:food.unit,variant:product.variant||'',quantityBasis:product.quantityBasis||'',...(food.packReviewed===true?{packQuantity:Number(food.packQuantity),packUnit:food.packUnit}:{}),...(amount?{quantity:amount.quantity,baseUnit:amount.unit}:{})}};
 }
 function prepare({stock,inventory,foods,uid}){
  if(!object(stock)||!object(inventory)||!Array.isArray(foods)||foods.length>20||typeof uid!=='function')throw Error('Review your saved pantry before saving.');
  const nextStock={},nextInventory=JSON.parse(JSON.stringify(inventory)),seen=new Set();
  for(const [id,quantity]of Object.entries(stock)){const at=id.lastIndexOf('|');if(at<1)throw Error('Review your pantry amounts in At home.');const amount=measure(quantity,id.slice(at+1)),key=stockName(id.slice(0,at))+'|'+amount.unit;nextStock[key]=round((nextStock[key]||0)+amount.quantity);if(nextStock[key]>1000000)throw Error('Review your pantry amounts in At home.');}
  const groups=new Map(),incoming=new Set();
  for(const food of foods){
   const originalId=uid(String(food.name||'').trim(),food.loc);if(seen.has(originalId))throw Error('Review duplicate ingredients.');seen.add(originalId);incoming.add(originalId);
   const row=reviewedFood(food);if(!['fridge','freezer','cupboard'].includes(row.loc))throw Error('Choose a storage location.');
   const key=row.loc+'|'+stockName(row.name),group=groups.get(key)||{name:row.name,loc:row.loc,rows:[]};group.rows.push(row);groups.set(key,group);
  }
  for(const group of groups.values()){
   const {name,loc}=group,canonical=stockName(name),id=uid(name,loc),previous=nextInventory[id]||{},lots=group.rows.map(row=>row.lot);
   let problem=group.rows.find(row=>row.problem)?.problem||'';
   const units=new Set(group.rows.filter(row=>row.amount).map(row=>row.amount.unit)),bases=new Set(group.rows.map(row=>row.product.quantityBasis).filter(Boolean));
   if(units.size>1)problem='Review the units and container sizes before combining these products.';
   if(bases.size>1)problem='Net and drained weights cannot be combined. Review these product amounts.';
   if(group.rows.length>1&&group.rows.some(row=>row.product.needsVariant&&row.amount?.quantity>0))problem='Confirm the packing liquid before combining tuna from different products.';
   if(previous.scanQuantityBasis&&bases.size&& !bases.has(previous.scanQuantityBasis)&&previous.bb173StockValue>0)problem='The saved stock uses a different weight basis. Review the existing total before replacing it.';
   // Retire only unmeasured aliases whose exact product is present in this
   // reviewed snapshot. Previously measured branded stock is never guessed.
   for(const [oldId,old]of Object.entries(nextInventory))if(oldId!==id&&old?.selected!==false&&old.loc===loc&&incoming.has(oldId)){
    const resolved=identity?.resolve(old.name);
    if(resolved?.approved&&resolved.family===group.rows[0].product.family){
     if(old.qty===null||old.qty===undefined||old.qty===''){nextInventory[oldId]={...old,selected:false,qty:null,scanMergedInto:id};}
     else problem='An existing branded amount needs review before it can join this food group.';
    }
   }
   const metadata={scanProductLots:lots,scanNeedsReview:!!problem,scanReviewMessage:problem,scanQuantityBasis:problem&&previous.bb173StockValue>0?previous.scanQuantityBasis||'':bases.size===1?[...bases][0]:'',...(problem&&previous.scanProductLots?.length?{scanPreviousProductLots:previous.scanProductLots}:{})};
   if(problem){nextInventory[id]={...previous,name,loc,selected:true,qty:previous.qty??null,unit:previous.unit||group.rows[0].amount?.unit||group.rows[0].lot.unit||'each',source:'scan',...metadata};continue;}
   const amount={quantity:round(group.rows.reduce((sum,row)=>sum+row.amount.quantity,0)),unit:[...units][0]};if(amount.quantity>1000000)throw Error('Review the combined pantry amount.');
   const stockKey=canonical+'|'+amount.unit,current=nextStock[stockKey]||0;if(previous.selected&&previous.bb173StockKey&&previous.bb173StockKey!==stockKey)throw Error('Review the existing ingredient and unit for '+name+' in At home first.');
   const allocations=Object.entries(nextInventory).filter(([,row])=>row?.selected&&row.bb173StockKey===stockKey&&['fridge','freezer','cupboard'].includes(row.loc));
   let allocated=0,here=0;for(const [,row]of allocations){const value=measure(row.bb173StockValue,stockKey.slice(stockKey.lastIndexOf('|')+1));if(value.unit!==amount.unit)throw Error('Review the saved unit for '+name+' in At home.');allocated+=value.quantity;if(row.loc===loc)here+=value.quantity;}
   if(allocated>current+0.000001||current>allocated+0.000001&&here===0)throw Error('Check '+name+' in At home first: its saved amount has no confirmed location. Leave the scan amount blank to save its name only.');
   const balance=round(current-here+amount.quantity);if(balance<0||balance>1000000)throw Error('Review the pantry balance for '+name+'.');
   if(balance>0)nextStock[stockKey]=balance;else delete nextStock[stockKey];
   for(const [other,row]of allocations)if(row.loc===loc&&other!==id)nextInventory[other]={...row,selected:false,qty:null,bb173StockValue:0};
   nextInventory[id]={...previous,name,loc,selected:amount.quantity>0,qty:amount.quantity,unit:amount.unit,source:'scan',...metadata,...(['g','ml'].includes(amount.unit)?{trackingMode:'measured',measurementReviewed:true}:{}),bb173StockKey:stockKey,bb173StockValue:amount.quantity};
  }
  return {stock:nextStock,inventory:nextInventory,groups:[...groups.values()].map(group=>{const row=nextInventory[uid(group.name,group.loc)];return {name:group.name,loc:group.loc,pending:row.scanNeedsReview,reviewMessage:row.scanReviewMessage};})};
 }
 function commit(store,result,expected){
  const after={[STOCK]:JSON.stringify(result.stock),[INVENTORY]:JSON.stringify(result.inventory)},written=[];
  const unchanged=()=>{for(const [key,value]of Object.entries(expected))if(store.getItem(key)!==(written.includes(key)?after[key]:value))throw Error('Your account or pantry changed. Review the latest amounts before saving.');};
  for(const key of Object.keys(after))if(!Object.hasOwn(expected,key))throw Error('Your pantry needs a fresh review before saving.');
  unchanged();try{for(const [key,value]of Object.entries(after)){unchanged();written.push(key);store.setItem(key,value);if(store.getItem(key)!==value)throw Error('Your pantry could not be saved on this device.');}unchanged();}
  catch(error){for(const key of written.reverse())try{if(store.getItem(key)!==after[key])continue;if(expected[key]===null)store.removeItem(key);else store.setItem(key,expected[key]);}catch{}throw error;}return true;
 }

 function install(win){const doc=win.document;if(!doc)return;let queued=false;
  function refresh(){queued=false;const app=doc.getElementById('app'),host=win.BBPantryCameraHost;const url=new URL(win.location.href);if(host&&url.searchParams.get('bbreturn')==='pantry'){url.searchParams.delete('bbreturn');win.history.replaceState(null,'',url);doc.querySelector('[data-tab="shop"]')?.click();}if(!app||!host||(host.getTab?.()||doc.body.dataset.bbnextView)!=='shop')return;const anchor=app.querySelector('#bb76StorageSections')||app.querySelector('#bb173ShopFridge');if(!anchor||app.querySelector('.bb-pantry-camera-bar'))return;
   const bar=doc.createElement('div');bar.className='bb-pantry-camera-bar';bar.setAttribute('aria-label','Scan pantry ingredients');
   for(const loc of ['fridge','cupboard']){const button=doc.createElement('button');button.type='button';button.className='bb-pantry-camera-button';button.setAttribute('aria-label','Scan '+loc+' ingredients with Premium AI');const icon=doc.createElement('span');icon.setAttribute('aria-hidden','true');icon.textContent='📷';const text=doc.createElement('span');text.textContent=loc==='fridge'?'Fridge':'Cupboard';const badge=doc.createElement('small');badge.textContent='Premium';button.append(icon,text,badge);button.onclick=()=>{const current=win.BBPantryCameraHost;if(current?.isPremium?.()!==true){current?.upgrade?.('AI pantry scanning');return;}const url=new URL('make-a-meal.html',win.location.href);url.searchParams.set('bbscan','pantry');url.searchParams.set('location',loc);url.hash='aiScanner';win.location.assign(url.href);};bar.append(button);}anchor.before(bar);
  }
  function schedule(){if(queued)return;queued=true;queueMicrotask(refresh);}const start=()=>{refresh();new win.MutationObserver(schedule).observe(doc.body,{childList:true,subtree:true});};if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
 }
 return Object.freeze({prepare,commit,measure,stockName,install,STOCK,INVENTORY});
});
