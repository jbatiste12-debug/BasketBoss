/* Generated700-only adapter to the existing planner, pricing and Auto-Fill. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBPlanSwapHostFactory=api;})(typeof window==='undefined'?null:window,function(win){
 'use strict';
 const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function readOnlyStorage(root,operation){
  const descriptor=Object.getOwnPropertyDescriptor(root,'localStorage'),original=root.localStorage;
  if(descriptor?.configurable===false)throw Error('Read-only planner review is unavailable');
  const snapshot=new Map();for(let index=0;index<original.length;index++){const key=original.key(index);if(key!==null)snapshot.set(key,original.getItem(key));}
  let reviewing=true,writes=0;
  const facade={get length(){return reviewing?snapshot.size:original.length;},key:index=>reviewing?[...snapshot.keys()][index]??null:original.key(index),getItem:key=>reviewing?(snapshot.get(String(key))??null):original.getItem(key)};
  for(const name of ['setItem','removeItem','clear'])facade[name]=(...args)=>{if(reviewing){writes++;throw Error('A dinner preview cannot write storage');}return original[name](...args);};
  Object.defineProperty(root,'localStorage',{configurable:true,value:facade});
  try{const result=operation();if(result?.then)throw Error('Dinner review must be synchronous');if(writes)throw Error('Dinner review attempted a storage change');return result;}
  finally{reviewing=false;if(descriptor)Object.defineProperty(root,'localStorage',descriptor);else delete root.localStorage;}
 }
 function createHost(app){
  function read(day){
   const plan=app.getState(),context=app.context(),slots=Array.isArray(plan?.planned)?plan.planned.filter(row=>row.day===day):[];
   if(!DAYS.includes(day)||!context.ready)return {ready:false,day,reason:'unavailable',message:'Open Plan when your account and saved week are ready.'};
   const pairs=app.batchPairs();
   if(pairs.some(pair=>pair.sourceDay===day||pair.leftoverDay===day))return {ready:true,blocked:true,day,reason:'batch',message:day+' is linked to a batch meal. Remove that batch link before choosing another dinner.'};
   if(slots.length!==1)return {ready:false,day,reason:'missing_dinner',message:'Add a dinner to '+day+' before looking for a replacement.'};
   let cooked;try{cooked=app.completion(day);}catch{return {ready:true,blocked:true,day,reason:'completion_review',message:'Review '+day+'’s cooking confirmation before changing dinner.'};}
   if(cooked?.confirmed)return {ready:true,blocked:true,day,reason:'completed',message:cooked.undoDay?'Undo Day done for '+day+' before changing its dinner.':'Review '+day+'’s cooking confirmation before changing dinner.'};
   const recipe=app.recipe(slots[0].recipeId),servings=app.servings(plan,slots[0],recipe);
   if(!recipe||!app.allowed(recipe.id))return {ready:false,day,reason:'access',message:'Reconnect access to this dinner before choosing another meal.'};
   const rawPlan=app.storage.getItem(app.planKey),rotationKey=app.rotationKey(context.actor),rotationRaw=app.storage.getItem(rotationKey);
   return {ready:true,day,plan,recipeId:recipe.id,servings,context,rawPlan,rotationKey,rotationRaw,fingerprint:JSON.stringify({plan,context,rawPlan,rotationRaw})};
  }
  function quoteFor(snapshot,next){const quote=app.estimate(next);return quote&&Number.isFinite(quote.total)&&quote.total>=0&&quote.pending===0?quote:null;}
  function propose(snapshot){
   return app.readOnly(()=>{
    const budget=Number(snapshot.context.budget)||0,before=budget>0?quoteFor(snapshot,snapshot.plan):null;
    if(budget>0&&!before)throw Error('Budget needs review');
    const limit=budget>0?Math.max(budget,before.total):null,others=snapshot.plan.planned.filter(row=>row.day!==snapshot.day),excluded=[snapshot.recipeId];
    // Quote the selected proposal, rather than rebuilding a whole household
    // basket for every recipe in the catalogue before the user gets a choice.
    // Rejected trials never commit rotation or write the plan/inventory.
    for(let attempt=0;attempt<12;attempt++){
     const filters={...snapshot.context.filters,bbPlanSwapExcluded:excluded};
     const selection=app.draw([snapshot.day],others,filters,false);
     if(!selection||selection.additions?.length!==1||selection.additions[0].day!==snapshot.day)return null;
     const recipeId=selection.additions[0].recipeId;
     if(excluded.includes(recipeId))return null;
     if(limit!==null){const next=app.replacement(snapshot,recipeId),quote=next&&quoteFor(snapshot,next);if(!quote||quote.total>limit+0.005){excluded.push(recipeId);continue;}}
     return {recipeId,selection,budgetLimit:limit};
    }
    return null;
   });
  }
  function valid(snapshot,proposal,next){
   const recipe=app.recipe(proposal.recipeId),others=snapshot.plan.planned.filter(row=>row.day!==snapshot.day),filters=snapshot.context.filters;
   if(!recipe||recipe.id===snapshot.recipeId||others.some(row=>row.recipeId===recipe.id)||!app.allowed(recipe.id)||!app.ingredientsAllowed(recipe)||!app.dinner(recipe)||filters.quick&&!app.under30(recipe)||filters.kids&&!app.kidAllowed(recipe)||!app.fits(recipe,snapshot.day,others)||!app.variety(next.planned))return false;
   const selection=proposal.selection;
   if(!selection?.rotation||selection.additions?.length!==1||selection.additions[0].recipeId!==recipe.id||selection.additions[0].day!==snapshot.day)return false;
   if(selection.rotation.key!==snapshot.rotationKey)return false;
   if(proposal.budgetLimit!==null){const quote=app.readOnly(()=>quoteFor(snapshot,next));if(!quote||quote.total>proposal.budgetLimit+0.005)return false;}
   return true;
  }
  function restoreValue(key,before,owned){
   try{if(app.storage.getItem(key)!==owned)return false;if(before===null)app.storage.removeItem(key);else app.storage.setItem(key,before);return true;}catch{return false;}
  }
  function save(snapshot,proposal,next){
   const latest=read(snapshot.day);if(!latest.ready||latest.blocked||latest.fingerprint!==snapshot.fingerprint||!valid(snapshot,proposal,next))return {ok:false,reason:'stale',message:'Your account or week changed. Try choosing dinner again.'};
   const recoveryBefore=app.storage.getItem(app.recoveryKey),rotationBefore=app.storage.getItem(snapshot.rotationKey),prior=app.getState(),expectedPlan=JSON.stringify(next);
   let actualWritten=expectedPlan,rotationWritten=null;
   const rollback=()=>{
    const ownsState=app.getState()===next;if(ownsState){actualWritten=JSON.stringify(app.getState());app.setState(prior);}
    restoreValue(app.planKey,snapshot.rawPlan,actualWritten);
    if(snapshot.rawPlan!==null)restoreValue(app.recoveryKey,recoveryBefore,snapshot.rawPlan);
    if(rotationWritten!==null)restoreValue(snapshot.rotationKey,rotationBefore,rotationWritten);
   };
   try{
    app.setState(next);
    if(app.persist()!==true||app.getState()!==next||JSON.stringify(app.getState())!==expectedPlan||app.storage.getItem(app.planKey)!==expectedPlan||!same(app.context(),snapshot.context)||!valid(snapshot,proposal,next))throw Error('Plan save failed');
    const rotation=proposal.selection.rotation,snap=rotation.snapshot();rotationWritten=JSON.stringify({version:1,cycle:snap.cycle,seen:snap.seen,last:snap.selected.slice(-7)});
    if(rotation.commit()!==true||app.getState()!==next||app.storage.getItem(app.planKey)!==expectedPlan||!same(app.context(),snapshot.context))throw Error('Rotation save failed');
    // These best-effort UI/history effects must not roll back a durably saved
    // plan and rotation if a renderer or history cache becomes unavailable.
    try{app.record([proposal.recipeId]);}catch{}
    try{app.render();}catch{}
    return {ok:true,message:snapshot.day+' dinner changed to '+app.recipe(proposal.recipeId).name+'.'};
   }catch{rollback();return {ok:false,reason:'save_failed',message:'Dinner could not be saved. Your previous meal is restored.'};}
  }
  return Object.freeze({read,propose,valid,save,notify:app.notify,locked:app.locked,withLock:app.withLock,yield:app.yield,visibleSlot:day=>(app.getState()?.planned||[]).find(row=>row.day===day)||null});
 }
 function currentPlanner(){
  const store=win.localStorage;
  const context=()=>{
   const actor=win.BBHome?.actor?.()||'guest',session=store.getItem('basketboss_cloud_session_v1'),premium=win.BasketBossVerifiedPremium?.isActive?.()===true;
   const dependencyKeys=[BB307_STOCK_KEY,'basketboss_makeameal_v1_inventory','basketboss_at_home_requirements_v1','basketboss_ui_next_local_shelf_prices_v1',BB_BETA_RECEIPT_KEY,BB_SHOP_SESSION_V7_KEY,BB321_LUNCH_KEY,BB307_FEATURE_KEY,BB172_QUICK_DINNER_KEY,'basketboss_planned_recipe_dates_v1'];
   return {actor,session,premium,ready:tab==='week'&&bbStorageSafe&&win.BBAccountDeletion?.isDeleting?.()!==true,market:bb307Market,retailer:bb307ActiveRetailer(),budget:bb172BudgetValue(),filters:premium?{...bb81ProFilters}:{quick:false,protein:false,kids:false,batch:false},ingredients:typeof BBIngredientPreferences==='undefined'?null:{scope:BBIngredientPreferences.scope(),selected:BBIngredientPreferences.getSelected()},meals:typeof BBMealPreferences==='undefined'?null:BBMealPreferences.get(),dependencies:Object.fromEntries(dependencyKeys.map(key=>[key,store.getItem(key)])),catalogue:RECIPES.map(recipe=>recipe.id)};
  };
  const estimate=next=>{
   const before=state,oldStock=bb307Stock;state=next;
   try{
    const result=bb307Plan(),reviewRequired=bbReceiptPantryReviewRequired()||bbReceiptHasAuthoritativePantry();
    const items=bb321UnifiedShop(result.items).map(item=>!item.manualBuyQty&&!reviewRequired&&bb172AssumesOnHand(item)?{...item,toBuy:0}:item);
    const automatic=(bb307FeatureState?.essentials||[]).filter(x=>x.selected).map(x=>{const q=win.BBWeeklyEssentials?.reconcile(x);return q?.manual?{...x,qty:q.toBuy??x.qty,bbHomeTarget:x}:x;}).filter(x=>x.bbHomeTarget?x.qty>0:!x.owned);
    const essentials=win.BBHome?.manualBuyEssentials?.(automatic)||automatic,quotes=[...items.filter(x=>x.toBuy>0).map(x=>bb15Quote(x)),...essentials.map(x=>bb15Quote(x,true))];
    return {total:Math.round(quotes.reduce((sum,quote)=>sum+(Number.isFinite(quote?.amount)?quote.amount:0),0)*100)/100,pending:quotes.filter(quote=>!Number.isFinite(quote?.amount)).length};
   }finally{state=before;bb307Stock=oldStock;}
  };
  return {storage:store,planKey:KEY,recoveryKey:BB_SNAPSHOT,getState:()=>state,setState:next=>{state=next;},context,recipe:getRecipe,allowed:bb176AllowedRecipe,ingredientsAllowed:bbAfIngredientAllowed,dinner:recipe=>BBRecipePlanning.isDinner(recipe),under30:bb81Under30,kidAllowed:bb81KidOK,variety:planned=>bbPlanVarietyValid(planned,true),fits:(recipe,day,other)=>{const map=new Map(RECIPES.map(value=>[value.id,bbAfTags(value)]));return bbAfFits(recipe,day,other,id=>map.get(id)||null,typeof BBPantryAutofill!=='undefined');},servings:(plan,slot,recipe)=>BBServing.forMeal(plan,slot,recipe),batchPairs:bbBatchPairs,completion:day=>{const meals=bbHomeDayMeals(day),confirmed=meals.some(meal=>win.BBHome?.isCooked?.(meal.occurrence)===true);if(!confirmed)return {confirmed:false};const undo=win.BBHome?.previewUndoDay?.({day,actorId:win.BBHome.actor()});return {confirmed:true,undoDay:undo?.ok===true&&undo.already===false};},rotationKey:actor=>BBRecipePlanning.STORAGE_KEY+':'+encodeURIComponent(actor),draw:bbAfDraw,replacement:(snapshot,id)=>win.BBPlanSwapCore.replacement(snapshot,id),readOnly:operation=>win.BBPlanSwapHostFactory.readOnlyStorage(win,operation),estimate,persist,record:bbRecordPlannedRecipes,render,notify,locked:()=>bbAfBusy,withLock:bbAfWithLock,yield:()=>new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)))};
 }
 return Object.freeze({createHost,currentPlanner,readOnlyStorage});
});
