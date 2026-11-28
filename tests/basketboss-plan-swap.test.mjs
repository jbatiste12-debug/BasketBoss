import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import core from '../bb-plan-swap-core.js';
import hosts from '../bb-plan-swap-host.js';
import planning from '../bb-recipe-planning.js';
const clone=value=>JSON.parse(JSON.stringify(value));
function harness({browser=false}={}){
 const saved=new Map(),storage={get length(){return saved.size;},key:index=>[...saved.keys()][index]??null,getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value)),removeItem:key=>saved.delete(key),clear:()=>saved.clear()};
 const recipes=['old','other','new','breakfast','locked'].map(id=>({id,name:id,category:id==='breakfast'?'Breakfast':'Family Meals',primaryProtein:id==='other'?'fish':'chicken',ingredients:[['Rice','100 g',1,'Grains']]}));
 let state={planned:[{day:'Monday',recipeId:'old',servings:3,custom:'preserve'},{day:'Tuesday',recipeId:'other',servings:5}],dayServings:{Monday:{recipeId:'old',count:3},Tuesday:{recipeId:'other',count:5}},plannedBreakfasts:[{day:'Monday',recipeId:'breakfast'}],plannedDesserts:[{day:'Tuesday',recipeId:'brownies'}],pantry:{rice:400},servings:4};
 let actor='member-a',cooked=false,batch=[],budget=30,persistFails=false,rotationFails=false,noCandidate=false,quote=25,drawCalls=0,records=[],rendered=0,notices=[];
 storage.setItem('plan',JSON.stringify(state));
 const captures=[],captureStates=[],root={localStorage:storage,BBHouseholdSharingAuto:{capturePlanEdit:edit=>{captures.push(clone(edit));captureStates.push({rotation:storage.getItem(planning.STORAGE_KEY+':'+encodeURIComponent(actor)),records:[...records],rendered});}}};
 let factory=hosts;
 if(browser){vm.runInNewContext(fs.readFileSync(new URL('../bb-plan-swap-host.js',import.meta.url),'utf8'),{window:root});factory=root.BBPlanSwapHostFactory;}
 const app={storage,planKey:'plan',recoveryKey:'backup',getState:()=>state,setState:value=>{state=value;},context:()=>({actor,ready:true,budget,filters:{quick:true,kids:true}}),batchPairs:()=>batch,completion:()=>({confirmed:cooked,undoDay:true}),recipe:id=>recipes.find(r=>r.id===id),servings:(plan,row)=>row.servings,allowed:id=>id!=='locked',ingredientsAllowed:r=>r.id!=='allergen',dinner:planning.isDinner,under30:()=>true,kidAllowed:()=>true,fits:()=>true,variety:()=>true,rotationKey:a=>planning.STORAGE_KEY+':'+encodeURIComponent(a),readOnly:operation=>hosts.readOnlyStorage(root,operation),replacement:core.replacement,estimate:()=>({total:quote,pending:0}),draw:(days,previous,filters)=>{
  drawCalls++;assert.deepEqual(clone(days),['Monday']);assert.equal(previous.length,1);assert.equal(previous[0].recipeId,'other');assert.deepEqual(clone(filters.bbPlanSwapExcluded),['old']);
  if(noCandidate||filters.bbPlanSwapExcluded.includes('new'))return null;
  const actual=planning.createRotation({recipes,storage:root.localStorage,scope:actor,isAllowed:r=>r.id!=='locked'});
  assert.equal(actual.take(recipes[2],{day:'Monday',planned:previous}),true);
  return {additions:[{day:'Monday',recipeId:'new'}],rotation:{key:actual.key,snapshot:actual.snapshot,commit:()=>rotationFails?false:actual.commit()}};
 },persist:()=>{storage.setItem('backup',storage.getItem('plan'));storage.setItem('plan',JSON.stringify(state));return !persistFails;},record:ids=>records.push(...ids),render:()=>{rendered++;},notify:m=>notices.push(m),locked:()=>false};
 const host=factory.createHost(app),controller=core.createController(host);
 return {storage,saved,root,app,host,controller,captures,captureStates,state:()=>state,actor:v=>{actor=v;},cooked:v=>{cooked=v;},batch:v=>{batch=v;},budget:v=>{budget=v;},quote:v=>{quote=v;},persistFails:()=>{persistFails=true;},rotationFails:()=>{rotationFails=true;},noCandidate:()=>{noCandidate=true;},counts:()=>({drawCalls,records,rendered,notices})};
}
test('one-day replacement preserves other dinners, portions, breakfast, dessert and stock',async()=>{
 const h=harness(),before=clone(h.state()),result=await h.controller.swap('Monday');
 assert.equal(result.ok,true);assert.deepEqual(h.state().planned,[{...before.planned[0],recipeId:'new'},before.planned[1]]);
 assert.deepEqual(h.state().dayServings.Monday,{recipeId:'new',count:3});assert.deepEqual(h.state().dayServings.Tuesday,before.dayServings.Tuesday);
 for(const key of ['plannedBreakfasts','plannedDesserts','pantry','servings'])assert.deepEqual(h.state()[key],before[key]);
 assert.equal(h.storage.getItem('plan'),JSON.stringify(h.state()));assert.deepEqual(h.counts().records,['new']);
 assert.equal([...h.saved.keys()].some(key=>/inventory|pantry|cook/.test(key)),false);
});
test('completed and linked batch days cannot be swapped or deduct inventory',async()=>{
 for(const kind of ['cooked','batch']){const h=harness(),before=[...h.saved];if(kind==='cooked')h.cooked(true);else h.batch([{sourceDay:'Monday',leftoverDay:'Wednesday'}]);const result=await h.controller.swap('Monday');assert.equal(result.ok,false);assert.deepEqual([...h.saved],before);assert.equal(h.counts().drawCalls,0);}
});
test('no eligible dinner leaves the saved plan and rotation untouched',async()=>{
 const h=harness(),before=[...h.saved];h.noCandidate();assert.equal((await h.controller.swap('Monday')).reason,'no_candidate');assert.deepEqual([...h.saved],before);
});
test('budget review rejects unavailable and more expensive basket quotes',()=>{
 const h=harness(),snap=h.host.read('Monday');assert.ok(h.host.propose(snap));h.quote(31);assert.equal(h.host.valid(snap,{recipeId:'new',selection:{additions:[{day:'Monday',recipeId:'new'}],rotation:{key:snap.rotationKey}},budgetLimit:30},core.replacement(snap,'new')),false);
 h.app.estimate=()=>({total:25,pending:1});assert.throws(()=>h.host.propose(h.host.read('Monday')),/Budget needs review/);
});
test('account and preference changes during selection discard the pending dinner',async()=>{
 const h=harness(),before=[...h.saved],propose=h.host.propose;
 const controller=core.createController({...h.host,propose:async snap=>{const proposal=propose(snap);h.actor('member-b');return proposal;}});
 assert.equal((await controller.swap('Monday')).reason,'stale');assert.deepEqual([...h.saved],before);
});
test('rapid taps share a single proposal and cannot save two replacements',async()=>{
 const h=harness();let release;const pending=new Promise(resolve=>{release=resolve;});
 const controller=core.createController({...h.host,propose:async snap=>{await pending;return h.host.propose(snap);}});
 const first=controller.swap('Monday');assert.equal((await controller.swap('Tuesday')).reason,'busy');release();assert.equal((await first).ok,true);assert.equal(h.counts().drawCalls,1);
});
test('failed plan and rotation persistence restore the prior dinner and backup',async()=>{
 for(const kind of ['plan','rotation']){const h=harness(),before=clone(h.state()),raw=h.storage.getItem('plan');h.storage.setItem('backup','original-backup');if(kind==='plan')h.persistFails();else h.rotationFails();assert.equal((await h.controller.swap('Monday')).reason,'save_failed');assert.deepEqual(h.state(),before);assert.equal(h.storage.getItem('plan'),raw);assert.equal(h.storage.getItem('backup'),'original-backup');assert.equal(h.counts().records.length,0);}
});
test('the browser quick-swap user action captures exact plan intent only after its plan and rotation are durable',async()=>{
 const h=harness({browser:true}),before=h.storage.getItem('plan');
 assert.equal((await h.controller.swap('Monday')).ok,true);
 assert.deepEqual(h.captures,[{before,after:h.storage.getItem('plan')}]);
 assert.equal(JSON.parse(h.captures[0].after).planned.find(row=>row.day==='Monday').recipeId,'new');
 assert.deepEqual(JSON.parse(h.captures[0].after).dayServings.Monday,{recipeId:'new',count:3});
 assert.ok(h.captureStates[0].rotation,'rotation is already committed when the real global capture handler runs');
 assert.deepEqual(h.captureStates[0].records,[]);assert.equal(h.captureStates[0].rendered,0);
});
test('failed quick-swap plan, rotation, final recipe lookup and stale proposals never become household intents',async()=>{
 for(const failure of ['plan','rotation','final-recipe','stale']){
  const h=harness({browser:true}),before=h.storage.getItem('plan');
  if(failure==='plan')h.persistFails();else if(failure==='rotation')h.rotationFails();
  if(failure==='final-recipe'){const recipe=h.app.recipe;h.app.recipe=id=>{if(h.storage.getItem(planning.STORAGE_KEY+':member-a')!==null)throw Error('synthetic recipe unavailable');return recipe(id);};}
  const controller=failure==='stale'?core.createController({...h.host,propose:snapshot=>{const proposal=h.host.propose(snapshot);h.actor('other');return proposal;}}):h.controller;
  assert.equal((await controller.swap('Monday')).ok,false,failure);
  assert.equal(h.storage.getItem('plan'),before);assert.deepEqual(h.captures,[]);
 }
});
test('optional household capture failures cannot roll back a committed quick swap',async()=>{
 for(const rejectAsync of [false,true]){
  const h=harness({browser:true});let attempts=0;
  h.root.BBHouseholdSharingAuto.capturePlanEdit=()=>{attempts++;if(rejectAsync)return Promise.reject(Error('synthetic queue unavailable'));throw Error('synthetic queue unavailable');};
  assert.equal((await h.controller.swap('Monday')).ok,true);
  assert.equal(attempts,1);assert.equal(JSON.parse(h.storage.getItem('plan')).planned[0].recipeId,'new');
  assert.ok(h.storage.getItem(planning.STORAGE_KEY+':member-a'));assert.deepEqual(h.counts().records,['new']);
 }
});
test('access, diet, dinner, speed, children and weekly variety are rechecked before commit',()=>{
 for(const guard of ['allowed','ingredientsAllowed','dinner','under30','kidAllowed','fits','variety']){const h=harness(),snap=h.host.read('Monday'),proposal=h.host.propose(snap),before=[...h.saved];h.app[guard]=()=>false;assert.equal(h.host.valid(snap,proposal,core.replacement(snap,'new')),false,guard);assert.deepEqual([...h.saved],before);}
});
test('preview storage facade rejects writes and restores the original descriptor',()=>{
 const h=harness(),descriptor=Object.getOwnPropertyDescriptor(h.root,'localStorage'),before=[...h.saved];
 assert.throws(()=>hosts.readOnlyStorage(h.root,()=>h.root.localStorage.setItem('inventory','bad')),/cannot write/);assert.deepEqual([...h.saved],before);assert.deepEqual(Object.getOwnPropertyDescriptor(h.root,'localStorage'),descriptor);
 assert.throws(()=>hosts.readOnlyStorage(h.root,()=>Promise.resolve()),/synchronous/);
});
test('duplicate targets, unsupported portions and no-op replacements fail without mutation',()=>{
 const h=harness(),snap=h.host.read('Monday');for(const id of ['old','other',''])assert.equal(core.replacement(snap,id),null);assert.equal(core.replacement({...snap,servings:0},'new'),null);assert.equal(core.replacement({...snap,plan:{...snap.plan,planned:[...snap.plan.planned,snap.plan.planned[0]]}},'new'),null);
});
test('compact control has an accessible label, stops day gestures and exposes a keyboard focus ring',()=>{
 const ui=fs.readFileSync(new URL('../bb-plan-swap.js',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../bb-plan-swap.css',import.meta.url),'utf8');assert.match(ui,/Find another dinner for/);assert.match(ui,/event.preventDefault\(\);event.stopPropagation\(\)/);assert.match(css,/:focus-visible/);assert.match(css,/min-width:44px/);
});
