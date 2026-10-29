/* BasketBoss Feeding helper v1 — pure arithmetic; no DOM, network or storage writes.
   Do not round inputs before pantry reconciliation or shopping aggregation. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.BBServing=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const count=n=>{const x=Number(n);return Number.isInteger(x)&&x>=1&&x<=12?x:null;};
  function onboardingHousehold(raw){
    try{
      const value=typeof raw==='string'?JSON.parse(raw):raw;
      if(!value||typeof value!=='object')return null;
      const h=String(value.house||'').trim();
      return count(h)||({'Just me':1,'2 people':2,'3–4 people':4,'3-4 people':4,'5+ people':5})[h]||null;
    }catch(_){return null;}
  }
  function ratio(servings,recipe){
    const base=Number(recipe?.baseServings)||Number(recipe?.servings)||4;
    return (count(servings)||4)/(base>0?base:4);
  }
  function forMeal(state,slot,recipe){
    const saved=state?.mealServings&&state.mealServings[slot?.recipeId];
    return count(saved)||count(state?.servings)||count(recipe?.servings)||4;
  }
  function moneyCost(cost,servings,recipe){return Number(cost||0)*ratio(servings,recipe);}
  function formatAmount(value,unit){
    if(!Number.isFinite(value)||value<=0)return '';
    const u=String(unit||'').toLowerCase();
    if(['g','gram','grams','ml','millilitre','millilitres'].includes(u)){
      const rounded=value>=10?Math.round(value/5)*5:Math.round(value*2)/2;
      return String(rounded||0.5);
    }
    const n=Math.round(value*4)/4;
    const integer=Math.floor(n),fraction=Math.round((n-integer)*4);
    if(fraction===0)return String(integer);
    return (integer?integer+' ':'')+({1:'¼',2:'½',3:'¾'}[fraction]||'');
  }
  // Editorial ingredient strings vary. Only modify a safely recognised leading amount;
  // leave vague or unparseable descriptions intact rather than inventing quantities.
  function scaleText(raw,factor,name){
    const original=String(raw??'').trim();
    const match=original.match(/^(\d+\/\d+|\d+(?:\.\d+)?)(?:\s+(\d+\/\d+))?(\s*)(.*)$/);
    if(!match||!(factor>0))return original;
    const parse=x=>x&&x.includes('/')?Number(x.split('/')[0])/Number(x.split('/')[1]):Number(x)||0;
    const n=parse(match[1])+parse(match[2]);if(!(n>0))return original;
    let rest=match[4],unit=((rest.match(/^(kg|g|grams?|ml|l|litres?)\b/i)||[])[1]||'').toLowerCase();
    let base=n;
    // Preserve the original weight unit for kitchen readability.
    if(unit==='kg'||/^litres?$/i.test(unit)||unit==='l')base=n*1000;
    const isWeight=/^(kg|g|grams?|ml|l|litres?)$/i.test(unit);
    const isCountable=!isWeight&&/\b(eggs?|onions?|peppers?|tins?|cans?|cloves?|wraps?|fillets?|bananas?|apples?|lemons?|limes?)\b/i.test(rest+' '+String(name||''));
    const scaled=base*factor;
    // Countable ingredients cannot reliably be bought as fractional whole units.
    const display=isCountable?String(Math.max(1,Math.ceil(scaled-1e-9))):formatAmount(scaled,isWeight?'g':'each');
    if(isCountable&&rest){
      const singular={eggs:'egg',onions:'onion',peppers:'pepper',tins:'tin',cans:'can',cloves:'clove',wraps:'wrap',fillets:'fillet',bananas:'banana',apples:'apple',lemons:'lemon',limes:'lime'};
      const plural=Object.fromEntries(Object.entries(singular).map(([p,s])=>[s,p]));
      rest=rest.replace(/\b(eggs?|onions?|peppers?|tins?|cans?|cloves?|wraps?|fillets?|bananas?|apples?|lemons?|limes?)\b/gi,w=>{
        const lower=w.toLowerCase(),base=singular[lower]||lower;return display==='1'?base:(plural[base]||lower);
      });
    }
    if(unit==='kg')return formatAmount(scaled,'g')+' g'+rest.slice(unit.length);
    if(/^(l|litres?)$/i.test(unit))return formatAmount(scaled,'ml')+' ml'+rest.slice(unit.length);
    if(isWeight)return display+' '+rest;
    return display+(rest?' '+rest:'');
  }
  function validOverrides(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    const out={};
    for(const [id,n] of Object.entries(value))if(id.length<=256 && /^[\w.-]+$/.test(id)&&count(n))out[id]=Number(n);
    return out;
  }
  return Object.freeze({count,onboardingHousehold,ratio,forMeal,moneyCost,formatAmount,scaleText,validOverrides});
});
