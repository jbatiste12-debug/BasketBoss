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
 function openBreakfastPicker({win,day,recipes,context,select,notify=()=>{}}={}){
  const doc=win?.document;
  if(!doc?.createElement||!DAYS.includes(day)||typeof recipes!=='function'||typeof context!=='function'||typeof select!=='function')return null;
  current?.close();
  const pin=context(),focus=doc.activeElement;
  const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const dialog=make('dialog','bb-plan-breakfast-picker');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','bbBreakfastPickerTitle');
  const header=make('div','bb-plan-picker-heading'),title=make('h2','','Choose breakfast');title.id='bbBreakfastPickerTitle';
  const closeButton=make('button','bb-plan-picker-close','Close');closeButton.type='button';closeButton.setAttribute('aria-label','Close breakfast recipes');
  header.append(title,closeButton);
  const intro=make('p','','Optional breakfast for '+day+'. Ingredients join your shopping list.');
  const search=make('input','bb-plan-picker-search');search.type='search';search.placeholder='Search breakfasts';search.setAttribute('aria-label','Search breakfast recipes');
  const list=make('div','bb-plan-picker-list');list.setAttribute('aria-label','Breakfast recipes');
  const status=make('p','bb-plan-picker-empty');status.setAttribute('role','status');
  dialog.append(header,intro,search,status,list);
  let closed=false;
  function close(){if(closed)return;closed=true;try{dialog.close();}catch{}dialog.remove();if(current?.node===dialog)current=null;if(focus?.isConnected)focus.focus?.({preventScroll:true});}
  function paint(){
   list.replaceChildren();
   const query=search.value.trim().toLocaleLowerCase(),available=recipes().filter(isBreakfast),filtered=available.filter(recipe=>String(recipe.name||'').toLocaleLowerCase().includes(query));
   status.textContent=filtered.length?filtered.length+' breakfast '+(filtered.length===1?'option':'options'):available.length?'No matching breakfasts. Try another search.':'Breakfast recipes are still loading. Reopen this picker after your recipes load.';
   for(const recipe of filtered){
    const button=make('button','bb-plan-picker-choice');button.type='button';button.dataset.bbBreakfastChoose=recipe.id;button.setAttribute('aria-label','Plan '+recipe.name+' for '+day);
    if(recipe.image){const image=make('img','');image.src=recipe.image;image.alt='';image.loading='lazy';image.decoding='async';image.addEventListener('error',()=>image.remove(),{once:true});button.append(image);}
    const text=make('span',''),name=make('strong','',recipe.name),meta=make('small','',win.BBDuration?.format(recipe.mins)||'Breakfast');text.append(name,meta);button.append(text);
    button.addEventListener('click',()=>{
     if(closed)return;
     if(context()!==pin){close();notify('Your account or plan changed. Reopen breakfast to choose again.');return;}
     const latest=recipes().find(value=>value.id===recipe.id&&isBreakfast(value));
     if(!latest){paint();notify('This breakfast is no longer available. Choose another.');return;}
     if(select(recipe.id,day)!==false)close();
    });list.append(button);
   }
  }
  search.addEventListener('input',paint);closeButton.addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',close);
  (doc.body||doc.documentElement).append(dialog);current={node:dialog,close};paint();
  try{dialog.showModal();}catch{dialog.setAttribute('open','');}search.focus?.({preventScroll:true});
  return Object.freeze({close,node:dialog});
 }
 return Object.freeze({isBreakfast,normalizeSlots,openBreakfastPicker});
});
