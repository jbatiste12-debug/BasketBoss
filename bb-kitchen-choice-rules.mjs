// Reuse receipt classification so household products never become pantry food.
import {classifyReceiptLine} from './bb-receipt-inventory-core.mjs';
export const FOOD_PREVIEWS=Object.freeze({cupboard:['Rice','Pasta','Cooking oil','Tinned tomatoes'],fridge:['Milk','Eggs','Cheddar','Butter'],freezer:['Frozen peas','Frozen mixed vegetables','Frozen chips','Frozen fish']});
export const HOUSEHOLD_PREVIEWS=Object.freeze([{name:'Toilet rolls',unit:'pack',emoji:'🧻'},{name:'Toothpaste',unit:'each',emoji:'🪥'},{name:'Laundry detergent',unit:'pack',emoji:'🧺'},{name:'Nappies',unit:'pack',emoji:'👶'}]);
export function isHousehold(name,product=''){
 const result=classifyReceiptLine({description:String(name||'')+' '+String(product||'')});
 return result.classification==='essential'&&result.hardExcluded===true;
}
export function previewOrder(nodes,names,readName){
 const selected=names.map(name=>nodes.find(node=>readName(node).toLowerCase()===name.toLowerCase())).filter(Boolean);
 return [...selected,...nodes.filter(node=>!selected.includes(node))];
}
