/* Planner adapter: confirmed quantities and a fresh comparison before saving.
 * The host retains ownership of persistence, account checks and inventory. */
(function(root,factory){
 'use strict';
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBEveningPivotApp=api;
})(typeof window==='undefined'?null:window,function(root){
 'use strict';
 const copy=value=>JSON.parse(JSON.stringify(value));
 function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
 function localISO(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
 function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d);
  return date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d;
 }
 function create(options={}){
  const core=options.core||root?.BBEveningPivot,tokens=new WeakMap();
  if(!core||typeof options.context!=='function'||typeof options.commit!=='function')throw Error('Evening Pivot requires the planner adapter.');
  function context(){
   const value=options.context();
   if(!value||!(value.date instanceof Date)||!Number.isFinite(value.date.getTime()))throw Error('Planner unavailable.');
   return value;
  }
  function fingerprint(c){
   return JSON.stringify({actor:c.actor,premium:c.premium===true,date:localISO(c.date),plan:c.planned,dayServings:c.dayServings,
    stock:c.stock,extra:c.fingerprint,recipes:c.recipes});
  }
  function pantryReady(recipe,servings,c){
   if(c.reviewRequired!==false||typeof c.reconcileStock!=='function'||typeof c.pantryId!=='function')return false;
   const normalized=c.normalized?.find(item=>item.id===recipe.id),ingredients=normalized?.ingredients;
   if(!Array.isArray(ingredients)||!ingredients.length||!Array.isArray(recipe.ingredients)||ingredients.length!==recipe.ingredients.length)return false;
   const base=Number(normalized.servings)||Number(recipe.baseServings)||Number(recipe.servings);
   if(!(base>0)||!(servings>0))return false;
   const targets=new Map();
   const units=new Set(['g','kg','ml','l','each','pack','clove','bulb','tsp','tbsp','tin','can','loaf','slice','whole','item','piece']);
   for(const [index,ingredient]of ingredients.entries()){
    const key=ingredient?.key||ingredient?.name,unit=c.recipeIngredientUnit?.(ingredient,recipe.ingredients)||ingredient?.unit,quantity=ingredient?.quantity;
    if(typeof key!=='string'||!key.trim()||typeof unit!=='string'||!unit.trim())return false;
    if(!units.has(unit))return false;
    const declared=recipe.ingredients[index],name=Array.isArray(declared)?declared[0]:typeof declared==='string'?declared:declared?.name;
    const clean=value=>String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
    if(!name||clean(ingredient.name)!==clean(name))return false;
    if(/^water$/i.test(key.trim()))continue;
    if(ingredient.status&&ingredient.status!=='PARSED')return false;
    if(typeof quantity!=='number'||!Number.isFinite(quantity)||!(quantity>0))return false;
    const id=c.pantryId(key,unit),required=quantity*servings/base;
    if(!Number.isFinite(required)||!(required>0))return false;
    const previous=targets.get(id);targets.set(id,{key,unit,required:required+(previous?.required||0)});
   }
   if(!targets.size)return false;
   const items=[...targets.values()],result=c.reconcileStock(c.stock,items);
   return items.every(item=>Number(result?.pantry?.[c.pantryId(item.key,item.unit)]||0)+0.0005>=item.required);
  }
  function suggestions(c){
   if(c.premium!==true||c.reviewRequired!==false)return [];
   return core.getSuggestions({planned:c.planned,recipes:c.recipes,date:c.date,
    allowed:c.allowed,recipeAllowed:c.recipeAllowed,servingsForDay:c.servingsForDay,isLinked:c.isLinked,
    isReady:(recipe,details)=>pantryReady(recipe,details.servings,c)});
  }
  function preview(expected={}){
   try{
    const c=context(),today=core.DAYS[(c.date.getDay()+6)%7];
    if(c.premium!==true)return {suggestions:[],reason:'Evening Pivot is included with BasketBoss Premium.'};
    if(expected.day!==today||!c.planned?.some(item=>item.day===today&&item.recipeId===expected.recipeId))return {suggestions:[],reason:'Tonight’s dinner has changed. Reopen the meal card.'};
    if(c.reviewRequired!==false)return {suggestions:[],reason:'Review and confirm your PANTRY amounts before checking quicker dinners.'};
    const stamp=fingerprint(c),result=suggestions(c).map(raw=>{
     const suggestion=freeze(copy(raw));tokens.set(suggestion,{stamp,today,day:raw.day,currentId:raw.currentRecipe.id,candidateId:raw.candidateRecipe.id});return suggestion;
    });
    return {suggestions:result,reason:result.length?'':'No quicker dinner later this week has all its ingredient amounts confirmed in PANTRY. Review your stock or keep tonight’s meal.'};
   }catch(_){return {suggestions:[],reason:'Your plan or PANTRY could not be checked. Reopen this meal to try again.'};}
  }
  function apply(suggestion,checks={}){
   const token=tokens.get(suggestion);
   if(!token)return {ok:false,error:'Reopen tonight’s meal and choose a current suggestion.'};
   try{
    const c=context();
    if(c.premium!==true)return {ok:false,error:'Evening Pivot requires a verified Premium membership.'};
    if(token.stamp!==fingerprint(c))return {ok:false,error:'Your plan, account or PANTRY has changed. Close this panel and check again.'};
    const fresh=suggestions(c).find(item=>item.day===token.day&&item.currentRecipe.id===token.currentId&&item.candidateRecipe.id===token.candidateId);
    if(!fresh)return {ok:false,error:'This dinner is no longer available for a swap. Check your plan and PANTRY again.'};
    if(checks.confirmed!==true||checks.readyToCook!==true)return {ok:false,error:'Confirm freshness and that tonight’s ingredients are ready to cook.'};
    for(const ingredient of fresh.requiresFreshness){
     const date=checks.useBy?.[ingredient.key];
     if(!validDate(date)||date<fresh.movedDateISO)return {ok:false,error:'Check each fresh ingredient’s date. It must keep through '+fresh.day+'.'};
    }
    const next=core.previewSwap({planned:c.planned,dayServings:c.dayServings,today:token.today,day:token.day,
     recipes:c.recipes,servingsForDay:c.servingsForDay});
    if(!next)return {ok:false,error:'The two dinners could not be checked. Nothing changed.'};
    const result=options.commit(token.stamp,next);
    if(result!==true&&result?.ok!==true)return {ok:false,error:'The swap could not be saved. Your original dinners have been kept.'};
    tokens.delete(suggestion);return {ok:true};
   }catch(_){return {ok:false,error:'The swap could not be saved. Check your plan before trying again.'};}
  }
  return Object.freeze({preview,apply,fingerprint:()=>fingerprint(context()),pantryReady:(recipe,servings)=>pantryReady(recipe,servings,context())});
 }
 return Object.freeze({create,validDate});
});
