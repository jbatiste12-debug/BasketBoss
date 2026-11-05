/* Shopping uses the same personal household groups as At home. This only
   arranges existing rows: quantities, prices and purchase controls stay owned
   by the shopping list. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.BBShopSubcategories=api;api.install(root);}})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const OTHER=Object.freeze({id:'other',name:'Other items'});
 function group(items,{pantryGroups,keyFor=item=>item.id,nameFor=item=>item.name}={}){
  const rows=Array.isArray(items)?items:[];
  if(!rows.length)return [];
  let snapshot;
  try{snapshot=pantryGroups?.snapshot('essentials');}catch{}
  const categories=Array.isArray(snapshot?.groups)?snapshot.groups.filter(value=>value&&typeof value.id==='string'&&value.id&&typeof value.name==='string'&&value.name.trim()):[];
  const unique=new Map(categories.map(value=>[value.id,{id:value.id,name:value.name,items:[]}]));
  if(!unique.has('other'))unique.set('other',{...OTHER,items:[]});
  for(const item of rows){
   let id='other';
   try{const key=String(keyFor(item)||'').replace(/^ess:/,'');const chosen=pantryGroups?.groupFor('essentials',key,String(nameFor(item)||''));if(unique.has(chosen))id=chosen;}catch{}
   unique.get(id).items.push(item);
  }
  return [...unique.values()].filter(value=>value.items.length);
 }
 function install(win){
  const doc=win.document;if(!doc)return;
  const refresh=()=>{if(doc.body?.dataset.bbnextView==='shop-list'&&win.BBPantryGroups)win.BBHomeHost?.refresh?.();};
  // Group definitions are deferred on the app document. Redraw a direct Shop
  // launch once they are ready instead of keeping the initial fallback aisle.
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',refresh,{once:true});else if(win.queueMicrotask)win.queueMicrotask(refresh);else queueMicrotask(refresh);
 }
 return Object.freeze({group,install});
});
