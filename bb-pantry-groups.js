/* Personal organisation only: these groups never change stock, recipes or shopping quantities. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBPantryGroups=api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_pantry_groups_v1',SESSION='basketboss_cloud_session_v1';
 const SECTIONS=Object.freeze(['cupboard','fridge','freezer','essentials']);
 const OTHER=Object.freeze({id:'other',name:'Other items'});
 const DEFAULTS={
  cupboard:[['tins','Tins & jars'],['grains','Pasta, rice & grains'],['baking','Baking'],['spices','Herbs & spices']],
  fridge:[['produce','Fruit & veg'],['dairy','Dairy & eggs'],['protein','Meat & fish'],['sauces','Sauces & leftovers']],
  freezer:[['protein','Meat & fish'],['produce','Fruit & veg'],['sides','Bread & sides'],['batch','Batch meals']],
  essentials:[['cleaning','Cleaning products'],['toiletries','Toiletries'],['laundry','Laundry'],['care','Baby & pet care']]
 };
 const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const clone=x=>JSON.parse(JSON.stringify(x));
 const changed=()=>Error('Your account or groups changed. Reopen this section and try again.');
 function section(value){if(!SECTIONS.includes(value))throw Error('Choose Cupboard, Fridge, Freezer or Weekly essentials.');return value;}
 function itemKey(name){return String(name??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();}
 function label(value){if(typeof value!=='string')throw Error('Enter a group name.');const name=value.normalize('NFKC').replace(/\s+/g,' ').trim();if(!name||name.length>48||/[\u0000-\u001f\u007f]/.test(name))throw Error('Use a group name between 1 and 48 characters.');return name;}
 function defaults(value){return DEFAULTS[section(value)].map(([id,name])=>({id,name}));}
 function validateSection(data){
  if(!object(data)||!Array.isArray(data.groups)||data.groups.length>40||!object(data.assignments))throw Error('Saved groups need review. No items have been changed.');
  const ids=new Set(['other']),names=new Set([itemKey(OTHER.name)]);
  for(const group of data.groups){
   if(!object(group)||typeof group.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(group.id)||ids.has(group.id)||typeof group.name!=='string'||label(group.name)!==group.name||names.has(itemKey(group.name)))throw Error('Saved groups need review. No items have been changed.');
   ids.add(group.id);names.add(itemKey(group.name));
  }
  const entries=Object.entries(data.assignments);if(entries.length>5000)throw Error('Saved groups need review. No items have been changed.');
  for(const [key,id]of entries)if(!key||key.length>240||typeof id!=='string'||!ids.has(id))throw Error('Saved groups need review. No items have been changed.');
 }
 function documentFrom(raw){
  if(raw===null)return {version:1,byActor:{}};
  let value;try{value=JSON.parse(raw);}catch{throw Error('Saved groups need review. No items have been changed.');}
  if(!object(value)||value.version!==1||!object(value.byActor))throw Error('Saved groups need review. No items have been changed.');
  for(const actor of Object.values(value.byActor)){
   if(!object(actor)||!object(actor.sections))throw Error('Saved groups need review. No items have been changed.');
   for(const [key,data]of Object.entries(actor.sections)){section(key);validateSection(data);}
  }
  return value;
 }
 function inferred(sectionId,name){
  const n=itemKey(name);
  if(sectionId==='essentials'){
   if(/\b(dishwasher|washing up|dish soap|dish detergent)\b/.test(n))return 'cleaning';
   if(/\b(laundry|detergent|fabric|softener|washing powder|washing liquid|stain remover)\b/.test(n))return 'laundry';
   if(/\b(napp(?:y|ies)|diapers?|baby|pet|cat|dog|litter|puppy|kitten)\b/.test(n))return 'care';
   if(/\b(toilet rolls?|toilet paper|tooth|toothpaste|toothbrush|shampoo|conditioner|shower|soap|deodorant|razor|sanitary|tampons?|tissues?|hand wash)\b/.test(n))return 'toiletries';
   if(/\b(clean|cleaner|cleaning|bleach|disinfect|washing up|dish|dishwasher|bin bags?|sponges?|wipes?|kitchen roll|scourer|polish)\b/.test(n))return 'cleaning';
   return 'other';
  }
  if(sectionId==='cupboard'){
   if(/\b(tinned|canned|tin|can|jar|chickpeas?|baked beans?|kidney beans?|tuna|passata)\b/.test(n))return 'tins';
   if(/\b(rice|pasta|spaghetti|macaroni|penne|fusilli|noodles?|couscous|quinoa|bulgur|lentils?|oats?|cereal)\b/.test(n))return 'grains';
   if(/\b(flour|sugar|baking|bicarbonate|cocoa|yeast|icing|vanilla|chocolate chips|cornflour)\b/.test(n))return 'baking';
   if(/\b(herbs?|spices?|salt|pepper|paprika|cumin|coriander|turmeric|cinnamon|oregano|thyme|basil|rosemary|nutmeg|chilli powder|curry powder)\b/.test(n))return 'spices';
   return 'other';
  }
  if(sectionId==='freezer'&&/\b(leftovers?|batch|ready meal|cooked meal|casserole|lasagne|lasagna|stew|soup|bolognese)\b/.test(n))return 'batch';
  if(sectionId==='freezer'&&/\b(bread|rolls?|bagels?|wraps?|chips|fries|wedges|roast potatoes|hash browns|garlic bread)\b/.test(n))return 'sides';
  if(sectionId==='fridge'&&/\b(milk|cheese|cheddar|mozzarella|parmesan|butter|yogh?urt|cream|eggs?)\b/.test(n))return 'dairy';
  if(/\b(chicken|beef|pork|lamb|turkey|mince|bacon|ham|sausages?|salmon|tuna|cod|haddock|fish|prawns?|shrimp|mackerel|meat|steak|tofu)\b/.test(n))return 'protein';
  if(/\b(peas|sweetcorn|broccoli|spinach|carrots?|onions?|peppers?|mushrooms?|tomatoes?|lettuce|cucumber|courgettes?|aubergines?|cabbage|kale|avocados?|berries|strawberries|blueberries|raspberries|fruit|vegetables?|apples?|bananas?|lemons?|limes?|oranges?|grapes|potatoes?)\b/.test(n))return 'produce';
  if(sectionId==='fridge'&&/\b(sauce|pesto|ketchup|mayonnaise|mayo|mustard|dressing|chutney|leftovers?|cooked|soup|hummus|houmous|dip)\b/.test(n))return 'sauces';
  return 'other';
 }
 function install(win){
  const storage=win.localStorage;
  function context(){
   const session=storage.getItem(SESSION);let parsed;
   try{parsed=JSON.parse(session||'null');}catch{throw changed();}
   const id=parsed?.user?.id;if(id!==undefined&&(typeof id!=='string'||!id||id.length>256))throw changed();
   return {actor:id||'guest',raw:storage.getItem(KEY),session};
  }
  function current(pin){const now=context();if(pin&&(pin.actor!==now.actor||pin.raw!==now.raw||pin.session!==now.session))throw changed();return now;}
  function saved(all,actor,area){return Object.hasOwn(all.byActor,actor)&&Object.hasOwn(all.byActor[actor].sections,area)?all.byActor[actor].sections[area]:{groups:defaults(area),assignments:{}};}
  function snapshot(area){section(area);const pin=context(),data=saved(documentFrom(pin.raw),pin.actor,area);return {groups:[...clone(data.groups),{...OTHER}],assignments:clone(data.assignments)};}
  function groupFor(area,key,name){const data=snapshot(area);if(Object.hasOwn(data.assignments,key))return data.assignments[key];const candidate=inferred(area,name);return data.groups.some(group=>group.id===candidate)?candidate:'other';}
  function mutation(area,pin,change){
   section(area);if(win.BBAccountDeletion?.isDeleting?.())throw Error('Account deletion is in progress. Groups have not changed.');
   const before=current(pin),all=documentFrom(before.raw),data=clone(saved(all,before.actor,area));
   const result=change(data);validateSection(data);
   if(!Object.hasOwn(all.byActor,before.actor))Object.defineProperty(all.byActor,before.actor,{value:{sections:{}},enumerable:true,writable:true,configurable:true});
   all.byActor[before.actor].sections[area]=data;
   const after=JSON.stringify(all);current(before);
   if(win.BBAccountDeletion?.isDeleting?.())throw changed();
   try{
    storage.setItem(KEY,after);
    if(storage.getItem(KEY)!==after)throw Error('Groups could not be saved on this device.');
    if(context().actor!==before.actor||storage.getItem(SESSION)!==before.session||win.BBAccountDeletion?.isDeleting?.())throw changed();
   }catch(error){
    try{if(storage.getItem(KEY)===after){if(before.raw===null)storage.removeItem(KEY);else storage.setItem(KEY,before.raw);}}catch{}
    throw error;
   }
   return result===undefined?snapshot(area):result;
  }
  function existing(data,id){const group=data.groups.find(row=>row.id===id);if(!group)throw Error('This group no longer exists. Reopen the section.');return group;}
  function unique(data,name,except){const clean=label(name);if(itemKey(clean)===itemKey(OTHER.name)||data.groups.some(row=>row.id!==except&&itemKey(row.name)===itemKey(clean)))throw Error('A group with that name already exists here.');return clean;}
  function create(area,name,pin){return mutation(area,pin,data=>{if(data.groups.length>=40)throw Error('You can have up to 40 groups in each section.');const clean=unique(data,name);let id;do{id='group-'+(win.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)).toLowerCase();}while(data.groups.some(row=>row.id===id));data.groups.push({id,name:clean});return id;});}
  function rename(area,id,name,pin){return mutation(area,pin,data=>{existing(data,id).name=unique(data,name,id);});}
  function remove(area,id,pin){return mutation(area,pin,data=>{existing(data,id);data.groups=data.groups.filter(row=>row.id!==id);for(const key of Object.keys(data.assignments))if(data.assignments[key]===id)data.assignments[key]='other';});}
  function move(area,id,delta,pin){return mutation(area,pin,data=>{existing(data,id);if(delta!==-1&&delta!==1)throw Error('Move a group up or down one place.');const index=data.groups.findIndex(row=>row.id===id),next=index+delta;if(next>=0&&next<data.groups.length){const [group]=data.groups.splice(index,1);data.groups.splice(next,0,group);}});}
  function assign(area,key,id,pin){return mutation(area,pin,data=>{if(typeof key!=='string'||!key||key.length>240)throw Error('Choose a valid item to organise.');if(id!=='other')existing(data,id);Object.defineProperty(data.assignments,key,{value:id,enumerable:true,writable:true,configurable:true});});}
  return Object.freeze({KEY,SECTIONS,itemKey,context,snapshot,groupFor,create,rename,remove,move,assign});
 }
 return Object.freeze({KEY,SECTIONS,defaults,install,itemKey});
});
