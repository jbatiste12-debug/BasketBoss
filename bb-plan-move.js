/* Dinner-only day moves. Pure proposal: no DOM, stock, storage or network writes.
 * The host must recheck permissions, plan snapshots and protected days before
 * saving the returned fields, and restore its old state if persistence fails.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BBPlanMove=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const DAYS=new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const recipeId=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim().length>0;
  const count=value=>value===null||(typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=12);
  const failure=message=>({ok:false,message});
  function move(state,from,to,context={}){
    if(!DAYS.has(from)||!DAYS.has(to))return failure('Choose valid dinner days.');
    if(from===to)return failure('Choose a different day.');
    if(!object(state)||!Array.isArray(state.planned)||!object(context))return failure('Your dinner plan needs review before moving a meal.');
    const planned=state.planned;
    if(planned.some(row=>!object(row)||!DAYS.has(row.day)||!recipeId(row.recipeId))||new Set(planned.map(row=>row.day)).size!==planned.length)
      return failure('Your dinner plan needs review before moving a meal.');
    const source=planned.find(row=>row.day===from),target=planned.find(row=>row.day===to);
    if(!source)return failure('That day no longer has a dinner to move.');
    if(own(context,'expectedRecipeId')&&(!recipeId(context.expectedRecipeId)||context.expectedRecipeId!==source.recipeId))
      return failure('That dinner changed. Review your plan and try again.');
    if(own(context,'blockedDays')&&!Array.isArray(context.blockedDays))return failure('Your dinner plan needs review before moving a meal.');
    const blocked=new Set(context.blockedDays||[]);
    if(blocked.has(from)||blocked.has(to))return failure('One of these days is unavailable. Review its dinner before moving it.');
    const overrides=state.dayServings===undefined?{}:state.dayServings;
    if(!object(overrides))return failure('Check the serving amounts before moving this dinner.');
    for(const day of [from,to]){
      if(!own(overrides,day))continue;
      const value=overrides[day];
      if(!object(value)||!recipeId(value.recipeId)||!own(value,'count')||!count(value.count))
        return failure('Check the serving amounts before moving this dinner.');
    }
    const nextPlanned=planned.map(row=>({...row,day:row.day===from?to:row.day===to?from:row.day}));
    const nextServings={...overrides};
    delete nextServings[from];delete nextServings[to];
    // Day-specific portions belong to the recipe occurrence, including a null
    // marker that intentionally clears an older recipe-scoped override.
    if(overrides[from]?.recipeId===source.recipeId)nextServings[to]={...overrides[from]};
    if(target&&overrides[to]?.recipeId===target.recipeId)nextServings[from]={...overrides[to]};
    return {ok:true,planned:nextPlanned,dayServings:nextServings,swapped:!!target};
  }
  return Object.freeze({move});
});
