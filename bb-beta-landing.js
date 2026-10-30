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
 const valid=r=>r&&typeof r.id==='string'&&/^[a-z0-9-]{1,80}$/.test(r.id)&&typeof r.name==='string'&&r.name.length<110&&r.image&&Number.isFinite(Number(r.cost))&&Number(r.cost)>=0&&Number.isFinite(Number(r.servings))&&Number(r.servings)>0;
 const GBP=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'});
 const money=n=>GBP.format(n);
 const elem=(tag,cls,content)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(content!==undefined)el.textContent=String(content);return el};
 let publicRecipes=[...FALLBACK], shown=[...FALLBACK], portions=[6,4,4],offset=0,activeTab='plan';
 const dayNames=['Monday','Tuesday','Wednesday'];
 const portionsFor=r=>Math.min(10,Math.max(1,Math.round(Number(r.servings)||4)));
 function total(){return shown.reduce((sum,r,i)=>sum+Number(r.cost||0)*portions[i]/Number(r.servings||4),0)}
 function renderTotal(){const target=$('demo-total');if(target)target.textContent='Estimated total: '+money(total())}
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
   const update=()=>{amount.textContent=portions[i];price.textContent=money(Number(r.cost)*portions[i]/Number(r.servings))+' est.';minus.disabled=portions[i]<=1;plus.disabled=portions[i]>=10;renderTotal();if(activeTab==='shop')renderShopping()};
   minus.addEventListener('click',()=>{portions[i]=Math.max(1,portions[i]-1);update()});
   plus.addEventListener('click',()=>{portions[i]=Math.min(10,portions[i]+1);update()});
   stepper.append(minus,amount,plus);controls.append(stepper,price);row.append(controls);container.append(row);update();
  });
  renderTotal();
 }
 function renderShopping(){
  const destination=$('demo-shopping');if(!destination)return;
  const content=elem('div','shop-content');content.append(elem('h4','','Shopping preview'));
  content.append(elem('p','','Ingredient names from these real recipes, grouped into one checklist. Use the app for full quantities and planning.'));
  const seen=new Set(), names=[];
  for(const r of shown){if(!Array.isArray(r.ingredients))continue;for(const item of r.ingredients){
    const name=Array.isArray(item)?item[0]:item?.name;
    if(typeof name!=='string'||name.length>70)continue;
    const key=name.trim().toLowerCase();if(!key||seen.has(key))continue;
    seen.add(key);names.push(name.trim());if(names.length>=12)break;
  }if(names.length>=12)break}
  if(!names.length)content.append(elem('p','','Open BasketBoss to see the full shopping list for your meals.'));
  else{const grid=elem('div','shopping-grid');for(const name of names){const label=document.createElement('label');const check=document.createElement('input');check.type='checkbox';const labelText=elem('span','',name);label.append(check,labelText);grid.append(label)}content.append(grid)}
  destination.replaceChildren(content);
 }
 function switchTab(next){activeTab=next;const plan=next==='plan';$('demo-plan').hidden=!plan;$('demo-shop').hidden=plan;$('tab-plan').setAttribute('aria-selected',String(plan));$('tab-shop').setAttribute('aria-selected',String(!plan));if(!plan)renderShopping()}
 function chooseWeek(){
  const candidates=publicRecipes.filter(r=>valid(r)&&safeSrc(r).includes('/release-assets/')&&!/dessert|breakfast|pancake|cookie|brownie/i.test([r.category,r.tag,r.name].join(' ')));
  if(candidates.length>=3){if(offset===0){const pinned=['fajitas','creamy-pasta','chickpea-curry'];const lookup=new Map(candidates.map(r=>[r.id,r]));shown=pinned.map(id=>lookup.get(id)||FALLBACK.find(x=>x.id===id))}else shown=[0,1,2].map(i=>candidates[(offset+i)%candidates.length]);}
  else shown=[...FALLBACK];
  portions=shown.map(portionsFor);renderMeals();renderShopping();
 }
 function renderRecipes(){
  const box=$('landing-recipes');if(!box)return;box.replaceChildren();
  const featured=['fajitas','creamy-pasta','chickpea-curry'].map(id=>publicRecipes.find(x=>x.id===id)||FALLBACK.find(x=>x.id===id));
  for(const r of featured){const card=elem('article','recipe-card');const img=document.createElement('img');img.src=safeSrc(r);img.loading='lazy';img.alt=r.name;const body=elem('div','recipe-body');body.append(elem('p','','BASKETBOSS FREE RECIPE'),elem('h3','',r.name),elem('div','recipe-meta',`${r.mins} min · ${portionsFor(r)} servings`));const link=elem('a','view-link','Explore recipes in the app →');link.href='/index.html';body.append(link);card.append(img,body);box.append(card)}
 }
 $('tab-plan')?.addEventListener('click',()=>switchTab('plan'));
 $('tab-shop')?.addEventListener('click',()=>switchTab('shop'));
 $('new-demo-week')?.addEventListener('click',()=>{offset+=3;chooseWeek();switchTab('plan')});
 async function load(){
  try{const response=await fetch('/recipes.json',{cache:'no-store',credentials:'omit',redirect:'error'});
   if(!response.ok)throw Error('catalogue_unavailable');
   const data=await response.json();
   if(!Array.isArray(data)||data.length!==100)throw Error('public_catalogue_invalid');
   const safe=data.filter(valid);if(safe.length<80)throw Error('public_catalogue_invalid');
   publicRecipes=safe;
  }catch(_){/* Retain pinned public Free recipe summaries while offline. */}
  chooseWeek();renderRecipes();
 }
 load();
})();
