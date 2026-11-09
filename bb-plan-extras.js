/* Optional planner slots. Breakfast never enters dinner Auto-fill. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBPlanExtras=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 const count=value=>Number.isInteger(value)&&value>=1&&value<=12;
 function isBreakfast(recipe){
  return !!(recipe&&typeof recipe.id==='string'&&/\b(?:breakfast|brunch)\b/i.test([recipe.category,recipe.tag,recipe.mealType].filter(value=>typeof value==='string').join(' ')));
 }
 function normalizeSlots(value){
  const days=new Set();
  return (Array.isArray(value)?value:[]).filter(row=>{
   if(!row||typeof row.recipeId!=='string'||!row.recipeId||row.recipeId.length>256||!DAYS.includes(row.day)||days.has(row.day))return false;
   days.add(row.day);return true;
  }).map(row=>({recipeId:row.recipeId,day:row.day,...(count(row.servings)?{servings:row.servings}:{})}));
 }
 let current=null;
 function openMealPicker({win,day,recipes,eligible,context,select,notify=()=>{},kind}={}){
  const doc=win?.document;
  if(!doc?.createElement||!DAYS.includes(day)||typeof recipes!=='function'||typeof eligible!=='function'||typeof context!=='function'||typeof select!=='function')return null;
  current?.close();
  const breakfast=kind==='breakfast',label=breakfast?'breakfast':'dessert',plural=breakfast?'breakfasts':'desserts or bakes';
  const pin=context(),view=doc.body?.dataset.bbnextView,focus=doc.activeElement;
  const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const dialog=make('dialog','bb-plan-meal-picker bb-plan-'+label+'-picker');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','bbPlanPickerTitle');dialog.setAttribute('aria-describedby','bbPlanPickerIntro');
  const header=make('div','bb-plan-picker-heading'),title=make('h2','','Choose '+label);title.id='bbPlanPickerTitle';
  const closeButton=make('button','bb-plan-picker-close','Close');closeButton.type='button';closeButton.setAttribute('aria-label','Close '+label+' recipes');
  header.append(title,closeButton);
  const intro=make('p','bb-plan-picker-intro','Optional '+(breakfast?'breakfast':'dessert or bake')+' for '+day+'. Ingredients join your shopping list.');intro.id='bbPlanPickerIntro';
  const search=make('input','bb-plan-picker-search');search.type='search';search.placeholder='Search '+plural;search.autocomplete='off';search.enterKeyHint='search';search.setAttribute('aria-label','Search '+label+' recipes');
  const list=make('div','bb-plan-picker-list');list.setAttribute('aria-label',breakfast?'Breakfast recipes':'Dessert and baking recipes');
  const status=make('p','bb-plan-picker-empty');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  dialog.append(header,intro,search,status,list);
  let closed=false;
  const events=['basketboss:session-changed','basketboss:account-deletion-started','basketboss:account-deletion-deleted'];
  function viewport(){const vp=win.visualViewport;dialog.style.setProperty('--bb-plan-picker-height',(vp?.height||win.innerHeight)+'px');dialog.style.setProperty('--bb-plan-picker-top',((vp?.offsetTop||0)+(vp?.height||win.innerHeight)/2)+'px');}
  function close(){
   if(closed)return;closed=true;
   events.forEach(name=>win.removeEventListener(name,close));win.removeEventListener('storage',storageChanged);win.removeEventListener('resize',viewport);win.visualViewport?.removeEventListener('resize',viewport);win.visualViewport?.removeEventListener('scroll',viewport);
   try{dialog.close();}catch{}dialog.remove();if(current?.node===dialog)current=null;
   if(focus?.isConnected&&context()===pin&&doc.body?.dataset.bbnextView===view)focus.focus?.({preventScroll:true});
  }
  function storageChanged(event){if(event.key===null||event.key==='basketboss_cloud_session_v1')close();}
  function paint(){
   if(closed)return;
   list.replaceChildren();
   const query=search.value.trim().toLocaleLowerCase(),available=recipes().filter(eligible),filtered=available.filter(recipe=>String(recipe.name||'').toLocaleLowerCase().includes(query));
   status.textContent=filtered.length?filtered.length+' '+label+' '+(filtered.length===1?'option':'options'):available.length?'No matching '+plural+'. Try another search.':'No '+label+' options available. Refresh your recipes or choose another day.';
   for(const recipe of filtered){
    const button=make('button','bb-plan-picker-choice');button.type='button';button.dataset[breakfast?'bbBreakfastChoose':'bbDessertChoose']=recipe.id;button.setAttribute('aria-label','Plan '+recipe.name+' for '+day);
    if(recipe.image){const image=make('img','');image.src=recipe.image;image.alt='';image.loading='lazy';image.decoding='async';image.addEventListener('error',()=>image.remove(),{once:true});button.append(image);}
    const text=make('span',''),name=make('strong','',recipe.name),meta=make('small','',win.BBDuration?.format(recipe.mins)||(breakfast?'Breakfast':'Dessert / bake'));text.append(name,meta);button.append(text);
    button.addEventListener('click',()=>{
     if(closed)return;
     if(context()!==pin||doc.body?.dataset.bbnextView!==view){close();notify('Your account or plan changed. Reopen '+label+' to choose again.');return;}
     const latest=recipes().find(value=>value.id===recipe.id&&eligible(value));
     if(!latest){paint();notify('This '+label+' is no longer available. Choose another.');return;}
     if(select(recipe.id,day)!==false)close();
    });list.append(button);
   }
  }
  search.addEventListener('input',paint);closeButton.addEventListener('click',close);
  search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();search.blur();}});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',close);
  (doc.body||doc.documentElement).append(dialog);current={node:dialog,close};paint();
  events.forEach(name=>win.addEventListener(name,close));win.addEventListener('storage',storageChanged);win.addEventListener('resize',viewport);win.visualViewport?.addEventListener('resize',viewport);win.visualViewport?.addEventListener('scroll',viewport);viewport();
  try{dialog.showModal();}catch{dialog.setAttribute('open','');}closeButton.focus?.({preventScroll:true});
  return Object.freeze({close,node:dialog});
 }
 function openBreakfastPicker(options={}){return openMealPicker({...options,kind:'breakfast',eligible:isBreakfast});}
 function openDessertPicker(options={}){return openMealPicker({...options,kind:'dessert'});}
 return Object.freeze({isBreakfast,normalizeSlots,openBreakfastPicker,openDessertPicker});
});
