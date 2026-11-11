import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const index=read('index.html'),NOW=Date.parse('2026-11-04T12:00:00Z'),DAY=86400000;
const STOCK='basketboss_321_v7_measured_pantry',HISTORY='basketboss_planned_recipe_dates_v1',PLAN='basketboss_321_unified_state_v1';
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const plain=value=>JSON.parse(JSON.stringify(value));
function extract(name,next){const start=index.indexOf('function '+name+'('),end=index.indexOf(next,start);assert.ok(start>=0&&end>start,name+' must remain available');return index.slice(start,end);}
const helpers=extract('bbRotationSession','/* BASKETBOSS_EVENING_PIVOT_ADAPTER')+'\n'+
 extract('bbPlanVarietyValid','\nfunction bbRotationMessage')+'\n'+
 extract('bbHomeRecipeIngredients','\nfunction bbHomeDayMeals')+'\n'+
 extract('bbHomeDayMeals','\nfunction bbHomeLunchForShopping')+'\n'+
 extract('bbHomeExcludedStockKeys','\nfunction bbHomePlanningStock');
const start=index.indexOf("const BB_AF_DAYS=['Monday'"),end=index.indexOf('/* END_BASKETBOSS_AUTOFILL_VARIETY_ROTATION_V1 */',start);
assert.ok(start>0&&end>start);
const auto=index.slice(start,end);
function recipe(id,protein,ingredients=[{name:'Rice',quantity:300,unit:'g'}],extra={}){
 return {id,name:id+' dinner',category:'Family dinner',tag:'STYLE-'+id,editorialCollection:'Everyday Favourites',servings:4,mins:25,
  primaryProtein:protein,cheeseHeavy:false,
  ingredients:ingredients.map(row=>[row.name,row.quantity+' '+row.unit]),
  normalized:ingredients.map(row=>({key:row.name.toLowerCase(),name:row.name,quantity:row.quantity,unit:row.unit})),...extra};
}
function harness(catalog,{stock={},planned=[],history={},actor='guest',random=.1,blocked=false,lunches={},pairs=[],inventory={}}={}){
 const values=new Map([[STOCK,JSON.stringify(stock)],['basketboss_makeameal_v1_inventory',JSON.stringify(inventory)]]),writes=[],attempts=[],notices=[];
 if(Object.keys(history).length)values.set(HISTORY,JSON.stringify({version:1,byActor:{[actor]:history}}));
 if(actor!=='guest')values.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:actor}}));
 const state={version:2,servings:4,planned:plain(planned),plannedDesserts:[],dayServings:{}};
 const allowed=new Set(catalog.map(row=>row.id)),excluded=new Set();let canPersist=true,renders=0;
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push([key,String(value)]);},removeItem:key=>values.delete(key)};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}}
 const ctx={Date:Clock,Math:Object.assign(Object.create(Math),{random:typeof random==='function'?random:()=>random}),console,
  localStorage:storage,state,RECIPES:catalog,BB307_NORMALIZED:catalog.map(row=>({id:row.id,ingredients:row.normalized})),
  DAYS,BB321Lunch:{LUNCH_DAYS:DAYS.slice(0,5)},BB307_STOCK_KEY:STOCK,bb307Market:'UK',
  BBIngredientPreferences:{recipeAllowed:row=>!excluded.has(row.id),scope:()=>actor},
  BBHome:{actor:()=>actor,blocked:()=>blocked,isCooked:()=>false},
  getRecipe:id=>catalog.find(row=>row.id===id),bb176AllowedRecipe:id=>allowed.has(id),
  bb81Under30:()=>true,bb81KidOK:()=>true,bb81BatchOK:()=>true,bb81ProteinScore:()=>0,
  bbHomePhysicalStock:()=>JSON.parse(storage.getItem(STOCK)||'{}'),bb307ReadStock:()=>JSON.parse(storage.getItem(STOCK)||'{}'),bb321LunchState:{children:1,days:lunches},
  bbHomeOccurrence:(id,day,kind='dinner')=>day+'|'+kind+'|'+id,
  bbBatchPairs:()=>pairs,bbBatchPairFor:slot=>pairs.find(pair=>pair.sourceDay===slot.day&&pair.recipeId===slot.recipeId),
  bb172QuickDinners:()=>({}),notify:message=>notices.push(message),render:()=>{renders++;},
  persist:()=>{if(!canPersist)return false;storage.setItem(PLAN,JSON.stringify(state));return true;}
 };
 ctx.window=ctx;vm.createContext(ctx);
 for(const name of ['bb-recipe-planning.js','bb-recipe-editorial.js','bb-serving-scale.js'])vm.runInContext(read(name),ctx);
 vm.runInContext(read('basketboss-pricing-v19.js'),ctx);
 ctx.BB_WHOLE_PRODUCE_GRAMS=ctx.BBPriceV19.wholeProduceGrams;
 const pantryStart=index.indexOf('const BB307Pantry=(()=>{'),pantryEnd=index.indexOf('// BasketBoss 321 v7 original-design',pantryStart);
 vm.runInContext(index.slice(pantryStart,pantryEnd)+';this.BB307Pantry=BB307Pantry;',ctx);
 vm.runInContext(extract('bbHomePhysicalStock','\nfunction bb307ReadStock'),ctx);
 vm.runInContext(read('bb-pantry-deduction.js'),ctx);
 vm.runInContext(read('bb-pantry-autofill.js'),ctx);
 const actual=ctx.BBPantryAutofill;
 ctx.BBPantryAutofill={...actual,create(options){
  const ledger=actual.create(options),record={initial:plain(ledger.snapshot()),assessments:[],reservations:[],ledger};attempts.push(record);
  return {...ledger,assess(rows,context){const result=ledger.assess(rows,context);record.assessments.push({recipeId:context?.recipeId,result:plain(result)});return result;},
   reserve(rows,context){const result=ledger.reserve(rows,context);record.reservations.push(plain(result));return result;}};
 }};
 vm.runInContext(helpers+'\n'+auto,ctx);
 const api=vm.runInContext('({draw:bbAfDraw,commit:bbAfCommit,weighted:bbAfWeightedPick,exact:bbAfExactProtein,previous:bbAfPreviousProtein,valid:bbPlanVarietyValid,readHistory:bbPlannedRecipeHistory,record:bbRecordPlannedRecipes,rotation:()=>bbRotationSession({forAutoFill:true})})',ctx);
 return {api,ctx,state,values,writes,attempts,notices,allowed,excluded,storage,get renders(){return renders;},setPersist:value=>{canPersist=value;}};
}

test('actual Auto-fill weights pantry overlap while retaining non-pantry candidates at nonzero probability',()=>{
 const catalog=[recipe('pantry','chicken'),recipe('new-food','beans',[{name:'Pasta',quantity:300,unit:'g'}])];
 const chooseFirst=harness(catalog,{stock:{'rice|g':500},random:0}),before=[...chooseFirst.values];
 const first=chooseFirst.api.draw(['Monday'],chooseFirst.state.planned);assert.ok(first,JSON.stringify({snapshot:chooseFirst.api.rotation().snapshot(),eligible:chooseFirst.api.rotation().eligible}));assert.equal(first.additions[0].recipeId,'pantry');
 const assessed=chooseFirst.attempts[0].assessments;assert.equal(assessed.find(row=>row.recipeId==='pantry').result.pantryBonus,3);
 assert.equal(assessed.find(row=>row.recipeId==='new-food').result.pantryBonus,0);
 assert.deepEqual([...chooseFirst.values],before,'a proposal does not change pantry, plan or history');
 const chooseLast=harness(catalog,{stock:{'rice|g':500},random:.999999});
 assert.equal(chooseLast.api.draw(['Monday'],chooseLast.state.planned).additions[0].recipeId,'new-food','a positive pantry overlap must not filter out every nonmatching meal');
});
test('a next-week proposal uses draft servings, skips old-week reservations and stages rotation without writes',()=>{
 const catalog=[recipe('fixed','chicken'),recipe('candidate','beans')],h=harness(catalog,{stock:{'rice|g':600},planned:[{day:'Monday',recipeId:'fixed'}],random:0});
 h.excluded.add('fixed');h.state.mealServings={candidate:12};
 const before=[...h.values],writes=new Map(),storage={getItem:key=>writes.has(key)?writes.get(key):h.storage.getItem(key),setItem:(key,value)=>writes.set(key,String(value)),removeItem:key=>writes.set(key,null)};
 const planningState={...h.state,planned:[],servings:2,mealServings:{},dayServings:{}};
 const selection=h.api.draw(['Monday'],[],{},false,'pantry-first',{planningState,reserveCurrentMeals:false,storage});
 assert.equal(selection.additions[0].recipeId,'candidate');assert.deepEqual([...h.values],before);assert.equal(writes.size,0);
 assert.equal(h.attempts[0].reservations.length,1,'the old planned dinner is not reserved for a replacement week');
 const used=h.attempts[0].reservations[0].used.find(row=>row.key==='rice');assert.equal(used.required,150);assert.equal(used.quantity,150);
 assert.equal(selection.rotation.commit(),true);assert.equal(writes.has(selection.rotation.key),true);assert.deepEqual([...h.values],before,'rotation is staged until the guarded trip/plan transaction');
});

test('actual scoring ignores staple-only stock, zero quantities and unresolved pantry state',()=>{
 const stapleRows=[{name:'Salt',quantity:1,unit:'g'},{name:'Pepper',quantity:1,unit:'g'},{name:'Oil',quantity:15,unit:'ml'},{name:'Water',quantity:300,unit:'ml'}];
 const catalog=[recipe('staples','chicken',stapleRows),recipe('rice','beans')];
 const h=harness(catalog,{stock:{'salt|g':50,'pepper|g':20,'oil|ml':100,'water|ml':500,'rice|g':0}});
 h.api.draw(['Monday'],h.state.planned);
 assert.ok(h.attempts[0].assessments.every(row=>row.result.pantryBonus===0));
 const pending=harness(catalog,{stock:{'rice|g':500},blocked:true});pending.api.draw(['Monday'],pending.state.planned);
 assert.deepEqual(pending.attempts[0].initial,{});assert.ok(pending.attempts[0].assessments.every(row=>row.result.pantryBonus===0));
});

test('actual Auto-fill applies dated penalties to eligible seen recipes without inventing dates from legacy IDs',()=>{
 const catalog=[recipe('recent','chicken'),recipe('older','beans'),recipe('undated','lentils')];
 const h=harness(catalog,{stock:{'rice|g':500},history:{recent:NOW-3*DAY,older:NOW-10*DAY}});
 h.values.set('basketboss_autofill_rotation_v1:guest',JSON.stringify({version:1,cycle:0,seen:catalog.map(row=>row.id),last:['undated']}));
 const before=[...h.values];h.api.draw(['Monday'],h.state.planned);
 const scores=new Map(h.attempts[0].assessments.map(row=>[row.recipeId,row.result]));
 assert.equal(scores.size,3,'seen history does not hard-exclude a candidate before weighted recency applies');
 assert.equal(scores.get('recent').recentPenalty,6);assert.equal(scores.get('older').recentPenalty,3);assert.equal(scores.get('undated').recentPenalty,0);
 assert.deepEqual([...h.values],before);
});

test('actual yesterday penalty distinguishes salmon from cod while manual adjacency remains strict',()=>{
 const fish=(id,species)=>recipe(id,'fish',[{name:species,quantity:300,unit:'g'},{name:'Rice',quantity:300,unit:'g'}]);
 const catalog=[fish('monday-salmon','Salmon'),fish('tuesday-salmon','Salmon'),fish('tuesday-cod','Cod')];
 const h=harness(catalog,{stock:{'rice|g':1000},planned:[{day:'Monday',recipeId:'monday-salmon'}]});
 const selection=h.api.draw(['Tuesday'],h.state.planned);assert.ok(selection);
 const scores=new Map(h.attempts[0].assessments.map(row=>[row.recipeId,row.result]));
 assert.equal(scores.get('tuesday-salmon').sameProteinPenalty,4);assert.equal(scores.get('tuesday-cod').sameProteinPenalty,0);
 const pair=[{day:'Monday',recipeId:'monday-salmon'},{day:'Tuesday',recipeId:'tuesday-cod'}];
 assert.equal(h.api.valid(pair),false);assert.equal(h.api.valid(pair,true),true,'Auto-fill scores adjacency while manual rules keep their default');
});

test('planned dinners and lunchboxes reserve real amounts before another recipe receives a pantry bonus',()=>{
 const catalog=[recipe('fixed','chicken'),recipe('candidate','beans')];
 const h=harness(catalog,{stock:{'rice|g':500},planned:[{day:'Monday',recipeId:'fixed'}],lunches:{Tuesday:[{name:'Rice',qty:100,unit:'g'}]}});
 const before=h.values.get(STOCK);h.api.draw(['Tuesday'],h.state.planned);
 const assessed=h.attempts[0].assessments.find(row=>row.recipeId==='candidate').result;
 assert.equal(assessed.used.find(row=>row.key==='rice').quantity,100,'300 g fixed dinner + 100 g lunch leaves only 100 g for the suggestion');
 assert.equal(h.values.get(STOCK),before);assert.equal(h.attempts[0].ledger.snapshot()['rice|g'],undefined,'proposal reservation may exhaust its copy but never physical stock');
});

test('one pantry source is reserved across all newly suggested days without consuming the real pantry',()=>{
 const catalog=[recipe('one','chicken'),recipe('two','beans'),recipe('three','lentils')];
 const h=harness(catalog,{stock:{'rice|g':500},random:0}),before=[...h.values];
 const selection=h.api.draw(['Monday','Tuesday','Wednesday'],h.state.planned);
 assert.equal(selection.additions.length,3);
 assert.deepEqual(h.attempts[0].reservations.map(result=>result.used.find(row=>row.key==='rice')?.quantity||0),[300,200,0]);
 assert.deepEqual([...h.values],before);assert.equal(h.values.has(HISTORY),false);
});

test('actual serving and batch helpers reserve a double-batch source once and skip its leftover night',()=>{
 const catalog=[recipe('fixed-batch','chicken'),recipe('candidate','beans')];
 const h=harness(catalog,{stock:{'rice|g':900},planned:[{day:'Monday',recipeId:'fixed-batch'}],
  pairs:[{recipeId:'fixed-batch',sourceDay:'Monday',leftoverDay:'Tuesday'}],lunches:{Tuesday:[{name:'Rice',qty:100,unit:'g'}]}});
 h.api.draw(['Wednesday'],h.state.planned);
 const assessed=h.attempts[0].assessments.find(row=>row.recipeId==='candidate').result;
 assert.equal(assessed.used.find(row=>row.key==='rice').quantity,200,'600 g double batch + 100 g lunch reserves one source, not another portion on leftover night');
 assert.equal(h.values.get(STOCK),JSON.stringify({'rice|g':900}));
});

test('hard access and ingredient preferences remain enforced before pantry scoring',()=>{
 const catalog=[recipe('locked','chicken'),recipe('allergy','beans'),recipe('allowed','lentils',[{name:'Pasta',quantity:300,unit:'g'}])];
 const h=harness(catalog,{stock:{'rice|g':1000}});h.allowed.delete('locked');h.excluded.add('allergy');
 const selection=h.api.draw(['Monday'],h.state.planned);
 assert.equal(selection.additions[0].recipeId,'allowed');
 assert.deepEqual(h.attempts[0].assessments.map(row=>row.recipeId),['allowed']);
 h.excluded.add('allowed');const previous=h.state.planned;
 assert.equal(h.api.commit(previous,JSON.stringify(previous),'{}',null,selection),false,'changed ingredient preferences invalidate confirmation');
 assert.equal(h.values.has(HISTORY),false);
});

test('attempting, cancelling and failed confirmation do not write planning dates; successful confirmation does',()=>{
 const catalog=[recipe('one','chicken'),recipe('two','beans')],h=harness(catalog,{stock:{'rice|g':500}});
 const previous=h.state.planned,selection=h.api.draw(['Monday'],previous);
 assert.equal(h.writes.length,0,'drawing and abandoning the proposal must be read-only');
 h.setPersist(false);assert.equal(h.api.commit(previous,JSON.stringify(previous),'{}',null,selection),false);
 assert.equal(h.values.has(HISTORY),false);assert.equal(h.values.has('basketboss_autofill_rotation_v1:guest'),false);
 h.setPersist(true);const retry=h.api.draw(['Monday'],previous);
 assert.equal(h.api.commit(previous,JSON.stringify(previous),'{}',null,retry),true);
 const saved=JSON.parse(h.values.get(HISTORY));assert.equal(saved.byActor.guest[retry.additions[0].recipeId],NOW);
 assert.equal(h.state.planned.length,1);assert.equal(h.values.get(STOCK),JSON.stringify({'rice|g':500}));
});

test('a late rotation conflict rolls back the plan without recording a date for the failed proposal',()=>{
 const catalog=[recipe('one','chicken'),recipe('two','beans')],h=harness(catalog);
 const previous=h.state.planned,selection=h.api.draw(['Monday'],previous),newer=JSON.stringify({version:1,cycle:0,seen:['two'],last:['two']});
 h.values.set('basketboss_autofill_rotation_v1:guest',newer);
 assert.equal(h.api.commit(previous,JSON.stringify(previous),'{}',null,selection),false);
 assert.equal(h.state.planned,previous);assert.equal(h.values.has(HISTORY),false);
 assert.equal(h.values.get('basketboss_autofill_rotation_v1:guest'),newer);
});

test('actual exact-protein helper follows a source-proven named main fish over an earlier seasoning fish',()=>{
 const main=recipe('salmon-crumbs','fish',[{name:'Anchovy fillets',quantity:10,unit:'g'},{name:'Salmon fillets',quantity:500,unit:'g'}],{name:'Salmon with anchovy breadcrumbs'});
 const h=harness([main]);assert.equal(h.api.exact(main),'salmon');
});


test('actual Auto-fill uses reviewed physical pack metadata and reserves it without changing inventory',()=>{
 const catalog=[recipe('one','chicken'),recipe('two','beans'),recipe('three','lentils')];
 const inventory={'cupboard|rice':{name:'Rice',bb173StockKey:'rice|pack',bb173StockValue:1,qty:1,packReviewed:true,packQuantity:500,packUnit:'g'}};
 const h=harness(catalog,{stock:{'rice|pack':1},inventory,random:0}),before=[...h.values];
 const selection=h.api.draw(['Monday','Tuesday','Wednesday'],h.state.planned);assert.equal(selection.additions.length,3);
 assert.deepEqual(h.attempts[0].initial,{'rice|pack':1});
 assert.deepEqual(h.attempts[0].reservations.map(result=>result.used.find(row=>row.key==='rice')?.quantity||0),[300,200,0]);
 assert.equal(h.attempts[0].ledger.snapshot()['rice|pack'],undefined);assert.deepEqual([...h.values],before);
});


test('explicit pantry-first mode chooses ingredient percentage before absolute match count',()=>{
 const catalog=[recipe('three-of-four','chicken',[{name:'Bread',quantity:2,unit:'each'},{name:'Cheddar',quantity:40,unit:'g'},{name:'Egg',quantity:2,unit:'each'},{name:'Tomato',quantity:100,unit:'g'}]),recipe('one-of-one','beans')];
 const h=harness(catalog,{stock:{'bread|each':2,'cheddar|g':40,'egg|each':2,'rice|g':300},random:.999999}),before=[...h.values];
 const selection=h.api.draw(['Monday'],h.state.planned,{},false,'pantry-first');assert.equal(selection.additions[0].recipeId,'one-of-one');
 const scores=new Map(h.attempts[0].assessments.map(row=>[row.recipeId,row.result]));assert.equal(scores.get('three-of-four').availabilityPercent,75);assert.equal(scores.get('one-of-one').availabilityPercent,100);assert.deepEqual([...h.values],before);
});

test('pantry-first reserves existing meals and each new selection against the same physical ledger',()=>{
 const catalog=[recipe('existing','fish'),recipe('rice-topup','chicken'),recipe('potatoes','beans',[{name:'Potatoes',quantity:300,unit:'g'}])];
 const h=harness(catalog,{stock:{'rice|g':500,'potato|g':300},planned:[{recipeId:'existing',day:'Wednesday'}]}),before=[...h.values];
 const selection=h.api.draw(['Monday','Tuesday'],h.state.planned,{},false,'pantry-first');assert.deepEqual(plain(selection.additions.map(row=>row.recipeId)),['potatoes','rice-topup']);
 const reservations=h.attempts[0].reservations;assert.equal(reservations[0].used.find(row=>row.key==='rice').quantity,300);assert.equal(reservations.at(-1).used.find(row=>row.key==='rice').quantity,200);assert.deepEqual([...h.values],before);
});

test('explicit fresh mode leaves physical pantry untouched while suppressing pantry ranking',()=>{
 const h=harness([recipe('pantry','chicken'),recipe('fresh','beans',[{name:'Pasta',quantity:300,unit:'g'}])],{stock:{'rice|g':500},random:.999999}),before=[...h.values];
 const selection=h.api.draw(['Monday'],h.state.planned,{},false,'fresh');assert.equal(selection.additions[0].recipeId,'fresh');assert.deepEqual(h.attempts[0].initial,{});assert.ok(h.attempts[0].assessments.every(row=>row.result.pantryBonus===0));assert.deepEqual([...h.values],before);
});


test('pantry-first uses existing recency penalties only after equal pantry percentages and coverage',()=>{
 const h=harness([recipe('recent-pantry','chicken'),recipe('older-pantry','beans')],{stock:{'rice|g':500},history:{'recent-pantry':NOW-3*DAY,'older-pantry':NOW-20*DAY},random:.1});
 const selection=h.api.draw(['Monday'],h.state.planned,{},false,'pantry-first');assert.equal(selection.additions[0].recipeId,'older-pantry');
});
