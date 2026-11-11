// Reuse receipt classification so household products never become pantry food.
import {classifyReceiptLine} from './bb-receipt-inventory-core.mjs';
export const FOOD_PREVIEWS=Object.freeze({cupboard:['Rice','Pasta','Cooking oil','Tinned tomatoes'],fridge:['Milk','Eggs','Cheddar','Butter'],freezer:['Frozen peas','Frozen mixed vegetables','Frozen chips','Frozen fish']});
export const HOUSEHOLD_PREVIEWS=Object.freeze([{name:'Toilet rolls',unit:'pack',emoji:'🧻'},{name:'Toothpaste',unit:'each',emoji:'🪥'},{name:'Laundry detergent',unit:'pack',emoji:'🧺'},{name:'Nappies',unit:'pack',emoji:'👶'}]);
export function isHousehold(name,product=''){
 const description=String(name||'')+' '+String(product||'');
 const classified=value=>{const result=classifyReceiptLine({description:value});return result.classification==='essential'&&result.hardExcluded===true;};
 if(classified(description))return true;
 // These comparison-only spellings do not change stored names or food keys.
 // Recognize ordinary plurals, CamelCase and spaced compound product words.
 const normalized=description.slice(0,300).normalize('NFKC').replace(/([\p{Ll}\p{N}])(\p{Lu})/gu,'$1 $2').toLowerCase().replace(/[-–—_/]+/g,' ').replace(/[^\p{L}\p{N}\s']/gu,' ').replace(/\s+/g,' ').trim();
 const singular=word=>/ies$/.test(word)?word.slice(0,-3)+'y':/(?:ches|shes|sses|xes|zes)$/.test(word)?word.slice(0,-2):/s$/.test(word)&&!/(?:ss|us|is)$/.test(word)?word.slice(0,-1):word;
 const words=normalized.split(' ').filter(Boolean).map(singular),candidates=new Set([normalized,words.join(' ')]);
 for(let index=0;index<words.length-1;index++)candidates.add([...words.slice(0,index),words[index]+words[index+1],...words.slice(index+2)].join(' '));
 const knownCompounds=new Set(HOUSEHOLD_PREVIEWS.map(item=>item.name.toLowerCase().split(/\s+/).map(singular).join('')));
 if(knownCompounds.has(words.join(''))||words.some(word=>knownCompounds.has(word)))return true;
 return [...candidates].some(classified);
}
export function previewOrder(nodes,names,readName){
 const selected=names.map(name=>nodes.find(node=>readName(node).toLowerCase()===name.toLowerCase())).filter(Boolean);
 return [...selected,...nodes.filter(node=>!selected.includes(node))];
}
