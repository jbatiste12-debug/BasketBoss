/* The 700 release credits confirmed Shop purchases immediately. The legacy
 * release retains its explicit Finish transfer. No ingredient or unit matching
 * lives here: the existing purchase transfer prepares every stock change. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBShopOwnership=api;})(typeof window==='undefined'?null:window,function(root){
 'use strict';
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const clone=value=>JSON.parse(JSON.stringify(value));
 const ordered=value=>Array.isArray(value)?value.map(ordered):object(value)?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,ordered(value[key])])):value;
 const stable=value=>JSON.stringify(ordered(value));
 const equal=(a,b)=>stable(a)===stable(b);
 const enabled=()=>root?.document?.querySelector('meta[name="basketboss-shop-ownership"]')?.content==='immediate-v1';
 const present=(value,key)=>({present:Object.hasOwn(value,key),...(Object.hasOwn(value,key)?{value:value[key]}:{})});
 const identified=rows=>Array.isArray(rows)&&rows.every(row=>object(row)&&typeof row.id==='string'&&row.id)&&new Set(rows.map(row=>row.id)).size===rows.length;
 function tree(before,after,path=[]){
  if(equal(before,after))return null;
  if(after.present&&object(after.value)&&(!before.present||object(before.value))){
   // A touched manual request/target is one physical intent. Its other fields
   // (including units) must still match before its purchase can be corrected.
   if(path.length===4&&path[0]==='byActor')return {before:clone(before),after:clone(after)};
   const children={},old=before.present?before.value:{};
   for(const key of new Set([...Object.keys(old),...Object.keys(after.value)])){const change=tree(present(old,key),present(after.value,key),[...path,key]);if(change)children[key]=change;}
   return {object:true,beforePresent:before.present,children};
  }
  if(after.present&&identified(after.value)&&(!before.present||identified(before.value))){
   const old=before.present?before.value:[],children={};
   for(const id of new Set([...old.map(row=>row.id),...after.value.map(row=>row.id)])){
    const a=old.find(row=>row.id===id),b=after.value.find(row=>row.id===id);
    if(!equal(a,b))children[id]={before:{present:!!a,...(a?{value:clone(a)}:{})},after:{present:!!b,...(b?{value:clone(b)}:{})},index:old.findIndex(row=>row.id===id)};
   }return {array:true,beforePresent:before.present,children};
  }
  return {before:clone(before),after:clone(after)};
 }
 function rewindTree(actual,change){
  const stale=()=>{throw Error('This purchase has been used or changed. Review its current amount in At home before correcting it.');};
  if(change.object){
   if(!actual.present||!object(actual.value))return stale();
   const next=clone(actual.value);
   for(const [key,child]of Object.entries(change.children)){const restored=rewindTree(present(next,key),child);if(restored.present)next[key]=restored.value;else delete next[key];}
   return {present:change.beforePresent||Object.keys(next).length>0,value:next};
  }
  if(change.array){
   if(!actual.present||!identified(actual.value))return stale();
   const next=clone(actual.value);
   for(const [id,child]of Object.entries(change.children)){
    const index=next.findIndex(row=>row.id===id),row=index>=0?{present:true,value:next[index]}:{present:false};
    if(!equal(row,child.after))return stale();
    if(child.before.present){if(index>=0)next[index]=clone(child.before.value);else next.splice(Math.max(0,Math.min(child.index,next.length)),0,clone(child.before.value));}
    else if(index>=0)next.splice(index,1);
   }return {present:change.beforePresent||next.length>0,value:next};
  }
  if(!equal(actual,change.after))return stale();return clone(change.before);
 }
 function capture(before,after,wholeKeys=[]){
  const changes={};
  for(const [key,value]of Object.entries(after)){
   const old=before[key]??{};if(equal(old,value))continue;
   if(wholeKeys.includes(key)){changes[key]={tree:tree({present:true,value:old},{present:true,value})};continue;}
   if(!object(old)||!object(value))throw Error('Review the saved purchase before changing its amount.');
   const rows={};for(const id of new Set([...Object.keys(old),...Object.keys(value)])){
    const a={present:Object.hasOwn(old,id),...(Object.hasOwn(old,id)?{value:old[id]}:{})},b={present:Object.hasOwn(value,id),...(Object.hasOwn(value,id)?{value:value[id]}:{})};
    if(!equal(a,b))rows[id]={before:clone(a),after:clone(b)};
   }if(Object.keys(rows).length)changes[key]={rows};
  }return changes;
 }
 function rewind(current,changes){
  const restored={};
  for(const [key,change]of Object.entries(changes||{})){
   const value=current[key]??{};
   if(change.tree){restored[key]=rewindTree({present:true,value},change.tree).value;continue;}
   if(change.whole){if(!equal(value,change.after))throw Error('This purchase has changed in At home or on another device. Review its current amount in At home.');restored[key]=clone(change.before);continue;}
   if(!object(value)||!object(change.rows))throw Error('Review the saved purchase in At home.');
   const next=clone(value);for(const [id,row]of Object.entries(change.rows)){
    const actual={present:Object.hasOwn(value,id),...(Object.hasOwn(value,id)?{value:value[id]}:{})};
    if(!equal(actual,row.after))throw Error('This purchase has been used or changed. Review its current amount in At home before correcting it.');
    if(row.before.present)next[id]=clone(row.before.value);else delete next[id];
   }restored[key]=next;
  }return restored;
 }
 function active(marker,id,session){return marker?.kind==='shop-owned-v1'&&marker.amount>0&&!!(session?.purchases?.[id]||session?.partials?.[session.id+'|'+id]);}
 function anchor(items,session,{essential=false,idFor}={}){
  const output=(items||[]).map(row=>({...row})),byId=new Map(output.map(row=>[idFor(row),row]));
  for(const [id,marker]of Object.entries(session?.shelfEdits||{})){
   if(!active(marker,id,session)||!!marker.essential!==essential||id.startsWith('shared:'))continue;
   const original=marker.anchor;if(!object(original))continue;
   const current=byId.get(id),row={...original,...current};
   // Keep the trip's pre-purchase demand as the checkbox anchor. The physical
   // pantry already includes this purchase; subtracting both would hide it.
   const required=Math.max(Number(original.required)||0,Number(current?.required)||0),increase=Math.max(0,required-(Number(original.required)||0));
   row.pantryUsed=Number(original.pantryUsed)||0;row.required=required||original.required;
   if(essential){
    if(!row.id&&id.startsWith('ess:'))row.id=id.slice(4);
    row.pantryUsed=Number(original.pantryUsed??original.ownedQty)||0;row.ownedQty=row.pantryUsed;
    const originalTarget=Number(original.targetQty??original.required)||row.pantryUsed+(Number(original.qty)||0),target=Math.max(originalTarget,Number(current?.targetQty??current?.required)||0);
    row.qty=(Number(original.qty)||0)+Math.max(0,target-originalTarget);row.targetQty=target;
   }
   else row.toBuy=Math.round(((Number(original.toBuy)||0)+increase)*1000000)/1000000;
   row.shopOwnedAnchor=true;
   if(current)Object.assign(current,row);else{output.push(row);byId.set(id,row);}
  }return output;
 }
 return Object.freeze({enabled,capture,rewind,active,anchor});
});
