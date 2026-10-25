/* BB-QA-CONSOLIDATED-20261025-R1
 * Non-destructive UI enhancement: default measurement units only when the user
 * types a NEW essentials item; never rewrites saved pantry or shopping state.
 */
(()=>{'use strict';
const chooseUnit=name=>{
 const n=String(name||'').toLowerCase().trim();
 if(!n)return null;
 if(/\b(prawns?|shrimp|frozen fish|fish fillets?)\b/.test(n))return 'pack';
 if(/\b(milk|cream|oil|vinegar|juice|stock|syrup)\b/.test(n))return 'ml';
 if(/\b(eggs?|onions?|lemons?|limes?|apples?|bananas?|garlic bulbs?)\b/.test(n))return 'each';
 if(/\b(pasta|rice|lentils?|cheese|broccoli|spinach|peas|carrots?|potatoes|flour|sugar|salt|oats|beans|couscous|noodles|chicken|beef|lamb)\b/.test(n))return 'g';
 return null;
};
let manual=false;
document.addEventListener('change',e=>{
 if(e.target?.id==='bb307EssUnit')manual=true;
 if(e.target?.id==='bb307EssName')manual=false;
},true);
document.addEventListener('input',e=>{
 if(e.target?.id!=='bb307EssName'||manual)return;
 const select=document.getElementById('bb307EssUnit');
 const unit=chooseUnit(e.target.value);
 if(select&&unit&&[...select.options].some(o=>o.value===unit))select.value=unit;
},true);
// Only customer-facing labels, preserving original features and handlers.
const polishText=()=>{
 for(const el of document.querySelectorAll('span,small,p')){
   if(el.children.length)continue;
   if(el.textContent.trim()==='Premium preview · Free Auto-fill still works')el.textContent='✨ BasketBoss Pro Feature';
 }
};
// Avoid a whole-page mutation observer and expensive reflow on large recipe lists.
window.addEventListener('load',polishText,{once:true});
})();
