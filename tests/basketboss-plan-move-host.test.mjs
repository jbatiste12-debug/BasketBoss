import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const model=createRequire(import.meta.url)('../bb-plan-move.js');
const source=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=source.indexOf('function bbPlanMoveSnapshot(){');
const end=source.indexOf('window.BBPlanMoveHost=Object.freeze(',start);
const code=source.slice(start,source.indexOf('\n',end));
function harness(){
 const store=new Map(),state={planned:[{recipeId:'a',day:'Monday'},{recipeId:'b',day:'Tuesday'}],dayServings:{Monday:{recipeId:'a',count:6},Tuesday:{recipeId:'b',count:null}},mealServings:{a:3},plannedDesserts:[{recipeId:'cake',day:'Monday'}],bb81Batch:null,bbManualBatch:null,leftoverSources:{},leftoverConfirmed:{},servings:4};
 let failed=false,renders=0,saves=0,cleanOnFailure=false;
 const ctx={state,DAYS:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],KEY:'plan',BB172_QUICK_DINNER_KEY:'notes',BB_LEFTOVER_LINKS:{a:['b'],unloaded:['b']},BBPlanMove:model,tab:'week',bbStorageSafe:true,console,
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  getRecipe:id=>['a','b'].includes(id)?{id,name:'Dinner '+id}:undefined,bb176AllowedRecipe:()=>true,bbBatchPairs:()=>[],
  bbHomeOccurrence:(id,day)=>id+'|'+day,document:{querySelector:()=>null},window:{},notify:()=>{},
  render:()=>{renders++},persist:()=>{saves++;if(failed){if(cleanOnFailure){state.bb81Batch=null;state.bbManualBatch=null;}return false;}store.set('plan',JSON.stringify(state));return true;}
 };
 store.set('plan',JSON.stringify(state));store.set('stock','original stock');
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,state,store,host:ctx.window.BBPlanMoveHost,fail:(clean=false)=>{failed=true;cleanOnFailure=clean},get saves(){return saves},get renders(){return renders}};
}
const request=(h,to='Tuesday')=>({from:'Monday',to,recipeId:'a',expected:h.host.snapshot().fingerprint});

test('day swap carries serving overrides and leaves desserts, stock and recipe-level portions untouched',()=>{
 const h=harness(),desserts=h.state.plannedDesserts,mealServings=h.state.mealServings;
 const result=h.host.move(request(h));assert.equal(result.ok,true);
 assert.equal(h.state.planned.find(x=>x.recipeId==='a').day,'Tuesday');
 assert.equal(h.state.dayServings.Tuesday.count,6);assert.equal(h.state.dayServings.Monday.count,null);
 assert.equal(h.state.plannedDesserts,desserts);assert.equal(h.state.mealServings,mealServings);
 assert.equal(h.store.get('stock'),'original stock');assert.equal(h.saves,1);assert.equal(h.renders,1);
});

test('custom notes, raw batch links, locked meals and cooked occurrences cannot be displaced',()=>{
 for(const setup of [
  h=>h.store.set('notes',JSON.stringify({Tuesday:'Freezer dinner'})),
  h=>{h.state.bbManualBatch={version:1,pairs:[{sourceDay:'Tuesday',leftoverDay:'Wednesday',recipeId:'b'}]};},
  h=>{h.state.bb81Batch={version:1,monday:'a',wednesday:'unloaded'};},
  h=>{h.ctx.bb176AllowedRecipe=id=>id!=='b';},
  h=>h.store.set('basketboss_at_home_requirements_v1',JSON.stringify({version:1,byActor:{guest:{planned:{'b|Tuesday':true}}}}))
 ]){
  const h=harness();setup(h);const before=JSON.stringify(h.state);
  const result=h.host.move(request(h));assert.equal(result.ok,false);assert.equal(JSON.stringify(h.state),before);assert.equal(h.saves,0);
 }
});

test('account, external storage, servings or cooking completion changes during the hold cancel the move',()=>{
 for(const change of [
  h=>h.store.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:'different-account'}})),
  h=>h.store.set('plan','changed in another tab'),
  h=>{h.state.dayServings.Monday.count=2;},
  h=>h.store.set('basketboss_at_home_requirements_v1',JSON.stringify({version:1,planned:{'a|Monday':true}}))
 ]){
  const h=harness(),move=request(h);change(h);const before=JSON.stringify(h.state);
  assert.equal(h.host.move(move).ok,false);assert.equal(JSON.stringify(h.state),before);assert.equal(h.saves,0);
 }
});

test('raw saved-leftover selections protect the source, linked targets and confirmed meals',()=>{
 for(const setup of [
  h=>{h.state.leftoverSources.a=true;},
  h=>{h.state.leftoverSources.unloaded=true;},
  h=>{h.state.leftoverConfirmed.a=true;},
  h=>{h.state.leftoverConfirmed.b=true;}
 ]){
  const h=harness();setup(h);const before=JSON.stringify(h.state);
  const result=h.host.move(request(h));
  assert.equal(result.ok,false);assert.match(result.message,/saved leftovers/);
  assert.equal(JSON.stringify(h.state),before);assert.equal(h.saves,0);
 }
});

test('disabled leftover flags permit movement and unrelated leftover changes invalidate a held move',()=>{
 const allowed=harness();allowed.state.leftoverSources.a=false;allowed.state.leftoverConfirmed.b=false;
 assert.equal(allowed.host.move(request(allowed)).ok,true);
 for(const field of ['leftoverSources','leftoverConfirmed']){
  const h=harness(),move=request(h);h.state[field].unrelated=true;
  const before=JSON.stringify(h.state),result=h.host.move(move);
  assert.equal(result.ok,false);assert.match(result.message,/week changed/);
  assert.equal(JSON.stringify(h.state),before);assert.equal(h.saves,0);
 }
});

test('failed save restores meal positions and portion state',()=>{
 const h=harness(),before=JSON.stringify(h.state),oldRaw=h.store.get('plan');h.fail();
 assert.equal(h.host.move(request(h)).ok,false);assert.equal(JSON.stringify(h.state),before);assert.equal(h.store.get('plan'),oldRaw);assert.equal(h.renders,0);
});

test('save failure restores raw batch metadata even when legacy persistence cleans it',()=>{
 const h=harness();h.state.bbManualBatch={version:1,pairs:[]};h.state.bb81Batch={version:0};
 const before=JSON.stringify(h.state);h.fail(true);
 assert.equal(h.host.move(request(h,'Friday')).ok,false);assert.equal(JSON.stringify(h.state),before);
});

test('deletion, non-Plan views and malformed completion records disable movement',()=>{
 for(const change of [
  h=>{h.ctx.window.BBAccountDeletion={isDeleting:()=>true};},
  h=>{h.ctx.tab='discover';},
  h=>h.store.set('basketboss_at_home_requirements_v1','not JSON'),
  h=>h.store.set('basketboss_at_home_requirements_v1',JSON.stringify({version:1,planned:'invalid'}))
 ]){
  const h=harness();change(h);assert.equal(h.host.snapshot().ready,false);assert.equal(h.host.move(request(h)).ok,false);assert.equal(h.saves,0);
 }
});


test('a failed verification after writing new positions restores the previous saved plan',()=>{
 const h=harness(),before=JSON.stringify(h.state),oldRaw=h.store.get('plan');
 h.ctx.persist=()=>{h.state.bbManualBatch=null;h.state.bb81Batch=null;h.store.set('plan',JSON.stringify(h.state));return false;};
 h.state.bb81Batch={version:0};const memoryBefore=JSON.stringify(h.state);
 assert.equal(h.host.move(request(h,'Friday')).ok,false);
 assert.equal(JSON.stringify(h.state),memoryBefore);assert.equal(h.store.get('plan'),oldRaw);
});
