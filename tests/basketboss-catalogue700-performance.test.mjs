import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transform700Performance} from '../tools/catalogue700/performance.mjs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const original=read('app.html');
const optimized=transform700Performance(original);
const clone=value=>JSON.parse(JSON.stringify(value));
const free=JSON.parse(read('catalogues/700/release/free.recipes.json'));
const rawNormal=JSON.parse(read('catalogues/700/release/free.normalized.json'));
const normal=Array.isArray(rawNormal)?rawNormal:rawNormal.recipes;

function engine(html){
 const start=html.indexOf('const bb307EstimateBasket=(()=>{'),end=html.indexOf('\nconst BB307Pantry=',start);
 assert.ok(start>=0&&end>start);
 const context=vm.createContext({Intl});
 for(const name of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(read(name),context);
 let calls=0;const pricing=context.BBPriceV19;
 context.BBPriceV19={...pricing,recipeIngredientUnit(...args){calls++;return pricing.recipeIngredientUnit(...args);}};
 vm.runInContext(html.slice(start,end)+';this.basket=bb307EstimateBasket;',context);
 return {basket:args=>clone(context.basket(args)),calls:()=>calls};
}
function pair(){return {baseline:engine(original),fast:engine(optimized)};}
function same(pair,args){assert.deepEqual(pair.fast.basket(args),pair.baseline.basket(args));}
function publicArgs(){return {recipes:clone(free),normalized:clone(normal),market:'UK',selections:free.slice(0,3).map(row=>({id:row.id,servings:4}))};}
function expandedArgs(){
 const args=publicArgs();
 // Public production ingredients exercise the real 700-row shape without
 // committing protected Premium data or depending on a CI secret.
 for(let i=0;i<500;i++){
  const recipe=clone(free[i%free.length]),normalized=clone(normal[i%normal.length]),id='test-private-'+i;
  recipe.id=id;normalized.id=id;
  for(const row of normalized.ingredients)row.recipe_id=id;
  args.recipes.push(recipe);args.normalized.push(normalized);
 }
 return args;
}

test('700 performance transform removes only the unused local rate sweep from the basket engine',()=>{
 const slice=html=>html.slice(html.indexOf('const bb307EstimateBasket=(()=>{'),html.indexOf('\nconst BB307Pantry='));
 const before=slice(original),after=slice(optimized),beforeStart=before.indexOf(' // Price hints are provisional allocations'),beforeEnd=before.indexOf(' const groups=new Map(),unresolved=[];',beforeStart);
 const afterStart=after.indexOf(' // Catalogue 700: unused whole-catalogue fallback-rate sweep omitted.');
 assert.equal(after.slice(0,afterStart),before.slice(0,beforeStart));
 assert.equal(after.slice(afterStart).split('\n').slice(1).join('\n'),before.slice(beforeEnd));
 assert.equal(/\ballUnitRates\b/.test(optimized),false);
 assert.ok(optimized.includes('const quote=BBPriceV19.price({name:g.key,unit:g.unit,quantity:toBuy,market});'));
 assert.equal(transform700Performance(read('index.html')),optimized);
});

test('700 performance transform fails closed when the estimator or unused-map contract changes',()=>{
 for(const changed of [null,'',original.replace('const allUnitRates=new Map();','const allUnitRates=new Map([]);'),
  original.replace(' const groups=new Map(),unresolved=[];',' console.log(allUnitRates.size);\n const groups=new Map(),unresolved=[];'),
  original.replace('const quote=BBPriceV19.price({name:g.key,unit:g.unit,quantity:toBuy,market});','const quote=otherPrice(g);'),
  original+'\nconst bb307EstimateBasket=(()=>{'])assert.throws(()=>transform700Performance(changed),/catalogue700_performance_/);
});

test('all 200 actual Free recipes retain exact basket outputs in every supported market',()=>{
 const p=pair();
 for(const market of ['UK','Jersey','Guernsey','US'])for(let i=0;i<free.length;i+=10){
  same(p,{recipes:free,normalized:normal,market,selections:free.slice(i,i+10).map((row,index)=>({id:row.id,servings:index%2?2:6}))});
 }
});

test('700 rows retain exact shared ingredients, portions, pantry credit and indicative pack prices',()=>{
 const p=pair(),args=expandedArgs();
 args.selections.push({id:'test-private-0',servings:3},{id:'test-private-54',servings:7});
 for(const market of ['UK','Jersey','Guernsey','US']){
  const next={...args,market,pantry:{'chicken breast|g':1000,'garlic|clove':3,'onion|each':1,'cooking oil|ml':20}};
  same(p,next);
 }
});

test('subsequent calls read in-place ingredient quantities, costs, names, source units and catalogue edits',()=>{
 const p=pair(),args=expandedArgs();same(p,args);
 // No persistent derived index exists, so even same-length mutations and
 // edits to the explicit source label are visible on the very next call.
 const row=args.normalized[0],recipe=args.recipes[0];
 for(const edit of [
  ()=>{recipe.ingredients[0][2]*=2;},
  ()=>{row.ingredients[0].quantity*=1.5;},
  ()=>{row.ingredients[0].key='potato';row.ingredients[0].name='Potatoes';recipe.ingredients[0][0]='Potatoes';},
  ()=>{row.ingredients[0].unit='each';recipe.ingredients[0][1]='2 whole potatoes';},
  ()=>{recipe.servings=2;row.servings=2;},
  ()=>{args.recipes.splice(200);args.normalized.splice(200);},
  ()=>{args.recipes[0]=clone(free[9]);args.normalized[0]=clone(normal[9]);args.selections=[{id:args.recipes[0].id,servings:5}];},
  ()=>{args.selections=[{id:args.recipes[1].id,servings:2}];args.pantry={'chicken breast|g':5000};args.market='Guernsey';}
 ]){edit();same(p,args);}
});

test('each call returns fresh mutable result arrays and rows',()=>{
 const p=pair(),args=publicArgs(),before=p.fast.basket(args),expected=clone(before);
 before.items[0].required=999999;before.items[0].quantityAssumptions?.push('test mutation');before.items.push({key:'invented'});before.recipeIds.length=0;before.unresolved.push({status:'invented'});
 assert.deepEqual(p.fast.basket(args),expected);
 same(p,args);
});

test('unknown selected IDs, invalid servings and market errors are unchanged',()=>{
 const p=pair(),args=publicArgs();
 for(const change of [{market:'Mars'},{selections:['not-a-real-recipe']},...[0,-1,101,NaN,Infinity,'invalid'].map(servings=>({selections:[{id:free[0].id,servings}]}))]){
  const request={...args,...change};let baseline;
  try{p.baseline.basket(request);}catch(error){baseline=error.message;}
  assert.ok(baseline);
  assert.throws(()=>p.fast.basket(request),error=>error.message===baseline);
 }
});

test('a 700-recipe basket resolves units only for selected ingredient lines',()=>{
 const p=pair(),args=expandedArgs(),selected=normal[0].ingredients.length;
 args.selections=[{id:free[0].id,servings:4}];
 same(p,args);
 assert.equal(p.fast.calls(),selected,'no whole-catalogue unit resolution remains');
 assert.ok(p.baseline.calls()>selected+3000,'the regression reproduces the previous unused scan');
 const calls=p.fast.calls();
 args.selections=[{id:'test-private-61',servings:3}];same(p,args);
 assert.equal(p.fast.calls()-calls,args.normalized[261].ingredients.length,'a changed selection recalculates immediately');
});

function autoFill({raf=true,storageFailure=false}={}){
 const frames=[],timers=[],busy=[],notifications=[];let session='session-a',actor='actor-a';
 const context=vm.createContext({Promise,JSON,setTimeout:fn=>timers.push(fn),localStorage:{getItem(){if(storageFailure)throw Error('Storage unavailable');return session;}},
  window:{BBHome:{actor:()=>actor},...(raf?{requestAnimationFrame:fn=>frames.push(fn)}:{})},
  bbAfBusy:false,bbAfSetBusy:value=>busy.push(value),notify:value=>notifications.push(value),tab:'week',state:{planned:[{recipeId:'fajitas',day:'Monday'}]}});
 const start=optimized.indexOf('function bbAfWithLock(action){'),end=optimized.indexOf('\nasync function bb81AutoFillPro()',start);
 assert.ok(start>=0&&end>start);vm.runInContext(optimized.slice(start,end),context);
 return {context,frames,timers,busy,notifications,run:action=>context.bbAfWithLock(action),setSession:value=>{session=value;},setActor:value=>{actor=value;},async frame(){assert.ok(frames.length);frames.shift()();await Promise.resolve();}};
}

test('Auto-fill marks busy synchronously and paints before running expensive suggestions once',async()=>{
 const h=autoFill();let calls=0;
 const result=h.run(()=>{calls++;return true;});
 assert.deepEqual(h.busy,[true]);assert.equal(h.context.bbAfBusy,true);assert.equal(calls,0);assert.equal(h.frames.length,1);
 assert.equal(await h.run(()=>{calls++;}),false,'duplicate presses are rejected immediately');
 assert.equal(h.frames.length,1);await h.frame();assert.equal(calls,0,'the first frame only schedules the next frame');
 await h.frame();assert.equal(await result,true);assert.equal(calls,1);
 assert.deepEqual(h.busy,[true,false]);assert.equal(h.context.bbAfBusy,false);assert.deepEqual(h.notifications,[]);
});

for(const change of ['session','actor','tab','state','plan reference','plan content'])test('Auto-fill cancels a '+change+' change while its busy feedback paints',async()=>{
 const h=autoFill();let calls=0;const result=h.run(()=>{calls++;h.context.state.planned.push({recipeId:'must-not-add'});return true;});
 await h.frame();
 if(change==='session')h.setSession('session-b');
 else if(change==='actor')h.setActor('actor-b');
 else if(change==='tab')h.context.tab='shop';
 else if(change==='state')h.context.state={planned:h.context.state.planned};
 else if(change==='plan reference')h.context.state.planned=plainClone(h.context.state.planned);
 else h.context.state.planned.push({recipeId:'another-user-action',day:'Tuesday'});
 const before=JSON.stringify(h.context.state.planned);await h.frame();
 assert.equal(await result,false);assert.equal(calls,0);assert.equal(JSON.stringify(h.context.state.planned),before);
 assert.deepEqual(h.busy,[true,false]);assert.deepEqual(h.notifications,[]);
});
function plainClone(value){return JSON.parse(JSON.stringify(value));}

test('Auto-fill timer fallback yields before calculating when animation frames are unavailable',async()=>{
 const h=autoFill({raf:false});let calls=0;const result=h.run(()=>{calls++;return 'done';});
 assert.deepEqual(h.busy,[true]);await Promise.resolve();assert.equal(calls,0);assert.equal(h.frames.length,0);assert.equal(h.timers.length,1);
 h.timers.shift()();assert.equal(await result,'done');assert.equal(calls,1);assert.deepEqual(h.busy,[true,false]);
});

test('Auto-fill failures and rejected asynchronous actions retain notification and unlock for retry',async()=>{
 const h=autoFill();let reject;
 const result=h.run(()=>new Promise((_resolve,fail)=>{reject=fail;}));await h.frame();await h.frame();
 assert.equal(h.context.bbAfBusy,true);assert.equal(await h.run(()=>true),false);
 reject(Error('Suggestion failure'));assert.equal(await result,false);assert.equal(h.context.bbAfBusy,false);
 assert.deepEqual(h.busy,[true,false]);assert.deepEqual(h.notifications,['Could not finish Auto-fill. Your saved plan is safe; please try again.']);
 const retry=h.run(()=>true);await h.frame();await h.frame();assert.equal(await retry,true);assert.deepEqual(h.busy,[true,false,true,false]);
 const broken=autoFill({storageFailure:true});assert.equal(await broken.run(()=>{throw Error('Must not run');}),false);assert.deepEqual(broken.busy,[true,false]);assert.equal(broken.notifications.length,1);
});

test('the generated busy-feedback change refuses a changed or duplicated legacy lock implementation',()=>{
 for(const altered of [original.replace('return Promise.resolve().then(action).catch(()=>{','return changedScheduler(action).catch(()=>{'),original+'\n'+original.slice(original.indexOf('function bbAfWithLock(action){'),original.indexOf('\nasync function bb81AutoFillPro()'))])assert.throws(()=>transform700Performance(altered),/catalogue700_performance_autofill_lock/);
});
