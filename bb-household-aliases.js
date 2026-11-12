/* Explicit household names only. This table never guesses a meat, cut, food
 * state, package size or conversion. Apply resolve before legacy canonicalizers
 * so whole "peppers" cannot first become ambiguous seasoning "pepper". */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root){root.BBHouseholdAliases=api;if(root.document){root.BBPantryAliasCanonical=name=>api.resolve(name,root.BBPriceV19?.canonical);root.BBPantryConversionCanonical=name=>api.conversionName(name,root.BBPriceV19?.canonical);}}
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ').trim():'';
 const safe=value=>!!value&&value.length<=200&&!value.includes('|')&&!['__proto__','prototype','constructor'].includes(value);
 const definitions=[
  ['pork-sausages','Meat & fish','pork sausages',['sausage','sausages','pork sausage','pork sausages']],
  ['beef-mince','Meat & fish','beef mince',['mince','beef mince','ground beef']],
  ['back-bacon','Meat & fish','back bacon',['bacon','back bacon']],
  ['mixed-peppers','Produce','mixed peppers',['peppers','mixed pepper','mixed peppers']],
  ['brown-onion','Produce','brown onion',['onion','onions','brown onion','brown onions']],
  ['garlic','Produce','garlic',['garlic','garlic clove','garlic cloves']],
  ['white-potato','Produce','white potato',['potato','potatoes','white potato','white potatoes']],
  ['salad-tomato','Produce','salad tomato',['tomato','tomatoes','salad tomato','salad tomatoes']],
  ['courgette','Produce','courgette',['courgette','courgettes','zucchini','zucchinis']],
  ['aubergine','Produce','aubergine',['aubergine','aubergines','eggplant','eggplants']],
  ['spring-onion','Produce','spring onion',['spring onion','spring onions','scallion','scallions']],
  ['carrot','Produce','carrot',['carrot','carrots']],
  ['mushroom','Produce','mushroom',['mushroom','mushrooms']],
  ['apple','Produce','apple',['apple','apples']],
  ['banana','Produce','banana',['banana','bananas']],
  ['lemon','Produce','lemon',['lemon','lemons']],
  ['lime','Produce','lime',['lime','limes']],
  ['orange','Produce','orange',['orange','oranges']],
  ['cucumber','Produce','cucumber',['cucumber','cucumbers']],
  ['shallot','Produce','shallot',['shallot','shallots']],
  ['semi-skimmed-milk','Dairy & chilled','semi-skimmed milk',['milk','semi-skimmed milk','semi skimmed milk','semiskimmed milk']],
  ['egg','Dairy & chilled','egg',['egg','eggs','large egg','large eggs']],
  ['cheddar','Dairy & chilled','cheddar',['cheddar','cheddar cheese']],
  ['salted-butter','Dairy & chilled','salted butter',['butter','salted butter']],
  ['chopped-tomatoes','Cupboard','chopped tomatoes',['chopped tomatoes','tinned tomatoes','canned tomatoes','tinned chopped tomatoes','canned chopped tomatoes','chopped tomatoes canned','tomatoes tinned','tomatoes canned','tinned whole tomatoes','canned whole tomatoes','tinned plum tomatoes','canned plum tomatoes']],
  ['long-grain-rice','Cupboard','long-grain rice',['rice','long-grain rice','long grain rice','longgrain rice','dry rice','dry long-grain rice','dry long grain rice','long-grain rice dry','long grain rice dry']],
  ['cooking-oil','Cupboard','cooking oil',['oil','vegetable oil','cooking oil']],
  ['scallop','Meat & fish','scallop',['scallop','scallops']],
  ['wrap','Bakery','wrap',['wrap','wraps']]
 ];
 const lookup=new Map(),groups=Object.freeze(definitions.map(([id,category,target,names])=>{
  const aliases=Object.freeze([...new Set([target,...names].map(clean))]);
  if(!safe(target)||aliases.some(value=>!safe(value)))throw Error('Invalid explicit household alias.');
  const group=Object.freeze({id,category,target,aliases});
  for(const value of aliases){if(lookup.has(value)&&lookup.get(value).target!==target)throw Error('Conflicting explicit household alias.');lookup.set(value,group);}
  return group;
 }));
 function canonicalName(value){const name=clean(value);return safe(name)?lookup.get(name)?.target||name:'';}
 function displayName(value){const group=lookup.get(clean(value));return group?group.target.replace(/\b[a-z]/g,letter=>letter.toUpperCase()):typeof value==='string'?value:'';}
 function resolve(value,canonicalize){
  const before=canonicalName(value);if(!before)return '';
  if(typeof canonicalize!=='function')return before;
  try{const after=canonicalName(canonicalize(before));return after||before;}catch{return before;}
 }
 // Identity defaults reuse the existing whole-food conversion entries. This
 // chooses a lookup label only; every factor and quantity stays in its owner.
 function conversionName(value,canonicalize){
  const target=canonicalName(value),legacy={'brown onion':'onion','white potato':'potato','salad tomato':'tomato','semi-skimmed milk':'milk','salted butter':'butter','back bacon':'bacon'};
  const name=legacy[target]||value;
  return typeof canonicalize==='function'?canonicalize(name):clean(name);
 }
 function canonicalStockKey(value){
  if(typeof value!=='string'||value.length>241||value.indexOf('|')<1||value.indexOf('|')!==value.lastIndexOf('|'))return '';
  const at=value.indexOf('|'),name=canonicalName(value.slice(0,at)),unit=value.slice(at+1);
  return name&&unit&&unit.length<=40&&!/[\u0000-\u001f\u007f]/.test(unit)?name+'|'+unit:'';
 }
 // Pricing keeps its existing exact name/unit row. A household spelling may
 // borrow only another explicitly declared spelling's row in that SAME unit;
 // this chooses a lookup name and never changes a pack, price or quantity.
 function catalogueName(value,unit,catalog,canonicalize){
  const original=typeof value==='string'?value:'',name=clean(original);
  if(!safe(name)||typeof unit!=='string'||!unit||!catalog||typeof catalog!=='object')return original;
  const priceName=input=>{try{const key=clean(typeof canonicalize==='function'?canonicalize(input):input);return safe(key)?key:'';}catch{return '';}};
  let indexedNames=null;
  const existing=input=>{
   const wanted=priceName(input);if(!wanted)return '';
   const direct=!Array.isArray(catalog)&&Object.hasOwn(catalog,wanted+'|'+unit)?catalog[wanted+'|'+unit]:null;
   if(direct&&direct.unit===unit&&typeof direct.ingredient==='string'&&priceName(direct.ingredient)===wanted)return wanted;
   if(indexedNames===null){indexedNames=new Set();for(const row of Array.isArray(catalog)?catalog:Object.values(catalog))if(row&&typeof row==='object'&&row.unit===unit&&typeof row.ingredient==='string'){const key=priceName(row.ingredient);if(key)indexedNames.add(key);}}
   return indexedNames.has(wanted)?wanted:'';
  };
  const exact=existing(original);if(exact)return exact;
  const group=lookup.get(name);if(!group)return original;
  for(const candidate of group.aliases){const found=existing(candidate);if(found)return found;}
  return original;
 }
 function audit(values=[]){
  if(!Array.isArray(values))throw Error('An ingredient-name array is required.');
  const matches=[],unmapped=new Set(),invalid=[],observed=new Map();
  for(const input of values){
   const original=typeof input==='string'?input:input?.name||input?.ingredient||input?.key,name=clean(original),target=canonicalName(original),group=lookup.get(name);
   if(!target){invalid.push(typeof original==='string'?original:null);continue;}
   if(!group){unmapped.add(name);continue;}
   matches.push({name,target,group:group.id,changed:name!==target});
   const sources=observed.get(target)||new Set();sources.add(name);observed.set(target,sources);
  }
  return {schemaVersion:1,total:values.length,recognized:matches.length,renamed:matches.filter(row=>row.changed).length,invalid,
   matches,unmapped:[...unmapped].sort(),groups:groups.map(group=>({id:group.id,category:group.category,target:group.target,aliases:[...group.aliases],observed:[...(observed.get(group.target)||[])].sort()})),
   boundaries:['Exact declared names only; no fuzzy matching or descriptor stripping.','Specific proteins, cuts, dietary and cooked/frozen food states remain separate.','Stock-key units are preserved; bulb/clove, each/pack and mass/volume conversions belong to existing reviewed handlers.','Bare pepper remains ambiguous; whole-Peppers provenance is required before associating a legacy pepper stock key.']};
 }
 return Object.freeze({schemaVersion:1,canonicalName,canonicalStockKey,displayName,catalogueName,resolve,conversionName,groups,audit});
});
