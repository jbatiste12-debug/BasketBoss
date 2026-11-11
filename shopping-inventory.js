/* BasketBoss v17.3 preview: Shopping Fridge tiles share inventory with Make a Meal.
   Only explicitly measured stock reduces the outstanding grocery requirement. */
(()=>{'use strict';
const INVENTORY='basketboss_makeameal_v1_inventory';
const MEASURED='basketboss_321_v7_measured_pantry';
const CONFIRMED='basketboss_ui_next_confirmed_pantry_v1';
const policy=()=>window.BBPantryPolicy;
const isStapleRow=row=>typeof policy()?.isContainerTracked==='function'?policy().isContainerTracked(row):!!policy()?.isStaple(row?.name)&&!(policy().canonicalName(row.name)==='pepper'&&row.unit==='each'&&row.staple!==true);
const policyMarket=()=>window.bb307ActiveMarket?.()||'UK';
const policyOptions=row=>({market:row?.inputMarket||policyMarket(),canonicalize:window.BBPriceV19?.canonical,packReviewed:row?.packReviewed===true,reviewed:row?.packReviewed===true,packQuantity:row?.packQuantity,packUnit:row?.packUnit});
const regionalAmount=(name,quantity,unit)=>window.BBPantryDisplay?.format(name,quantity,unit,policyMarket())||quantity+' '+unit;
const pantryModuleURL=document.currentScript?.src?new URL('./bb-receipt-inventory-core.mjs?v=20261105-business1',document.currentScript.src).href:'./bb-receipt-inventory-core.mjs?v=20261105-business1';
let pantryModulePromise;
const pantryModule=()=>pantryModulePromise??=(window.BBReceiptInventoryCore?Promise.resolve(window.BBReceiptInventoryCore):import(pantryModuleURL));
let pendingFoodDraft=null;
const draftActor=()=>{try{return JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null')?.user?.id||'guest';}catch{return 'guest';}};
const physicalRevision=()=>JSON.stringify([localStorage.getItem(INVENTORY),localStorage.getItem(MEASURED)]);
const ITEMS=[['🥛','Milk'],['🧀','Cheddar'],['🥣','Yoghurt'],['🍖','Ham'],['🧈','Butter'],['🥚','Eggs'],['🍗','Cooked chicken'],['🥛','Cream'],['🧀','Mozzarella'],['🥬','Spinach'],['🥒','Cucumber'],['🥗','Lettuce'],['🥓','Bacon'],['🍄','Mushrooms'],['🍅','Tomatoes'],['🥕','Carrots'],['🧅','Onion'],['🫑','Peppers'],['🥦','Broccoli'],['🧀','Cheese strings']];
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function canon(s){let t=String(s||'').toLowerCase().normalize('NFKC').replace(/\([^)]*\)/g,' ').replace(/[–—-]/g,' ').replace(/[^\p{L}\s]/gu,' ').replace(/\s+/g,' ').trim();const alias={eggs:'egg',tomatoes:'tomato',potatoes:'potato',onions:'onion',carrots:'carrot',peppers:'pepper',mushrooms:'mushroom',yoghurts:'yoghurt'};t=t.replace(/^(cooked|frozen|fresh|raw|chopped|sliced|grated)\s+/,'');if(alias[t])return alias[t];if(t.endsWith('ies'))t=t.slice(0,-3)+'y';else if(t.endsWith('s')&&!t.endsWith('ss'))t=t.slice(0,-1);return alias[t]||t}
const id=s=>'fridge|'+canon(s);
function read(key){try{const x=JSON.parse(localStorage.getItem(key)||'{}');return x&&typeof x==='object'&&!Array.isArray(x)?x:{}}catch{return {}}}
function saveBoth(inventory,measured){const oi=localStorage.getItem(INVENTORY),om=localStorage.getItem(MEASURED);try{const a=JSON.stringify(inventory),b=JSON.stringify(measured);localStorage.setItem(MEASURED,b);localStorage.setItem(INVENTORY,a);if(localStorage.getItem(INVENTORY)!==a||localStorage.getItem(MEASURED)!==b)throw Error('Save verification failed');return true}catch(e){try{if(oi===null)localStorage.removeItem(INVENTORY);else localStorage.setItem(INVENTORY,oi);if(om===null)localStorage.removeItem(MEASURED);else localStorage.setItem(MEASURED,om)}catch{}return false}}
function amount(raw,unit){const n=Number(raw);if(!Number.isFinite(n)||n<0||n>1000000)return null;return n}
function unitConversion(q,u){return {qty:(u==='kg'||u==='l')?q*1000:q,unit:u==='kg'?'g':u==='l'?'ml':['whole','item','piece'].includes(u)?'each':u==='can'?'tin':u}}
function update(item,qty,unit,selected){const inv=read(INVENTORY),measured=read(MEASURED),key=id(item);const prior=inv[key];if(prior?.bb173StockKey&&Number(measured[prior.bb173StockKey])===Number(prior.bb173StockValue))delete measured[prior.bb173StockKey];const next={name:item,loc:'fridge',selected,qty:qty||null,unit:unit||'each'};
 if(qty){const p=unitConversion(qty,unit),stockKey=String(item).trim().toLowerCase().replace(/\s+/g,' ')+'|'+p.unit;next.bb173StockKey=stockKey;next.bb173StockValue=p.qty;measured[stockKey]=p.qty;}
 inv[key]=next;return saveBoth(inv,measured)}
function refreshShop(){const nav=document.querySelector('.tab.active[data-tab="shop"]');if(!nav)return;const top=window.scrollY;nav.click();requestAnimationFrame(()=>window.scrollTo({top,behavior:'instant'}));}
/* Keep custom foods and the existing stock form without duplicating Cupboard cards. */
function placeInventoryFirst(app,panel,fridge){
 const old=app.querySelector('#bb172Cupboard');
 let advanced=panel.querySelector('#bb173CupboardManage');
 if(!advanced){
  advanced=document.createElement('details');
  advanced.id='bb173CupboardManage';advanced.className='bb173-cupboard-manage';
  const label=document.createElement('summary');
  label.textContent='＋ Add or edit cupboard foods & quantities';
  advanced.append(label);panel.append(advanced);
 }
 let foodTiles=old?.querySelector('#bb172CupboardTiles')||app.querySelector('#bb172CupboardTiles');
 if(!foodTiles){foodTiles=document.createElement('div');foodTiles.id='bb172CupboardTiles'}
 advanced.append(foodTiles);
 const details=old?.querySelector('#bb172PantryDetails')||app.querySelector('#bb172PantryDetails');
 if(details)advanced.append(details);
 else{
  const form=app.querySelector('#bb321ManualStock'), section=form?.closest('section');
  if(section){
   const d=document.createElement('details');d.id='bb172PantryDetails';d.className='bb172-pantry-disclosure';
   const sum=document.createElement('summary');sum.textContent='✎ Edit pantry quantities';
   d.append(sum,section);advanced.append(d);
  }
 }
 if(old)old.remove();
 if(app.firstElementChild!==panel)app.prepend(panel);
 if(panel.nextElementSibling!==fridge)panel.insertAdjacentElement('afterend',fridge);
}
function pantryStockId(name,unit){
 /* Same canonical resolver and explicit plural aliases as main BB307Pantry. */
 const raw=String(name||'').trim().toLowerCase().replace(/\s+/g,' ');
 const resolve=window.BBPriceV19?.canonical;
 const canonName=typeof resolve==='function'?resolve(raw):raw;
 const aliases={potatoes:'potato',eggs:'egg',tomatoes:'tomato',onions:'onion',peppers:'pepper',carrots:'carrot',bananas:'banana',apples:'apple',lemons:'lemon',limes:'lime',mushrooms:'mushroom',scallops:'scallop',wraps:'wrap'};
 const n=policy()?.canonicalName(name,resolve)||(typeof resolve==='function'?resolve(aliases[canonName]||canonName):(aliases[canonName]||canonName));
 const u=String(unit||'').trim().toLowerCase();
 const base=u==='kg'?'g':u==='l'?'ml':['whole','item','piece'].includes(u)?'each':u==='can'?'tin':u;
 return n+'|'+base;
}
const BB5_FOODS={
 cupboard:[['🍚','Rice'],['🍝','Pasta'],['🍅','Tinned tomatoes'],['🥫','Tinned beans'],['🫘','Lentils'],['🫒','Cooking oil'],['🧂','Salt'],['🌶️','Pepper'],['🧄','Garlic'],['🌿','Dried herbs'],['🥄','Soy sauce'],['🥖','Breadcrumbs'],['🧊','Stock cubes'],['🥣','Oats'],['🍯','Sugar'],['🥖','Flour'],['🥜','Peanut butter'],['🍯','Honey'],['🥔','Potatoes'],['🥫','Tuna'],['🥫','Chickpeas'],['🍜','Noodles'],['🧂','Paprika'],['🍅','Ketchup'],['🥚','Mayonnaise']],
 fridge:ITEMS,
 freezer:[['🫛','Frozen peas'],['🌽','Frozen sweetcorn'],['🥦','Frozen broccoli'],['🍗','Frozen chicken'],['🐟','Frozen fish'],['🦐','Frozen prawns'],['🍟','Frozen chips'],['🥬','Frozen spinach'],['🥩','Frozen mince'],['🍞','Frozen bread'],['🫐','Frozen berries'],['🍖','Frozen sausages'],['🍲','Frozen leftovers'],['🧊','Frozen mixed vegetables'],['🥔','Frozen potato wedges']]
};
const BB5_LOCATIONS=['cupboard','fridge','freezer'];
const BB5_UNITS=['each','g','kg','ml','l','cup','oz','lb','fl oz','pack','bag','pint','clove','bulb','tin','can','bottle','jar','tbsp','tsp','loaf','slice','whole','item','piece'];
const BB5_CONTENT_UNITS=['g','ml','each','oz','lb','fl oz'];
const entryUnits=()=>policyMarket()==='US'?['each','cup','oz','lb','fl oz','pint',...BB5_UNITS]:BB5_UNITS.filter(unit=>!['cup','oz','lb','fl oz'].includes(unit));
let bb5RequirementsCache=null;
function bb5Requirements(){if(!bb5RequirementsCache){bb5RequirementsCache=window.BBHomeHost?.requirements?.()||[];queueMicrotask(()=>{bb5RequirementsCache=null;});}return bb5RequirementsCache;}
function bb5PlannedRequirements(name){
 const wanted=pantryStockId(name,''),groups=new Map();
 for(const row of bb5Requirements()){
  const food=row.key||row.name;
  // New food suggestions use the same protected-name comparison as stock
  // reconciliation. Saved names, quantities and units keep their identities.
  if(pantryStockId(food,'')!==wanted&&policy()?.stockCompatible?.(name,food,window.BBPriceV19?.canonical)!==true)continue;
  const base=policy()?.normalize(row.key||row.name,Number(row.required),row.unit,policyOptions(row)),measured=base?{qty:base.quantity,unit:base.unit}:unitConversion(Number(row.required),String(row.unit||'').trim().toLowerCase());
  if(!BB5_UNITS.includes(measured.unit)||!Number.isFinite(measured.qty)||measured.qty<=0)continue;
  groups.set(measured.unit,(groups.get(measured.unit)||0)+measured.qty);
 }
 return [...groups].map(([unit,qty])=>({unit,qty}));
}
function bb5WeekCoverage(row){
 if(isStapleRow(row))return null;
 const needed=bb5PlannedRequirements(row.name),current=unitConversion(1,row.unit);
 const matching=needed.find(x=>x.unit===current.unit);
 const coverage=matching?{qty:matching.qty/current.qty,unit:row.unit}:needed.length===1?needed[0]:null;
 // A sole known recipe unit is safe to offer explicitly. Never combine unlike units.
 if(!coverage||needed.length!==1)return null;
 const target=Number(window.BBHome?.total?.(row.name,coverage.unit));
 if(Number.isFinite(target)&&target>=0)coverage.qty=Math.max(coverage.qty,target);
 // Online Pantry accepts whole counts. State the full amount the user is declaring.
 const count=['each','pack','clove','bulb','tin','loaf','slice'].includes(unitConversion(1,coverage.unit).unit);
 return {...coverage,name:row.name,qty:count?Math.ceil(coverage.qty):coverage.qty,count};
}
function bb5CoverageText(coverage){return coverage.count?'I have '+coverage.qty+' '+coverage.unit+' · enough for this week':'Enough for this week ('+regionalAmount(coverage.name,coverage.qty,coverage.unit)+')';}
function bb5AlreadyEnough(row,coverage){return coverage&&row.qty!==null&&row.qty!==''&&Number(row.qty)>=coverage.qty&&row.unit===coverage.unit;}
function bb5AmountReadout(row){
 if(isStapleRow(row)){
  const status=policy().stapleStatus(row),label=policy().containerLabel(row.name);
  return status==='in'?'In stock · recipe spoonfuls do not reduce the container':status==='low'?'Low · restock 1 '+label:status==='out'?'Out · restock 1 '+label:'Choose In Stock, Low or Out';
 }
 if(policy()){
  const actual=row.qty===null||row.qty===undefined||row.qty===''?null:policy().normalize(row.name,Number(row.qty),row.unit,policyOptions(row));
  const needed=bb5PlannedRequirements(row.name);
  if(actual){
   const target=Math.max(needed.find(value=>value.unit===actual.unit)?.qty||0,window.BBHome?.total?.(row.name,actual.unit)||0);
   const quantity=Math.max(0,Math.round((target-actual.quantity)*1000000)/1000000),hint=actual.estimated?' · '+actual.assumption:row.packEstimated&&row.packAssumption?' · '+row.packAssumption:'';
   const containers=row.containerUnit&&row.packQuantity>0&&row.packUnit===actual.unit?' · '+Math.round(actual.quantity/row.packQuantity*1000000)/1000000+' '+row.containerUnit+(actual.quantity/row.packQuantity===1?'':'s')+' ('+actual.quantity+' '+actual.unit+')':'';
   return 'At home: '+regionalAmount(row.name,actual.quantity,actual.unit)+' · To buy: '+regionalAmount(row.name,quantity,actual.unit)+containers+hint;
  }
  if(row.qty!==null&&row.qty!==undefined&&row.qty!=='')return 'Review this unit or enter the container contents. Your saved stock stays intact.';
 }
 const coverage=bb5WeekCoverage(row),current=unitConversion(1,row.unit);
 if(coverage&&unitConversion(1,coverage.unit).unit!==current.unit)return 'Shopping uses '+coverage.unit+'; check the unit';
 const needed=Math.max(Number(window.BBHome?.total?.(row.name,row.unit)??0),window.BBHome?.requirement?.(row.name,row.unit)||0);
 return 'To buy: '+Math.max(0,needed-Number(row.qty||0))+(row.qty===null||row.qty===undefined||row.qty===''?' (amount unknown)':'');
}
/* Beta QA: unit suggestions apply ONLY to new/unmeasured Kitchen selections.
   Preserve all existing saved units and quantities, including manual changes. */
function bb5SuggestedUnit(name){
 if(policy()?.isStaple(name))return 'each';
 const needed=bb5PlannedRequirements(name);if(needed.length===1)return needed[0].unit;
 const n=String(name||'').toLowerCase();
 /* BB-DAIRY-DEFAULTS-20261026-V2 */
 if(/\bparmesan\b/.test(n))return 'g';
 if(/\b(?:garlic|cloves?)\b/.test(n))return 'clove';
 if(/\b(?:aubergines?|courgettes?|(?:red |mixed |bell )?peppers?|onions?|cucumbers?|sweet potatoes?|baking potatoes?|avocados?)\b/.test(n))return 'each';
 if(/\b(?:stock cubes?|bouillon cubes?|cheese strings?|eggs?|onions?|lemons?|limes?|apples?|bananas?|peppers|(?:bell|mixed) pepper|bagels?|wraps?|bread slices?|loaves?)\b/.test(n))return 'each';
 if(/\b(?:milk|cream|cooking oil|olive oil|soy sauce|vinegar|juice|liquid stock|syrup|ketchup)\b/.test(n))return 'ml';
 if(/\b(?:fish fillets?|frozen bread|crisps packs?)\b/.test(n))return 'pack';
 if(/\b(?:rice|pasta|lentils?|cheese|cheddar|mozzarella|broccoli|spinach|peas|carrots?|potatoes|flour|sugar|oats|beans|noodles|chicken|beef|lamb|ham|butter|yoghurt|berries|mushrooms|tomatoes|tuna|chickpeas|breadcrumbs|salt|bacon|fish|prawns|chips|lettuce|cucumber|mayonnaise|honey|peanut butter|sweetcorn|mixed vegetables|sausages|leftovers|paprika|herbs?|pepper|chilli|spices?|mince|wedges)\b/.test(n))return 'g';
 return 'each'; /* Unknown foods remain editable in PANTRY: no invented conversion. */
}

async function build(){
 const app=document.getElementById('app'),panel=document.getElementById('bb172StaplesPanel');
 const active=document.querySelector('.tab.active')?.dataset.tab;
 if(active!=='shop'||!app||!panel||panel.dataset.bb5BulkInventoryApplied)return;
 panel.dataset.bb5BulkInventoryApplied='1';
 panel.dataset.bb173ShopFridgeApplied='1';
 const openingActor=draftActor(),openingRevision=physicalRevision(),openingSession=localStorage.getItem('basketboss_cloud_session_v1');
 let normalizeState=null,openingState={inventory:read(INVENTORY),stock:read(MEASURED),issues:[]};
 if(policy())try{
  const module=await pantryModule();
  if(draftActor()!==openingActor||localStorage.getItem('basketboss_cloud_session_v1')!==openingSession||physicalRevision()!==openingRevision||document.getElementById('bb172StaplesPanel')!==panel||document.querySelector('.tab.active')?.dataset.tab!=='shop'){
   delete panel.dataset.bb5BulkInventoryApplied;return;
  }
  if(typeof module.normalizePantryState==='function'){normalizeState=module.normalizePantryState;openingState=normalizeState(openingState.stock,openingState.inventory,{canonicalize:window.BBPriceV19?.canonical,market:policyMarket()});}
 }catch{openingState.issues=[{message:'Container conversions need review. Existing stock has been kept.'}];}
 const card=document.createElement('section');card.id='bb173ShopFridge';card.className='bb173-shop-fridge bb5-multi-inventory bb75-simple-kitchen';
 card.innerHTML=`<header class="bb173-shop-header bb76-kitchen-intro"><div class="bb76-title"><div><p class="bb76-eyebrow">KITCHEN · UI-NEXT 7.6.1</p><h2>What have you got already?</h2><p>Choose the food you already have. Open each area, tap your ingredients, then check the amounts in <strong>PANTRY</strong>.</p></div><button type="button" id="bb76JumpPantry" class="bb76-view-pantry">View PANTRY <span id="bb76JumpCount">0</span> ↓</button></div></header>
 <div id="bb76StorageSections" class="bb76-storage" aria-label="Select food by storage area">
 <details class="bb76-store" data-bb76-store="cupboard" open><summary><span class="bb76-store-icon">🥫</span><span class="bb76-store-heading"><strong>What's in your Cupboard?</strong><small>Dry goods, tins and everyday staples</small></span><span class="bb76-store-right"><span data-bb76-count="cupboard">0 selected</span><span class="bb76-chevron" aria-hidden="true">⌄</span></span></summary><div class="bb76-store-body"><div class="bb173-shop-tiles" data-bb76-tiles="cupboard" aria-label="Choose cupboard foods"></div><form class="bb173-shop-add bb76-add-food" data-bb76-add="cupboard"><label class="wide">Can't see it? Add a cupboard food<input name="name" maxlength="70" placeholder="e.g. Hummus" required></label><button type="submit">＋ Add food</button></form></div></details>
 <details class="bb76-store" data-bb76-store="fridge"><summary><span class="bb76-store-icon">🥛</span><span class="bb76-store-heading"><strong>What's in your Fridge?</strong><small>Fresh foods, dairy and chilled items</small></span><span class="bb76-store-right"><span data-bb76-count="fridge">0 selected</span><span class="bb76-chevron" aria-hidden="true">⌄</span></span></summary><div class="bb76-store-body"><div class="bb173-shop-tiles" data-bb76-tiles="fridge" aria-label="Choose fridge foods"></div><form class="bb173-shop-add bb76-add-food" data-bb76-add="fridge"><label class="wide">Can't see it? Add a fridge food<input name="name" maxlength="70" placeholder="e.g. Hummus" required></label><button type="submit">＋ Add food</button></form></div></details>
 <details class="bb76-store" data-bb76-store="freezer"><summary><span class="bb76-store-icon">❄️</span><span class="bb76-store-heading"><strong>What's in your Freezer?</strong><small>Frozen foods and leftovers</small></span><span class="bb76-store-right"><span data-bb76-count="freezer">0 selected</span><span class="bb76-chevron" aria-hidden="true">⌄</span></span></summary><div class="bb76-store-body"><div class="bb173-shop-tiles" data-bb76-tiles="freezer" aria-label="Choose freezer foods"></div><form class="bb173-shop-add bb76-add-food" data-bb76-add="freezer"><label class="wide">Can't see it? Add a freezer food<input name="name" maxlength="70" placeholder="e.g. Frozen berries" required></label><button type="submit">＋ Add food</button></form></div></details>
 </div>
 <section class="bb174-fridge-review" id="bb8WhatIHave" aria-label="Pantry: all selected foods"><div class="bb174-fridge-review-head"><div class="bb75-pantry-head"><h3 tabindex="-1" id="bb76PantryHeading">PANTRY <span id="bb5SelectedCount"></span></h3><span id="bb75DraftIndicator">Review quantities</span></div><p><strong>What you've selected</strong> from Cupboard, Fridge and Freezer. Enter what you have, or choose <strong>Enough for this week</strong> to record the amount your planned meals need. Unknown amounts are saved but do not reduce Shopping.</p></div>
 <div id="bb5SelectedRows" aria-live="polite"></div><button type="button" id="bb5Reconcile" class="bb174-fridge-reconcile">✓ Confirm &amp; Reconcile Shopping List</button>
 <p class="bb174-fridge-explain">Only recognised measured quantities reduce what's left to buy. Other foods stay in PANTRY. Nothing is marked as bought.</p>
 <p id="bb5StockStatus" class="bb173-shop-note" role="status" aria-live="polite">Select your food above, review the quantities, then confirm.</p>
 <details class="bb8-inventory-help"><summary>How does Pantry work?</summary><ol><li>Expand Cupboard, Fridge or Freezer and tap the foods you already have.</li><li>See every selected food together in the <strong>PANTRY</strong> list.</li><li>Set actual quantities in PANTRY, or leave an amount unknown.</li><li>Tap <strong>Confirm &amp; Reconcile Shopping List</strong>. BasketBoss saves measured stock and calculates what's left to buy.</li><li>For meal ideas instead, go to Cook → Make a Meal.</li></ol><a href="basketboss-latest-guide.html">Full BasketBoss guide →</a></details></section>`;
 const review=card.querySelector('#bb8WhatIHave'),rows=review.querySelector('#bb5SelectedRows'),note=review.querySelector('#bb5StockStatus'),reconcile=review.querySelector('#bb5Reconcile');
 const staged=new Map(),stagedTargets=new Map();let draftDirty=false;let openedRevision=physicalRevision();const openedActor=draftActor();
 let autoTimer=null,saving=null,movingReduced=false;
 const live=()=>window.BBPantryLiveSync===true;
 function scheduleAuto(){if(!live()||!draftDirty)return;clearTimeout(autoTimer);autoTimer=setTimeout(()=>{autoTimer=null;void runSave(true);},350);}
 function runSave(automatic=false){
  if(autoTimer!==null)clearTimeout(autoTimer);autoTimer=null;
  if(automatic&&(!live()||!draftDirty||!card.isConnected||document.querySelector('.tab.active')?.dataset.tab!=='shop'))return Promise.resolve();
  if(saving)return saving.then(()=>draftDirty&&card.isConnected?runSave(automatic):undefined);
  if(automatic&&[...staged.values()].some(row=>row.qty!==null&&row.qty!==undefined&&(String(row.qty).trim()===''||!Number.isFinite(Number(row.qty))||Number(row.qty)<0||Number(row.qty)>1000000||row.staple&&Number(row.qty)>10000))){note.textContent='Enter a valid amount to update Shopping. Existing stock has been kept.';return Promise.resolve();}
  const savedDraft=JSON.stringify([...staged]);
  saving=reconcilePantry(automatic).finally(()=>{saving=null;if(draftDirty&&card.isConnected&&JSON.stringify([...staged])!==savedDraft)scheduleAuto();});return saving;
 }
 if(live()){window.BBPantryLive={flush:()=>runSave(true),hasPending:()=>draftDirty,householdChanged:()=>{draftDirty=true;scheduleAuto();}};reconcile.textContent='Update Shopping now';card.querySelectorAll('li')[3].textContent='Valid amounts save automatically and update Shopping. Done saves pending picker changes.';note.textContent='Valid changes update Shopping automatically.';review.querySelector('.bb174-fridge-review-head p').textContent='Set actual quantities or staple status. Valid edits save automatically; Done saves any pending picker changes.';review.querySelector('.bb174-fridge-explain').textContent='Known quantities reduce what is left to buy. Unknown amounts and containers stay visible for review.';}
 function sid(loc,name){return loc+'|'+(policy()?.canonicalName(name,window.BBPriceV19?.canonical)||canon(name))}
 const draftKeys=(loc,name)=>[...staged].filter(([,row])=>sid(row.loc,row.name)===sid(loc,name)).map(([key])=>key);
 function stageValue(rec,inventoryId){
  const row={...rec,name:String(rec.name),loc:rec.loc,qty:rec.qty??null,unit:rec.unit||'each',inventoryId,inputMarket:rec.inputMarket||policyMarket()};
  // Inventory is stock only. Explicit targets live in a separate staged map,
  // so obsolete total fields on old inventory rows can never create demand.
  delete row.totalNeeded;delete row.targetChanged;
  if(policy()&&!isStapleRow(row)){
   const source=row.containerUnit||[...(row.pantrySourceHistory||[])].reverse().find(value=>['tin','can','bag','pack','pint'].includes(value.unit))?.unit;
   if(source){
    row.containerUnit=source;const pack=policy().defaultPack(row.name,source,policyOptions(row));
    if(pack&&!row.packReviewed){row.packQuantity=pack.quantity;row.packUnit=pack.unit;row.packReviewed=true;row.packEstimated=true;row.packAssumption=pack.assumption;}
   }
  }
  if(isStapleRow(row)){
   row.staple=true;row.stapleStatus=policy().stapleStatus(row,openingState.stock);
   row.qty=row.stapleStatus==='out'?0:['each','bottle','jar','pack','bag','tin','can'].includes(row.unit)&&Number(row.qty)>0?Number(row.qty):row.stapleStatus==='in'||row.stapleStatus==='low'?1:null;
   row.unit='each';delete row.totalNeeded;delete row.targetChanged;
  }else if(row.trackingMode==='measured'&&row.measurementReviewed===true){
   row.staple=false;delete row.stapleStatus;delete row.stapleCount;delete row.containerLabel;
  }
  return row;
 }
 for(const [inventoryId,rec]of Object.entries(openingState.inventory))if(rec?.selected&&BB5_LOCATIONS.includes(rec.loc)&&rec.name){
  const key=policy()?inventoryId:sid(rec.loc,rec.name);staged.set(key,stageValue(rec,key));
 }
 // Include existing measured stock from the original pantry form so nothing
 // disappears when that redundant form is hidden from Kitchen.
 const existingInventory=openingState.inventory,existingMeasured=openingState.stock;
 const managedStock=new Set(Object.values(existingInventory).filter(x=>x?.bb173StockKey).map(x=>x.bb173StockKey));
 const externalAtOpen=new Map();
 for(const [stockKey,value] of Object.entries(existingMeasured)){
  const divider=stockKey.lastIndexOf('|'),qty=Number(value);
  if(divider<1||!Number.isFinite(qty)||qty<=0||managedStock.has(stockKey))continue;
  const name=stockKey.slice(0,divider).trim(),unit=stockKey.slice(divider+1);
  if(!name||!BB5_UNITS.includes(unit))continue;
  externalAtOpen.set(stockKey,qty);
  const known=[...staged.values()].find(x=>pantryStockId(x.name,x.unit)===pantryStockId(name,unit));
  if(known)continue;
  const loc=BB5_LOCATIONS.find(place=>BB5_FOODS[place].some(([,preset])=>canon(preset)===canon(name)))||'cupboard';
  const key=sid(loc,name);
  if(!staged.has(key))staged.set(key,stageValue({name,loc,qty,unit},key));
 }

 if(pendingFoodDraft){
  if(pendingFoodDraft.actor===openedActor&&pendingFoodDraft.revision===openedRevision){staged.clear();for(const [key,value]of pendingFoodDraft.rows)staged.set(key,{...value});for(const [key,value]of pendingFoodDraft.targets||[])stagedTargets.set(key,{...value});draftDirty=true;}
  else{pendingFoodDraft=null;note.textContent='At home changed. Review the latest amounts before confirming.';}
 }
 function drawOverview(){
  if(draftDirty)pendingFoodDraft={actor:openedActor,revision:openedRevision,rows:[...staged].map(([key,value])=>[key,{...value}]),targets:[...stagedTargets].map(([key,value])=>[key,{...value}])};
  review.querySelector('#bb75DraftIndicator').textContent=live()?(draftDirty?'Updating Shopping…':'Shopping up to date'):(draftDirty?'Not confirmed yet':'Review and confirm');
  if(draftDirty)scheduleAuto();
  editorEvent('amount');
 }
 function editorEvent(type,key){
  if(typeof window.dispatchEvent==='function'&&typeof window.CustomEvent==='function')window.dispatchEvent(new window.CustomEvent('bb:pantry-editor',{detail:{type,key}}));
 }
 function drawAmount(key,input){
  const value=staged.get(key),row=input.closest('[data-bb5-row]');row.querySelector('output').textContent=bb5AmountReadout(value);
  const coverage=bb5WeekCoverage(value),action=row.querySelector('[data-bb5-enough]');
  if(action&&coverage){action.textContent=bb5CoverageText(coverage);action.hidden=bb5AlreadyEnough(value,coverage);}
 }
 function render(){
  const existing=Object.values(read(INVENTORY));
  for(const loc of BB5_LOCATIONS){
   const tiles=card.querySelector(`[data-bb76-tiles="${loc}"]`),preset=BB5_FOODS[loc];
   const custom=[...new Map([...existing,...staged.values()].filter(x=>x?.name&&x.loc===loc&&!preset.some(([,n])=>canon(n)===canon(x.name))).map(x=>[canon(x.name),['✏️',x.name]])).values()];
   tiles.innerHTML=[...preset,...custom].map(([emoji,name])=>{
    const visual=window.BBFoodVisuals?.html(name,{context:'pantry',variant:'tile',emoji})||`<span class="bb173-emoji" aria-hidden="true">${esc(emoji)}</span>`;
    const on=draftKeys(loc,name).length>0;return `<button type="button" data-bb5-food="${esc(name)}" aria-pressed="${on}">${visual}<span>${esc(name)}</span><small>${on?'✓ Selected':'Tap to add'}</small></button>`;
   }).join('');
   const count=[...staged.values()].filter(x=>x.loc===loc).length;
   card.querySelector(`[data-bb76-count="${loc}"]`).textContent=`${count} item${count===1?'':'s'}`;
  }
  const all=[...staged.values()].sort((a,b)=>BB5_LOCATIONS.indexOf(a.loc)-BB5_LOCATIONS.indexOf(b.loc)||a.name.localeCompare(b.name));
  review.querySelector('#bb5SelectedCount').textContent=`(${all.length})`;
  card.querySelector('#bb76JumpCount').textContent=String(all.length);
  rows.innerHTML=all.length?BB5_LOCATIONS.map(loc=>{
   const own=all.filter(x=>x.loc===loc);
   if(!own.length)return '';
   const label=loc==='cupboard'?'🥫 Cupboard':loc==='fridge'?'🥛 Fridge':'❄️ Freezer';
   return `<div class="bb75-pantry-group" data-pantry-location="${loc}"><h4>${label} <small>${own.length} item${own.length===1?'':'s'}</small></h4>${own.map(x=>{
    const k=x.inventoryId||sid(x.loc,x.name),coverage=bb5WeekCoverage(x),opts=[...new Set([...entryUnits(),x.unit])].map(u=>`<option value="${esc(u)}" ${x.unit===u?'selected':''}>${u==='l'?'litres':esc(u)}</option>`).join('');
    const enough=coverage?`<button type="button" class="bb5-week-coverage" data-bb5-enough="${esc(k)}"${bb5AlreadyEnough(x,coverage)?' hidden':''}>${esc(bb5CoverageText(coverage))}</button>`:'';
    if(isStapleRow(x)){
     const status=x.stapleStatus||policy().stapleStatus(x),label=policy().containerLabel(x.name),statusOptions=(status==='unknown'?[['unknown','Review status']]:[]).concat([['in','In Stock'],['low','Low'],['out','Out']]).map(([value,title])=>`<option value="${value}" ${status===value?'selected':''}>${title}</option>`).join('');
     return `<div class="bb174-fridge-row bb5-review-row" data-bb5-row="${esc(k)}" data-bb5-staple="true"><strong>${esc(x.name)}</strong><label>Stock status<select data-bb5-staple-status="${esc(k)}" aria-label="Stock status for ${esc(x.name)}">${statusOptions}</select></label><label>${esc(label.charAt(0).toUpperCase()+label.slice(1))} amount (optional)<input type="number" inputmode="decimal" data-bb5-qty="${esc(k)}" min="0" max="10000" step="any" placeholder="Status only" value="${esc(x.qty??'')}"></label><label hidden>Unit<select data-bb5-unit="${esc(k)}"><option value="each" selected>each</option></select></label><output data-bb5-buy="${esc(k)}">${esc(bb5AmountReadout(x))}</output><small class="bb5-staple-note">Partly used containers are allowed, such as 0.5 ${esc(label)}. Purchases round up to whole containers.</small><button type="button" data-bb5-remove="${esc(k)}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`;
    }
    const packEditor=policy()?`<details class="bb5-pack-editor"><summary>Set container contents</summary><p>Use the size on your pack to replace a regional default or review an unknown container.</p><label>One container contains<input type="number" inputmode="decimal" min="0.000001" max="1000000" step="any" data-bb5-pack-quantity="${esc(k)}" value="${esc(x.packReviewed?x.packQuantity??'':'')}"></label><label>Contents unit<select data-bb5-pack-unit="${esc(k)}"><option value="">Choose unit</option>${(policyMarket()==='US'?BB5_CONTENT_UNITS:['g','ml','each']).map(unit=>`<option value="${unit}" ${x.packReviewed&&x.packUnit===unit?'selected':''}>${unit}</option>`).join('')}</select></label></details>`:'';
    return `<div class="bb174-fridge-row bb5-review-row" data-bb5-row="${esc(k)}"><strong>${esc(x.name)}</strong><label>Already got<input type="number" inputmode="decimal" data-bb5-qty="${esc(k)}" min="0" max="1000000" step="any" placeholder="Unknown" value="${esc(x.qty??'')}"></label><label>Unit<select data-bb5-unit="${esc(k)}">${opts}</select></label>${enough}<output data-bb5-buy="${esc(k)}">${esc(bb5AmountReadout(x))}</output>${packEditor}<button type="button" data-bb5-remove="${esc(k)}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`;
   }).join('')}</div>`;
  }).join(''):'<p class="bb174-fridge-empty">Nothing selected yet. Open a section above and tap the foods you have.</p>';
  reconcile.disabled=!all.length&&!Object.values(read(INVENTORY)).some(x=>x?.selected&&BB5_LOCATIONS.includes(x.loc))&&!externalAtOpen.size;
  drawOverview();
 }
 card.querySelectorAll('.bb76-store').forEach(section=>section.addEventListener('toggle',()=>{
  if(section.open)card.querySelectorAll('.bb76-store').forEach(other=>{if(other!==section)other.open=false});
 }));
 card.querySelector('#bb76JumpPantry').addEventListener('click',()=>{
  review.scrollIntoView({behavior:'smooth',block:'start'});
  review.querySelector('#bb76PantryHeading').focus({preventScroll:true});
 });
 card.querySelector('#bb76StorageSections').addEventListener('click',e=>{
  const btn=e.target.closest('[data-bb5-food]');if(!btn)return;
  const loc=btn.closest('[data-bb76-store]')?.dataset.bb76Store;
  if(!BB5_LOCATIONS.includes(loc))return;
  const name=btn.dataset.bb5Food,k=sid(loc,name),matching=draftKeys(loc,name);
  if(matching.length)matching.forEach(key=>staged.delete(key));
  else{const old=openingState.inventory[k],staple=policy()?.isStaple(name);staged.set(k,stageValue({name,loc,qty:old?.selected?old.qty??null:staple?1:null,unit:old?.selected?(old.unit||bb5SuggestedUnit(name)):bb5SuggestedUnit(name),...(staple?{staple:true,stapleStatus:'in'}:{})},k))}
  draftDirty=true;render();note.textContent=live()?'Selection updated. Enter an amount in PANTRY to update Shopping.':'Selection updated. Review amounts in PANTRY before confirming.';
 });
 card.querySelector('#bb76StorageSections').addEventListener('submit',e=>{
  const f=e.target.closest('[data-bb76-add]');if(!f)return;e.preventDefault();
  const loc=f.dataset.bb76Add,name=f.elements.name.value.trim(),k=sid(loc,name);
  if(!BB5_LOCATIONS.includes(loc)||!name||!canon(name))return;
  if(window.BBKitchenChoiceRules?.isHousehold(name)){note.textContent='Add household items in Weekly essentials instead.';return;}
  if(!draftKeys(loc,name).length){const staple=policy()?.isStaple(name);staged.set(k,stageValue({name,loc,qty:staple?1:null,unit:bb5SuggestedUnit(name),...(staple?{staple:true,stapleStatus:'in'}:{})},k));}
  let groupNote='';
  const group=window.BBPantryGroupsUI?.active(loc);
  if(group&&group!=='all'&&draftActor()===openedActor)try{const api=window.BBPantryGroups;api.assign(loc,api.itemKey(name),group,api.context());}catch{groupNote=' Choose its subcategory again in the item menu.';}
  f.reset();draftDirty=true;render();note.textContent='Food added to '+loc+'. Enter its amount in PANTRY below.'+groupNote;
 });
 rows.addEventListener('input',e=>{
  const pack=e.target.dataset.bb5PackQuantity;if(pack&&staged.has(pack)){const row=staged.get(pack);row.packQuantity=e.target.value===''?null:Number(e.target.value);row.packReviewed=Number(row.packQuantity)>0&&BB5_CONTENT_UNITS.includes(row.packUnit);draftDirty=true;drawAmount(pack,e.target);drawOverview();return;}
  const k=e.target.dataset.bb5Qty;if(!k||!staged.has(k))return;const row=staged.get(k);row.qty=e.target.value;
  if(row.staple&&row.qty!==''){if(Number(row.qty)===0)row.stapleStatus='out';else if(row.stapleStatus==='out'||row.stapleStatus==='unknown')row.stapleStatus='in';const status=e.target.closest('[data-bb5-row]').querySelector('[data-bb5-staple-status]');if(status)status.value=row.stapleStatus;}
  draftDirty=true;drawAmount(k,e.target);drawOverview();
 });
 rows.addEventListener('change',e=>{
  const statusKey=e.target.dataset.bb5StapleStatus;
  if(statusKey&&staged.has(statusKey)){const row=staged.get(statusKey);if(!['in','low','out'].includes(e.target.value))return;row.stapleStatus=e.target.value;if(row.stapleStatus==='out')row.qty=0;else if(!(Number(row.qty)>0))row.qty=1;draftDirty=true;render();return;}
  const pack=e.target.dataset.bb5PackUnit;if(pack&&staged.has(pack)){const row=staged.get(pack);row.packUnit=e.target.value;row.packReviewed=Number(row.packQuantity)>0&&BB5_CONTENT_UNITS.includes(row.packUnit);draftDirty=true;drawAmount(pack,e.target);drawOverview();return;}
  const k=e.target.dataset.bb5Unit;if(!k||!staged.has(k))return;const row=staged.get(k),nextUnit=e.target.value;
  if(policy()&&row.qty!==null&&row.qty!==undefined&&row.qty!==''){
   const previous=policy().normalize(row.name,Number(row.qty),row.unit,policyOptions(row)),next=policy().normalize(row.name,1,nextUnit,{...policyOptions(row),market:policyMarket()});
   if(!previous||!next||previous.unit!==next.unit||!(next.quantity>0)){
    e.target.value=row.unit;note.textContent='That unit needs a compatible amount or checked container contents. Your amount and unit have been kept. Clear the amount first to enter a different kind of measure.';return;
   }
   row.qty=previous.quantity/next.quantity;
  }
  row.unit=nextUnit;row.inputMarket=policyMarket();if(['tin','can','bag','pack','bottle','jar','pint'].includes(row.unit))row.containerUnit=row.unit;draftDirty=true;render();
 });
 rows.addEventListener('click',e=>{
  const enough=e.target.closest('[data-bb5-enough]');
  if(enough){const row=staged.get(enough.dataset.bb5Enough),coverage=row&&bb5WeekCoverage(row);if(!coverage)return;const changedUnit=row.unit!==coverage.unit;row.qty=coverage.qty;row.unit=coverage.unit;if(changedUnit){delete row.totalNeeded;delete row.targetChanged;}draftDirty=true;render();note.textContent=row.name+': '+coverage.qty+' '+coverage.unit+(live()?' recorded for this week. Shopping updates automatically.':' recorded for this week. Confirm to update Shopping, or edit the amount.');return;}
  const btn=e.target.closest('[data-bb5-remove]');if(!btn)return;staged.delete(btn.dataset.bb5Remove);draftDirty=true;render();note.textContent=live()?'Item removed. Shopping is updating.':'Item removed from draft; Reconcile to save.';
 });
 async function reconcilePantry(automatic=false){
  if(window.BBAccountDeletion?.isDeleting?.()){note.textContent='Finish the account review before changing pantry quantities.';return;}
  if(draftActor()!==openedActor||physicalRevision()!==openedRevision){note.textContent='At home changed elsewhere. Reopen At home and review the latest amounts first.';return;}
  if(window.BBReceiptHost?.hasPendingConfirmation?.()){
   note.textContent='Recover the pending receipt in Shop before changing Pantry quantities.';return;
  }
  let state={inventory:read(INVENTORY),stock:read(MEASURED),issues:[]};
  if(normalizeState)try{state=normalizeState(state.stock,state.inventory,{canonicalize:window.BBPriceV19?.canonical,market:policyMarket()});}catch{note.textContent='Review the saved pantry units first. Every amount has been kept unchanged.';return;}
  const originalInv=state.inventory,originalStock=state.stock,nextInv={...originalInv},nextStock={...originalStock};
  // Different physical sources can share a displayed name. Keep both records
  // intact until their units are reviewed instead of consolidating one away.
  const sourceUnits=new Map();
  for(const rec of Object.values(originalInv))if(rec?.selected&&rec.name&&BB5_LOCATIONS.includes(rec.loc)){
   const identity=sid(rec.loc,rec.name),unit=unitConversion(1,rec.unit||'each').unit,units=sourceUnits.get(identity)||new Set();units.add(unit);sourceUnits.set(identity,units);
  }
  if(!policy()&&[...sourceUnits.values()].some(units=>units.size>1)){note.textContent='Review the separate units for the same pantry item before confirming. All existing quantities have been kept; no changes saved.';return;}
  const chosen=[...staged.values()].map(x=>({...x}));
  for(const x of chosen){
   const raw=x.qty==null?'':String(x.qty).trim(),previous=originalInv[x.inventoryId||sid(x.loc,x.name)];
   if(!BB5_UNITS.includes(x.unit)&&!(policy()&&previous?.unit===x.unit)){note.textContent='Select a valid unit for '+x.name;return;}
   x.qty=raw===''?null:amount(raw,x.unit);if(raw!==''&&x.qty===null){note.textContent='Check '+x.name+': enter a non-negative quantity.';return;}
   const identityProblem=policy()?.measuredIdentityProblem?.(x,window.BBPriceV19?.canonical);if(identityProblem){note.textContent=identityProblem;return;}
   if(isStapleRow(x)){
    x.staple=true;x.unit='each';delete x.totalNeeded;delete x.targetChanged;
    if(!['in','low','out'].includes(x.stapleStatus)){x.conversionNeedsReview=true;continue;}
    if(x.stapleStatus==='out')x.qty=0;else if(x.qty===null)x.qty=1;
    if(x.qty>10000||x.stapleStatus!=='out'&&x.qty<=0){note.textContent='Check the container amount for '+x.name+', or choose Out.';return;}
    delete x.conversionNeedsReview;continue;
   }
   if(policy()&&x.qty!==null){
    const from=x.unit,normalized=policy().normalize(x.name,x.qty,x.unit,policyOptions(x));
    if(normalized){
     x.qty=normalized.quantity;x.unit=normalized.unit;
     if(['tin','can','pack','bag','pint','bottle','jar'].includes(from))x.containerUnit=from==='can'?'tin':from;
     if(normalized.packQuantity){x.packQuantity=normalized.packQuantity;x.packUnit=normalized.packUnit;x.packReviewed=true;x.packEstimated=normalized.estimated===true;x.packAssumption=normalized.assumption;}
     x.conversionAssumption=normalized.assumption||x.conversionAssumption;delete x.conversionNeedsReview;
    }else{x.conversionNeedsReview=true;delete x.totalNeeded;delete x.targetChanged;}
   }
  }
  // Stop if another tool changed an external stock record while this panel was open.
  for(const [key,qty] of externalAtOpen){if(Number(originalStock[key])!==qty){note.textContent='Existing stock for '+key+' changed elsewhere. Refresh Kitchen to review it first.';return}}
  const originalOwned=new Map(),oldRecords=[];
  for(const [k,rec] of Object.entries(originalInv)){
   if(!rec?.name||!BB5_LOCATIONS.includes(rec.loc)||!k.startsWith(rec.loc+'|'))continue;
   oldRecords.push([k,rec]);
   if(rec.bb173StockKey&&Number(rec.bb173StockValue)>0)originalOwned.set(rec.bb173StockKey,(originalOwned.get(rec.bb173StockKey)||0)+Number(rec.bb173StockValue));
  }
  // Explicit Pantry confirmation now adopts or removes legacy measured stock.
  for(const key of externalAtOpen.keys())delete nextStock[key];
  for(const [stockKey,owned] of originalOwned){
   if(Number(originalStock[stockKey])!==owned){note.textContent='Stock for '+stockKey+' was changed elsewhere. No changes saved. Review that quantity first.';return}
   delete nextStock[stockKey];
  }
  const groups=new Map(),needsOwner=new Set();
  for(const x of chosen){
   const k=x.inventoryId||sid(x.loc,x.name),prev=originalInv[k]||{};
   const copy={...prev,...x,name:x.name,loc:x.loc,selected:true,qty:x.qty,unit:x.unit};delete copy.inventoryId;delete copy.totalNeeded;delete copy.targetChanged;delete copy.bb173StockKey;delete copy.bb173StockValue;
   nextInv[k]=copy;
   if(x.qty!==null){const p=unitConversion(x.qty,x.unit),key=pantryStockId(x.name,p.unit);groups.set(key,(groups.get(key)||0)+p.qty)}
  }
  for(const [key,rec] of oldRecords)if(!chosen.some(x=>(x.inventoryId||sid(x.loc,x.name))===key)){
   const copy={...rec,selected:false,qty:null};delete copy.bb173StockKey;delete copy.bb173StockValue;nextInv[key]=copy;
  }
  for(const [key,qty] of groups){
   const hadExternal=Object.prototype.hasOwnProperty.call(originalStock,key)&&!originalOwned.has(key)&&!externalAtOpen.has(key);
   if(hadExternal){
    if(Number(originalStock[key])!==qty){note.textContent='Existing '+key+' stock was recorded by another tool. No changes saved; edit it there first.';return}
    nextStock[key]=qty;continue;
   }
   nextStock[key]=qty;needsOwner.add(key);
  }
  for(const x of chosen)if(x.qty!==null){
   const p=unitConversion(x.qty,x.unit),key=pantryStockId(x.name,p.unit);
   if(needsOwner.has(key)){nextInv[x.inventoryId||sid(x.loc,x.name)].bb173StockKey=key;nextInv[x.inventoryId||sid(x.loc,x.name)].bb173StockValue=p.qty}
  }
  if(window.BBReducedStock?.settleInventory){const annotated=window.BBReducedStock.settleInventory({before:originalInv,after:nextInv,actor:openedActor,policy:policy(),canonicalize:window.BBPriceV19?.canonical,market:policyMarket()});for(const key of Object.keys(nextInv))nextInv[key]=annotated[key];}
  let homeChange;try{
   const homeRows=chosen.map(row=>{
    const target=[...stagedTargets.values()].find(value=>value.sourceKey===row.inventoryId);
    if(!target)return row;
    if(row.qty===null||row.unit!==target.unit||row.conversionNeedsReview)throw Error('Review the amount and unit before adding '+row.name+' to Shop. Your saved stock has been kept.');
    return {...row,totalNeeded:target.quantity,...(target.extraBuffer!==undefined?{extraBuffer:target.extraBuffer}:{}),...(target.buyMultiple!==undefined?{buyMultiple:target.buyMultiple,buyMultipleUnit:target.unit}:{}),...(target.automaticNeeded===true?{automaticNeeded:true}:{}),targetChanged:true,pantryTarget:true};
   });
   homeChange=window.BBHome?.prepare?.(homeRows);
  }catch(error){note.textContent=error.message;return;}
  const shoppingChange=homeChange?.shoppingChange,shoppingBefore=Object.fromEntries(Object.keys(shoppingChange?.updates||{}).map(key=>[key,localStorage.getItem(key)]));
  const originalHomeRaw=homeChange?localStorage.getItem(homeChange.key):null;const featureChange=homeChange?.featureChange,originalFeatures=featureChange?localStorage.getItem(featureChange.key):null;
  const originalInventoryRaw=localStorage.getItem(INVENTORY),originalStockRaw=localStorage.getItem(MEASURED),originalConfirmedRaw=localStorage.getItem(CONFIRMED);
  try{
   const text=JSON.stringify(nextInv);localStorage.setItem(INVENTORY,text);if(localStorage.getItem(INVENTORY)!==text)throw Error('Inventory save verification failed');
   if(typeof bb307SaveStock==='function'){if(!bb307SaveStock(nextStock))throw Error('Stock save failed')}
   else{const stockText=JSON.stringify(nextStock);localStorage.setItem(MEASURED,stockText);if(localStorage.getItem(MEASURED)!==stockText)throw Error('Stock save verification failed')}
   const confirmedText=JSON.stringify({version:1,confirmedAt:new Date().toISOString(),items:chosen.map(x=>({name:x.name,loc:x.loc,qty:x.qty,unit:x.unit,...(x.staple?{staple:true,stapleStatus:x.stapleStatus}:{})}))});
   localStorage.setItem(CONFIRMED,confirmedText);
   if(localStorage.getItem(CONFIRMED)!==confirmedText)throw Error('Confirmed Pantry save verification failed');
   if(homeChange){if(window.BBHome.actor()!==homeChange.who||localStorage.getItem(homeChange.key)!==homeChange.expected)throw Error('At home changed elsewhere');const homeText=JSON.stringify(homeChange.value);localStorage.setItem(homeChange.key,homeText);if(localStorage.getItem(homeChange.key)!==homeText)throw Error('Requirements save failed');}
   if(featureChange){if(localStorage.getItem(featureChange.key)!==featureChange.expected)throw Error('Household list changed');const value=JSON.stringify(featureChange.value);localStorage.setItem(featureChange.key,value);if(localStorage.getItem(featureChange.key)!==value)throw Error('Household save failed');}
   if(shoppingChange)window.BBHome.atomic(localStorage,shoppingChange.updates,shoppingChange.expected);
  }catch(err){
   try{for(const [key,value]of Object.entries(shoppingBefore)){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}
   if(featureChange){if(originalFeatures===null)localStorage.removeItem(featureChange.key);else localStorage.setItem(featureChange.key,originalFeatures);}
   if(homeChange){if(originalHomeRaw===null)localStorage.removeItem(homeChange.key);else localStorage.setItem(homeChange.key,originalHomeRaw);}
   if(originalInventoryRaw===null)localStorage.removeItem(INVENTORY);else localStorage.setItem(INVENTORY,originalInventoryRaw);
    if(originalStockRaw===null)localStorage.removeItem(MEASURED);else localStorage.setItem(MEASURED,originalStockRaw);
    if(originalConfirmedRaw===null)localStorage.removeItem(CONFIRMED);else localStorage.setItem(CONFIRMED,originalConfirmedRaw);
    if(typeof bb307ReadStock==='function'&&typeof bb307Stock!=='undefined')bb307Stock=bb307ReadStock();
   }catch(restoreErr){console.error('BasketBoss pantry rollback failed',restoreErr)}
   note.textContent='Could not save safely. Review storage and try again.';return;
  }
  pendingFoodDraft=null;stagedTargets.clear();openedRevision=physicalRevision();window.BBHome?.committed?.();externalAtOpen.clear();draftDirty=false;
  window.BasketBossCloud?.scheduleSave?.();
  const unknown=chosen.filter(x=>x.qty===null);
  const requirements=window.BBHomeHost?.requirements?.()||[],mismatches=window.BBHomeHost?.consume?.(nextStock,requirements)?.mismatches||{};
  const incompatible=chosen.filter(x=>!x.staple&&(x.conversionNeedsReview||x.qty>0&&requirements.some(row=>pantryStockId(row.key||row.name,'')===pantryStockId(x.name,'')&&mismatches[pantryStockId(row.key||row.name,row.unit)]?.length)));
  const reviewText=unknown.length||incompatible.length?'PANTRY saved. '+(unknown.length?'Amount unknown for '+unknown.map(x=>x.name).join(', ')+': these selections have not reduced To buy. Enter an amount or choose Enough for this week. ':'')+(incompatible.length?'Check the units for '+incompatible.map(x=>x.name).join(', ')+': those shopping amounts still need review.':''):'';
  if(reviewText&&!automatic){
   note.textContent=reviewText;drawOverview();const first=unknown[0]||incompatible[0],key=sid(first.loc,first.name);
   const pantry=document.getElementById('bbSimplePantry');if(pantry)pantry.open=true;
   rows.querySelectorAll('[data-bb5-qty]').forEach(input=>{if(input.dataset.bb5Qty===key){input.focus({preventScroll:true});input.closest('[data-bb5-row]').scrollIntoView({behavior:'smooth',block:'center'});}});
  }
  if(automatic)note.textContent=reviewText||'✓ Pantry saved. Shopping has been updated.';
  if(window.BBReceiptHost?.confirmCurrentPantry){
   let synced;reconcile.disabled=true;
   try{synced=await window.BBReceiptHost.confirmCurrentPantry({stock:nextStock});}
   catch{note.textContent=reviewText+' Your amounts are saved on this device. Online Pantry confirmation needs another attempt.';return;}
   finally{reconcile.disabled=false;}
   if(!synced?.ok||synced.needsReview){
    note.textContent=reviewText+' Your amounts are saved on this device. Review the saved online pantry before reconciling Shopping.';
    if(!automatic)void window.BBReceiptHost.reviewPantry();return;
   }
  }
  if(reviewText)return;
  note.textContent='✓ PANTRY confirmed. '+chosen.filter(x=>x.qty!==null).length+' measured item(s) saved. Shopping needs have been recalculated.';
  if(automatic){if(!draftDirty)drawOverview();return;}
  const shopTab=document.querySelector('.tab[data-tab="shop-list"]');
  if(shopTab){shopTab.click();window.scrollTo({top:0,behavior:'instant'})}
  else{drawOverview()}

 }
 reconcile.addEventListener('click',()=>runSave(false));
 // Inline controls use the same staged ledger and atomic save as the original
 // review form. No second inventory, conversion path or shopping balance exists.
 const editorGuard=()=>{
  if(!card.isConnected||document.querySelector('.tab.active')?.dataset.tab!=='shop'||draftActor()!==openedActor||physicalRevision()!==openedRevision)return 'At home changed. Reopen it to edit the latest amounts.';
  if(window.BBAccountDeletion?.isDeleting?.())return 'Finish the account review before changing pantry quantities.';
  if(window.BBReceiptHost?.hasPendingConfirmation?.())return 'Recover the pending receipt in Shop before changing pantry quantities.';
  return '';
 };
 const editorFail=message=>{note.textContent=message;editorEvent('status');return {ok:false,message};};
 function editorDescriptor(value,key){
  const row={...value,key,staple:isStapleRow(value),readout:bb5AmountReadout(value)};
  let needed;try{needed=window.BBHome?.foodTarget?.(row,{requirements:bb5Requirements(),otherRows:[...staged].filter(([id])=>id!==key).map(([,value])=>value)});}catch{needed=null;}
  let fields=needed||{totalNeeded:null,mealNeeded:null,minimumNeeded:null,targetProblem:'Shopping totals are still loading. Please try again.'};
  const pending=fields.canonicalUnit&&stagedTargets.get(pantryStockId(row.name,fields.canonicalUnit));
  const saved=fields.canonicalUnit&&window.BBHome?.targets?.()[pantryStockId(row.name,fields.canonicalUnit)];
  if(pending?.automaticNeeded===true||!pending&&saved?.automaticNeeded===true){
   row.automaticNeeded=true;
   try{fields=window.BBHome.foodTarget(row,{requirements:bb5Requirements(),otherRows:[...staged].filter(([id])=>id!==key).map(([,value])=>value)});}catch{}
  }
  if(pending&&fields.quantityPerUnit>0){
   const view=value=>Math.round(value/fields.quantityPerUnit*1000000)/1000000;
   if(pending.automaticNeeded!==true){fields.totalQuantity=pending.quantity;fields.totalNeeded=view(pending.quantity);}fields.extraBufferQuantity=pending.extraBuffer??fields.extraBufferQuantity??0;fields.buyMultipleQuantity=pending.buyMultiple??fields.buyMultipleQuantity??0;fields.extraBuffer=view(fields.extraBufferQuantity);fields.buyMultiple=view(fields.buyMultipleQuantity);fields.buyMultipleUnit=row.unit;fields.requiredQuantity=fields.totalQuantity+fields.extraBufferQuantity;fields.requiredNeeded=view(fields.requiredQuantity);
   const owned=(Number(row.qty||0)+Number(fields.otherOwned||0))*fields.quantityPerUnit;
   try{const purchase=pending.automaticNeeded===true?window.BBHome.purchaseAmounts({needed:Math.round((Math.max(0,fields.requiredQuantity-owned)+fields.manualQuantity)*1000000)/1000000,owned:0,multiple:fields.buyMultipleQuantity,unit:fields.canonicalUnit}):window.BBHome.purchaseAmounts({needed:pending.quantity,buffer:fields.extraBufferQuantity,owned,multiple:fields.buyMultipleQuantity,unit:fields.canonicalUnit});fields.shortfall=view(purchase.purchaseQuantity);fields.unroundedShortfall=view(purchase.shortfall);fields.purchasePackCount=purchase.packCount;}catch(error){fields.targetProblem=error.message;fields.shortfall=null;}
  }
  return {...row,...fields};
 }
 const editorRow=key=>{const value=staged.get(key);return value?editorDescriptor(value,key):null;};
 function editorPreview(name,loc,unit){
  if(editorGuard()||!BB5_LOCATIONS.includes(loc)||typeof name!=='string'||!name.trim()||name.trim().length>70)return null;
  const existing=draftKeys(loc,name);if(existing.length)return editorRow(existing[0]);
  const staple=policy()?.isStaple(name),chosen=staple?'each':BB5_UNITS.includes(unit)?unit:bb5SuggestedUnit(name),key=sid(loc,name);
  const row=stageValue({name:name.trim(),loc,qty:null,unit:chosen,...(staple?{staple:true,stapleStatus:'in'}:{})},key);row.qty=null;
  return editorDescriptor(row,key);
 }
 function editorUpdate(key,patch={}){
  const blocked=editorGuard();if(blocked)return editorFail(blocked);
  const previous=staged.get(key);if(!previous)return editorFail('This item changed. Choose it again.');
  const next={...previous},automaticNeeded=patch.automaticNeeded===true,hasQuantity=Object.hasOwn(patch,'qty'),hasPolicy=['extraBuffer','buyMultiple','buyMultipleUnit'].some(field=>Object.hasOwn(patch,field)),hasTarget=Object.hasOwn(patch,'totalNeeded')||hasPolicy||automaticNeeded;
  if(!automaticNeeded&&Object.hasOwn(patch,'totalNeeded')&&(patch.totalNeeded===null||patch.totalNeeded===undefined||String(patch.totalNeeded).trim()===''||amount(patch.totalNeeded,patch.unit||next.unit)===null))return editorFail('Enter a valid Total needed, or use 0 for none. Your saved stock has been kept.');
  if(Object.hasOwn(patch,'packQuantity')){
   const raw=patch.packQuantity===null||patch.packQuantity===undefined?'':String(patch.packQuantity).trim();
   if(raw==='')return editorFail('Enter a container size. Your reviewed contents and saved amount have been kept.');
   next.packQuantity=Number(raw);
  }
  if(Object.hasOwn(patch,'packUnit')){
   if(!BB5_CONTENT_UNITS.includes(String(patch.packUnit)))return editorFail('Choose a contents unit. Your reviewed contents and saved amount have been kept.');
   next.packUnit=String(patch.packUnit);
  }
  if(Object.hasOwn(patch,'packQuantity')||Object.hasOwn(patch,'packUnit')){
   if(next.packQuantity!==null&&(!Number.isFinite(next.packQuantity)||next.packQuantity<=0||next.packQuantity>1000000))return editorFail('Enter a valid container size. Your saved amount has been kept.');
   if(next.packUnit&&!BB5_CONTENT_UNITS.includes(next.packUnit))return editorFail('Choose a contents unit.');
   next.packReviewed=Number(next.packQuantity)>0&&BB5_CONTENT_UNITS.includes(next.packUnit);next.packEstimated=false;
  }
  if(Object.hasOwn(patch,'trackingMode')){
   if(!['containers','measured'].includes(patch.trackingMode))return editorFail('Choose container or measured tracking.');
   next.trackingMode=patch.trackingMode;
  }
  if(Object.hasOwn(patch,'measurementReviewed')){
   if(typeof patch.measurementReviewed!=='boolean')return editorFail('Confirm the measurement before saving.');
   next.measurementReviewed=patch.measurementReviewed;
  }
  const proposed={...next,unit:Object.hasOwn(patch,'unit')?String(patch.unit):next.unit};
  const identityProblem=policy()?.measuredIdentityProblem?.(proposed,window.BBPriceV19?.canonical);if(identityProblem)return editorFail(identityProblem);
  if(next.trackingMode==='measured'){
   const measured=next.measurementReviewed===true&&policy()?.normalize(next.name,1,proposed.unit,policyOptions(proposed));
   if(!measured||!['g','ml'].includes(measured.unit)||measured.estimated===true)return editorFail('Choose a reviewed weight or volume unit and enter its amount.');
   next.staple=false;delete next.stapleStatus;delete next.stapleCount;delete next.containerLabel;
  }else if(next.trackingMode==='containers')next.measurementReviewed=false;
  if(isStapleRow(previous)!==isStapleRow(proposed)&&!hasQuantity)return editorFail('Enter the amount in the new unit before changing tracking. Your saved stock has been kept.');
  if(Object.hasOwn(patch,'unit')){
   const unit=String(patch.unit);if(!BB5_UNITS.includes(unit))return editorFail('Choose a valid unit.');
   if(isStapleRow(proposed)&&unit!=='each')return editorFail('Use the container count for this cupboard staple.');
   if(unit!==previous.unit&&!hasQuantity&&previous.qty!==null&&previous.qty!==undefined&&previous.qty!==''){
    const before=policy()?.normalize(previous.name,Number(previous.qty),previous.unit,policyOptions(previous));
    const after=policy()?.normalize(previous.name,1,unit,{...policyOptions(next),market:policyMarket()});
    if(!before||!after||before.unit!==after.unit||!(after.quantity>0))return editorFail('Enter the amount with its new unit together, or set the container contents first. Your saved amount has been kept.');
    next.qty=Math.round(before.quantity/after.quantity*1000000)/1000000;
   }
   next.unit=unit;next.inputMarket=policyMarket();
   if(['tin','can','bag','pack','bottle','jar','pint'].includes(unit))next.containerUnit=unit;
  }
  function incompleteQuantity(raw,message){
   if(hasTarget)return editorFail(message);
   next.qty=raw;staged.set(key,next);draftDirty=true;
   const input=[...card.querySelectorAll('[data-bb5-qty]')].find(node=>node.dataset.bb5Qty===key);
   if(input){input.value=raw;drawAmount(key,input);}drawOverview();
   return editorFail(message);
  }
  if(hasQuantity){
   const raw=patch.qty===null||patch.qty===undefined?'':String(patch.qty).trim();
   // Keep incomplete/invalid raw edits in the draft, so a queued previous
   // valid keystroke cannot autosave after the user clears or mistypes it.
   // New selections may still be unknown; explicit zero means none at home.
   if(raw==='')return incompleteQuantity(raw,'Enter a quantity, or use 0 for none. Your saved amount has been kept.');
   next.qty=amount(raw,next.unit);
   if(next.qty===null)return incompleteQuantity(raw,'Enter a non-negative quantity up to 1,000,000. Your saved amount has been kept.');
  }
  if(isStapleRow(next)){
   if(Object.hasOwn(patch,'stapleStatus')){
    if(!['in','low','out'].includes(patch.stapleStatus))return editorFail('Choose In Stock, Low or Out.');
    next.stapleStatus=patch.stapleStatus;
    if(next.stapleStatus==='out')next.qty=0;else if(!(Number(next.qty)>0))next.qty=1;
   }else if(hasQuantity&&next.qty!==null){if(Number(next.qty)===0)next.stapleStatus='out';else if(!['in','low'].includes(next.stapleStatus))next.stapleStatus='in';}
   if(next.qty!==null&&Number(next.qty)>10000)return hasQuantity?incompleteQuantity(String(patch.qty).trim(),'Enter a container amount up to 10,000, or choose a stock status.'):editorFail('Enter a container amount up to 10,000, or choose a stock status.');
   next.unit='each';next.staple=true;
  }
  if(hasTarget){
   if(next.qty===null||next.qty===undefined||next.qty==='')return editorFail('Enter how much you already have; use 0 for none.');
   const policyPatch=Object.fromEntries(['extraBuffer','buyMultiple','buyMultipleUnit'].filter(field=>Object.hasOwn(patch,field)).map(field=>[field,patch[field]]));
   const info=window.BBHome?.foodTarget?.({...next,...policyPatch,...(automaticNeeded?{automaticNeeded:true}:{}),staple:isStapleRow(next)},{requirements:bb5Requirements(),otherRows:[...staged].filter(([id])=>id!==key).map(([,value])=>value)});
   if(!info||info.targetProblem)return editorFail(info?.targetProblem||'Shopping totals are still loading. Please try again.');
   const base=!automaticNeeded&&Object.hasOwn(patch,'totalNeeded')?Number(patch.totalNeeded):info.totalNeeded;
   let quantity=Math.round(base*info.quantityPerUnit*1000000)/1000000;
   if(base===info.totalNeeded)quantity=info.totalQuantity;
   if(!Number.isFinite(quantity)||quantity<0||quantity>1000000||isStapleRow(next)&&(!Number.isInteger(quantity)||quantity>10000))return editorFail('Enter a valid Total needed for this item.');
   if(quantity+info.quantityTolerance<info.minimumQuantity)return editorFail(info.manualQuantity>0?'This item already has an extra amount on Shop. Keep its current total or amend that Shop item first.':'Total needed cannot be less than your planned meals need.');
   quantity=Math.abs(quantity-info.minimumQuantity)<=info.quantityTolerance?info.minimumQuantity:Math.max(quantity,info.minimumQuantity);
   const targetKey=pantryStockId(next.name,info.canonicalUnit);
   for(const [id,target]of stagedTargets)if(target.sourceKey===key&&id!==targetKey)stagedTargets.delete(id);
   stagedTargets.set(targetKey,{sourceKey:key,quantity,unit:info.canonicalUnit,extraBuffer:info.extraBufferQuantity??0,buyMultiple:info.buyMultipleQuantity??0,...(automaticNeeded?{automaticNeeded:true}:{})});
  }
  staged.set(key,next);draftDirty=true;
  const input=[...card.querySelectorAll('[data-bb5-qty]')].find(node=>node.dataset.bb5Qty===key);
  if(Object.keys(patch).every(field=>field==='qty')&&input){input.value=next.qty??'';drawAmount(key,input);drawOverview();}
  else render();
  editorEvent('update',key);return {ok:true,key,row:editorRow(key)};
 }
 function editorSelect(name,loc,options={}){
  const blocked=editorGuard();if(blocked){editorFail(blocked);return null;}
  if(!BB5_LOCATIONS.includes(loc)||!String(name||'').trim()||!canon(name))return null;
  const matching=draftKeys(loc,name);if(matching.length)return matching[0];
  const key=sid(loc,name),staple=policy()?.isStaple(name),unit=BB5_UNITS.includes(options.unit)?options.unit:bb5SuggestedUnit(name);
  staged.set(key,stageValue({name:String(name).trim(),loc,qty:staple?1:null,unit:staple?'each':unit,...(staple?{staple:true,stapleStatus:'in'}:{})},key));
  draftDirty=true;render();editorEvent('select',key);return key;
 }
 function editorAdd({name,loc,qty,unit,trackingMode,measurementReviewed}={}){
  const blocked=editorGuard();if(blocked)return editorFail(blocked);
  name=String(name||'').trim();unit=String(unit||'each');
  if(!BB5_LOCATIONS.includes(loc)||!name||name.length>70||!canon(name))return editorFail('Enter the food name.');
  if(window.BBKitchenChoiceRules?.isHousehold(name))return editorFail('Add household items in Weekly essentials.');
  if(qty===null||qty===undefined||String(qty).trim()===''||amount(qty,unit)===null||!BB5_UNITS.includes(unit))return editorFail('Enter a quantity and unit to add.');
  if(trackingMode!==undefined&&!['containers','measured'].includes(trackingMode))return editorFail('Choose container or measured tracking.');
  const tracking=trackingMode?{trackingMode,measurementReviewed:trackingMode==='measured'&&measurementReviewed===true}:{},model={name,unit,...tracking};
  const identityProblem=policy()?.measuredIdentityProblem?.(model,window.BBPriceV19?.canonical);if(identityProblem)return editorFail(identityProblem);
  if(trackingMode==='measured'){
   const measured=measurementReviewed===true&&policy()?.normalize(name,1,unit,policyOptions(model));
   if(!measured||!['g','ml'].includes(measured.unit)||measured.estimated===true)return editorFail('Choose a reviewed weight or volume unit and enter its amount.');
  }
  const staple=isStapleRow(model),countUnits=['each','bottle','jar','pack','bag','tin','can'];
  const entered={name,loc,qty:staple&&!countUnits.includes(unit)?1:Number(qty),unit:staple?'each':unit,inputMarket:policyMarket(),...tracking,...(staple?{staple:true,stapleStatus:Number(qty)===0?'out':'in'}:trackingMode==='measured'?{staple:false}:{})};
  if(staple&&entered.qty>10000)return editorFail('Enter a container amount up to 10,000 for this staple.');
  const incoming=policy()?.normalize(name,entered.qty,entered.unit,policyOptions(entered));
  if(draftKeys(loc,name).some(key=>{const value=staged.get(key);return value.qty!==null&&value.qty!==undefined&&(String(value.qty).trim()===''||amount(value.qty,value.unit)===null||value.staple&&Number(value.qty)>10000);}))return editorFail('Finish the quantity you are editing before adding more of this food. Your saved amount has been kept.');
  let key=null;
  for(const candidate of draftKeys(loc,name)){
   const current=staged.get(candidate),normalized=current.qty===null?null:policy()?.normalize(current.name,Number(current.qty),current.unit,policyOptions(current));
   if(incoming&&normalized&&incoming.unit===normalized.unit){
    const combined=Math.round((normalized.quantity+incoming.quantity)*1000000)/1000000;
    if(combined>1000000)return editorFail('The combined amount is too large. Your saved amount has been kept.');
    // Sum canonical balances directly. Rounding back to fractional cans/pints
    // first would lose stock when their contents do not divide evenly.
    key=candidate;entered.qty=combined;entered.unit=normalized.unit;break;
   }
   if(current.unit===entered.unit){key=candidate;entered.qty=Number(current.qty||0)+entered.qty;break;}
  }
  if(key){const result=editorUpdate(key,{qty:entered.qty,unit:entered.unit,...(staple?{stapleStatus:entered.stapleStatus}:{})});if(!result.ok)return result;}
  else{
   key=sid(loc,name);let suffix=1;while(staged.has(key))key=sid(loc,name)+'::manual:'+suffix++;
   staged.set(key,stageValue(entered,key));draftDirty=true;render();
  }
  const group=window.BBPantryGroupsUI?.active(loc);
  if(group&&group!=='all')try{const api=window.BBPantryGroups;api.assign(loc,api.itemKey(name),group,api.context());}catch{note.textContent='Food saved. Choose its subcategory again in the item menu.';}
  editorEvent('add',key);return {ok:true,key,row:editorRow(key)};
 }
 async function editorMoveToFreezer(key){
  if(movingReduced)return {ok:false,message:'Wait for this item to finish moving.'};
  if(window.BBReducedFoodHost?.isPremium?.()!==true)return editorFail('Premium is needed to move reduced food with one tap.');
  let blocked=editorGuard();if(blocked)return editorFail(blocked);movingReduced=true;
  try{
   // Finish valid amount edits through the ordinary save before relocating.
   if(saving)await saving;if(draftDirty)await runSave(true);
   blocked=editorGuard();if(blocked)return editorFail(blocked);
   if(draftDirty)return editorFail('Finish the amount you are editing before moving this food.');
   if(window.BBReducedFoodHost?.isPremium?.()!==true)return editorFail('Refresh Premium before moving this item.');
   const previous=staged.get(key),helper=window.BBReducedStock;if(!previous||!helper?.isUrgent(previous,{actor:openedActor}))return editorFail('This reduced item changed. Reopen At home to review it.');
   const snapshot=new Map([...staged].map(([id,row])=>[id,{...row}])),next=helper.freeze(previous,{actor:openedActor});
   let target=sid('freezer',next.name),suffix=1;while(staged.has(target))target=sid('freezer',next.name)+'::moved:'+suffix++;
   next.inventoryId=target;staged.delete(key);staged.set(target,next);draftDirty=true;render();
   await runSave(true);
   const persisted=read(INVENTORY)[target];
   if(persisted?.loc==='freezer'&&persisted?.bbReduced?.actor===openedActor&&persisted.bbReduced.urgent===false){editorEvent('move',target);return {ok:true,key:target,row:editorRow(target),message:'Moved to Freezer. Your stock amount is unchanged.'};}
   if(draftActor()===openedActor){staged.clear();for(const [id,row]of snapshot)staged.set(id,row);draftDirty=false;pendingFoodDraft=null;render();}
   return editorFail(note.textContent||'The move could not be saved. Your stock has been kept.');
  }catch(error){return editorFail(error?.message||'The move could not be saved. Your stock has been kept.');}
  finally{movingReduced=false;}
 }
 window.BBPantryEditor=Object.freeze({card,list:()=>[...staged.keys()].map(editorRow),read:editorRow,preview:editorPreview,isCurrent:()=>!editorGuard(),select:editorSelect,update:editorUpdate,add:editorAdd,
  moveToFreezer:editorMoveToFreezer,
  remove:key=>{const blocked=editorGuard();if(blocked)return editorFail(blocked);if(!staged.has(key))return {ok:false};staged.delete(key);for(const [id,target]of stagedTargets)if(target.sourceKey===key)stagedTargets.delete(id);draftDirty=true;render();editorEvent('remove',key);return {ok:true};},
  flush:()=>runSave(true),status:()=>note.textContent,units:entryUnits});
 // One Kitchen picker and one Pantry list. Keep legacy controllers in the DOM
 // for their saved data, but do not expose duplicate editing forms or banners.
 app.prepend(card);render();
}
const css=document.createElement('style');css.id='bb173ShopFridgeStyles';css.textContent=`.bb173-shop-fridge,.bb173-shop-fridge *{box-sizing:border-box}.bb173-cupboard-subtitle{font-size:18px;color:#2e6f40;margin:13px 0}.bb173-shop-fridge{background:#FAF8F5;color:#1b4365;border:1px solid #d5e4da;border-radius:18px;padding:18px;margin:14px 0 20px}.bb173-shop-header h3{font-size:25px;margin:0 0 4px}.bb173-shop-header p{color:#516f76;font-size:13px;margin:0 0 13px}.bb173-shop-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(116px,1fr));gap:9px}.bb173-shop-tiles button{border:1px solid #d8e5dd;border-radius:13px;background:#fff;color:#1b4365;font-size:13px;font-weight:750;min-height:95px;padding:9px 6px;display:grid;place-items:center;gap:1px}.bb173-shop-tiles button[aria-pressed=true]{background:#e6f3e7;border:2px solid #2e6f40}.bb173-shop-tiles .bb173-emoji{font-size:24px}.bb173-shop-tiles small{color:#526a76;font-size:11px}.bb173-shop-add,.bb173-shop-editor{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-top:14px;border-top:1px solid #d8e5dd;padding-top:15px}.bb173-shop-add label,.bb173-shop-editor label{display:grid;gap:4px;min-width:96px;flex:1;font-size:13px;font-weight:750}.bb173-shop-add .wide{flex:2;min-width:185px}.bb173-shop-add input,.bb173-shop-add select,.bb173-shop-editor input,.bb173-shop-editor select{border:1px solid #b6d1c0;border-radius:10px;padding:10px;background:#fff;color:#1b4365;min-height:46px;max-width:100%;width:100%}.bb173-shop-add button,.bb173-shop-editor-actions button{border:0;border-radius:11px;background:#2e6f40;color:#fff;min-height:46px;padding:10px 13px;font-weight:750}.bb173-shop-editor{background:#edf7f0;border-radius:14px;padding:13px;align-items:end}.bb173-shop-editor[hidden]{display:none!important}.bb173-shop-editor strong{width:100%;font-size:16px}.bb173-shop-editor-actions{display:flex;gap:8px;flex-wrap:wrap}.bb173-shop-editor-actions #bb173RemoveOwned{background:#fff0ec;color:#8c3f26}.bb173-shop-editor-actions #bb173CloseEditor{background:#e4ebed;color:#254764}.bb173-shop-note{color:#587272;font-size:12px!important;margin:12px 0 0!important}@media(max-width:480px){.bb173-shop-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}.bb173-shop-editor-actions{width:100%}.bb173-shop-add button{flex:1 1 100%}}`;
css.textContent+=`
#bb172StaplesPanel .bb173-cupboard-manage{margin-top:16px;padding:9px 12px;border:1px solid #cfdfd2;border-radius:13px;background:#fffdf9;color:#1b4365}
#bb172StaplesPanel .bb173-cupboard-manage>summary{cursor:pointer;color:#2e6f40;font-weight:850;padding:10px 3px;min-height:44px}
#bb172StaplesPanel .bb173-cupboard-manage[open]{padding-bottom:15px}
#bb172StaplesPanel .bb173-cupboard-manage #bb172CupboardTiles{margin-top:12px}
#bb172StaplesPanel .bb173-cupboard-manage .bb172-inline-choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(117px,1fr));gap:8px}
#bb172StaplesPanel .bb173-cupboard-manage .bb172-food-tile{min-height:74px}
@media(max-width:450px){#bb172StaplesPanel .bb173-cupboard-manage .bb172-inline-choices{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;

css.textContent+=`
.bb174-fridge-review{margin-top:16px;border:1px solid #c3d9ce;border-radius:15px;background:#f0f8f2;padding:14px}
.bb174-fridge-review-head h4{margin:0;font-size:18px;color:#174b32}
.bb174-fridge-review-head p,.bb174-fridge-explain{font-size:12px;color:#486c5e;margin:5px 0 12px}
.bb174-fridge-row{display:grid;grid-template-columns:minmax(115px,1fr) 100px 108px auto;gap:8px;align-items:end;padding:10px 0;border-bottom:1px solid #d3e4d7}
.bb174-fridge-row strong{align-self:center;font-size:13px;overflow-wrap:anywhere}
.bb174-fridge-row label{display:grid;gap:4px;font-size:11px;font-weight:700}
.bb174-fridge-row input,.bb174-fridge-row select{width:100%;min-width:0;background:#fff;border:1px solid #adcdb6;border-radius:9px;padding:9px;color:#173c36;font-size:16px}
.bb174-fridge-row button{border:1px solid #ebc6ba;border-radius:9px;background:#fff0ea;color:#833c25;padding:10px;font-size:12px;font-weight:800}
.bb174-fridge-row .bb5-week-coverage{grid-column:1/-1;border-color:#b5d3bc;background:#edf7ee;color:#205b39;min-height:44px;text-align:left}
.bb174-fridge-row .bb5-week-coverage[hidden]{display:none}
.bb174-fridge-reconcile{display:block;width:100%;margin-top:14px;border:0;border-radius:12px;background:#246b42;color:#fff;padding:15px;font-weight:850;font-size:14px;min-height:50px}
.bb174-fridge-reconcile:disabled{opacity:.4;cursor:not-allowed}
.bb174-fridge-empty{font-size:13px;color:#668074;padding:12px 0}
@media(max-width:550px){.bb174-fridge-row{grid-template-columns:minmax(0,1fr) minmax(70px,1fr) minmax(90px,1fr)}.bb174-fridge-row strong{grid-column:1/-1}.bb174-fridge-row button{grid-column:1/-1;justify-self:start}}
`;
css.textContent+=`
.bb5-location-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0 16px}
.bb5-location-tabs button{padding:12px 5px;border:1px solid #d2e3d8;border-radius:12px;color:#17405b;background:#fff;font-size:13px;font-weight:850;min-height:49px}
.bb5-location-tabs button[aria-pressed=true]{background:#dff3e7;border:2px solid #2e6f40;color:#145234}
.bb5-review-row strong small{display:block;margin-top:3px;font-weight:500;font-size:11px;color:#527066}
@media(max-width:370px){.bb5-location-tabs button{font-size:11px}}
`;
css.textContent+=`
#app #bb74LiveOverview{border:1px solid #bdd7c5;border-radius:15px;background:#edf7ef;padding:13px;margin:8px 0 17px;color:#194a32}
#app #bb74LiveOverview .bb74-live-title{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:15px;flex-wrap:wrap}
#app #bb74LiveOverview .bb74-draft-indicator{font-size:11px;font-weight:700;color:#477d60}
#app #bb74LiveOverview .bb74-live-items{display:flex;align-content:start;align-items:start;gap:7px;flex-wrap:wrap;max-height:150px;overflow-y:auto;padding:10px 0 8px}
#app #bb74LiveOverview .bb74-live-chip{display:inline-flex;gap:6px;align-items:center;border-radius:11px;border:1px solid #c6dccc;padding:7px 9px;line-height:1.3;background:white;font-size:12px;color:#28533b;max-width:100%;flex-wrap:wrap}
#app #bb74LiveOverview .bb74-live-chip small{background:#eff5ee;padding:2px 5px;border-radius:5px;color:#376249;font-weight:750}
#app #bb74LiveOverview .bb74-live-empty{font-size:12px;color:#66816b}
#app #bb74LiveOverview .bb74-goto-review{width:100%;background:#256b43;color:white;border:0;border-radius:10px;min-height:47px;padding:11px;font-size:13px;font-weight:850}
#app #bb74LiveOverview .bb74-goto-review:disabled{opacity:.5}
@media(max-width:380px){#app #bb74LiveOverview .bb74-live-chip{font-size:11px}}
`;
css.textContent+=`
#app #bb8WhatIHave{display:block;max-width:1100px;width:100%;margin:20px auto 28px!important;background:#f0f8f2;border:2px solid #afcfb7;scroll-margin-top:100px}
#app #bb8WhatIHave .bb174-fridge-review-head h4{font-size:21px}
#app #bb8JumpList{display:block;width:100%;border:1px solid #a7cbb5;background:#e7f4ea;color:#1b5937;border-radius:12px;margin-top:13px;padding:12px;font-weight:850;min-height:48px;cursor:pointer}
#app #bb8WhatIHave .bb8-inventory-help{margin-top:13px;border-top:1px solid #ccdfd0;padding-top:12px;font-size:13px;line-height:1.5;color:#365d49}
#app #bb8WhatIHave .bb8-inventory-help summary{cursor:pointer;font-weight:800;color:#205b39;min-height:36px}
#app #bb8WhatIHave .bb8-inventory-help ol{padding-left:23px}
#app #bb8WhatIHave .bb8-inventory-help li{margin-bottom:6px}
#app #bb8WhatIHave .bb8-inventory-help a{color:#1e6740;font-weight:850}
@media(max-width:550px){#app #bb8WhatIHave{padding:14px!important;margin:16px auto!important}}
`;
css.textContent+=`
/* UI-NEXT 7.5: Hide only redundant legacy Kitchen blocks, not Shopping or Planner. */
#app:has(> #bb173ShopFridge) > :not(#bb173ShopFridge){display:none!important}
#app #bb173ShopFridge.bb75-simple-kitchen{display:block!important;max-width:900px;width:100%;margin:0 auto 22px!important;border-color:#d6e3d6;padding:clamp(12px,2.5vw,22px)}
#app #bb173ShopFridge .bb173-shop-header h2{margin:0 0 6px;color:#214f38;font-size:clamp(22px,3vw,29px)}
#app #bb173ShopFridge #bb5Locations{margin-top:16px}
#app #bb173ShopFridge #bb8WhatIHave{margin:20px 0 0!important;max-width:100%;scroll-margin-top:100px}
#app #bb173ShopFridge #bb8WhatIHave .bb75-pantry-head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px}
#app #bb173ShopFridge #bb8WhatIHave .bb75-pantry-head h3{margin:0;color:#20583c;font-size:clamp(22px,3vw,27px);letter-spacing:.4px}
#app #bb173ShopFridge #bb8WhatIHave .bb75-pantry-head h3 span{font-size:15px;letter-spacing:0;color:#517663}
#app #bb173ShopFridge #bb75DraftIndicator{font-size:12px;font-weight:750;color:#4d7b61}
#app #bb173ShopFridge .bb75-pantry-group{margin-top:14px;padding:12px;border:1px solid #d0dfd1;background:#fff;border-radius:12px}
#app #bb173ShopFridge .bb75-pantry-group h4{margin:0 0 3px;color:#1d6540;font-size:17px}
#app #bb173ShopFridge .bb75-pantry-group h4 small{font-size:12px;color:#6b8876;margin-left:8px}
#app #bb173ShopFridge .bb75-pantry-group .bb174-fridge-row:last-child{border-bottom:0}
#app #bb173ShopFridge #bb5Reconcile{background:#216c43;font-size:15px;min-height:54px}
#app #bb173ShopFridge #bb5FoodTiles button{min-width:0;overflow-wrap:anywhere}
#app #bb173ShopFridge #bb5FoodTiles button[aria-pressed=true]{outline:2px solid #266b44;outline-offset:-3px}
@media(max-width:480px){#app #bb173ShopFridge #bb5FoodTiles{grid-template-columns:repeat(3,minmax(0,1fr))}#app #bb173ShopFridge .bb174-fridge-row{grid-template-columns:repeat(2,minmax(0,1fr))}#app #bb173ShopFridge .bb174-fridge-row strong{grid-column:1/-1}#app #bb173ShopFridge .bb174-fridge-row button{grid-column:1/-1;justify-self:stretch}}
`;css.textContent+=`
/* Batch 7.6: clearly separated category accordions, then one PANTRY confirmation. */
#app #bb173ShopFridge .bb76-kitchen-intro{margin:0 0 14px}
#app #bb173ShopFridge .bb76-title{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}
#app #bb173ShopFridge .bb76-title>div{flex:1 1 250px}
#app #bb173ShopFridge .bb76-eyebrow{font-size:10px;color:#42815d;letter-spacing:1px;font-weight:900;margin:0 0 4px}
#app #bb173ShopFridge .bb76-view-pantry{border:1px solid #9fc5ac;background:#eff9f1;color:#20583c;padding:10px 13px;border-radius:12px;min-height:45px;font-size:13px;font-weight:850;white-space:nowrap;cursor:pointer}
#app #bb173ShopFridge .bb76-view-pantry span{display:inline-flex;align-items:center;justify-content:center;min-width:25px;height:25px;margin:0 3px;padding:0 5px;border-radius:20px;background:#d7eddd}
#app #bb173ShopFridge .bb76-storage{display:grid;gap:10px;margin:16px 0}
#app #bb173ShopFridge .bb76-store{border:1px solid #cedfd4;border-radius:15px;background:#fff;overflow:hidden}
#app #bb173ShopFridge .bb76-store[open]{border-color:#88bea0;box-shadow:0 3px 14px #173d2520}
#app #bb173ShopFridge .bb76-store>summary{display:flex;align-items:center;gap:11px;cursor:pointer;list-style:none;padding:14px;min-height:70px;color:#214e39;user-select:none}
#app #bb173ShopFridge .bb76-store>summary::-webkit-details-marker{display:none}
#app #bb173ShopFridge .bb76-store[open]>summary{background:#eff7f1;border-bottom:1px solid #d7e5da}
#app #bb173ShopFridge .bb76-store-icon{display:grid;place-items:center;background:#edf5ee;border:1px solid #d9e8db;border-radius:12px;flex:none;width:42px;height:42px;font-size:23px}
#app #bb173ShopFridge .bb76-store-heading{display:grid;gap:3px;flex:1;min-width:0}
#app #bb173ShopFridge .bb76-store-heading strong{font-size:17px;font-weight:900;line-height:1.15}
#app #bb173ShopFridge .bb76-store-heading small{color:#5b7668;font-size:11px;font-weight:550}
#app #bb173ShopFridge .bb76-store-right{display:flex;align-items:center;gap:8px;color:#2b7150;font-size:11px;font-weight:850;white-space:nowrap}
#app #bb173ShopFridge .bb76-chevron{font-size:21px;color:#367855;transition:transform .15s}
#app #bb173ShopFridge .bb76-store[open] .bb76-chevron{transform:rotate(180deg)}
#app #bb173ShopFridge .bb76-store-body{padding:12px}
#app #bb173ShopFridge .bb76-store-body .bb173-shop-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:8px}
#app #bb173ShopFridge .bb76-store-body .bb173-shop-tiles button{min-height:95px}
#app #bb173ShopFridge .bb76-add-food{margin:14px 0 2px;padding-top:12px}
#app #bb173ShopFridge .bb76-add-food label{min-width:150px}
#app #bb173ShopFridge #bb8WhatIHave{margin:15px 0 0!important;border-radius:16px}
#app #bb173ShopFridge #bb5Reconcile{min-height:56px;font-size:15px}
#app #bb173ShopFridge #bb5SelectedRows{scroll-margin-top:110px}
#app #bb173ShopFridge .bb5-review-row>[hidden]{display:none!important}
#app #bb173ShopFridge .bb5-staple-note,#app #bb173ShopFridge .bb5-pack-editor{grid-column:1/-1;font-size:12px;line-height:1.6;color:#526d56;min-width:0}
#app #bb173ShopFridge .bb5-pack-editor{border-top:1px solid #dce7d9;padding-top:5px}
#app #bb173ShopFridge .bb5-pack-editor>summary{box-sizing:border-box;min-height:44px;padding:11px 0;font-weight:750;color:#315c3f;cursor:pointer}
#app #bb173ShopFridge .bb5-pack-editor label{display:grid;gap:5px;margin:8px 0}
@media(max-width:500px){
 #app #bb173ShopFridge .bb76-title{display:block}
 #app #bb173ShopFridge .bb76-view-pantry{width:100%;margin:11px 0 0}
 #app #bb173ShopFridge .bb76-store>summary{padding:11px 9px;gap:8px}
 #app #bb173ShopFridge .bb76-store-heading strong{font-size:14px}
 #app #bb173ShopFridge .bb76-store-heading small{font-size:10px}
 #app #bb173ShopFridge .bb76-store-right{font-size:10px;gap:3px}
 #app #bb173ShopFridge .bb76-store-icon{width:36px;height:36px;font-size:19px}
 #app #bb173ShopFridge .bb76-store-body .bb173-shop-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}
 #app #bb173ShopFridge .bb76-store-body{padding:9px}
}
`;
document.head.append(css);
document.addEventListener?.('click',event=>{
 const button=event.target.closest?.('.tab[data-tab]');if(!window.BBPantryLiveSync||!button||button.dataset.tab==='shop')return;
 if(button.dataset.bbPantryNavigate==='ready'){delete button.dataset.bbPantryNavigate;return;}
 const active=window.BBPantryLive;if(!active?.hasPending?.())return;
 event.preventDefault();event.stopImmediatePropagation();
 Promise.resolve(active.flush()).then(()=>window.BBPantryLive!==active&&window.BBPantryLive?.hasPending?.()?window.BBPantryLive.flush():undefined).finally(()=>{if(button.isConnected){button.dataset.bbPantryNavigate='ready';button.click();}});
},true);
const start=()=>{const app=document.getElementById('app');if(!app)return;build();new MutationObserver(()=>build()).observe(app,{childList:true,subtree:false})};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
