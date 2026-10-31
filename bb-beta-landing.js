/* BasketBoss Beta landing — public recipe demo only.
 * No access to account credentials, D1, Paddle, private recipes or local plans.
 * The authoritative app remains at /index.html.
 */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const FALLBACK=[
  {id:'fajitas',name:'Sheet-pan chicken fajitas',category:'Mexican · Family favourite',mins:30,servings:6,cost:22.6,image:'release-assets/basketboss-v17/images/existing/fajitas.webp',ingredients:[['Chicken breast'],['Mixed peppers'],['Tortilla wraps'],['Soured cream'],['Cheddar'],['Fajita seasoning']]},
  {id:'creamy-pasta',name:'Creamy garlic parmesan chicken pasta',category:'Italian · Comfort food',mins:30,servings:4,cost:15.11,image:'release-assets/basketboss-v17/images/existing/creamy-pasta.webp',ingredients:[]},
  {id:'chickpea-curry',name:'Creamy chickpea & spinach curry',category:'Vegetarian · Pantry-friendly',mins:25,servings:4,cost:11.99,image:'release-assets/basketboss-v17/images/existing/chickpea-curry.webp',ingredients:[]}
 ];
 const safeSrc=r=>typeof r.image==='string'&&/^release-assets\/basketboss-v17\/images\/existing\/[a-z0-9-]+\.webp$/.test(r.image)?'/'+r.image:'/icons/basketboss-crowned-v1766-192.png';
 const valid=r=>r&&typeof r.id==='string'&&/^[a-z0-9-]{1,80}$/.test(r.id)&&typeof r.name==='string'&&r.name.length<110&&r.image&&Array.isArray(r.ingredients)&&r.ingredients.length<=60&&Number.isFinite(Number(r.cost))&&Number(r.cost)>=0&&Number.isFinite(Number(r.servings))&&Number(r.servings)>0;
 const GBP=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'});
 const money=n=>n==null||!Number.isFinite(Number(n))?'Estimate unavailable':GBP.format(n);
 const elem=(tag,cls,content)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(content!==undefined)el.textContent=String(content);return el};
 let publicRecipes=[...FALLBACK], shown=[...FALLBACK], portions=[6,4,4],offset=0,activeTab='plan';
 let normalizedById=new Map(),pricingReady=false;
 // This public sample uses UK packs. The full app supports saved shopping regions.
 const MARKET='UK';
 const demoChecked=new Set();
 const dayNames=['Monday','Tuesday','Wednesday'];
 const portionsFor=r=>Math.min(10,Math.max(1,Math.round(Number(r.servings)||4)));
 function mealEstimate(recipe,servings){
  if(!pricingReady)return {amount:null,items:[],unpriced:1};
  return window.BBPriceV19.estimateMeal({recipe,normalized:normalizedById.get(recipe.id),servings,market:MARKET});
 }
 function total(){
  const amounts=shown.map((r,i)=>mealEstimate(r,portions[i]).amount);
  return amounts.some(n=>n==null)?null:amounts.reduce((sum,n)=>sum+n,0);
 }
 function renderTotal(){const target=$('demo-total');if(target)target.textContent='Estimated meals (UK): '+money(total())}
 function renderMeals(){
  const container=$('demo-meals');if(!container)return;
  container.replaceChildren();
  shown.forEach((r,i)=>{
   const row=elem('article','meal-row');
   const img=document.createElement('img');img.src=safeSrc(r);img.alt='';img.loading='lazy';row.append(img);
   const description=elem('div');description.append(elem('span','day',dayNames[i]),elem('h4','',r.name),elem('p','meta',String(Number(r.mins)||'—')+' min · '+(r.category||'Family meal')));row.append(description);
   const controls=elem('div','meal-controls');
   const stepper=elem('div','stepper');stepper.setAttribute('aria-label','Servings for '+r.name);
   const minus=elem('button','','−');minus.type='button';minus.setAttribute('aria-label','Remove a serving of '+r.name);
   const amount=elem('output','',portions[i]);amount.setAttribute('aria-live','polite');
   const plus=elem('button','','+');plus.type='button';plus.setAttribute('aria-label','Add a serving of '+r.name);
   const price=elem('span','meal-price');
   const update=()=>{amount.textContent=portions[i];const estimate=mealEstimate(r,portions[i]);price.textContent=money(estimate.amount)+(estimate.amount==null?'':' est.');minus.disabled=portions[i]<=1;plus.disabled=portions[i]>=10;renderTotal();if(activeTab==='shop')renderShopping()};
   minus.addEventListener('click',()=>{portions[i]=Math.max(1,portions[i]-1);update()});
   plus.addEventListener('click',()=>{portions[i]=Math.min(10,portions[i]+1);update()});
   stepper.append(minus,amount,plus);controls.append(stepper,price);row.append(controls);container.append(row);update();
  });
  renderTotal();
 }
 const AISLES={Produce:'Fruit & Veg','Meat & Fish':'Meat & Fish','Dairy & Chilled':'Dairy & Chilled',Bakery:'Bakery','Cupboard / Pantry':'Cupboard & Essentials','Household & Other':'Other'};
 const AISLE_ORDER=['Fruit & Veg','Meat & Fish','Dairy & Chilled','Bakery','Cupboard','Cupboard & Essentials','Other'];
 // Combine only unambiguous compatible amounts; never guess pack sizes or mixed units.
 function combinedQuantity(amounts){
  const values=amounts.filter(Boolean);
  if(values.length<=1)return values[0]||'';
  const unitAliases={kg:'g',g:'g',l:'ml',ml:'ml',clove:'cloves',cloves:'cloves',tbsp:'tbsp',tsp:'tsp',can:'cans',cans:'cans',pepper:'peppers',peppers:'peppers',pack:'packs',packs:'packs'};
  const parsed=values.map(v=>{const m=/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|cloves?|tbsp|tsp|cans?|peppers?|packs?)$/i.exec(v.trim());
   if(m){const base=unitAliases[m[2].toLowerCase()];const factor=(m[2].toLowerCase()==='kg'||m[2].toLowerCase()==='l')?1000:1;return {n:Number(m[1])*factor,unit:base}};
   const plain=/^(\d+(?:\.\d+)?)$/.exec(v.trim());return plain?{n:Number(plain[1]),unit:'count'}:null;
  });
  if(parsed.some(x=>!x)||parsed.some(x=>x.unit!==parsed[0].unit))return values.join(' + ');
  const total=parsed.reduce((v,x)=>v+x.n,0);if(!Number.isFinite(total))return values.join(' + ');
  const display=n=>String(Number(n.toFixed(2)));
  const unit=parsed[0].unit;
  if(unit==='g'&&total>=1000)return display(total/1000)+' kg';
  if(unit==='ml'&&total>=1000)return display(total/1000)+' l';
  return display(total)+(unit==='count'?'':' '+(unit==='cloves'&&total===1?'clove':unit==='cans'&&total===1?'can':unit==='peppers'&&total===1?'pepper':unit==='packs'&&total===1?'pack':unit));
 }
 function rowsForShopping(){
  if(!pricingReady)return [];
  const api=window.BBPriceV19,byName=new Map();
  for(let i=0;i<shown.length;i++){
   const r=shown[i];const ratio=portions[i]/Number(r.servings||4);
   const source=normalizedById.get(r.id);
   if(!source)continue;
   for(const entry of source.ingredients){
    const name=entry.key||entry.name;
    const amount=entry.quantity==null?NaN:Number(entry.quantity)*ratio;
    const normalized=api.normalizeUnit(name,amount,entry.unit);
    const key=api.canonical(name)+'|'+(normalized?.unit||entry.unit);
    if(!byName.has(key))byName.set(key,{key,name,unit:normalized?.unit||entry.unit,
      aisle:AISLES[api.aisle(name)]||'Other',quantity:0,amounts:[],cost:null,unpriced:false});
    const row=byName.get(key);
    if(normalized)row.quantity+=normalized.quantity;else row.unpriced=true;
   }
  }
  // Shared ingredients are combined before rounding to purchased packs, including
  // cupboard containers that the meal estimate charges only by the amount used.
  return [...byName.values()].map(row=>{
   if(!row.unpriced){
    const quote=api.price({name:row.name,quantity:row.quantity,unit:row.unit,market:MARKET});
    row.cost=quote?.packAmount??null;
    row.amounts=[api.formatQuantity(row.quantity,row.unit,MARKET)];
   }
   return row;
  }).sort((a,b)=>AISLE_ORDER.indexOf(a.aisle)-AISLE_ORDER.indexOf(b.aisle)||a.name.localeCompare(b.name));
 }
 function renderShopping(){
  const destination=$('demo-shopping');if(!destination)return;
  const rows=rowsForShopping();
  const nChecked=rows.filter(row=>demoChecked.has(row.key)).length;
  const basketTotal=!pricingReady||rows.some(row=>row.cost==null)?null:rows.reduce((sum,row)=>sum+row.cost,0);
  const pct=rows.length?Math.round(nChecked/rows.length*100):0;
  const content=elem('div','shop-content');
  const hero=elem('div','shop-hero');
  hero.append(elem('p','shop-eyebrow','✦ BASKETBOSS · YOUR SHOP'),elem('h4','','Ready for the aisles?'),elem('p','',"From the three real sample recipes above. Check off what you've picked up — this demo never changes your actual basket."));
  const metrics=elem('div','shop-metrics');
  for(const [value,label] of [[rows.length-nChecked,'Still to buy'],[nChecked,'Bought'],[money(basketTotal),'Est. basket (UK)']]){
   const tile=elem('div','shop-metric');tile.append(elem('strong','',value),elem('span','',label));metrics.append(tile);
  }
  hero.append(metrics);
  const progress=elem('div','shop-progress');progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','Sample shopping progress');progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');progress.setAttribute('aria-valuenow',String(pct));
  const fill=elem('div','shop-progress-fill');fill.style.width=pct+'%';progress.append(fill);hero.append(progress,elem('p','shop-progress-caption',`${pct}% checked off · ${rows.length} items`));
  content.append(hero);
  if(!pricingReady)content.append(elem('p','shop-footnote','Pack estimates unavailable. Open the full app to review ingredient quantities and prices.'));
  const byAisle=new Map();for(const row of rows){if(!byAisle.has(row.aisle))byAisle.set(row.aisle,[]);byAisle.get(row.aisle).push(row)}
  for(const [aisle,items] of byAisle){
   const section=elem('section','shop-aisle');const h=elem('h5','',aisle);section.append(h);
   const ul=elem('ul','shop-aisle-list');
   for(const row of items){
    const li=elem('li','shop-item');const label=document.createElement('label');
    const tick=document.createElement('input');tick.type='checkbox';tick.checked=demoChecked.has(row.key);tick.setAttribute('aria-label','Mark '+row.name+' bought in the sample list');
    tick.addEventListener('change',()=>{if(tick.checked)demoChecked.add(row.key);else demoChecked.delete(row.key);renderShopping()});
    const desc=elem('span','shop-item-name');desc.append(elem('strong','',row.name),elem('small','',combinedQuantity(row.amounts)||'See recipe for quantity'));
    label.append(tick,desc,elem('span','shop-item-price',money(row.cost)+(row.cost==null?'':' est.')));li.append(label);ul.append(li);
   }
   section.append(ul);content.append(section);
  }
  content.append(elem('p','shop-footnote','UK sample: quantities scale before packs are counted. Meals include only the share of cupboard staples used; Shopping includes replacement packs and combines shared ingredients. In the app, choose your region and supermarket; dated online guides cover selected UK products and regional estimates fill gaps.'));
  destination.replaceChildren(content);
 }
 function wirePantryDemo(){
  const confirm=$('confirm-pantry-demo'),reset=$('reset-pantry-demo'),available=$('pantry-available'),buy=$('pantry-to-buy'),note=$('pantry-demo-note');
  if(!confirm||!reset||!available||!buy||!note)return;
  function render(done){available.textContent=done?'300g in Kitchen':'Not confirmed';buy.textContent=done?'0g to buy · 50g remains':'250g to buy';note.textContent=done?'After confirming the 500g pack and using 200g, the saved 300g can cover a 250g recipe next week (50g remains). Actual stock changes require Finish Shop and safe-storage confirmation.':'Tap confirm to see how 300g of unused food can count towards next week’s shopping.';confirm.disabled=done;}
  confirm.addEventListener('click',()=>render(true));
  reset.addEventListener('click',()=>render(false));
  render(false);
 }
 function switchTab(next){activeTab=next;const plan=next==='plan';$('demo-plan').hidden=!plan;$('demo-shop').hidden=plan;$('tab-plan').setAttribute('aria-selected',String(plan));$('tab-shop').setAttribute('aria-selected',String(!plan));if(!plan)renderShopping()}
 function chooseWeek(){
  const candidates=publicRecipes.filter(r=>valid(r)&&safeSrc(r).includes('/release-assets/')&&!/dessert|breakfast|pancake|cookie|brownie/i.test([r.category,r.tag,r.name].join(' ')));
  if(candidates.length>=3){if(offset===0){const pinned=['fajitas','creamy-pasta','chickpea-curry'];const lookup=new Map(candidates.map(r=>[r.id,r]));shown=pinned.map(id=>lookup.get(id)||FALLBACK.find(x=>x.id===id))}else shown=[0,1,2].map(i=>candidates[(offset+i)%candidates.length]);}
  else shown=[...FALLBACK];
  portions=shown.map(portionsFor);demoChecked.clear();renderMeals();renderShopping();
 }
 let cookStep=0,cookRecipe=null;
 function renderCook(){
  const steps=cookRecipe?.method||cookRecipe?.steps;
  if(!Array.isArray(steps)||!steps.length)return;
  $('cook-recipe-name').textContent=cookRecipe.name;
  $('cook-step-count').textContent=`Step ${cookStep+1} of ${steps.length}`;
  $('cook-step-text').textContent=steps[cookStep];
  $('cook-prev').disabled=cookStep===0;
  $('cook-next').textContent=cookStep===steps.length-1?'Start again ↺':'Next step →';
 }
 $('cook-prev')?.addEventListener('click',()=>{cookStep=Math.max(0,cookStep-1);renderCook()});
 $('cook-next')?.addEventListener('click',()=>{if(!cookRecipe)return;const steps=cookRecipe.method||cookRecipe.steps;cookStep=(cookStep+1)%steps.length;renderCook()});
 function renderRecipes(){
  const box=$('landing-recipes');if(!box)return;box.replaceChildren();
  const featured=['fajitas','creamy-pasta','chickpea-curry'].map(id=>publicRecipes.find(x=>x.id===id)||FALLBACK.find(x=>x.id===id));
  for(const r of featured){const card=elem('article','recipe-card');const img=document.createElement('img');img.src=safeSrc(r);img.loading='lazy';img.alt=r.name;const body=elem('div','recipe-body');body.append(elem('p','','BASKETBOSS FREE RECIPE'),elem('h3','',r.name),elem('div','recipe-meta',`${r.mins} min · ${portionsFor(r)} servings`));const link=elem('a','view-link','Explore recipes in the app →');link.href='/app';body.append(link);card.append(img,body);box.append(card)}
 }
 $('tab-plan')?.addEventListener('click',()=>switchTab('plan'));
 $('tab-shop')?.addEventListener('click',()=>switchTab('shop'));
 $('new-demo-week')?.addEventListener('click',()=>{offset+=3;chooseWeek();switchTab('plan')});
 document.querySelector('[data-landing-phone-shop]')?.addEventListener('click',()=>switchTab('shop'));
 wirePantryDemo();
 function normalizedCatalogue(data,recipes){
  if(!Array.isArray(data?.recipes)||data.recipes.length!==100)throw Error('public_quantities_invalid');
  const sources=new Map(recipes.map(r=>[r.id,r])),out=new Map();
  for(const recipe of data.recipes){
   const original=sources.get(recipe?.id);
   if(!original||out.has(recipe.id)||Number(recipe.servings)!==Number(original.servings)
      ||!Array.isArray(recipe.ingredients)||recipe.ingredients.length!==original.ingredients?.length)
    throw Error('public_quantities_mismatch');
   if(!recipe.ingredients.every(ingredient=>ingredient&&typeof ingredient.key==='string'&&ingredient.key.length>0&&ingredient.key.length<=120
      &&(ingredient.unit==null||(typeof ingredient.unit==='string'&&['g','kg','ml','l','each','clove','cloves','tsp','tbsp','pack','None'].includes(ingredient.unit)))
      &&(ingredient.quantity==null||(typeof ingredient.quantity==='string'&&ingredient.quantity.length<=120&&!Number.isFinite(Number(ingredient.quantity)))||(Number.isFinite(Number(ingredient.quantity))&&Number(ingredient.quantity)>=0&&Number(ingredient.quantity)<=1000000))))
    throw Error('public_quantities_invalid');
   out.set(recipe.id,{...recipe,ingredients:recipe.ingredients.map(ingredient=>({...ingredient,
    quantity:ingredient.quantity==null||!Number.isFinite(Number(ingredient.quantity))?null:Number(ingredient.quantity)}))});
  }
  return out;
 }
 async function load(){
  try{
   const [response,quantityResponse]=await Promise.all([
    fetch('/recipes.json',{cache:'no-store',credentials:'omit',redirect:'error'}),
    fetch('/normalized-ingredient-database.json',{cache:'no-store',credentials:'omit',redirect:'error'})
   ]);
   if(!response.ok||!quantityResponse.ok)throw Error('catalogue_unavailable');
   const [data,quantityData]=await Promise.all([response.json(),quantityResponse.json()]);
   if(!Array.isArray(data)||data.length!==100)throw Error('public_catalogue_invalid');
   const safe=data.filter(valid);if(safe.length!==100||new Set(safe.map(r=>r.id)).size!==100)throw Error('public_catalogue_invalid');
   const quantities=normalizedCatalogue(quantityData,safe);
   publicRecipes=safe;normalizedById=quantities;
   pricingReady=typeof window.BBPriceV19?.estimateMeal==='function';
  }catch(_){/* Keep public descriptions, but never invent prices if pack data is unavailable. */}
  cookRecipe=publicRecipes.find(r=>r.id==='fajitas'&&Array.isArray(r.method)&&r.method.length)||null;
  if(!cookRecipe){
   const label=$('cook-step-text');if(label)label.textContent='Open BasketBoss to view the complete cooking instructions.';
   $('cook-prev').disabled=true;$('cook-next').disabled=true;
  }else renderCook();
  chooseWeek();renderRecipes();
 }
 load();
})();
