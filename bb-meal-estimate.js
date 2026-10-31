/* BasketBoss meal quote: ingredient quantities first, packs second.
   These are indicative regional prices, not live supermarket shelf prices.
   Shopping lists continue to charge full packs regardless of pantry-use display. */
(function(root){
 'use strict';
 const LOCAL_PACKS=Object.freeze({
  UK:{},Jersey:{},Guernsey:{},
  US:{'potato|g':2268,'lean beef mince|g':454,'beef mince|g':454,'chicken breast|g':907,'rice|g':907}
 });
 const stapled=name=>/\b(?:oil|flour|cornflour|starch|salt|pepper|paprika|cumin|coriander|cinnamon|turmeric|chilli powder|chilli flakes|seasoning|dried herbs?|mixed herbs?|oregano|stock|gravy|vinegar|mustard|soy sauce|worcestershire sauce|ketchup|mayonnaise|honey|sugar|baking powder)\b/i.test(name);
 const round2=n=>Math.round((n+Number.EPSILON)*100)/100;
 function quote({recipe,normalized,servings,market='UK',pricing=root.BBPriceV19}={}){
  if(!recipe||!Array.isArray(normalized?.ingredients)||!pricing?.CURRENCY?.[market]||!LOCAL_PACKS[market])return null;
  const base=Number(normalized.servings)||Number(recipe.baseServings)||Number(recipe.servings);
  const count=Number(servings??base);
  if(!(base>0)||!Number.isFinite(count)||count<=0||count>100)return null;
  const rows=Array(normalized.ingredients.length).fill(null),groups=new Map();
  for(let i=0;i<normalized.ingredients.length;i++){
   const ing=normalized.ingredients[i],originalQty=Number(ing?.quantity);
   if(!(originalQty>0)||!Number.isFinite(originalQty)||!ing.key||!ing.unit){
    // Optional garnish is not a required shopping quantity.
    if(/\boptional\b/i.test(String(ing?.quantity))){rows[i]=0;continue;}
    return null;
   }
   const name=pricing.canonical(ing.key),unit=String(ing.unit),required=(originalQty/base)*count;
   const key=name+'|'+unit;
   if(!groups.has(key))groups.set(key,{name,unit,required:0,members:[]});
   const group=groups.get(key);
   group.required+=required;
   group.members.push({index:i,required});
  }
  let total=0,rough=false;const details=[];
  for(const group of groups.values()){
   const item=pricing.price({name:group.name,unit:group.unit,quantity:group.required,market});
   if(!item||item.packAmount==null||item.portionAmount==null)return null;
   const pantry=stapled(group.name);
   // Local pack formats preserve the regionally uplifted unit price. A user's
   // own shelf-price override is applied to its original configured pack size.
   const localSize=LOCAL_PACKS[market][group.name+'|'+item.packUnit];
   const packSize=!item.userOverride&&Number.isFinite(localSize)&&localSize>0?localSize:item.packQty;
   const packs=Math.ceil((group.required-1e-10)/packSize);
   const fullPackCost=packSize===item.packQty?item.packAmount:
    round2(Math.round(packs*packSize*item.unitPrice*20)/20);
   const amount=pantry?item.portionAmount:fullPackCost;
   if(!Number.isFinite(amount))return null;
   total+=amount;rough=rough||!!item.needsReview;
   for(const m of group.members)rows[m.index]=round2(amount*m.required/group.required);
   details.push({name:group.name,quantity:group.required,unit:group.unit,
    packSize,packCount:packs,amount:round2(amount),
    pricingBasis:pantry?'fractional_pantry_use':'whole_packs'});
  }
  return {amount:round2(total),lines:rows,details,market,
   currency:pricing.CURRENCY[market],portions:count,rough};
 }
 const api=Object.freeze({quote,localPackSizes:LOCAL_PACKS});
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBMealEstimate=api;
})(typeof window!=='undefined'?window:globalThis);
