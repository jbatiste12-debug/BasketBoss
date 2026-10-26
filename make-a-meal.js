(()=>{'use strict';
const STORE='basketboss_makeameal_v1_inventory', STOCK='basketboss_321_v7_measured_pantry', STATE='basketboss_321_unified_state_v1';
const FOODS={
 cupboard:[['🍚','Rice'],['🍝','Pasta'],['🍅','Tinned tomatoes'],['🥫','Tinned beans'],['🫘','Lentils'],['🫒','Cooking oil'],['🧂','Salt'],['🌶️','Pepper'],['🧄','Garlic'],['🌿','Dried herbs'],['🥄','Soy sauce'],['🥖','Breadcrumbs'],['🧊','Stock cubes'],['🥣','Oats'],['🍯','Sugar'],['🥖','Flour'],['🥜','Peanut butter'],['🍯','Honey'],['🥕','Potatoes'],['🥫','Tuna'],['🥫','Chickpeas'],['🍜','Noodles'],['🧂','Paprika'],['🍅','Ketchup'],['🥚','Mayonnaise']],
 fridge:[['🥛','Milk'],['🧀','Cheddar'],['🥣','Yoghurt'],['🍖','Ham'],['🧈','Butter'],['🥚','Eggs'],['🍗','Cooked chicken'],['🥛','Cream'],['🧀','Mozzarella'],['🥬','Spinach'],['🥒','Cucumber'],['🥗','Lettuce'],['🥓','Bacon'],['🍄','Mushrooms'],['🍅','Tomatoes'],['🥕','Carrots'],['🧅','Onion'],['🫑','Peppers'],['🥦','Broccoli'],['🧀','Cheese strings']],
 freezer:[['🫛','Frozen peas'],['🌽','Frozen sweetcorn'],['🥦','Frozen broccoli'],['🍗','Frozen chicken'],['🐟','Frozen fish'],['🦐','Frozen prawns'],['🍟','Frozen chips'],['🥬','Frozen spinach'],['🥩','Frozen mince'],['🍞','Frozen bread'],['🫐','Frozen berries'],['🍖','Frozen sausages'],['🍲','Frozen leftovers'],['🧊','Frozen mixed vegetables'],['🥔','Frozen potato wedges']]
};
function bb176MakeMealAllowed(recipe){
 if(!recipe || !recipe.id)return false;
 const host=location.hostname.toLowerCase();
 let demoPremium=false;
 if(host==='basketboss-v17513-qa.basketboss-v1749-qa.pages.dev'){
   demoPremium=window.BasketBossCloudflareQA?.isPremium?.()===true;
  }else if(host==='localhost'||host==='127.0.0.1'||host.endsWith('.app.github.dev')){
  try{demoPremium=localStorage.getItem('basketboss_v17513_private_qa_membership_view_v1')==='premium'||sessionStorage.getItem('bb174_premium_local_demo_v1')==='premium';}catch(_){demoPremium=false;}
 }
 const leftover=String(recipe.id).startsWith('leftover-')||/leftover magic/i.test(String(recipe.tag||'')+' '+String(recipe.category||''));
 if(leftover && !demoPremium)return false;
 return demoPremium || (Array.isArray(window.BB173_FREE_RECIPE_IDS) && window.BB173_FREE_RECIPE_IDS.includes(recipe.id));
}

let area='cupboard',mode='only',recipes=[],inventory={},results=[],suggestionOffset=0,photoFile=null;
 let bb5Confirmed=false;
let aiEnabled=false, turnstileToken='',turnstileWidgetId=null,scanRevision=0,scanInFlight=false,generateInFlight=false;
const $=s=>document.querySelector(s), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const alias={'cheddar cheese':'cheddar','mature cheddar':'cheddar','cheese (cheddar)':'cheddar','tinned kidney beans':'tinned beans','canned beans':'tinned beans','olive oil':'cooking oil','sunflower oil':'cooking oil','vegetable oil':'cooking oil','chopped tomatoes':'tinned tomatoes','canned tomatoes':'tinned tomatoes','eggs':'egg','tomatoes':'tomato','potatoes':'potato','peppers':'pepper','mushrooms':'mushroom','carrots':'carrot','onions':'onion','wraps':'wrap','peas':'pea','frozen peas':'pea','sweetcorn':'sweetcorn','frozen sweetcorn':'sweetcorn','yoghurts':'yoghurt','chickpeas':'chickpea'};
function canon(s){let t=String(s||'').toLowerCase().normalize('NFKC').replace(/\([^)]*\)/g,' ').replace(/[–—-]/g,' ').replace(/[^\p{L}\s]/gu,' ').replace(/\s+/g,' ').trim();if(alias[t])return alias[t];t=t.replace(/^(fresh|cooked|raw|diced|chopped|sliced|grated|frozen)\s+/g,'').trim();if(alias[t])return alias[t];if(t.endsWith('ies'))t=t.slice(0,-3)+'y';else if(t.endsWith('s')&&!t.endsWith('ss'))t=t.slice(0,-1);return alias[t]||t}
function load(){try{const v=JSON.parse(localStorage.getItem(STORE)||'{}');if(v&&typeof v==='object'&&!Array.isArray(v))inventory=v}catch(e){inventory={}};
// Import measured pantry stock without modifying its original records.
try{const measured=JSON.parse(localStorage.getItem(STOCK)||'{}');if(measured&&typeof measured==='object'){for(const [id,q] of Object.entries(measured)){if(!id.includes('|')||!(Number(q)>0))continue;const [name,unit]=[id.slice(0,id.lastIndexOf('|')),id.slice(id.lastIndexOf('|')+1)];const loc=Object.keys(FOODS).find(k=>FOODS[k].some(([,n])=>canon(n)===canon(name)))||'cupboard';const key=uid(name,loc);if(!inventory[key])inventory[key]={name,loc,selected:true,qty:Number(q),unit};}}}catch(e){}
// Legacy name-only ownership is displayed as unknown quantity, not unlimited stock.
try{const state=JSON.parse(localStorage.getItem(STATE)||'{}');for(const [name,val] of Object.entries(state.pantry||{})){if(!val)continue;const loc=Object.keys(FOODS).find(k=>FOODS[k].some(([,n])=>canon(n)===canon(name)))||'cupboard';const key=uid(name,loc);if(!inventory[key])inventory[key]={name,loc,selected:true,qty:null,unit:'each'}}}catch(e){}
}
function save(){try{localStorage.setItem(STORE,JSON.stringify(inventory));return true}catch(e){message('Cannot save ingredients on this device. Check available storage.','warning');return false}}
function uid(n,l){return l+'|'+canon(n)}
/* BB-BETA-QA-PHASE2: suggested units for NEW selections only. Existing stock stays untouched. */
function bb25SuggestedUnit(name){
 const n=String(name||'').toLowerCase();
 if(/\b(?:garlic|cloves?)\b/.test(n))return 'clove';
 if(/\b(?:milk|cream|oil|vinegar|juice|stock|soy sauce|syrup)\b/.test(n))return 'ml';
 if(/\b(?:eggs?|onions?|lemons?|limes?|apples?|bananas?|peppers?|bagels?|wraps?|bread loaf|tins?|cans?)\b/.test(n))return 'each';
 if(/\b(?:fish fillets?|frozen fish|prawns?|shrimp|crisps|frozen leftovers)\b/.test(n))return 'pack';
 if(/\b(?:rice|pasta|lentils?|cheese|cheddar|broccoli|spinach|peas|carrots?|potatoes|flour|sugar|oats|beans|noodles|chicken|beef|lamb|ham|butter|yoghurt|berries|mushrooms|tuna|chickpeas|breadcrumbs|salt)\b/.test(n))return 'g';
 return 'each';
}

function list(){return Object.values(inventory).filter(x=>x&&typeof x.name==='string'&&x.selected)}
function stockDisplay(name){const s=canon(name);try{const data=JSON.parse(localStorage.getItem(STOCK)||'{}');const relevant=Object.entries(data).filter(([k,v])=>canon(k.split('|')[0])===s&&Number(v)>0);return relevant.map(([k,v])=>`${v} ${k.split('|').pop()}`).join(' + ')}catch(e){return ''}}
function stateCount(){const items=list();$('#stockCount').textContent=items.length+' ingredient'+(items.length===1?'':'s');$('#selected').innerHTML=items.length?items.map(x=>`<div class="stock-item"><span>${esc(x.name)} · ${esc(x.loc)} ${x.qty?`· ${esc(x.qty)} ${esc(x.unit)}`:(stockDisplay(x.name)?`· measured: ${esc(stockDisplay(x.name))}`:'· quantity not checked')}</span><button type="button" data-remove="${esc(uid(x.name,x.loc))}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`).join(''):'<p class="hint">No foods selected.</p>';bb5DrawMealReview(items)}
// Batch 5: a single review list for all three storage locations. Editing stays in memory
// until the user confirms. Shopping quantity deductions are a separate explicit action.
const BB5_MEAL_UNITS=['each','g','kg','ml','l','pack','clove'];
function bb5MealPanel(){
 let panel=$('#bb5MealReview');if(panel)return panel;
 const sections=$('#inventorySections');if(!sections)return null;
 panel=document.createElement('section');panel.id='bb5MealReview';panel.className='bb5-meal-review';
 panel.innerHTML='<h3>YOUR INGREDIENTS <span id="bb5MealCount"></span></h3><p class="hint">One list for Cupboard, Fridge and Freezer. Edit quantities or remove foods, then confirm to see matching meals. This never updates Shopping.</p><div id="bb5MealRows"></div><p id="bb5MealMessage" role="status" aria-live="polite"></p><button type="button" id="bb5GenerateFromReview" class="button">✓ Confirm — Make a Meal</button>';
 sections.insertAdjacentElement('afterend',panel);
 const css=document.createElement('style');css.id='bb5-meal-review-css';css.textContent=`
 #bb5MealReview{padding:17px;margin:15px 0;background:#f0f7ee;border:1px solid #cee2cf;border-radius:17px;color:#173e38}
 #bb5MealReview h3{margin:0 0 8px;font-size:20px}
 .bb5-meal-item{display:grid;grid-template-columns:minmax(120px,1fr) 95px 100px auto;gap:8px;align-items:end;border-bottom:1px solid #cbded0;padding:10px 0}
 .bb5-meal-item strong{align-self:center;font-size:13px;overflow-wrap:anywhere}.bb5-meal-item strong small{display:block;font-size:11px;color:#658071;font-weight:500}
 .bb5-meal-item label{font-size:11px;font-weight:700;display:grid;gap:5px}
 .bb5-meal-item input,.bb5-meal-item select{max-width:100%;width:100%;padding:10px 6px;min-width:0;border-radius:8px;border:1px solid #b4cdb9;background:white;color:#193f36;font-size:16px}
 .bb5-meal-item button{border:1px solid #eed3c6;border-radius:8px;background:#fff3ee;color:#783e27;padding:10px;font-size:12px;font-weight:750}
 #bb5GenerateFromReview{width:100%;padding:14px;margin-top:12px;min-height:48px}
 #bb5MealMessage{font-size:12px;color:#345d48;min-height:16px}
 @media(max-width:520px){.bb5-meal-item{grid-template-columns:minmax(70px,1fr) minmax(80px,1fr) minmax(70px,1fr)}.bb5-meal-item strong{grid-column:1/-1}.bb5-meal-item button{grid-column:1/-1;justify-self:start}}
 `;document.head.append(css);
 panel.addEventListener('input',e=>{const k=e.target.dataset.bb5MealQty;if(!k||!inventory[k])return;inventory[k].qty=e.target.value;bb5Confirmed=false;bb74MealOverview(list());renderRecipes()});
 panel.addEventListener('change',e=>{const k=e.target.dataset.bb5MealUnit;if(!k||!inventory[k])return;inventory[k].unit=e.target.value;bb5Confirmed=false;bb74MealOverview(list());renderRecipes()});
 panel.addEventListener('click',e=>{const rm=e.target.closest('[data-bb5-meal-remove]');if(rm){const old=inventory[rm.dataset.bb5MealRemove];if(old){inventory[rm.dataset.bb5MealRemove]={...old,selected:false};bb5Confirmed=false;renderTiles()}return}
 if(!e.target.closest('#bb5GenerateFromReview'))return;
 const selected=list();if(!selected.length){$('#bb5MealMessage').textContent='Select at least one food first.';return;}
 for(const food of selected){const raw=food.qty==null?'':String(food.qty).trim();if(!BB5_MEAL_UNITS.includes(food.unit||'each')){$('#bb5MealMessage').textContent='Check the unit for '+food.name;return;}
 if(raw===''){food.qty=null;continue}
 const n=Number(raw);if(!Number.isFinite(n)||n<=0||n>1000000||(['each','pack','clove'].includes(food.unit)&&!Number.isInteger(n))){$('#bb5MealMessage').textContent='Check '+food.name+': enter a positive amount; whole numbers for each, packs and cloves.';return;}food.qty=n;}
 // The names/quantities are stored in Make a Meal inventory. Deducting grocery stock
 // still requires the dedicated Reconcile action in BasketBoss Shopping.
 if(!save()){$('#bb5MealMessage').textContent='Could not confirm ingredients; device storage may be full.';return;}
 bb5Confirmed=true;suggestionOffset=0;renderTiles();$('#bb5MealMessage').textContent='✓ Ingredients confirmed. Your meal ideas are shown below. Shopping has not changed.';
 $('#recipes')?.scrollIntoView({behavior:'smooth',block:'start'});
 });
 return panel;
}
function bb74MealOverview(items){
 const parent=$('#inventorySections');if(!parent)return;
 let peek=$('#bb74MealPeek');
 if(!peek){peek=document.createElement('aside');peek.id='bb74MealPeek';peek.setAttribute('aria-label','Overview of foods selected for Make a Meal');peek.innerHTML='<div class="bb74-meal-head"><strong>Your ingredients <span id="bb74MealPeekCount">(0)</span></strong><span class="bb74-meal-draft">Review before making a meal</span></div><div id="bb74MealPeekItems" class="bb74-meal-peek-items" aria-live="polite"></div><button id="bb74MealJump" type="button">↓ Review quantities &amp; confirm — Make a Meal</button>';parent.insertAdjacentElement('beforebegin',peek);peek.querySelector('#bb74MealJump').addEventListener('click',()=>{$('#bb5MealReview')?.scrollIntoView({behavior:'smooth',block:'start'})});}
 peek.querySelector('#bb74MealPeekCount').textContent='('+items.length+')';
 peek.querySelector('.bb74-meal-draft').textContent=bb5Confirmed?'✓ Confirmed':'Not confirmed';
 peek.querySelector('#bb74MealPeekItems').innerHTML=items.length?items.map(x=>{
  const raw=x.qty==null?'':String(x.qty).trim();return `<span class="bb74-meal-chip">${x.loc==='fridge'?'🥛':x.loc==='freezer'?'❄️':'🥫'} <strong>${esc(x.name)}</strong> <small>${raw?esc(raw)+' '+esc(x.unit||'each'):'Amount unknown'}</small></span>`;
 }).join(''):'<span class="bb74-meal-empty">Tap the ingredient tiles to build your list.</span>';
 peek.querySelector('#bb74MealJump').disabled=!items.length;
}
function bb5DrawMealReview(items){
 const panel=bb5MealPanel();if(!panel)return;
 const rows=panel.querySelector('#bb5MealRows');panel.querySelector('#bb5MealCount').textContent='('+items.length+')';
 bb74MealOverview(items);
 rows.innerHTML=items.length?['cupboard','fridge','freezer'].map(loc=>{const group=items.filter(x=>x.loc===loc);if(!group.length)return '';const heading={cupboard:'🥫 CUPBOARD',fridge:'🥛 FRIDGE',freezer:'❄️ FREEZER'}[loc];return `<h4 class="bb82-review-category">${heading} · ${group.length}</h4>`+group.map(x=>{const key=uid(x.name,x.loc),opts=BB5_MEAL_UNITS.map(u=>`<option value="${u}" ${x.unit===u?'selected':''}>${u==='l'?'litres':u}</option>`).join('');return `<div class="bb5-meal-item"><strong>${esc(x.name)}<small>${esc(x.loc)}</small></strong><label>Amount<input data-bb5-meal-qty="${esc(key)}" min="0.01" max="1000000" step="any" type="number" inputmode="decimal" placeholder="Unknown" value="${x.qty??''}"></label><label>Unit<select data-bb5-meal-unit="${esc(key)}">${opts}</select></label><button type="button" data-bb5-meal-remove="${esc(key)}">Remove</button></div>`}).join('')}).join(''):'<p class="hint">Tap ingredient tiles above to build your list.</p>';
}
// Smart, local thumbnail matching. No third-party image requests and no AI calls.
// Never use photographs of fresh or raw food to misrepresent a processed food.
const BB_PHOTO_EXACT={
 'tomato':'tomato','tomatoes':'tomato','fresh tomato':'tomato','cherry tomatoes':'tomato',
 'lettuce':'lettuce','romaine lettuce':'lettuce','little gem lettuce':'lettuce',
 'red onion':'red-onion','red onions':'red-onion',
 'onion':'onion','onions':'onion','white onion':'onion','brown onion':'onion',
 'parmesan':'parmesan','parmesan cheese':'parmesan',
 'egg':'eggs','eggs':'eggs','free range eggs':'eggs',
 'raw chicken breast':'chicken-breast','chicken breast':'chicken-breast','chicken breasts':'chicken-breast','chicken fillet':'chicken-breast','chicken fillets':'chicken-breast',
 'rice':'rice','white rice':'rice','basmati rice':'rice','long grain rice':'rice',
 'broccoli':'broccoli','fresh broccoli':'broccoli','broccoli florets':'broccoli',
 'yellow pepper':'yellow-pepper','yellow peppers':'yellow-pepper','yellow bell pepper':'yellow-pepper',
 'red pepper':'red-pepper','red peppers':'red-pepper','red bell pepper':'red-pepper',
 'courgette':'courgette','courgettes':'courgette','zucchini':'courgette'
};
const BB_EMOJI_MATCH=[
 [/\b(chicken|poultry|turkey)\b/i,'🍗'],[/\b(beef|steak|mince|lamb|pork)\b/i,'🥩'],[/\b(bacon|ham|sausage)\b/i,'🥓'],
 [/\b(salmon|tuna|cod|haddock|fish)\b/i,'🐟'],[/\b(prawn|shrimp)\b/i,'🦐'],[/\b(egg)\b/i,'🥚'],
 [/\b(milk|cream)\b/i,'🥛'],[/\b(cheese|cheddar|mozzarella|feta|halloumi)\b/i,'🧀'],[/\b(yoghurt|yogurt)\b/i,'🥣'],
 [/\b(butter)\b/i,'🧈'],[/\b(rice)\b/i,'🍚'],[/\b(pasta|spaghetti|penne|fusilli|macaroni)\b/i,'🍝'],
 [/\b(noodle)\b/i,'🍜'],[/\b(bread|roll|baguette)\b/i,'🥖'],[/\b(flour|oat|porridge)\b/i,'🌾'],
 [/\b(tomato|ketchup)\b/i,'🍅'],[/\b(pepper|paprika|chilli|chili)\b/i,'🫑'],[/\b(onion)\b/i,'🧅'],
 [/\b(potato|chip|fries|wedges)\b/i,'🥔'],[/\b(carrot)\b/i,'🥕'],[/\b(cucumber|courgette|zucchini)\b/i,'🥒'],
 [/\b(broccoli)\b/i,'🥦'],[/\b(spinach|lettuce|kale|leaf|greens)\b/i,'🥬'],[/\b(mushroom)\b/i,'🍄'],
 [/\b(pea|bean|lentil|chickpea)\b/i,'🫘'],[/\b(sweetcorn|corn)\b/i,'🌽'],[/\b(garlic)\b/i,'🧄'],
 [/\b(apple)\b/i,'🍎'],[/\b(banana)\b/i,'🍌'],[/\b(orange|clementine|tangerine)\b/i,'🍊'],
 [/\b(lemon)\b/i,'🍋'],[/\b(lime)\b/i,'🍋‍🟩'],[/\b(avocado)\b/i,'🥑'],[/\b(berry|berries|blueberry)\b/i,'🫐'],
 [/\b(strawberry)\b/i,'🍓'],[/\b(grape)\b/i,'🍇'],[/\b(pear)\b/i,'🍐'],
 [/\b(nut|peanut)\b/i,'🥜'],[/\b(honey)\b/i,'🍯'],[/\b(oil)\b/i,'🫒'],[/\b(salt)\b/i,'🧂'],
 [/\b(herb|basil|parsley|coriander)\b/i,'🌿']
];
function bbPhotoName(name){const nameKey=String(name||'').toLowerCase().normalize('NFKC').trim().replace(/\s+/g,' ');return BB_PHOTO_EXACT[nameKey]||null}
function bbFoodEmoji(name,preferred){
 const text=String(name||'').toLowerCase();
 if(/\b(sausages?|bratwurst|frankfurter)\b/.test(text))return '🌭';
 if(/\b(breadcrumbs?|panko)\b/.test(text))return '🍞';
 if(/\b(black pepper|ground pepper|peppercorns?|white pepper)\b/.test(text))return '🧂';
 if(/\b(mushrooms?)\b/.test(text))return '🍄';
 if(/\b(carrots?)\b/.test(text))return '🥕';
 if(/\b(prawns?|shrimps?)\b/.test(text))return '🦐';
 if(/\b(cucumbers?)\b/.test(text))return '🥒';
 if(/\b(paprika|chilli powder|chili powder)\b/.test(text))return '🌶️';
 for(const [pattern,glyph] of BB_EMOJI_MATCH)if(pattern.test(name))return glyph;
 return preferred&&preferred!=='✏️'?preferred:'🥣';
}
function bbFoodVisual(name,preferred){const photo=bbPhotoName(name);return photo?`<img class="bb-food-photo" src="food-thumbs/${photo}.webp" alt="" loading="lazy" decoding="async">`:`<span class="bb-food-fallback"><span class="bb-food-emoji" aria-hidden="true">${bbFoodEmoji(name,preferred)}</span></span>`}
function bbDisplayFoodName(name){
 const raw=String(name||'').trim().replace(/\s+/g,' ');
 // Preserve user-created names; just tidy labels typed entirely in lowercase or uppercase.
 if(raw===raw.toLocaleLowerCase('en-GB')||raw===raw.toLocaleUpperCase('en-GB'))
   return raw.toLocaleLowerCase('en-GB').replace(/(^|[\s(-])([\p{L}])/gu,(_,gap,letter)=>gap+letter.toLocaleUpperCase('en-GB'));
 return raw;
}
function bbStripItem(group){
 const x=group.first,count=group.count;
 const safeName=esc(bbDisplayFoodName(x.name)),safeLocation=esc(x.loc),id=esc(uid(x.name,x.loc));
 const label=count>1?`Review ${count} ${safeName} entries in your ingredient list`:`Find ${safeName} in ${safeLocation}`;
 const duplicate=count>1?`<span class="bb-mini-group-count" aria-label="${count} entries">×${count}</span>`:'';
 // Do not remove multiple different stock/location records with one button.
 const remove=count===1?`<button class="bb-mini-remove" type="button" data-strip-remove="${id}" aria-label="Remove ${safeName}">×</button>`:'';
 return `<div class="bb-mini-tile">${duplicate}<button class="bb-mini-focus" type="button" data-jump-food="${id}" aria-label="${label}"><span class="bb-mini-image">${bbFoodVisual(x.name)}</span><span class="bb-mini-name">${safeName}</span></button>${remove}</div>`;
}
function bbGroupStrip(items){
 const groups=new Map();
 for(const item of items){const key=canon(item.name)||item.name.toLocaleLowerCase('en-GB');
  if(groups.has(key))groups.get(key).count++;
  else groups.set(key,{first:item,count:1});
 }
 return [...groups.values()];
}
function renderIngredientStrips(){const items=list();for(const [source,box,count] of [['scan','#bbScannedStrip','#bbScannedCount'],['added','#bbAddedStrip','#bbAddedCount']]){const match=items.filter(x=>(x.source==='scan'?'scan':'added')===source);const target=$(box);if(!target)continue;$(count).textContent=match.length+' item'+(match.length===1?'':'s');target.innerHTML=match.length?bbGroupStrip(match).map(bbStripItem).join(''):`<div class="bb-strip-empty">${source==='scan'?'Confirmed photo-scan foods will appear here.':'Your manually added foods will appear here.'}</div>`;}}
function foodTile(emoji,name,location){const id=uid(name,location),saved=inventory[id],isOn=!!saved?.selected;return `<button class="tile bb74-food-tile" type="button" data-food="${esc(name)}" aria-pressed="${isOn}" aria-label="${isOn?'Remove':'Select'} ${esc(name)} from ${esc(location)}"><span class="bb-tile-image">${bbFoodVisual(name,emoji)}</span><span class="bb74-tile-name">${esc(name)}</span><span class="quantity">${isOn?(saved.qty?`${esc(saved.qty)} ${esc(saved.unit)}`:'✓ In my list'):'Tap to add'}</span></button>`}
function renderTiles(){for(const location of Object.keys(FOODS)){const presets=FOODS[location];const custom=list().filter(x=>x.loc===location&&!presets.some(([,n])=>canon(n)===canon(x.name)));const container=$('#tiles-'+location);container.innerHTML=presets.map(([emoji,name])=>foodTile(emoji,name,location)).join('')+custom.map(x=>foodTile('✏️',x.name,location)).join('')}stateCount();renderIngredientStrips();renderRecipes();bb82SyncLocationCounts()}
function bbPantryName(name){const val=String(name||'').trim().toLowerCase().replace(/\s+/g,' ');const aliases={'potatoes':'potato','eggs':'egg','tomatoes':'tomato','onions':'onion','carrots':'carrot','bananas':'banana','apples':'apple','lemons':'lemon','limes':'lime','courgettes':'courgette','mushrooms':'mushroom','scallops':'scallop','wraps':'wrap'};return aliases[val]||val}
function setFood(name,qty,unit,location){const id=uid(name,location);if(inventory[id]?.selected&&qty==null){inventory[id]={...inventory[id],selected:false}}else inventory[id]={...inventory[id],name:name.trim(),loc:location,selected:true,qty:qty||null,unit:unit||inventory[id]?.unit||bb25SuggestedUnit(name),source:inventory[id]?.source||'added'};bb5Confirmed=false;suggestionOffset=0;renderTiles()}
function normalizeIngredients(r){return (r.ingredients||[]).filter(a=>Array.isArray(a)&&a.length>1).map(a=>({name:String(a[0]),amount:String(a[1])}))}
function isDinner(r){const category=String(r.category+' '+r.tag).toLowerCase(),name=String(r.name).toLowerCase();return !/dessert|baking|breakfast|brunch|sweet treats|sweet bread|pudding/.test(category)&&!/\b(cakes?|biscuits?|cookies?|brownies?|cupcakes?|muffins?|puddings?|granola|fudge|tart)\b/.test(name)}
// Recipe discovery should never confuse a theme match with an ingredient the family owns.
// In particular, ready-to-eat cooked chicken is NOT raw chicken breast and rice
// is not automatically the specialised rice needed for risotto.
const FOOD_FAMILIES={
 rice:/\brice\b/,
 chicken:/\bchicken\b/,
 potato:/\bpotato(?:es)?\b/,
 pasta:/\b(?:pasta|spaghetti|penne|fusilli|macaroni|linguine|tagliatelle)\b/,
 tomato:/\btomato(?:es)?\b/,
 cheese:/\b(?:cheese|cheddar|mozzarella|parmesan|feta|halloumi)\b/,
 egg:/\beggs?\b/,
 broccoli:/\bbroccoli\b/,
 spinach:/\bspinach\b/,
 salmon:/\bsalmon\b/,
 pea:/\bpeas?\b/,
 bean:/\bbeans?\b/,
 mushroom:/\bmushrooms?\b/,
 mince:/\bmince\b/,
 noodle:/\bnoodles?\b/
};
function family(name){
 const text=String(name||'').toLowerCase().replace(/[–—-]/g,' ');
 for(const [family,re] of Object.entries(FOOD_FAMILIES)){
  if(!re.test(text))continue;
  if(family==='chicken'&&/\b(?:stock|broth|bouillon|gravy|seasoning|flavour|flavor)\b/.test(text))continue;
  if(family==='rice'&&/\b(?:vinegar|flour|milk|noodles?|cakes?|pudding|wine|paper|crackers?)\b/.test(text))continue;
  if(family==='tomato'&&/\b(?:ketchup|chutney|paste|puree|purée)\b/.test(text))continue;
  if(family==='cheese'&&/\b(?:cheese\s+strings?)\b/.test(text))return 'cheese';
  return family;
 }
 return null;
}
function ingredientMatch(selected,required){
 const sel=String(selected||'').toLowerCase(),req=String(required||'').toLowerCase();
 const have=canon(sel),need=canon(req);
 const a=family(sel),b=family(req);
 const cookedHave=/\b(?:cooked|ready.to.eat|roast|leftover|pre.cooked)\b/.test(sel);
 const cookedNeed=/\b(?:cooked|ready.to.eat|roast|leftover|pre.cooked)\b/.test(req);
 const rawNeed=/\b(?:raw|uncooked|breast|thighs?|fillets?|whole chicken|drumsticks?)\b/.test(req);
 const frozenHave=/\bfrozen\b/.test(sel);
 // An ingredient is counted as on hand only for a direct, safe name match.
 if(have===need){
  if(cookedHave&&!cookedNeed&&(a==='chicken'||a==='salmon'||a==='mince'))return 'related';
  if(frozenHave&&!/\bfrozen\b/.test(req)&&(a==='chicken'||a==='fish'||a==='mince'))return 'related';
  return 'exact';
 }
 if(!a||!b||a!==b)return null;
 if(a==='chicken'||a==='salmon'){
  if(cookedHave&&(!cookedNeed||rawNeed))return 'related';
  if(cookedNeed&&!cookedHave)return 'related';
 }
 // Broader ingredient-family matches are inspiration only until the shopper
 // confirms that the actual variety, form and amount can be substituted.
 return 'related';
}
function scoreRecipe(r,have){
 const ing=normalizeIngredients(r);if(!ing.length)return null;
 const matched=[],related=[],missing=[];
 for(const ingredient of ing){
  let best=null;
  for(const stock of have){const q=ingredientMatch(stock.name,ingredient.name);if(q==='exact'){best={stock,match:q};break}if(q==='related'&&!best)best={stock,match:q}}
  if(!best)missing.push(ingredient);
  else if(best.match==='exact')matched.push(ingredient);
  else {related.push({ingredient,stock:best.stock});missing.push(ingredient)}
 }
 const title=String(r.name||'');
 const titleMatched=have.some(stock=>{const f=family(stock.name);return f?new RegExp('\\b'+f+'\\b','i').test(title):false});
 if(!matched.length&&!related.length&&!titleMatched)return null;
 const suggestions=matched.length+related.length;
 // Show recipes with a real ingredient-family connection before title-only hits.
 const score=matched.length*9+related.length*6+(titleMatched?2:0)-missing.length*.15;
 return {r,matched,related,missing,ing,score,titleMatched,suggestions};
}
function groupRecipe(x){return !x.missing.length?'ready':x.missing.length<=2?'near':'idea'}
function recipeCard(x,index){
 const ready=x.missing.length===0;
 const anyRelated=x.related.length>0;
 const badge=ready?'✓ Ingredient names match':x.missing.length<=2?'1–2 extra ingredients':'More ingredients needed';
 const note=anyRelated?`<div class="related-note"><strong>Check substitutions:</strong> ${x.related.map(z=>`${esc(z.stock.name)} is related to ${esc(z.ingredient.name)}`).join('; ')}. They are not necessarily interchangeable. ${x.related.some(z=>/\bcooked chicken\b/i.test(z.stock.name))?'Cooked and raw chicken require different preparation.':''}</div>`:'';
 return `<article class="recipe" data-id="${esc(x.r.id)}"><h3>${esc(x.r.name)}</h3><p class="meta">⏱ ${Number(x.r.mins)||'?'} mins · ${Number(x.r.servings)||4} servings · Indicative recipe cost £${Number(x.r.cost||0).toFixed(2)}</p><span class="pill">${x.matched.length} matching ingredient${x.matched.length===1?'':'s'}</span>${x.related.length?`<span class="pill amber">${x.related.length} related item${x.related.length===1?'':'s'}</span>`:''}<span class="pill ${ready?'':'amber'}">${badge}</span>${x.missing.length?`<div class="warning"><strong>Still required or check substitution:</strong> ${x.missing.map(z=>esc(z.name)).join(', ')}</div>`:''}${note}<p class="hint">Confirm quantities, substitutions, allergies and freshness. Prices are indicative, not checkout guarantees.</p><details><summary>See ingredients and cooking instructions</summary><ul>${x.ing.map(z=>`<li>${esc(z.name)} — ${esc(z.amount)}</li>`).join('')}</ul><ol>${(x.r.method||[]).map(z=>`<li>${esc(z)}</li>`).join('')}</ol><p class="hint">Allergen notes: ${esc(x.r.allergy_advice||'Check packaging and cross-contact risks.')}</p></details><div class="inline-actions"><button type="button" class="button" data-plan="${index}">Choose this meal</button></div></article>`;
}
function renderRecipes(){
 const have=list(),dest=$('#recipes'),summary=$('#matchSummary');
 if(!bb5Confirmed){results=[];suggestionOffset=0;dest.innerHTML='<div class="empty">Review your selected foods, then tap <strong>Confirm — Make a Meal</strong> to see suitable recipes.</div>';summary.textContent='Your ingredient selection is a draft until you confirm it.';return}
 if(!have.length){results=[];suggestionOffset=0;dest.innerHTML='<div class="empty">Start by selecting what you have.</div>';summary.textContent='Select a food to browse recipes containing it.';return}
 const matched=[];
 for(const r of recipes){if(!bb176MakeMealAllowed(r))continue;if(!isDinner(r))continue;const item=scoreRecipe(r,have);if(item)matched.push(item)}
 matched.sort((a,b)=>{
  const priority=mode==='only'?{ready:0,near:1,idea:2}:{near:0,ready:1,idea:2};
  return priority[groupRecipe(a)]-priority[groupRecipe(b)]||b.score-a.score||a.missing.length-b.missing.length||a.r.name.localeCompare(b.r.name);
 });
 results=matched;
 if(suggestionOffset>=results.length)suggestionOffset=0;
 const names=have.length<=3?have.map(x=>x.name).join(', '):have.length+' selected foods';
 summary.textContent=`Showing the 3 closest ideas from ${matched.length} related BasketBoss dinners for ${names}.`;
 if(!matched.length){dest.innerHTML='<div class="empty">No related dinner recipes found yet. Try another ingredient or add your own.</div>';return}
 const start=suggestionOffset,shown=matched.slice(start,start+3);
 const end=start+shown.length;
 const cards=shown.map((x,i)=>recipeCard(x,start+i)).join('');
 dest.innerHTML=`<div class="discovery-explainer">${mode==='only'?'Closest matches first.':'Meals needing up to two extras are prioritised.'} Some suggestions still need more shopping; see each recipe before choosing.</div><div class="recipe-grid">${cards}</div><div class="suggestion-footer"><span>Suggestions ${start+1}–${end} of ${matched.length}</span>${matched.length>3?'<button type="button" id="showMoreRecipes" class="button secondary">↻ Show another 3</button>':''}</div>`;
}
function message(msg,type='success'){const dest=bbActiveTool==='meal'&&!$('#bbToolStage').hidden?$('#generated'):$('#bbToast');dest.hidden=false;dest.innerHTML=`<div class="${type}">${esc(msg)}</div>`;dest.scrollIntoView({behavior:'smooth',block:'nearest'})}
let pendingRecipe=null;
function openMealReview(i){
 const x=results[i];if(!x)return;
 const dialog=$('#mealReview');const title=$('#mealReviewTitle'),body=$('#mealReviewItems'),days=$('#mealReviewDay');
 let data=null;try{data=JSON.parse(localStorage.getItem(STATE)||'null')}catch(e){}
 if(!data||!Array.isArray(data.planned)){
  message('Please open BasketBoss Planner once to initialise your saved weekly plan, then choose your meal again.','warning');return;
 }
 if(data.planned.some(p=>String(p.recipeId)===String(x.r.id))){message('That recipe is already in your Planner. Check Shopping for its grocery requirements.','warning');return;}
 const free=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].filter(d=>!data.planned.some(p=>p.day===d));
 pendingRecipe=i;
 title.textContent=x.r.name;
 body.replaceChildren();
 const p=document.createElement('p');p.className='hint';p.textContent='These ingredients are not directly confirmed as available in sufficient quantity. Related ingredients may need a different variety or preparation.';body.append(p);
 if(x.missing.length){const ul=document.createElement('ul');x.missing.forEach(m=>{const li=document.createElement('li');li.textContent=m.name+' — '+m.amount;ul.append(li)});body.append(ul)}
 else {const p=document.createElement('p');p.textContent='All ingredient names are matched. BasketBoss will still check available pantry quantities and add anything else required.';body.append(p)}
 days.replaceChildren();free.forEach(d=>{const op=document.createElement('option');op.value=d;op.textContent=d;days.append(op)});
 $('#mealReviewSave').disabled=!free.length;
 $('#mealReviewNoDay').hidden=!!free.length;
 if(typeof dialog.showModal==='function')dialog.showModal();else {dialog.setAttribute('open','');}
}
function confirmMeal(){
 if(pendingRecipe===null)return;
 const i=pendingRecipe,x=results[i];if(!x)return;
 const day=$('#mealReviewDay').value;
 try{
  const saved=JSON.parse(localStorage.getItem(STATE)||'null');if(!saved||!Array.isArray(saved.planned))throw Error('Planner data unavailable');
  if(saved.planned.some(p=>p.day===day)||!['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].includes(day))throw Error('That day is no longer free; reopen the meal selector.');
  if(saved.planned.some(p=>String(p.recipeId)===String(x.r.id)))throw Error('That recipe is already planned.');
  const next=JSON.parse(JSON.stringify(saved));next.planned.push({recipeId:x.r.id,day});
  const value=JSON.stringify(next);localStorage.setItem(STATE,value);if(localStorage.getItem(STATE)!==value)throw Error('Could not verify Planner save');
  const dialog=$('#mealReview');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
  pendingRecipe=null;
  message(x.r.name+' added to '+day+'. BasketBoss Shopping now calculates the meal’s required groceries, deducting recognised pantry stock where possible. No separate duplicate list was created.');
 }catch(e){const error=$('#mealReviewError');error.textContent=e.message;error.hidden=false;}
}
function copyMissing(i){const x=results[i];if(!x)return;const text=x.missing.map(z=>z.name+' — '+z.amount).join('\n');if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>message('Missing-item checklist copied. Paste it into your shopping list.')).catch(()=>message(text,'warning'));else message(text,'warning')}

// Public beta: the API is a same-origin Cloudflare Pages Function. No API or testing tokens in browser.
function resetHumanCheck(){
 turnstileToken='';
 if(turnstileWidgetId!==null&&window.turnstile?.reset)window.turnstile.reset(turnstileWidgetId);
}
function setupHumanCheck(siteKey){
 if(!siteKey||!/^[-_a-zA-Z0-9]+$/.test(siteKey)){return;}
 const script=document.createElement('script');
 script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
 script.async=true;
 script.onload=()=>{
  if(!window.turnstile){$('#aiHumanStatus').textContent='Human verification unavailable.';return;}
  turnstileWidgetId=window.turnstile.render('#aiHumanCheck',{sitekey:siteKey,action:'bb_ai',
   callback:token=>{turnstileToken=token;$('#aiHumanStatus').textContent='Verified. You can now request one AI action.';},
   'expired-callback':()=>{turnstileToken='';$('#aiHumanStatus').textContent='Verification expired; please complete it again.';},
   'error-callback':()=>{turnstileToken='';$('#aiHumanStatus').textContent='Human verification failed. Try again.';}
  });
 };
 script.onerror=()=>{$('#aiHumanStatus').textContent='Human verification could not load. Built-in recipes remain available.';};
 document.head.appendChild(script);
}
function likelyPerishable(name){return /\b(chicken|beef|pork|lamb|fish|prawns?|shrimp|salmon|raw meat|turkey|milk|yoghurt|cream|cheese|eggs?|ham|bacon)\b/i.test(name) && !/\b(tinned|canned|shelf.stable|dried|powdered)\b/i.test(name);}

function renderScanResponse(scan){
 const items=Array.isArray(scan?.items)?scan.items.filter(x=>x&&typeof x.name==='string'&&x.name.trim()).slice(0,20):[];
 const seen=new Set();const unique=items.filter(x=>{const id=canon(x.name);if(!id||seen.has(id))return false;seen.add(id);return true});
 $('#scanResults').innerHTML=unique.length?`<div class="success">Gemini found possible ingredients. Tick only those you recognise, then choose where each one belongs before saving. AI estimates are not counted as measured stock.</div><form id="reviewFoods"><div class="scan-result-list">${unique.map(x=>`<div class="scan-result-row"><label class="scan-item-label"><input type="checkbox" name="food" value="${esc(x.name.trim().slice(0,70))}"><span><strong>${esc(x.name.trim().slice(0,70))}</strong><span class="scan-item-meta">Estimated ${esc(String(x.estimatedQuantity||'unknown').slice(0,60))} · ${esc(String(x.confidence||'uncertain').slice(0,15))} confidence</span><span class="scan-item-meta">${esc(String(x.notes||'').slice(0,150))}</span></span></label><label class="scan-destination">Store this item in<select class="field" data-scan-location aria-label="Choose storage location for ${esc(x.name.trim().slice(0,70))}"><option value="">Choose when saving…</option><option value="fridge">🥛 Fridge</option><option value="freezer">🧊 Freezer</option><option value="cupboard">🥫 Cupboard</option></select></label></div>`).join('')}</div><div class="scan-review-actions"><p id="scanSaveError" class="warning" role="alert" hidden></p><button class="button ai-primary-button" type="submit">✓ Save my confirmed foods</button><p class="hint">Choose an appropriate storage location for each selected food. Raw meat and other perishable foods must not go in the cupboard.</p></div></form>`:'<div class="warning">No foods identified. Use manual ingredient entry instead.</div>';
}
function bbPaidToken(){
 try{
  const s=JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');
  return typeof s?.access_token==='string' &&
    Number(s.expires_at)*1000>Date.now()+5000?s.access_token:null;
 }catch{return null;}
}
async function requestBody(verb,body){
 if(!aiEnabled)throw Error('Premium AI is not enabled for this account.');
 if(!bbPaidToken())throw Error('Sign in to a verified Premium account first.');
 if(!turnstileToken)throw Error('Complete the human verification above first.');
 const token=turnstileToken;turnstileToken='';
 try{
  const controller=new AbortController();
  const stop=setTimeout(()=>controller.abort(),verb==='scan'?25000:30000);
  let r;
  try{r=await fetch('/api/bb173/'+verb,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+bbPaidToken()},body:JSON.stringify({...body,turnstileToken:token}),cache:'no-store',credentials:'same-origin',signal:controller.signal});}
  catch(err){if(controller.signal.aborted)throw Error('Request timed out. Your selections were not changed; try again or use local recipes.');throw err}
  finally{clearTimeout(stop)}
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(String(j.error||'AI is temporarily unavailable.').slice(0,200));return j;
 }finally{resetHumanCheck();}
}
async function scanPhoto(){
 if(scanInFlight)return;
 const revision=++scanRevision;
 const f=photoFile;if(!f){$('#scanResults').innerHTML='<div class="warning">Choose a photo first.</div>';return}
 if(!f.type.startsWith('image/')||f.size>12*1024*1024){$('#scanResults').innerHTML='<div class="warning">Choose a food-only photo under 12 MB.</div>';return}
 if(!confirm('Send this resized food photograph to Cloudflare and Google Gemini to suggest ingredients? You will review every item before anything is saved. Cancel keeps it on this device.'))return;
 scanInFlight=true;
 const btn=$('#scanBtn');btn.disabled=true;$('#scanResults').innerHTML='<p class="notice">Reducing and scanning your food photo…</p>';
 try{
  const bitmap=await createImageBitmap(f);const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const imageBase64=canvas.toDataURL('image/jpeg',.8).split(',')[1];
  if(!imageBase64||imageBase64.length>2500000)throw Error('Photo remains too large after resizing');
  const res=await requestBody('scan',{mimeType:'image/jpeg',imageBase64});
  if(revision!==scanRevision)return;
  if(!res.ok||!res.reviewRequired)throw Error('AI scan result is not ready for review');
  renderScanResponse(res.scan);
 }catch(e){if(revision===scanRevision)$('#scanResults').innerHTML='<div class="warning">'+esc(e.message)+'. No inventory was changed.</div>'}
 finally{scanInFlight=false;btn.disabled=false}
}
function generate(){
 if(generateInFlight)return;
 if(!bb5Confirmed){message('Confirm your ingredients using “Confirm — Make a Meal” before requesting a recipe.','warning');return}
 const ingredients=[...new Set(list().map(x=>String(x.name||'').trim()).filter(Boolean))];
 if(!ingredients.length){message('Select some ingredients first.','warning');return}
 if(ingredients.length>12){message('Choose up to 12 ingredients for a single AI recipe. Your saved inventory is unchanged.','warning');return}
 if(!confirm('Send these '+ingredients.length+' ingredient names (not stock quantities) to Cloudflare and Google Gemini to suggest a new recipe? Cancel keeps everything local.'))return;
 const btn=$('#generate');generateInFlight=true;btn.disabled=true;$('#generated').innerHTML='<p class="notice">Asking Gemini for a draft meal…</p>';
 requestBody('generate',{ingredients,mode:mode==='only'?'only_have':'up_to_two',servings:4}).then(j=>{
  const r=j.recipe;if(!j.ok||!j.reviewRequired||!r||!Array.isArray(r.ingredients)||!Array.isArray(r.steps)||!Array.isArray(r.extraIngredients))throw Error('Incomplete recipe response');
  const extras=r.ingredients.filter(a=>a.fromHome===false);if(mode==='only'&&(extras.length||r.extraIngredients.length))throw Error('AI suggested ingredients you do not have');
  if(mode==='extras'&&(extras.length>2||r.extraIngredients.length>2))throw Error('AI exceeded the two-extra-ingredient rule');
  const duration=(Number(r.prepMinutes)||0)+(Number(r.cookMinutes)||0),steps=r.steps.slice(0,15),allergens=Array.isArray(r.allergens)?r.allergens:[],safety=Array.isArray(r.safetyNotes)?r.safetyNotes:[];
  $('#generated').innerHTML=`<article class="generated"><div class="eyebrow" style="color:var(--green)">Unverified AI recipe · early access</div><h3>${esc(r.title||'AI meal')}</h3><p>${esc(r.servings)} servings · ${esc(duration)} estimated minutes</p><p>${esc(r.summary||'')}</p><p class="hint">No cost estimate. This AI recipe is NOT automatically added to Planner or Shopping.</p><h4>Ingredients</h4><ul>${r.ingredients.map(a=>`<li>${esc(a.quantity||'Quantity unclear')} ${esc(a.name||'')} · ${a.fromHome===false?'<strong>To buy</strong>':'Have (check quantity)'}</li>`).join('')}</ul><h4>Method (review for food safety)</h4><ol>${steps.map(st=>`<li>${esc(String(st).replace(/^\s*\d+[.)]\s*/,''))}</li>`).join('')}</ol><h4>Possible allergens</h4><p>${esc(allergens.join(', ')||'Review packaged ingredients and allergens yourself')}</p><h4>Food safety reminders</h4><ul>${safety.map(s=>`<li>${esc(s)}</li>`).join('')||'<li>Check safe handling, storage and cooking temperatures.</li>'}</ul><div class="warning">AI-generated, not kitchen-tested or verified as safe for dietary requirements. Confirm all ingredients, allergens, quantities and cooking safety. BasketBoss never automatically adds AI drafts to the Planner.</div></article>`;
 }).catch(e=>{$('#generated').innerHTML='<div class="warning">'+esc(e.message+'. Your saved ingredients were not changed. The built-in recipes remain available.')+'</div>';}).finally(()=>{generateInFlight=false;btn.disabled=false});
}
// One streamlined Make a Meal workspace. Keep the original controls and event hooks.
let bbActiveTool=null,bbSiteKey=null,bbTurnstileLoading=false;
function bbChooseLocation(loc){
 if(!['cupboard','fridge','freezer'].includes(loc))return;
 for(const location of ['cupboard','fridge','freezer']){
  const section=document.querySelector('[data-location="'+location+'"]');
  if(section)section.hidden=location!==loc;
  const button=document.querySelector('[data-select-location="'+location+'"]');
  if(button)button.setAttribute('aria-pressed',String(location===loc));
 }
}
function bbOpenTool(tool){
 if(!['scan','meal'].includes(tool))return;
 bbActiveTool=tool;
 const stage=$('#bbToolStage');stage.hidden=false;
 $('#aiScanner').hidden=tool!=='scan';
 $('#aiMeal').hidden=tool!=='meal';
 document.querySelectorAll('[data-open-tool]').forEach(btn=>btn.setAttribute('aria-expanded',String(btn.dataset.openTool===tool)));
 if(aiEnabled&&bbSiteKey&&!bbTurnstileLoading&&turnstileWidgetId===null){bbTurnstileLoading=true;setupHumanCheck(bbSiteKey)}
 stage.scrollIntoView({behavior:'smooth',block:'start'});
}
function bbCloseTool(){
 const stage=$('#bbToolStage');stage.hidden=true;bbActiveTool=null;
 document.querySelectorAll('[data-open-tool]').forEach(btn=>btn.setAttribute('aria-expanded','false'));
 document.querySelector('[data-open-tool]')?.focus({preventScroll:true});
}
function bb74InstallTileStyles(){
 if(document.querySelector('#bb74MakeMealStyles'))return;
 const style=document.createElement('style');style.id='bb74MakeMealStyles';style.textContent=`
 #inventorySections [data-food].bb74-food-tile{position:relative!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:flex-start!important;gap:6px!important;min-width:0!important;min-height:153px!important;max-width:100%!important;padding:9px 6px!important;border:1px solid #cfe2d4!important;border-radius:14px!important;background:white!important;color:#194534!important;box-shadow:0 1px 3px #173d2610!important;text-align:center!important;overflow:hidden!important;line-height:1.25!important}
 #inventorySections [data-food].bb74-food-tile[aria-pressed=true]{background:#eaf7ed!important;border:2px solid #2a7c4c!important;padding:8px 5px!important;box-shadow:inset 0 0 0 1px #b1d8bc!important}
 #inventorySections [data-food].bb74-food-tile[aria-pressed=true]:after{content:'✓';position:absolute;top:4px;right:5px;background:#267348;color:#fff;border-radius:99px;min-width:20px;height:20px;display:grid;place-items:center;font-size:12px;font-weight:900}
 #inventorySections [data-food].bb74-food-tile .bb-tile-image{width:72px!important;height:72px!important;min-width:72px;min-height:72px;margin:0!important;background:#f4f6ef;border-radius:12px;display:grid!important;place-items:center!important;overflow:hidden!important;flex:none!important}
 #inventorySections [data-food].bb74-food-tile .bb-food-photo{width:100%!important;height:100%!important;object-fit:cover!important;display:block!important;aspect-ratio:1/1}
 #inventorySections [data-food].bb74-food-tile .bb-food-fallback{display:grid!important;place-items:center!important;width:100%!important;height:100%!important}
 #inventorySections [data-food].bb74-food-tile .bb-food-emoji{font-size:34px!important;line-height:1.1!important}
 #inventorySections [data-food].bb74-food-tile .bb74-tile-name{font-size:13px!important;font-weight:850!important;line-height:1.25!important;overflow-wrap:anywhere!important;display:block!important;min-height:31px}
 #inventorySections [data-food].bb74-food-tile .quantity{font-size:11px!important;color:#537067!important;font-weight:700!important;line-height:1.15!important;margin-top:auto!important;white-space:normal!important}
 #inventorySections [data-food].bb74-food-tile[aria-pressed=true] .quantity{color:#226742!important}
 #inventorySections #tiles-cupboard,#inventorySections #tiles-fridge,#inventorySections #tiles-freezer{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(110px,1fr))!important;gap:9px!important}
 #bb74MealPeek{border:1px solid #b7d8c0;background:#eaf7ed;border-radius:14px;padding:13px;margin:12px 0 16px;color:#17472e;scroll-margin-top:110px}
 #bb74MealPeek .bb74-meal-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:7px;font-size:15px}
 #bb74MealPeek .bb74-meal-draft{font-size:11px;color:#47775b;font-weight:750}
 #bb74MealPeek .bb74-meal-peek-items{max-height:145px;overflow:auto;display:flex;align-items:start;align-content:start;gap:7px;flex-wrap:wrap;margin:9px 0}
 #bb74MealPeek .bb74-meal-chip{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;background:white;border:1px solid #c6dfce;padding:6px 8px;border-radius:9px;font-size:12px;max-width:100%}
 #bb74MealPeek .bb74-meal-chip small{font-size:11px;background:#eef5ee;padding:3px 5px;color:#44664e;border-radius:6px;font-weight:700}
 #bb74MealPeek .bb74-meal-empty{font-size:12px;color:#64816d}
 #bb74MealJump{display:block;width:100%;border:0;border-radius:11px;background:#267047;color:white;font-weight:850;min-height:46px;padding:12px;font-size:13px}
 #bb74MealJump:disabled{opacity:.45}
 #bb5MealReview{scroll-margin-top:100px}
 @media(max-width:540px){#inventorySections #tiles-cupboard,#inventorySections #tiles-fridge,#inventorySections #tiles-freezer{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important}
 #inventorySections [data-food].bb74-food-tile{min-height:145px!important;padding:8px 3px!important}
 #inventorySections [data-food].bb74-food-tile[aria-pressed=true]{padding:7px 2px!important}
 #inventorySections [data-food].bb74-food-tile .bb-tile-image{width:61px!important;height:61px!important;min-width:61px;min-height:61px}
 #inventorySections [data-food].bb74-food-tile .bb74-tile-name{font-size:11px!important;min-height:31px}
 #inventorySections [data-food].bb74-food-tile .quantity{font-size:10px!important}}
 @media(max-width:340px){#inventorySections #tiles-cupboard,#inventorySections #tiles-fridge,#inventorySections #tiles-freezer{grid-template-columns:repeat(2,minmax(0,1fr))!important}}

 /* 7.10: keep selected-food previews compact; one editable confirmation list owns quantities. */
 #bbAddedStrip,#bbScannedStrip{display:flex!important;flex-wrap:wrap!important;overflow:visible!important;max-width:100%!important;gap:7px!important;align-items:stretch!important}
 #bbAddedStrip .bb-mini-tile,#bbScannedStrip .bb-mini-tile{display:flex!important;align-items:center!important;min-height:46px!important;max-width:100%!important;width:auto!important;min-width:0!important;flex:0 1 auto!important;border:1px solid #d2e5d7!important;border-radius:10px!important;padding:4px 8px!important;background:#f9fcfa!important}
 #bbAddedStrip .bb-mini-focus,#bbScannedStrip .bb-mini-focus{display:flex!important;align-items:center!important;gap:7px!important;flex-direction:row!important;max-width:100%!important;padding:0!important;text-align:left!important}
 #bbAddedStrip .bb-mini-image,#bbScannedStrip .bb-mini-image{width:34px!important;height:34px!important;min-width:34px!important;min-height:34px!important;margin:0!important;display:grid!important;place-items:center!important;overflow:hidden!important;border-radius:8px!important}
 #bbAddedStrip .bb-mini-image img,#bbScannedStrip .bb-mini-image img{width:100%!important;height:100%!important;object-fit:cover!important}
 #bbAddedStrip .bb-mini-name,#bbScannedStrip .bb-mini-name{max-width:125px!important;font-size:11px!important;line-height:1.2!important;font-weight:750!important;white-space:normal!important;overflow-wrap:anywhere!important}
 #bbAddedStrip .bb-mini-remove,#bbScannedStrip .bb-mini-remove{position:static!important;flex:0 0 28px!important;min-width:28px!important;min-height:28px!important;display:grid!important;place-items:center!important}
 #bb5MealReview{border:2px solid #badac1!important;box-shadow:0 5px 16px #173d2612!important}
 #bb5GenerateFromReview{font-size:15px!important;letter-spacing:0!important}
 `;document.head.appendChild(style);
 document.addEventListener('error',e=>{const img=e.target;if(!(img instanceof HTMLImageElement)||!img.matches('#inventorySections .bb-food-photo'))return;const fallback=document.createElement('span');fallback.className='bb-food-fallback';const emoji=document.createElement('span');emoji.className='bb-food-emoji';emoji.textContent=bbFoodEmoji(img.closest('[data-food]')?.dataset.food||'');fallback.append(emoji);img.replaceWith(fallback)},true);
}
/* Batch 7.12: Same pick -> review -> confirm layout as Kitchen, no second pantry database. */
function bb82SyncLocationCounts(){
 for(const details of document.querySelectorAll('.bb82-ingredient-location')){
  const loc=details.dataset.bb82Loc;const count=list().filter(x=>x.loc===loc).length;
  const label=details.querySelector('.bb82-location-count');if(label)label.textContent=count+' selected';
 }
}
function bb82UnifyMealLayout(){
 const source=$('#inventorySections'),review=$('#bb5MealReview');if(!source||!review||$('#bb82MealWorkspace'))return;
 const formerDrawer=$('#bbIngredientsDrawer');
 const dashboard=$('.bb-meal-dashboard');if(!dashboard)return;
 const workspace=document.createElement('section');workspace.id='bb82MealWorkspace';
 workspace.setAttribute('aria-label','Choose foods and confirm your Make a Meal ingredients');
 workspace.innerHTML='<div class="bb82-workspace-intro"><span class="bb82-kicker">YOUR KITCHEN</span><h2>What have you got?</h2><p>Open Cupboard, Fridge or Freezer to choose ingredients. Review everything in one list below, then tap Confirm — Make a Meal.</p></div>';
 // Put the main workspace where the old added/scanned thumbnail sections were.
 const oldCards=['#bbAddedStrip','#bbScannedStrip'].map(s=>$(s)?.closest('section')).filter(Boolean);
 const anchor=oldCards[0]||formerDrawer||source;
 anchor.parentElement?.insertBefore(workspace,anchor);
 workspace.appendChild(source);
 // Keep original buttons/forms inside each existing location, only change their wrappers.
 for(const loc of ['cupboard','fridge','freezer']){
  const section=source.querySelector('[data-location="'+loc+'"]');if(!section)continue;
  section.hidden=false;
  const accord=document.createElement('details');accord.className='bb82-ingredient-location';accord.dataset.bb82Loc=loc;
  accord.open=loc==='cupboard';
  const caption={cupboard:'🥫 What is in your Cupboard?',fridge:'🥛 What is in your Fridge?',freezer:'❄️ What is in your Freezer?'}[loc];
  const summary=document.createElement('summary');summary.innerHTML='<strong>'+caption+'</strong><span class="bb82-location-count">0 selected</span>';
  section.parentNode.insertBefore(accord,section);accord.append(summary,section);
 }
 workspace.appendChild(review);
 // Hide obsolete image strips and read-only duplicates: the one review list owns quantities.
 for(const el of oldCards){if(!el.contains(workspace)){el.hidden=true;el.style.display='none';}}
 const oldPeek=$('#bb74MealPeek');if(oldPeek){oldPeek.hidden=true;oldPeek.style.display='none';}
 const oldSelected=$('#selected');if(oldSelected){oldSelected.hidden=true;oldSelected.style.display='none';}
 // Keep any advanced drawer controls, but not the duplicate three-location picker.
 if(formerDrawer){formerDrawer.hidden=true;formerDrawer.style.display='none';}
 bb82SyncLocationCounts();
 const style=document.createElement('style');style.id='bb82-makeameal-layout';style.textContent=`
 #bb82MealWorkspace{background:#fffdf9;border:1px solid #d6e5d9;border-radius:18px;padding:clamp(12px,3vw,22px);margin:15px auto 23px;max-width:1080px;color:#234e39}
 #bb82MealWorkspace .bb82-kicker{color:#398452;font-size:10px;letter-spacing:1px;font-weight:900}
 #bb82MealWorkspace h2{color:#24573e;font-size:clamp(23px,4vw,30px);margin:6px 0 4px}
 #bb82MealWorkspace .bb82-workspace-intro p{font-size:13px;line-height:1.5;color:#547364;margin:4px 0 14px}
 #bb82MealWorkspace #inventorySections{display:block!important;margin:0!important;padding:0!important;border:0!important;max-height:none!important;overflow:visible!important}
 #bb82MealWorkspace .bb82-ingredient-location{display:block!important;border:1px solid #cbded0;border-radius:13px;background:#f9fcf9;margin:8px 0;overflow:hidden}
 #bb82MealWorkspace .bb82-ingredient-location>summary{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:14px 12px;cursor:pointer;min-height:55px;color:#245b3f;list-style-position:inside}
 #bb82MealWorkspace .bb82-location-count{background:#e5f3e7;border-radius:99px;padding:5px 8px;font-size:11px;font-weight:850;white-space:nowrap}
 #bb82MealWorkspace .bb82-ingredient-location>[data-location]{display:block!important;padding:10px 12px 16px!important;background:#fff!important}
 #bb82MealWorkspace [data-select-location]{display:none!important}
 #bb82MealWorkspace #bb5MealReview{background:#f1f8f1!important;margin:20px 0 0!important;border-radius:15px!important}
 #bb82MealWorkspace #bb5MealReview h3{font-size:23px!important;color:#20543a!important;letter-spacing:.4px}
 #bb82MealWorkspace .bb82-review-category{font-size:13px;color:#276046;font-weight:900;margin:16px 0 2px;padding-top:9px;border-top:1px solid #d4e5d7}
 #bb82MealWorkspace .bb5-meal-item{grid-template-columns:minmax(115px,1fr) minmax(75px,95px) minmax(75px,95px) auto!important}
 #bb82MealWorkspace .bb5-meal-item button{min-height:42px;min-width:67px}
 #bb82MealWorkspace #bb5GenerateFromReview{font-size:15px!important;border-radius:12px!important;background:#2d7248!important}
 #bb74MealPeek,#bbAddedStrip,#bbScannedStrip{display:none!important}
 @media(max-width:570px){#bb82MealWorkspace .bb5-meal-item{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
 #bb82MealWorkspace .bb5-meal-item>strong{grid-column:1/-1}
 #bb82MealWorkspace .bb5-meal-item>button{grid-column:1/-1;width:100%}
 #bb82MealWorkspace .bb82-ingredient-location>summary{font-size:13px}}
 `;document.head.append(style);
}
// Batch 7.15: restore the prominent Premium AI entry points without duplicating
// the scanner, generator, inventory, entitlement checks, or request handlers.
function bb15RestorePremiumEntry(){
 const dashboard=document.querySelector('.bb-meal-dashboard');
 const workspace=document.getElementById('bb82MealWorkspace');
 if(document.getElementById('bb15AiPremiumHub')||(!dashboard&&!workspace))return;
 if(!document.getElementById('bb15AiPremiumStyles')){
  const style=document.createElement('style');style.id='bb15AiPremiumStyles';
  style.textContent=`
  #bb15AiPremiumHub{display:block!important;visibility:visible!important;position:relative;isolation:isolate;margin:0 0 20px;padding:clamp(17px,3vw,27px);border-radius:23px;overflow:hidden;color:#fff;background:radial-gradient(ellipse at 90% -20%,#3c8e82a8,transparent 54%),linear-gradient(130deg,#103c52,#245b63 67%,#185746);border:1px solid #367c76;box-shadow:0 15px 35px #163d4730}
  #bb15AiPremiumHub .bb15-ai-kicker{display:inline-flex;align-items:center;gap:6px;letter-spacing:.09em;font-size:10px;text-transform:uppercase;font-weight:900;color:#e5d7a2;background:#ffffff19;border:1px solid #ffffff33;border-radius:99px;padding:6px 10px}
  #bb15AiPremiumHub h2{margin:11px 0 7px;color:#fff!important;font-size:clamp(25px,4vw,35px);letter-spacing:-.035em;line-height:1.1;font-weight:900}
  #bb15AiPremiumHub .bb15-ai-intro{max-width:680px;margin:0 0 15px;font-size:13px;line-height:1.5;color:#d9ede8}
  #bb15AiPremiumHub .bb15-ai-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  #bb15AiPremiumHub .bb15-ai-card{display:flex;flex-direction:column;align-items:flex-start;gap:7px;min-width:0;padding:17px;border:1px solid #ffffff48;border-radius:17px;background:#ffffff15;box-shadow:inset 0 1px #ffffff25;backdrop-filter:blur(4px)}
  #bb15AiPremiumHub .bb15-ai-art{display:grid;place-items:center;border-radius:12px;width:46px;height:46px;background:linear-gradient(145deg,#ffffff32,#d4f0d820);font-size:25px}
  #bb15AiPremiumHub h3{color:#fff!important;font-size:19px;line-height:1.2;margin:2px 0 0}
  #bb15AiPremiumHub .bb15-ai-card p{color:#e4f0ec;font-size:12px;line-height:1.5;margin:0 0 auto}
  #bb15AiPremiumHub .bb17-ai-service{margin:0 0 13px;padding:9px 11px;border:1px solid #ffffff39;border-radius:10px;background:#ffffff13;font-size:12px;color:#f4e4c5;line-height:1.45}
  #bb15AiPremiumHub .bb17-ai-service span{color:#efce84;font-size:11px;margin-right:5px}
  #bb15AiPremiumHub button{font-family:inherit;min-height:47px;width:100%;margin-top:8px;border:1px solid #cce4d4;border-radius:12px;background:#effaf2;color:#1e593d;font-size:14px;font-weight:900;cursor:pointer;padding:10px 12px;touch-action:manipulation}
  #bb15AiPremiumHub button[aria-expanded=true]{background:#ccead6}
  #bb15AiPremiumHub button:focus-visible{outline:3px solid #ffe1a8;outline-offset:3px}
  #bb15AiPremiumHub .bb15-ai-footnote{margin:13px 1px 0;color:#d1e9e2;font-size:11px;line-height:1.45}
  @media(max-width:520px){#bb15AiPremiumHub .bb15-ai-grid{grid-template-columns:1fr}#bb15AiPremiumHub .bb15-ai-card{padding:14px}#bb15AiPremiumHub .bb15-ai-card p{min-height:0}}
  @media(prefers-reduced-motion:reduce){#bb15AiPremiumHub *{scroll-behavior:auto!important}}
  `;document.head.append(style);
 }
 const section=document.createElement('section');section.id='bb15AiPremiumHub';
 section.setAttribute('aria-label','Premium AI tools');
 section.innerHTML=`<span class="bb15-ai-kicker">✦ BasketBoss Premium · AI Studio</span>
 <h2>Make something amazing from what you've got</h2>
 <p class="bb15-ai-intro">Choose your ingredients below for local recipe matches. Premium AI tools offer optional photo recognition or an AI recipe draft when the service is connected.</p>
 <p class="bb17-ai-service"><span aria-hidden="true">●</span> Premium tools are previewed here for everyone. AI requests need an active connection and service access; the local recipe finder still works offline.</p>
 <div class="bb15-ai-grid">
  <article class="bb15-ai-card"><span class="bb15-ai-art" aria-hidden="true">📸</span><h3>Scan ingredients</h3><p>Take or upload a food photo. Review every AI suggestion before saving anything to Kitchen.</p><button type="button" data-open-tool="scan" aria-expanded="false">Open AI Photo Scanner →</button></article>
  <article class="bb15-ai-card"><span class="bb15-ai-art" aria-hidden="true">✨</span><h3>AI Create a Meal</h3><p>Use your confirmed ingredient names to request a draft recipe. The standard recipe finder still works offline.</p><button type="button" data-open-tool="meal" aria-expanded="false">Open AI Meal Creator →</button></article>
 </div><p class="bb15-ai-footnote">Premium early access · AI features need a live connection and may be unavailable in the private Codespaces preview. Your local ingredients and recipes remain accessible.</p>`;
 // Keep AI Studio visibly above the three-section Kitchen workspace,
 // not inside a hidden legacy dashboard or behind the QA/install banners.
 // This is presentation only; existing scan/generate/entitlement handlers remain.
 if(workspace&&workspace.parentNode)workspace.parentNode.insertBefore(section,workspace);
 else dashboard.prepend(section);
}
function init(){bb74InstallTileStyles();load();document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;suggestionOffset=0;document.querySelectorAll('[data-mode]').forEach(t=>t.setAttribute('aria-pressed',String(t.dataset.mode===mode)));renderRecipes()}));
// Dashboard thumbnail controls reuse the existing inventory state and save pathway.
$('.bb-meal-dashboard').addEventListener('click',e=>{
 const opener=e.target.closest('[data-open-tool]');
 if(opener){bbOpenTool(opener.dataset.openTool);return;}
 if(e.target.closest('[data-close-tool]')){bbCloseTool();return;}
 const area=e.target.closest('[data-select-location]');
 if(area){bbChooseLocation(area.dataset.selectLocation);return;}
 const remove=e.target.closest('[data-strip-remove]');
 if(remove){const prior=inventory[remove.dataset.stripRemove];if(prior){inventory[remove.dataset.stripRemove]={...prior,selected:false};bb5Confirmed=false;renderTiles()}return;}
 const jump=e.target.closest('[data-jump-food]');if(!jump)return;
 const ingredient=inventory[jump.dataset.jumpFood];if(!ingredient)return;
 $('#bbIngredientsDrawer').open=true;
 bbChooseLocation(ingredient.loc);
 const section=document.querySelector('[data-location="'+ingredient.loc+'"]');
 section?.scrollIntoView({behavior:'smooth',block:'start'});
 const tile=[...(section?.querySelectorAll('[data-food]')||[])].find(t=>canon(t.dataset.food)===canon(ingredient.name));
 if(tile)setTimeout(()=>tile.focus({preventScroll:true}),250);
});
$('#inventorySections').addEventListener('click',e=>{const b=e.target.closest('[data-food]');if(b){const section=b.closest('[data-location]');if(section)setFood(b.dataset.food,null,null,section.dataset.location)}});
$('#selected').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b){const prior=inventory[b.dataset.remove];if(prior)inventory[b.dataset.remove]={...prior,selected:false};bb5Confirmed=false;renderTiles()}});
for(const form of document.querySelectorAll('[data-add-area]')){
 const field=form.querySelector('[data-food-name]'),unit=form.querySelector('[data-food-unit]');
 if(!field||!unit)continue;
 let manuallyChanged=false;
 unit.addEventListener('change',()=>{manuallyChanged=true});
 field.addEventListener('input',()=>{if(manuallyChanged)return;const suggestion=bb25SuggestedUnit(field.value);if([...unit.options].some(o=>o.value===suggestion))unit.value=suggestion});
 form.addEventListener('reset',()=>{manuallyChanged=false});
}
for(const form of document.querySelectorAll('[data-add-area]'))form.addEventListener('submit',e=>{e.preventDefault();const location=form.dataset.addArea;const name=form.querySelector('[data-food-name]').value.trim();if(!name)return;const raw=form.querySelector('[data-food-qty]').value;const qty=raw?Number(raw):null;const unit=form.querySelector('[data-food-unit]').value;if(raw&&(!Number.isFinite(qty)||qty<=0)){message('Enter a positive stock quantity.','warning');return}if(qty&&['each','pack','clove'].includes(unit)&&!Number.isInteger(qty)){message('Use whole numbers for each, packs or cloves.','warning');return}inventory[uid(name,location)]={...inventory[uid(name,location)],name,loc:location,selected:true,qty,unit,source:'added'};bb5Confirmed=false;renderTiles();form.reset()});
$('#photo').addEventListener('change',e=>{scanRevision++;photoFile=e.target.files?.[0]||null;$('#scanResults').replaceChildren();const p=$('#photoPreview');if(p.dataset.url)URL.revokeObjectURL(p.dataset.url);p.classList.toggle('show',!!photoFile);if(photoFile){p.src=p.dataset.url=URL.createObjectURL(photoFile)}});
$('#scanBtn').addEventListener('click',scanPhoto);
$('#scanResults').addEventListener('submit',e=>{
 if(e.target.id!=='reviewFoods')return;e.preventDefault();
 const form=e.target,err=form.querySelector('#scanSaveError');
 const checked=[...form.querySelectorAll('input[name="food"]:checked')];
 if(!checked.length){err.textContent='Tick at least one food you recognise before saving.';err.hidden=false;return;}
 const chosen=[];
 for(const control of checked){
  const row=control.closest('.scan-result-row'),loc=row?.querySelector('[data-scan-location]')?.value;
  if(!['fridge','freezer','cupboard'].includes(loc)){
   err.textContent='Choose Fridge, Freezer or Cupboard for each selected food before saving.';err.hidden=false;row?.querySelector('[data-scan-location]')?.focus();return;
  }
  if(loc==='cupboard'&&likelyPerishable(control.value)){err.textContent='This food is perishable. Choose Fridge or Freezer after checking its packaging and storage requirements.';err.hidden=false;row?.querySelector('[data-scan-location]')?.focus();return;}
  chosen.push({name:control.value,loc});
 }
 err.hidden=true;
 const prior=JSON.stringify(inventory);
 for(const {name,loc} of chosen){
  const key=uid(name,loc),previous=inventory[key];
  inventory[key]={...previous,name,loc,selected:true,qty:previous?.qty??null,unit:previous?.unit||'each',source:'scan'};
 }
 if(!save()){inventory=JSON.parse(prior);return;}
 renderTiles();
 $('#scanResults').innerHTML='<div class="success">Your '+chosen.length+' reviewed ingredient'+(chosen.length===1?' was':'s were')+' saved to the locations you chose. <button type="button" data-open-tool="meal" class="bb-inline-link">Now make a meal with AI →</button></div>';
});
$('#recipes').addEventListener('click',e=>{const a=e.target.closest('[data-plan]'),more=e.target.closest('#showMoreRecipes');if(a)openMealReview(Number(a.dataset.plan));if(more){suggestionOffset=(suggestionOffset+3)%results.length;renderRecipes();}});
$('#mealReviewSave').addEventListener('click',confirmMeal);
$('#mealReviewCancel').addEventListener('click',()=>{pendingRecipe=null;$('#mealReviewError').hidden=true;});
$('#mealReview').addEventListener('close',()=>{$('#mealReviewError').hidden=true;pendingRecipe=null;});
$('#generate').addEventListener('click',generate);fetch('/api/bb173/status',{cache:'no-store',headers:bbPaidToken()?{'Authorization':'Bearer '+bbPaidToken()}:{}}).then(r=>r.json()).then(j=>{aiEnabled=j.status==='available'&&j.premium_ai===true&&!!j.siteKey;$('#aiStatus').textContent=aiEnabled?'AI early access is available, subject to daily limits.':'Premium AI is unavailable. Browse your available recipes instead.';$('#aiHumanStatus').textContent=aiEnabled?'Complete the human check to make an AI request.':'Human check not needed for the built-in recipes.';if(aiEnabled){bbSiteKey=j.siteKey;if(bbActiveTool&&!bbTurnstileLoading){bbTurnstileLoading=true;setupHumanCheck(bbSiteKey)}}}).catch(()=>{$('#aiStatus').textContent='AI service is not connected — ordinary recipe matching works without it.';$('#aiHumanStatus').textContent='The AI service is unavailable.';});
fetch('recipes.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Recipe library unavailable');return r.json()}).then(data=>{if(!Array.isArray(data)||data.length!==321)throw Error('Recipe library must contain 321 recipes');recipes=data.filter(bb176MakeMealAllowed);renderTiles()}).catch(e=>{message(e.message,'warning');renderTiles()});renderTiles();bb82UnifyMealLayout();bb15RestorePremiumEntry()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
