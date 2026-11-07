/* Approved product aliases for reviewed pantry scans. Unknown labels are kept;
 * a brand name is never removed by a general substring or fuzzy-match rule. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBScanFoodIdentity=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const clean=value=>String(value||'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
 const variants=Object.freeze({brine:'in brine',springwater:'in spring water',sunflower:'in sunflower oil',olive:'in olive oil',oil:'in oil'});
 const variantOptions=Object.freeze([['','Not confirmed'],['brine','In brine'],['springwater','In spring water'],['sunflower','In sunflower oil'],['olive','In olive oil'],['oil','In oil (type unspecified)']]);
 function resolve(value,{variant,quantityBasis}={}){
  const productName=clean(value),label=productName.toLowerCase();
  const result={productName,canonicalName:productName,brand:'',family:'',approved:false,variant:'',quantityBasis:'',needsVariant:false,needsBasis:false};
  // Physical states and dietary/product variants outside these exact aliases
  // deliberately stay distinct. In particular, fresh/frozen tuna never maps.
  const tuna=label.match(/^(?:(john west|(?:essential )?waitrose) )?(?:tuna chunks|tinned tuna|canned tuna)(?: (in brine|in spring ?water|in sunflower oil|in olive oil|in oil))?(?: (drained|net weight))?$/);
  if(tuna&&(tuna[1]||!/^tuna chunks/.test(label))){
   const declared={'in brine':'brine','in springwater':'springwater','in spring water':'springwater','in sunflower oil':'sunflower','in olive oil':'olive','in oil':'oil'}[tuna[2]]||'';
   const chosen=Object.hasOwn(variants,variant)?variant:declared;
   // A reviewed selection cannot contradict an explicit label descriptor.
   if(declared&&chosen!==declared)throw Error('The selected tuna type disagrees with its product label.');
   const basis=quantityBasis==='net'||quantityBasis==='drained'?quantityBasis:tuna[3]==='drained'?'drained':tuna[3]==='net weight'?'net':'';
   if(tuna[3]&&basis!==(tuna[3]==='drained'?'drained':'net'))throw Error('The selected weight basis disagrees with its product label.');
   return {...result,canonicalName:'Tinned tuna'+(chosen?' '+variants[chosen]:''),brand:tuna[1]?/^john/.test(tuna[1])?'John West':'Waitrose':'',family:'tinned tuna',approved:true,variant:chosen,quantityBasis:basis,needsVariant:!chosen,needsBasis:!basis};
  }
  const tomato=label.match(/^(?:(essential waitrose|waitrose) )?((?:tinned |canned )?chopped tomatoes)$/);
  if(tomato)return {...result,canonicalName:'Chopped tomatoes',brand:tomato[1]?'Waitrose':'',family:'chopped tomatoes',approved:true};
  if(/^(?:heinz (?:beanz|baked beans)|baked beans)$/.test(label))return {...result,canonicalName:'Baked beans',brand:label.startsWith('heinz ')?'Heinz':'',family:'baked beans',approved:true};
  return result;
 }
 return Object.freeze({resolve,variantOptions});
});
