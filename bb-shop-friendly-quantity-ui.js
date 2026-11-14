/* Kitchen-friendly hints only. This module never changes a requirement,
 * purchase selection, conversion table, price or inventory quantity. */
(function(root,factory){
 'use strict';const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBShopFriendlyQuantityUI=api;
})(typeof window==='undefined'?null:window,function(root){
 'use strict';
 const MAX=1000000;
 const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=MAX;
 const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const same=(a,b)=>Math.abs(a-b)<=Math.max(1e-9,Math.max(Math.abs(a),Math.abs(b))*Number.EPSILON*8);
 const names=Object.create(null);
 // Exact whole-produce names only. Every weight comes from the existing
 // planning table at render time; no average weights are introduced here.
 for(const [key,singular,plural,fallbackKey]of [
  ['aubergine','aubergine','aubergines'],['courgette','courgette','courgettes'],
  ['onion','onion','onions'],['red onion','red onion','red onions'],
  ['brown onion','brown onion','brown onions','onion'],['white onion','white onion','white onions','onion'],['yellow onion','yellow onion','yellow onions','onion'],
  ['spring onion','spring onion','spring onions'],['shallot','shallot','shallots'],
  ['cucumber','cucumber','cucumbers'],['carrot','carrot','carrots'],
  ['potato','potato','potatoes'],['sweet potato','sweet potato','sweet potatoes'],['baking potato','baking potato','baking potatoes'],
  ['tomato','tomato','tomatoes'],['cherry tomatoes','cherry tomato','cherry tomatoes'],
  ['mixed peppers','pepper','peppers'],['bell peppers','bell pepper','bell peppers'],
  ['avocado','avocado','avocados'],['apple','apple','apples'],['banana','banana','bananas'],
  ['lemon','lemon','lemons'],['lime','lime','limes'],['orange','orange','oranges'],
  ['broccoli','head of broccoli','heads of broccoli'],['lettuce','lettuce','lettuces'],
  ['mushroom','mushroom','mushrooms'],['parsnip','parsnip','parsnips']
 ]){
  const profile=Object.freeze({key,singular,plural,...(fallbackKey?{fallbackKey}:{})});names[key]=profile;if(singular!=='pepper')names[singular]=profile;names[plural]=profile;
 }
 Object.freeze(names);
 const label=value=>typeof value==='string'?value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' '):'';
 function measure(quantity,rawUnit){
  if(!positive(quantity))return null;
  const unit=label(rawUnit),factor=unit==='kg'||unit==='l'?1000:1;
  const family=['g','kg'].includes(unit)?'g':['ml','l'].includes(unit)?'ml':['each','clove'].includes(unit)?'each':null;
  return family&&positive(quantity*factor)?{quantity:quantity*factor,unit:family}:null;
 }
 function selectedPack(selection,needed,name){
  if(!plain(selection)||selection.kind!=='pack'||!Number.isSafeInteger(selection.packCount)||selection.packCount<1||selection.packCount>MAX||!positive(selection.packQuantity))return null;
  const total=measure(selection.quantity,selection.unit),pack=measure(selection.packQuantity,selection.unit);
  if(!total||!pack||total.unit!==needed.unit||!same(total.quantity,pack.quantity*selection.packCount)||!same(total.quantity,needed.quantity))return null;
  if(selection.boughtQtyOverride!==undefined&&(!positive(selection.boughtQtyOverride)||!same(selection.boughtQtyOverride,selection.quantity)))return null;
  // A selected pack is not the recipe requirement. Use its noun only when
  // its total exactly matches the needed amount; bigger/smaller choices must
  // stay in the separate Buying control, never change this need hint.
  const noun=selection.label;
  if(!['pack','tub','bulb'].includes(noun))return null;
  if(noun==='bulb'&&(!/^(?:fresh )?garlic(?: cloves?)?$/.test(name)||pack.unit!=='each'||pack.quantity!==10))return null;
  return selection.packCount+' '+noun+(selection.packCount===1?'':'s');
 }
 function view(options={}){
  if(!plain(options))return null;
  const name=label(options.name),needed=measure(options.quantity,options.unit);if(!name||!needed)return null;
  const whole=name.replace(/^(?:(?:fresh|whole) ){1,2}/,''),profile=names[whole];
  const counts=plain(options.countGrams)?options.countGrams:options.policy?.countGrams||root?.BBPantryPolicy?.countGrams;
  // These three whole onion colours may use the existing generic onion
  // average when no colour-specific estimate exists. Their names stay
  // distinct; red and spring onions always require their own metadata.
  const grams=profile&&(counts?.[profile.key]??(profile.fallbackKey?counts?.[profile.fallbackKey]:undefined));
  if(profile&&needed.unit==='g'&&positive(grams)){
   const ratio=needed.quantity/grams;
   // A tiny remainder is clearer as a weight than an invented whole item.
   if(ratio>=0.5&&ratio<=MAX){
    const count=Math.max(1,Math.round(ratio));
    return 'About '+count+' '+(count===1?profile.singular:profile.plural);
   }
  }
  return selectedPack(options.selection,needed,name);
 }
 return Object.freeze({view});
});
