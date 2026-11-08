/* One-day dinner replacement. Candidate selection and saving stay host-owned. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBPlanSwapCore=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function replacement(snapshot,recipeId){
  const plan=snapshot?.plan,day=snapshot?.day,slots=plan?.planned;
  if(!DAYS.includes(day)||!Array.isArray(slots)||typeof recipeId!=='string'||!recipeId||recipeId===snapshot.recipeId||slots.filter(row=>row.day===day).length!==1||slots.some(row=>row.day!==day&&row.recipeId===recipeId)||!Number.isInteger(snapshot.servings)||snapshot.servings<1||snapshot.servings>12)return null;
  const planned=slots.map(row=>row.day===day?{...row,recipeId,servings:snapshot.servings}:row);
  const next={...plan,planned};
  if(plan.dayServings?.[day]?.recipeId===snapshot.recipeId)next.dayServings={...plan.dayServings,[day]:{...plan.dayServings[day],recipeId,count:snapshot.servings}};
  return next;
 }
 function createController(host,{onBusy=()=>{}}={}){
  let busy=false;
  const reply=value=>{if(value?.message)host.notify?.(value.message);return value;};
  const stale=()=>({ok:false,reason:'stale',message:'Your account, meal preferences or week changed. Try choosing dinner again.'});
  async function perform(day){
   let initial;try{initial=host.read(day);}catch{return reply({ok:false,reason:'unavailable',message:'Your planner could not be checked. Reopen Plan and try again.'});}
   if(!initial?.ready)return reply({ok:false,reason:initial?.reason||'unavailable',message:initial?.message||'Open a planned dinner before choosing another meal.'});
   if(initial.blocked)return reply({ok:false,reason:initial.reason||'blocked',message:initial.message||'Review this day before changing dinner.'});
   let proposal;try{proposal=await host.propose(initial);}catch{return reply({ok:false,reason:'unavailable',message:'Another dinner could not be checked. Try again shortly.'});}
   let current;try{current=host.read(day);}catch{return reply(stale());}
   if(!current?.ready||current.blocked||current.fingerprint!==initial.fingerprint)return reply(stale());
   if(!proposal)return reply({ok:false,reason:'no_candidate',message:'No other dinner fits your current meal preferences and budget. Try changing those choices.'});
   const next=replacement(initial,proposal.recipeId);
   if(!next)return reply({ok:false,reason:'invalid_candidate',message:'That dinner is no longer available for this day. Try another choice.'});
   let valid=false;try{valid=host.valid(initial,proposal,next)===true;}catch{}
   if(!valid)return reply(stale());
   // The host rechecks the lease while committing and owns rollback for both
   // plan persistence and the existing confirmed-only rotation history.
   let saved;try{saved=await host.save(initial,proposal,next);}catch{saved=null;}
   if(!saved?.ok)return reply(saved||{ok:false,reason:'save_failed',message:'Dinner could not be saved. Please try again.'});
   return reply({...saved,ok:true,day,recipeId:proposal.recipeId,message:saved.message||day+' dinner changed.'});
  }
  async function swap(day){
   if(!DAYS.includes(day))return {ok:false,reason:'invalid_day'};
   if(busy||host.locked?.())return {ok:false,reason:'busy'};
   busy=true;onBusy(true);
   try{
    if(host.yield)await host.yield();
    const result=host.withLock?await host.withLock(()=>perform(day)):await perform(day);
    return result&&typeof result==='object'?result:{ok:false,reason:'busy'};
   }finally{busy=false;onBusy(false);}
  }
  return Object.freeze({swap,get busy(){return busy;}});
 }
 return Object.freeze({DAYS,replacement,createController});
});
