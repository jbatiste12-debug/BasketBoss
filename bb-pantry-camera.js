/* The camera reuses the existing consent, Premium and review scanner. Photo
 * estimates never become measured stock until a user enters an amount. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.BBPantryCamera=api;api.install(root);}})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory';
 const aliases={potatoes:'potato',eggs:'egg',tomatoes:'tomato',onions:'onion',peppers:'pepper',carrots:'carrot',bananas:'banana',apples:'apple',lemons:'lemon',limes:'lime',courgettes:'courgette',mushrooms:'mushroom',scallops:'scallop',wraps:'wrap'};
 function stockName(value){let name=String(value||'').toLowerCase().replace(/[–—]/g,'-').replace(/,/g,' ').replace(/\s+/g,' ').trim();if(['oil','vegetable oil'].includes(name))name='cooking oil';if(name.startsWith('x g tin '))name='tinned '+name.slice(8);name=name.replace(/\s+(?:(?:washed|cored|drained) and (?:sliced|rinsed)|(?:thinly|thickly|finely|roughly)\s+(?:chopped|sliced|crushed|grated|diced)|cut into (?:thin )?(?:wedges|pieces|slices|chunks|strips|cubes)|(?:chopped|sliced|crushed|grated|halved|quartered|diced|peeled|shredded|drained|rinsed))$/,'').trim();if(['tinned chopped tomatoes','canned chopped tomatoes','chopped tomatoes canned'].includes(name))name='chopped tomatoes';if(['garlic cloves','garlic clove','small garlic clove'].includes(name))name='garlic';name=aliases[name]||name;if(!name||name.length>140||name.includes('|')||['__proto__','constructor','prototype'].includes(name))throw Error('Review the ingredient name.');return name;}
 const round=n=>Math.round(n*1000000)/1000000;
 function measure(quantity,unit){const value=Number(quantity),base=unit==='kg'?'g':unit==='l'?'ml':unit,amount=value*(unit==='kg'||unit==='l'?1000:1);if(quantity===null||quantity===undefined||String(quantity).trim()===''||!Number.isFinite(amount)||amount<0||amount>1000000||!['g','ml','each','pack','clove','tin','bag','loaf','slice','bulb','tsp','tbsp'].includes(base))throw Error('Enter a valid amount and matching unit.');return {quantity:round(amount),unit:base};}
 const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
 function prepare({stock,inventory,foods,uid}){
  if(!object(stock)||!object(inventory)||!Array.isArray(foods)||foods.length>20||typeof uid!=='function')throw Error('Review your saved pantry before saving.');
  const nextStock={},nextInventory=JSON.parse(JSON.stringify(inventory)),seen=new Set();
  for(const [id,quantity]of Object.entries(stock)){const at=id.lastIndexOf('|');if(at<1)throw Error('Review your pantry amounts in At home.');const amount=measure(quantity,id.slice(at+1)),key=stockName(id.slice(0,at))+'|'+amount.unit;nextStock[key]=round((nextStock[key]||0)+amount.quantity);if(nextStock[key]>1000000)throw Error('Review your pantry amounts in At home.');}
  for(const food of foods){
   const name=String(food.name||'').trim(),canonical=stockName(name),loc=food.loc;if(!['fridge','freezer','cupboard'].includes(loc))throw Error('Choose a storage location.');
   const id=uid(name,loc);if(seen.has(id))throw Error('Review duplicate ingredients.');seen.add(id);const previous=nextInventory[id]||{};
   if(food.qty===null){nextInventory[id]={...previous,name,loc,selected:true,qty:previous.qty??null,unit:previous.unit||food.unit||'each',source:'scan'};continue;}
   const amount=measure(food.qty,food.unit),stockKey=canonical+'|'+amount.unit,current=nextStock[stockKey]||0;if(previous.selected&&previous.bb173StockKey&&previous.bb173StockKey!==stockKey)throw Error('Review the existing ingredient and unit for '+name+' in At home first.');
   const allocations=Object.entries(nextInventory).filter(([,row])=>row?.selected&&row.bb173StockKey===stockKey&&['fridge','freezer','cupboard'].includes(row.loc));
   let allocated=0,here=0;for(const [,row]of allocations){const value=measure(row.bb173StockValue,stockKey.slice(stockKey.lastIndexOf('|')+1));if(value.unit!==amount.unit)throw Error('Review the saved unit for '+name+' in At home.');allocated+=value.quantity;if(row.loc===loc)here+=value.quantity;}
   if(allocated>current+0.000001||current>allocated+0.000001&&here===0)throw Error('Check '+name+' in At home first: its saved amount has no confirmed location. Leave the scan amount blank to save its name only.');
   const balance=round(current-here+amount.quantity);if(balance<0||balance>1000000)throw Error('Review the pantry balance for '+name+'.');
   if(balance>0)nextStock[stockKey]=balance;else delete nextStock[stockKey];
   for(const [other,row]of allocations)if(row.loc===loc&&other!==id)nextInventory[other]={...row,selected:false,qty:null,bb173StockValue:0};
   nextInventory[id]={...previous,name,loc,selected:amount.quantity>0,qty:amount.quantity,unit:amount.unit,source:'scan',bb173StockKey:stockKey,bb173StockValue:amount.quantity};
  }
  return {stock:nextStock,inventory:nextInventory};
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
