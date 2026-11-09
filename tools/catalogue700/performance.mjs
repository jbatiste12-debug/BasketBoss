// The current basket estimator prices selected ingredients through BBPriceV19.
// Its former fallback-rate sweep still traverses the entire catalogue, but its
// local map has no reader. Remove only that exact dead work in generated 700
// clients. No catalogue, plan, pantry or account result is cached.
const START='const bb307EstimateBasket=(()=>{';
const END='\nconst BB307Pantry=';
const UNUSED_SWEEP=` // Price hints are provisional allocations across each recipe, not verified shop products.
 const allUnitRates=new Map();for(const r of recipes){const rr=ns.get(r.id);if(!rr)continue;
  for(let k=0;k<rr.ingredients.length;k++){
   const q=rr.ingredients[k],entry=r.ingredients[k];if(!entry||!Array.isArray(entry))continue;
   const cost=Number(entry[2]),quantity=Number(q.quantity);if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(cost)||cost<=0||!q.key||!q.unit)continue;
   const unit=BBPriceV19.recipeIngredientUnit?.(q,r.ingredients)||q.unit;const id=groupName(q.key)+'|'+unit;if(!allUnitRates.has(id))allUnitRates.set(id,[]);allUnitRates.get(id).push(cost/quantity);
  }
 }
`;
const AUTO_FILL_LOCK=`function bbAfWithLock(action){
 if(bbAfBusy)return Promise.resolve(false);
 bbAfBusy=true;bbAfSetBusy(true);
 return Promise.resolve().then(action).catch(()=>{
  notify('Could not finish Auto-fill. Your saved plan is safe; please try again.');return false;
 }).finally(()=>{bbAfBusy=false;bbAfSetBusy(false);});
}`;
const PAINTED_AUTO_FILL_LOCK=`function bbAfWithLock(action){
 if(bbAfBusy)return Promise.resolve(false);
 bbAfBusy=true;bbAfSetBusy(true);
 // Capture the initiating screen/account/plan synchronously. Let busy controls
 // paint before calculating suggestions, then discard a stale button press.
 let pin;
 const painted=new Promise((resolve,reject)=>{
  try{
   pin={session:localStorage.getItem('basketboss_cloud_session_v1'),actor:window.BBHome?.actor?.()||'guest',tab,state,planned:state.planned,plan:JSON.stringify(state.planned)};
   if(typeof window.requestAnimationFrame==='function')window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve));
   else setTimeout(resolve,0);
  }catch(error){reject(error);}
 });
 return painted.then(()=>{
  if(localStorage.getItem('basketboss_cloud_session_v1')!==pin.session||(window.BBHome?.actor?.()||'guest')!==pin.actor||tab!==pin.tab||state!==pin.state||state.planned!==pin.planned||JSON.stringify(state.planned)!==pin.plan)return false;
  return action();
 }).catch(()=>{
  notify('Could not finish Auto-fill. Your saved plan is safe; please try again.');return false;
 }).finally(()=>{bbAfBusy=false;bbAfSetBusy(false);});
}`;

export function transform700Performance(source){
 if(typeof source!=='string')throw Error('catalogue700_performance_source');
 const start=source.indexOf(START),end=source.indexOf(END,start);
 if(start<0||end<=start||source.indexOf(START,start+START.length)>=0)throw Error('catalogue700_performance_engine');
 const engine=source.slice(start,end),at=engine.indexOf(UNUSED_SWEEP);
 if(at<0||engine.indexOf(UNUSED_SWEEP,at+UNUSED_SWEEP.length)>=0)throw Error('catalogue700_performance_unused_sweep');
 const updated=engine.replace(UNUSED_SWEEP,' // Catalogue 700: unused whole-catalogue fallback-rate sweep omitted.\n');
 // Stop the build if a future estimator starts using the map again, or changes
 // the selected-ingredient pack-pricing path on which this removal depends.
 if(/\ballUnitRates\b/.test(updated)||!updated.includes('const quote=BBPriceV19.price({name:g.key,unit:g.unit,quantity:toBuy,market});'))throw Error('catalogue700_performance_rate_consumer');
 source=source.slice(0,start)+updated+source.slice(end);
 const lockAt=source.indexOf(AUTO_FILL_LOCK);
 if(lockAt<0||source.indexOf(AUTO_FILL_LOCK,lockAt+AUTO_FILL_LOCK.length)>=0)throw Error('catalogue700_performance_autofill_lock');
 return source.slice(0,lockAt)+PAINTED_AUTO_FILL_LOCK+source.slice(lockAt+AUTO_FILL_LOCK.length);
}
