/* Recipe quantity basis, never a pantry synonym or cooked-to-dry conversion.
 * An explicit dry grain weight belongs to the uncooked shopping ingredient;
 * its original preparation label and quantity text remain in the recipe. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBRecipePurchaseBasis=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/\s+/g,' ').trim():'';
 const identity=value=>clean(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const grain=/^(?:(?:white|brown|basmati|jasmine|long[- ]grain|short[- ]grain|arborio|risotto|sushi|pudding|easy[- ]cook) )?rice$|^(?:(?:wholewheat|whole wheat|dried|dry) )?(?:pasta|spaghetti|penne|fusilli|macaroni|orzo|noodles|couscous|quinoa|bulgur|barley)$/i;
 function project(row,sourceLine,{canonicalize}={}){
  if(!row||!Array.isArray(sourceLine)||typeof sourceLine[0]!=='string'||typeof sourceLine[1]!=='string')return null;
  const original=clean(sourceLine[0]),text=clean(sourceLine[1]);
  if(/\b(?:microwave|microwaveable|microwavable|ready|instant|pouch|pouches|precooked|pre-cooked|leftover|leftovers)\b/i.test(original+' '+text))return null;
  const explicit=/^(\d+(?:\.\d+)?)\s*(kg|kilograms?|g|grams?)\s*(?:\(\s*)?(?:dry|uncooked)(?:\s+weight)?\b/i.exec(text);
  if(!explicit)return null;
  const quantity=typeof row.quantity==='number'?row.quantity:typeof row.quantity==='string'&&row.quantity.trim()?Number(row.quantity):NaN;
  const unit=String(row.unit||'').toLowerCase(),expected=Number(explicit[1])*(/^k/i.test(explicit[2])?1000:1),measured=quantity*(unit==='kg'?1000:1);
  if(!['g','kg'].includes(unit)||!Number.isFinite(measured)||measured<0||Math.abs(measured-expected)>1e-6)return null;
  const label=original.replace(/^(?:freshly\s+)?cooked\s+/i,'').replace(/(?:,\s*|\s+)(?:freshly\s+)?cooked$/i,'').trim();
  if(label===original||!grain.test(label))return null;
  const named=identity(row.name||row.key),verified=identity(row.purchase_source_name)===identity(original)&&row.purchase_quantity_basis==='EXPLICIT_DRY_SOURCE_WEIGHT';
  if(named!==identity(original)&&!(verified&&named===identity(label)))return null;
  const key=typeof canonicalize==='function'?canonicalize(label):identity(label);if(typeof key!=='string'||!key.trim())return null;
  return {name:label,key,quantity:row.quantity,unit:row.unit,purchase_quantity_basis:'EXPLICIT_DRY_SOURCE_WEIGHT',purchase_source_name:original,purchase_source_quantity:text};
 }
 function apply(recipes,normalized,{canonicalize}={}){
  const sources=new Map((Array.isArray(recipes)?recipes:[]).map(recipe=>[recipe.id,recipe]));let count=0;
  for(const recipe of Array.isArray(normalized)?normalized:[]){
   const source=sources.get(recipe.id);if(!source||!Array.isArray(recipe.ingredients))continue;
   for(let index=0;index<recipe.ingredients.length;index++){
    const row=recipe.ingredients[index];if(!row||row.recipe_id&&row.recipe_id!==recipe.id||row.ingredient_index!==undefined&&row.ingredient_index!==index)continue;
    const next=project(row,source.ingredients?.[index],{canonicalize});if(!next)continue;
    if(!row.raw_shopping_key)row.raw_shopping_key=row.key||row.name;
    if(!row.prep_note)row.prep_note=next.purchase_source_name;
    Object.assign(row,next);count++;
   }
  }return count;
 }
 return Object.freeze({project,apply});
});
