/* BasketBoss v17.3 preview: Shopping Fridge tiles share inventory with Make a Meal.
   Only explicitly measured stock reduces the outstanding grocery requirement. */
(()=>{'use strict';
const INVENTORY='basketboss_makeameal_v1_inventory';
const MEASURED='basketboss_321_v7_measured_pantry';
const CONFIRMED='basketboss_ui_next_confirmed_pantry_v1';
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
 const n=typeof resolve==='function'?resolve(aliases[canonName]||canonName):(aliases[canonName]||canonName);
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
const BB5_UNITS=['each','g','kg','ml','l','pack','clove','bulb','tin','can','tbsp','tsp','loaf','slice','whole','item','piece'];
let bb5RequirementsCache=null;
function bb5PlannedRequirements(name){
 const wanted=pantryStockId(name,''),groups=new Map();
 if(!bb5RequirementsCache){bb5RequirementsCache=window.BBHomeHost?.requirements?.()||[];queueMicrotask(()=>{bb5RequirementsCache=null;});}
 for(const row of bb5RequirementsCache){
  if(pantryStockId(row.key||row.name,'')!==wanted)continue;
  const measured=unitConversion(Number(row.required),String(row.unit||'').trim().toLowerCase());
  if(!BB5_UNITS.includes(measured.unit)||!Number.isFinite(measured.qty)||measured.qty<=0)continue;
  groups.set(measured.unit,(groups.get(measured.unit)||0)+measured.qty);
 }
 return [...groups].map(([unit,qty])=>({unit,qty}));
}
function bb5WeekCoverage(row){
 const needed=bb5PlannedRequirements(row.name),current=unitConversion(1,row.unit);
 const matching=needed.find(x=>x.unit===current.unit);
 const coverage=matching?{qty:matching.qty/current.qty,unit:row.unit}:needed.length===1?needed[0]:null;
 // A sole known recipe unit is safe to offer explicitly. Never combine unlike units.
 if(!coverage||needed.length!==1)return null;
 const target=Number((coverage.unit===row.unit?row.totalNeeded:undefined)??window.BBHome?.total?.(row.name,coverage.unit));
 if(Number.isFinite(target)&&target>=0)coverage.qty=Math.max(coverage.qty,target);
 // Online Pantry accepts whole counts. State the full amount the user is declaring.
 const count=['each','pack','clove','bulb','tin','loaf','slice'].includes(unitConversion(1,coverage.unit).unit);
 return {...coverage,qty:count?Math.ceil(coverage.qty):coverage.qty,count};
}
function bb5CoverageText(coverage){return coverage.count?'I have '+coverage.qty+' '+coverage.unit+' · enough for this week':'Enough for this week ('+coverage.qty+' '+coverage.unit+')';}
function bb5AlreadyEnough(row,coverage){return coverage&&row.qty!==null&&row.qty!==''&&Number(row.qty)>=coverage.qty&&row.unit===coverage.unit;}
function bb5AmountReadout(row){
 const coverage=bb5WeekCoverage(row),current=unitConversion(1,row.unit);
 if(coverage&&unitConversion(1,coverage.unit).unit!==current.unit)return 'Shopping uses '+coverage.unit+'; check the unit';
 const needed=Math.max(Number(row.totalNeeded??window.BBHome?.total?.(row.name,row.unit)??0),window.BBHome?.requirement?.(row.name,row.unit)||0);
 return 'To buy: '+Math.max(0,needed-Number(row.qty||0))+(row.qty===null||row.qty===undefined||row.qty===''?' (amount unknown)':'');
}
/* Beta QA: unit suggestions apply ONLY to new/unmeasured Kitchen selections.
   Preserve all existing saved units and quantities, including manual changes. */
function bb5SuggestedUnit(name){
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

function build(){
 const app=document.getElementById('app'),panel=document.getElementById('bb172StaplesPanel');
 const active=document.querySelector('.tab.active')?.dataset.tab;
 if(active!=='shop'||!app||!panel||panel.dataset.bb5BulkInventoryApplied)return;
 panel.dataset.bb5BulkInventoryApplied='1';
 panel.dataset.bb173ShopFridgeApplied='1';
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
 const staged=new Map();let draftDirty=false;let openedRevision=physicalRevision();const openedActor=draftActor();
 function sid(loc,name){return loc+'|'+canon(name)}
 for(const rec of Object.values(read(INVENTORY)))if(rec?.selected&&BB5_LOCATIONS.includes(rec.loc)&&rec.name){staged.set(sid(rec.loc,rec.name),{name:String(rec.name),loc:rec.loc,qty:rec.qty??null,unit:rec.unit||'each'})}
 // Include existing measured stock from the original pantry form so nothing
 // disappears when that redundant form is hidden from Kitchen.
 const existingInventory=read(INVENTORY),existingMeasured=read(MEASURED);
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
  if(!staged.has(key))staged.set(key,{name,loc,qty,unit});
 }

 if(pendingFoodDraft){
  if(pendingFoodDraft.actor===openedActor&&pendingFoodDraft.revision===openedRevision){staged.clear();for(const [key,value]of pendingFoodDraft.rows)staged.set(key,{...value});draftDirty=true;}
  else{pendingFoodDraft=null;note.textContent='At home changed. Review the latest amounts before confirming.';}
 }
 function drawOverview(){
  if(draftDirty)pendingFoodDraft={actor:openedActor,revision:openedRevision,rows:[...staged].map(([key,value])=>[key,{...value}])};
  review.querySelector('#bb75DraftIndicator').textContent=draftDirty?'Not confirmed yet':'Review and confirm';
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
    const on=staged.has(sid(loc,name));return `<button type="button" data-bb5-food="${esc(name)}" aria-pressed="${on}">${visual}<span>${esc(name)}</span><small>${on?'✓ Selected':'Tap to add'}</small></button>`;
   }).join('');
   const count=[...staged.values()].filter(x=>x.loc===loc).length;
   card.querySelector(`[data-bb76-count="${loc}"]`).textContent=count?`${count} selected`:'None selected';
  }
  const all=[...staged.values()].sort((a,b)=>BB5_LOCATIONS.indexOf(a.loc)-BB5_LOCATIONS.indexOf(b.loc)||a.name.localeCompare(b.name));
  review.querySelector('#bb5SelectedCount').textContent=`(${all.length})`;
  card.querySelector('#bb76JumpCount').textContent=String(all.length);
  rows.innerHTML=all.length?BB5_LOCATIONS.map(loc=>{
   const own=all.filter(x=>x.loc===loc);
   if(!own.length)return '';
   const label=loc==='cupboard'?'🥫 Cupboard':loc==='fridge'?'🥛 Fridge':'❄️ Freezer';
   return `<div class="bb75-pantry-group" data-pantry-location="${loc}"><h4>${label} <small>${own.length} item${own.length===1?'':'s'}</small></h4>${own.map(x=>{
    const k=sid(x.loc,x.name),coverage=bb5WeekCoverage(x),opts=BB5_UNITS.map(u=>`<option value="${u}" ${x.unit===u?'selected':''}>${u==='l'?'litres':u}</option>`).join('');
    const enough=coverage?`<button type="button" class="bb5-week-coverage" data-bb5-enough="${esc(k)}"${bb5AlreadyEnough(x,coverage)?' hidden':''}>${esc(bb5CoverageText(coverage))}</button>`:'';
    return `<div class="bb174-fridge-row bb5-review-row" data-bb5-row="${esc(k)}"><strong>${esc(x.name)}</strong><label>Already got<input type="number" inputmode="decimal" data-bb5-qty="${esc(k)}" min="0" max="1000000" step="any" placeholder="Unknown" value="${esc(x.qty??'')}"></label>${enough}<label>Total needed<input type="number" inputmode="decimal" min="0" max="1000000" step="any" data-bb5-needed="${esc(k)}" value="${esc(x.totalNeeded??window.BBHome?.total?.(x.name,x.unit)??0)}"></label><output data-bb5-buy="${esc(k)}">${esc(bb5AmountReadout(x))}</output><label>Unit<select data-bb5-unit="${esc(k)}">${opts}</select></label><button type="button" data-bb5-remove="${esc(k)}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`;
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
  const name=btn.dataset.bb5Food,k=sid(loc,name);
  if(staged.has(k))staged.delete(k);
  else{const old=read(INVENTORY)[k];staged.set(k,{name,loc,qty:old?.selected?old.qty??null:null,unit:old?.selected?(old.unit||bb5SuggestedUnit(name)):bb5SuggestedUnit(name)})}
  draftDirty=true;render();note.textContent='Selection updated. Review amounts in PANTRY before confirming.';
 });
 card.querySelector('#bb76StorageSections').addEventListener('submit',e=>{
  const f=e.target.closest('[data-bb76-add]');if(!f)return;e.preventDefault();
  const loc=f.dataset.bb76Add,name=f.elements.name.value.trim(),k=sid(loc,name);
  if(!BB5_LOCATIONS.includes(loc)||!name||!canon(name))return;
  if(window.BBKitchenChoiceRules?.isHousehold(name)){note.textContent='Add household items in Weekly essentials instead.';return;}
  if(!staged.has(k))staged.set(k,{name,loc,qty:null,unit:bb5SuggestedUnit(name)});
  let groupNote='';
  const group=window.BBPantryGroupsUI?.active(loc);
  if(group&&group!=='all'&&draftActor()===openedActor)try{const api=window.BBPantryGroups;api.assign(loc,api.itemKey(name),group,api.context());}catch{groupNote=' Choose its subcategory again in the item menu.';}
  f.reset();draftDirty=true;render();note.textContent='Food added to '+loc+'. Enter its amount in PANTRY below.'+groupNote;
 });
 rows.addEventListener('input',e=>{const target=e.target.dataset.bb5Needed;if(target&&staged.has(target)){staged.get(target).totalNeeded=e.target.value;staged.get(target).targetChanged=true;draftDirty=true;drawAmount(target,e.target);drawOverview();return;}const k=e.target.dataset.bb5Qty;if(!k||!staged.has(k))return;staged.get(k).qty=e.target.value;draftDirty=true;drawAmount(k,e.target);drawOverview()});
 rows.addEventListener('change',e=>{const k=e.target.dataset.bb5Unit;if(!k||!staged.has(k))return;const row=staged.get(k);row.unit=e.target.value;delete row.totalNeeded;delete row.targetChanged;draftDirty=true;render()});
 rows.addEventListener('click',e=>{
  const enough=e.target.closest('[data-bb5-enough]');
  if(enough){const row=staged.get(enough.dataset.bb5Enough),coverage=row&&bb5WeekCoverage(row);if(!coverage)return;const changedUnit=row.unit!==coverage.unit;row.qty=coverage.qty;row.unit=coverage.unit;if(changedUnit){delete row.totalNeeded;delete row.targetChanged;}draftDirty=true;render();note.textContent=row.name+': '+coverage.qty+' '+coverage.unit+' recorded for this week. Confirm to update Shopping, or edit the amount.';return;}
  const btn=e.target.closest('[data-bb5-remove]');if(!btn)return;staged.delete(btn.dataset.bb5Remove);draftDirty=true;render();note.textContent='Item removed from draft; Reconcile to save.';
 });
 reconcile.addEventListener('click',async()=>{
  if(draftActor()!==openedActor||physicalRevision()!==openedRevision){note.textContent='At home changed elsewhere. Reopen At home and review the latest amounts first.';return;}
  if(window.BBReceiptHost?.hasPendingConfirmation?.()){
   note.textContent='Recover the pending receipt in Shop before changing Pantry quantities.';return;
  }
  const originalInv=read(INVENTORY),originalStock=read(MEASURED),nextInv={...originalInv},nextStock={...originalStock};
  // Different physical sources can share a displayed name. Keep both records
  // intact until their units are reviewed instead of consolidating one away.
  const sourceUnits=new Map();
  for(const rec of Object.values(originalInv))if(rec?.selected&&rec.name&&BB5_LOCATIONS.includes(rec.loc)){
   const identity=sid(rec.loc,rec.name),unit=unitConversion(1,rec.unit||'each').unit,units=sourceUnits.get(identity)||new Set();units.add(unit);sourceUnits.set(identity,units);
  }
  if([...sourceUnits.values()].some(units=>units.size>1)){note.textContent='Review the separate units for the same pantry item before confirming. All existing quantities have been kept; no changes saved.';return;}
  const chosen=[...staged.values()].map(x=>({...x}));
  for(const x of chosen){const raw=x.qty==null?'':String(x.qty).trim();if(!BB5_UNITS.includes(x.unit)){note.textContent='Select a valid unit for '+x.name;return}x.qty=raw===''?null:amount(raw,x.unit);if(raw!==''&&x.qty===null){note.textContent='Check '+x.name+': enter a non-negative quantity.';return}}
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
   const k=sid(x.loc,x.name),prev=originalInv[k]||{};
   const copy={...prev,name:x.name,loc:x.loc,selected:true,qty:x.qty,unit:x.unit};delete copy.bb173StockKey;delete copy.bb173StockValue;
   nextInv[k]=copy;
   if(x.qty!==null){const p=unitConversion(x.qty,x.unit),key=pantryStockId(x.name,p.unit);groups.set(key,(groups.get(key)||0)+p.qty)}
  }
  for(const [key,rec] of oldRecords)if(!chosen.some(x=>sid(x.loc,x.name)===key)){
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
   if(needsOwner.has(key)){nextInv[sid(x.loc,x.name)].bb173StockKey=key;nextInv[sid(x.loc,x.name)].bb173StockValue=p.qty}
  }
  let homeChange;try{homeChange=window.BBHome?.prepare?.(chosen);}catch(error){note.textContent=error.message;return;}
  const shoppingChange=homeChange?.shoppingChange,shoppingBefore=Object.fromEntries(Object.keys(shoppingChange?.updates||{}).map(key=>[key,localStorage.getItem(key)]));
  const originalHomeRaw=homeChange?localStorage.getItem(homeChange.key):null;const featureChange=homeChange?.featureChange,originalFeatures=featureChange?localStorage.getItem(featureChange.key):null;
  const originalInventoryRaw=localStorage.getItem(INVENTORY),originalStockRaw=localStorage.getItem(MEASURED),originalConfirmedRaw=localStorage.getItem(CONFIRMED);
  try{
   const text=JSON.stringify(nextInv);localStorage.setItem(INVENTORY,text);if(localStorage.getItem(INVENTORY)!==text)throw Error('Inventory save verification failed');
   if(typeof bb307SaveStock==='function'){if(!bb307SaveStock(nextStock))throw Error('Stock save failed')}
   else{const stockText=JSON.stringify(nextStock);localStorage.setItem(MEASURED,stockText);if(localStorage.getItem(MEASURED)!==stockText)throw Error('Stock save verification failed')}
   const confirmedText=JSON.stringify({version:1,confirmedAt:new Date().toISOString(),items:chosen.map(x=>({name:x.name,loc:x.loc,qty:x.qty,unit:x.unit}))});
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
  pendingFoodDraft=null;openedRevision=physicalRevision();window.BBHome?.committed?.();externalAtOpen.clear();draftDirty=false;
  const unknown=chosen.filter(x=>x.qty===null);
  const requirements=window.BBHomeHost?.requirements?.()||[],mismatches=window.BBHomeHost?.consume?.(nextStock,requirements)?.mismatches||{};
  const incompatible=chosen.filter(x=>x.qty>0&&requirements.some(row=>pantryStockId(row.key||row.name,'')===pantryStockId(x.name,'')&&mismatches[pantryStockId(row.key||row.name,row.unit)]?.length));
  const reviewText=unknown.length||incompatible.length?'PANTRY saved. '+(unknown.length?'Amount unknown for '+unknown.map(x=>x.name).join(', ')+': these selections have not reduced To buy. Enter an amount or choose Enough for this week. ':'')+(incompatible.length?'Check the units for '+incompatible.map(x=>x.name).join(', ')+': those shopping amounts still need review.':''):'';
  if(reviewText){
   note.textContent=reviewText;drawOverview();const first=unknown[0]||incompatible[0],key=sid(first.loc,first.name);
   const pantry=document.getElementById('bbSimplePantry');if(pantry)pantry.open=true;
   rows.querySelectorAll('[data-bb5-qty]').forEach(input=>{if(input.dataset.bb5Qty===key){input.focus({preventScroll:true});input.closest('[data-bb5-row]').scrollIntoView({behavior:'smooth',block:'center'});}});
  }
  if(window.BBReceiptHost?.confirmCurrentPantry){
   let synced;reconcile.disabled=true;
   try{synced=await window.BBReceiptHost.confirmCurrentPantry({stock:nextStock});}
   catch{note.textContent=reviewText+' Your amounts are saved on this device. Online Pantry confirmation needs another attempt.';return;}
   finally{reconcile.disabled=false;}
   if(!synced?.ok||synced.needsReview){
    note.textContent=reviewText+' Your amounts are saved on this device. Review the saved online pantry before reconciling Shopping.';
    void window.BBReceiptHost.reviewPantry();return;
   }
  }
  if(reviewText)return;
  note.textContent='✓ PANTRY confirmed. '+chosen.filter(x=>x.qty!==null).length+' measured item(s) saved. Shopping needs have been recalculated.';
  const shopTab=document.querySelector('.tab[data-tab="shop-list"]');
  if(shopTab){shopTab.click();window.scrollTo({top:0,behavior:'instant'})}
  else{drawOverview()}

 });
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
const start=()=>{const app=document.getElementById('app');if(!app)return;build();new MutationObserver(()=>build()).observe(app,{childList:true,subtree:false})};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
