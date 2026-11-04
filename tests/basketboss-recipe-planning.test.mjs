import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const planning=require('../bb-recipe-planning.js');
const memory=initial=>{
  const values=new Map(initial||[]);
  return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),values};
};
const dish=(id,primaryProtein,cheeseHeavy=false,extra={})=>({id,name:id+' dinner',servings:4,ingredients:[],primaryProtein,cheeseHeavy,...extra});
const fixture=[dish('chicken','chicken'),dish('beans','beans'),dish('fish','fish'),dish('lentils','lentils')];
const session=(recipes=fixture,storage=memory(),extra={})=>planning.createRotation({recipes,storage,isAllowed:()=>true,...extra});
const choose=(rotation,day='Monday',planned=[],candidates=rotation.eligible)=>rotation.choose(candidates,{day,planned});

test('public catalogue records retain their slug IDs and receive runtime metadata without mutation',()=>{
  const raw=fs.readFileSync(new URL('../recipes.json',import.meta.url),'utf8');
  const recipes=JSON.parse(raw),before=JSON.stringify(recipes);
  const annotated=planning.annotate(recipes);
  assert.equal(annotated.length,recipes.length);
  assert.deepEqual(annotated.map(r=>r.id),recipes.map(r=>r.id));
  for(const recipe of annotated){
    assert.match(recipe.primaryProtein,/^[a-z][a-z0-9-]*$/);
    assert.equal(typeof recipe.cheeseHeavy,'boolean');
    assert.equal(typeof recipe.dinnerEligible,'boolean');
    if(/dessert|baking|breakfast|brunch/i.test(recipe.category+' '+recipe.tag))assert.equal(recipe.dinnerEligible,false,recipe.id);
  }
  assert.equal(JSON.stringify(recipes),before);
});

test('protein comes from the dish rather than chicken or beef stock and preserves explicit editorial tags',()=>{
  assert.equal(planning.metadata({id:'bean-stew',name:'Bean and tomato stew',ingredients:[['Cannellini beans','400 g'],['Chicken stock','500 ml']]}).primaryProtein,'beans');
  assert.equal(planning.metadata({id:'mushroom-soup',name:'Mushroom soup',ingredients:[['Mushrooms','400 g'],['Beef broth','500 ml']]}).primaryProtein,'vegetables');
  assert.equal(planning.metadata({id:'chicken-ramen',name:'Chicken ramen',ingredients:[['Chicken breast','500 g']]}).primaryProtein,'chicken');
  assert.equal(planning.metadata(dish('specified','tofu')).primaryProtein,'tofu');
  assert.equal(planning.metadata({id:'cauliflower-steaks',name:'Cauliflower steaks',ingredients:[['Cauliflower','1 head']]}).primaryProtein,'vegetables');
  assert.equal(planning.metadata({id:'tuna-steak',name:'Tuna steaks',ingredients:[['Tuna steaks','400 g']]}).primaryProtein,'fish');
  assert.equal(planning.metadata({id:'steak-beans',name:'Steak and black bean salad',ingredients:[['Sirloin steak','400 g'],['Black beans','400 g']]}).primaryProtein,'beef');
});

test('cheese-heavy derives from amount or a cheese-led dish, with explicit reviewed overrides',()=>{
  assert.equal(planning.metadata({id:'bake',name:'Broccoli bake',servings:4,ingredients:[['Cheddar','200 g']]}).cheeseHeavy,true);
  assert.equal(planning.metadata({id:'pasta',name:'Tomato pasta',servings:4,ingredients:[['Parmesan','20 g']]}).cheeseHeavy,false);
  assert.equal(planning.metadata({id:'halloumi',name:'Halloumi and couscous',ingredients:[]}).cheeseHeavy,true);
  assert.equal(planning.metadata({id:'reviewed',name:'Cheesy vegetable dinner',cheeseHeavy:false,ingredients:[]}).cheeseHeavy,false);
});

test('desserts, baking and breakfasts never enter the dinner pool even with a contradictory flag',()=>{
  for(const tag of ['DESSERT','BAKING','BREAKFAST & BRUNCH'])assert.equal(planning.isDinner(dish('sweet','vegetables',false,{tag,dinnerEligible:true})),false);
  assert.equal(planning.isDinner(dish('sweet-potato','beans',false,{name:'Sweet potato and black bean chilli'})),true);
  assert.equal(planning.isDinner(dish('fishcakes','fish',false,{name:'Salmon fishcakes'})),true);
  assert.equal(planning.isDinner(dish('okonomiyaki','pork',false,{name:'Pork & cabbage okonomiyaki pancakes',dinnerEligible:true})),true);
  assert.equal(planning.isDinner(dish('savoury-pancakes','lentils',false,{name:'Savoury lentil pancakes',dinnerEligible:true})),true);
  assert.equal(planning.isDinner(dish('raggmunk','pork',false,{name:'Swedish potato pancakes with bacon and lingonberry',dinnerEligible:true})),true);
  assert.equal(planning.isDinner(dish('pancake-dessert','eggs',false,{name:'Sweet potato pancakes',tag:'DESSERT',dinnerEligible:true})),false);
});

test('Free and Premium entitlement predicates define separate complete eligible rotation pools',()=>{
  const recipes=[...fixture,dish('premium','tofu'),dish('cake','eggs',true,{tag:'DESSERT'})];
  const storage=memory();
  const free=session(recipes,storage,{scope:'free',isAllowed:r=>r.id!=='premium'});
  assert.equal(free.eligible.length,4);
  assert.equal(free.filter([recipes[4],recipes[5]],{day:'Monday'}).length,0);
  assert.equal(session(recipes,storage,{scope:'premium'}).eligible.length,5);
  assert.notEqual(free.key,session(recipes,storage,{scope:'premium'}).key);
  assert.equal(planning.createRotation({recipes,storage}).eligible.length,0,'missing entitlement callback must deny access');
});

test('an eligible recipe is not repeated until the entire accessible dinner pool has been consumed',()=>{
  const storage=memory(),picked=[];
  for(let n=0;n<fixture.length;n++){
    const rotation=session(fixture,storage),recipe=choose(rotation);
    assert.ok(recipe);picked.push(recipe.id);assert.equal(rotation.commit(),true);
  }
  assert.equal(new Set(picked).size,fixture.length);
  const next=session(fixture,storage);assert.equal(choose(next).id,fixture[0].id);
  assert.equal(next.snapshot().cycle,1);
});

test('growing the catalogue preserves history and consumes newly added recipes before a cycle reset',()=>{
  const storage=memory();
  for(const recipe of fixture){const rotation=session(fixture,storage);assert.equal(choose(rotation).id,recipe.id);assert.equal(rotation.commit(),true);}
  const expanded=session([...fixture,dish('added','tofu')],storage);
  assert.equal(choose(expanded).id,'added');assert.equal(expanded.snapshot().cycle,0);
});

test('narrow filters cannot reset a partly consumed wider rotation pool',()=>{
  const storage=memory();
  const first=session(fixture,storage);assert.equal(choose(first).id,'chicken');assert.equal(first.commit(),true);
  const restricted=session(fixture,storage);
  assert.equal(choose(restricted,'Monday',[],[fixture[0]]),null);
  assert.equal(restricted.reason,'rotation-filter-exhausted');
  assert.equal(restricted.snapshot().cycle,0);
  assert.deepEqual(restricted.snapshot().seen,['chicken']);
  assert.equal(choose(restricted,'Monday',[],[fixture[1]]).id,'beans');
});

test('adjacent protein checks respect both earlier and later planned dinners and occupied slots',()=>{
  const recipes=[...fixture,dish('another-chicken','chicken'),dish('another-fish','fish')];
  const rotation=session(recipes);
  const planned=[{day:'Monday',recipeId:'chicken'},{day:'Wednesday',recipeId:'fish'}];
  const allowed=rotation.filter(recipes,{day:'Tuesday',planned});
  assert.deepEqual(allowed.map(r=>r.id),['beans','lentils']);
  assert.equal(choose(rotation,'Monday',planned),null);
  assert.equal(rotation.reason,'occupied-day');
  assert.equal(rotation.filter(recipes,{day:'not-a-day'}).length,0);
  assert.equal(rotation.reason,'invalid-day');
});

test('reservations enforce protein variety and two cheese-heavy dinners across the whole seven-day plan',()=>{
  const recipes=[dish('heavy-chicken','chicken',true),dish('heavy-beans','beans',true),dish('heavy-fish','fish',true),dish('light-fish','fish')];
  const rotation=session(recipes);
  assert.equal(choose(rotation,'Monday',[],[recipes[0]]).id,'heavy-chicken');
  assert.equal(choose(rotation,'Tuesday',[],[recipes[0]]),null);
  assert.equal(choose(rotation,'Tuesday',[],[recipes[1]]).id,'heavy-beans');
  assert.equal(choose(rotation,'Sunday',[],[recipes[2]]),null,'count all seven days, not only preceding days');
  assert.equal(choose(rotation,'Wednesday',[],[recipes[3]]).id,'light-fish');
});

test('confirmation cancellation consumes nothing, while commit persists reservations exactly once',()=>{
  const storage=memory(),cancelled=session(fixture,storage);
  choose(cancelled);assert.equal(storage.values.size,0);
  const confirmed=session(fixture,storage);assert.equal(choose(confirmed).id,'chicken');
  assert.equal(confirmed.commit(),true);const first=storage.getItem(confirmed.key);
  assert.equal(confirmed.commit(),true);assert.equal(storage.getItem(confirmed.key),first);
  assert.equal(choose(confirmed,'Tuesday'),null);assert.equal(confirmed.reason,'session-committed');
});

test('corrupt history is recovered only on confirmation and storage failures cannot claim persisted rotation',()=>{
  const storage=memory(),key=session(fixture,storage).key;
  storage.setItem(key,'not JSON');const recovered=session(fixture,storage);
  assert.equal(recovered.snapshot().recovered,true);assert.equal(storage.getItem(key),'not JSON');
  choose(recovered);assert.equal(recovered.commit(),true);assert.equal(JSON.parse(storage.getItem(key)).seen[0],'chicken');
  const quota=memory();quota.setItem=()=>{throw Error('quota');};
  const blocked=session(fixture,quota);choose(blocked);assert.equal(blocked.commit(),false);
  assert.equal(blocked.reason,'rotation-storage-unavailable');
  const denied=session(fixture,{getItem(){throw Error('denied');},setItem(){throw Error('denied');}});
  assert.equal(choose(denied),null);assert.equal(denied.reason,'rotation-storage-unavailable');
});

test('a concurrent tab or account scope cannot silently overwrite a newer rotation',()=>{
  const storage=memory(),one=session(fixture,storage),two=session(fixture,storage);
  choose(one);choose(two);assert.equal(one.commit(),true);
  assert.equal(two.commit(),false);assert.equal(two.reason,'rotation-changed');
  assert.deepEqual(JSON.parse(storage.getItem(one.key)).seen,['chicken']);
});

test('caller ranking cannot return an inaccessible or filtered recipe',()=>{
  const rotation=session(fixture);
  const picked=rotation.choose(fixture,{day:'Monday',pick:()=>dish('not-in-catalogue','pork')});
  assert.equal(picked,null);assert.deepEqual(rotation.snapshot().selected,[]);
});

test('protein aliases cannot bypass the adjacent-day restriction',()=>{
  const recipes=[dish('prawn-one','prawn'),dish('shrimp-two','shrimp'),dish('white-bean','cannellini-beans'),dish('bean-two','bean')];
  assert.equal(planning.metadata(recipes[0]).primaryProtein,'prawns');
  assert.equal(planning.metadata(recipes[1]).primaryProtein,'prawns');
  assert.equal(planning.metadata(recipes[2]).primaryProtein,'beans');
  const rotation=session(recipes);
  assert.equal(choose(rotation,'Tuesday',[{day:'Monday',recipeId:'prawn-one'}],[recipes[1]]),null);
  assert.equal(choose(rotation,'Thursday',[{day:'Wednesday',recipeId:'white-bean'}],[recipes[3]]),null);
});

test('account history survives Premium downgrade, unloaded records and a Free-only pool reset',()=>{
  const storage=memory(),recipes=[...fixture];
  const premium=session(recipes,storage,{scope:'account'});
  assert.equal(choose(premium,'Monday',[],[recipes[0]]).id,'chicken');
  assert.equal(choose(premium,'Tuesday',[],[recipes[1]]).id,'beans');
  assert.equal(choose(premium,'Wednesday',[],[recipes[2]]).id,'fish');
  assert.equal(premium.commit(),true);
  // The Free runtime has unloaded both Premium records, but must keep their
  // seen IDs for a later upgrade without offering those recipes to Free users.
  const free=session(recipes.slice(0,2),storage,{scope:'account'});
  assert.equal(choose(free).id,'chicken');assert.equal(free.commit(),true);
  assert.deepEqual(new Set(free.snapshot().seen),new Set(['fish','chicken']));
  const upgraded=session(recipes,storage,{scope:'account'});
  assert.deepEqual(upgraded.filter(recipes,{day:'Monday'}).map(r=>r.id),['beans','lentils']);
});

test('access changes during the confirmation window invalidate the proposed rotation commit',()=>{
  const storage=memory();let premium=true;
  const rotation=session(fixture,storage,{isAllowed:r=>premium||r.id==='chicken'});
  assert.ok(choose(rotation));premium=false;
  assert.equal(rotation.commit(),false);assert.equal(rotation.reason,'rotation-access-changed');
  assert.equal(storage.values.size,0);
});

test('published main history migrates without writes until a confirmed scoped commit',()=>{
 const storage=memory(),legacyKey='basketboss_autofill_seenRecipeIds_v1';
 storage.setItem(legacyKey,JSON.stringify(['chicken']));
 const rotation=session(fixture,storage,{scope:'account',legacyKey});
 assert.deepEqual(rotation.snapshot().seen,['chicken']);
 assert.equal(storage.values.size,1,'opening the updated planner does not mutate history');
 const available=rotation.filter(fixture,{day:'Monday'});
 assert.ok(available.every(r=>r.id!=='chicken'));
 assert.equal(rotation.take(available[0],{day:'Monday'}),true);
 assert.equal(rotation.commit(),true);
 assert.equal(storage.getItem(legacyKey),JSON.stringify(['chicken']));
 assert.equal(JSON.parse(storage.getItem(rotation.key)).seen.length,2);
});

const cohortFixture=()=>[
  dish('everyday-chicken','chicken',false,{editorialGroup:'everyday'}),
  dish('everyday-beans','beans',false,{editorialGroup:'everyday'}),
  dish('world-duck','duck',false,{editorialGroup:'world'}),
  dish('world-tofu','tofu',false,{editorialGroup:'world'})
];
const cohortOptions={rotationGroup:recipe=>recipe.editorialGroup};
function seedCohortHistory(recipes,storage,seen,extra={}){
  const key=session(recipes,storage,extra).key;
  const raw=JSON.stringify({version:1,cycle:0,seen,last:[]});storage.setItem(key,raw);
  return {key,raw};
}

test('editorial cohorts let everyday dinners rotate without waiting for optional world recipes',()=>{
  const recipes=cohortFixture(),storage=memory();
  seedCohortHistory(recipes,storage,['everyday-chicken','everyday-beans','world-duck','unloaded-premium'],cohortOptions);
  const everyday=session(recipes,storage,cohortOptions);
  assert.equal(choose(everyday,'Monday',[],recipes.slice(0,2)).id,'everyday-chicken');
  assert.equal(everyday.snapshot().cycle,1);
  assert.deepEqual(new Set(everyday.snapshot().seen),new Set(['world-duck','unloaded-premium','everyday-chicken']));
  assert.equal(everyday.commit(),true);
  const nextWorld=session(recipes,storage,cohortOptions);
  assert.equal(choose(nextWorld,'Monday',[],recipes.slice(2)).id,'world-tofu');
  assert.equal(nextWorld.snapshot().cycle,1,'partly consumed world cohort cannot reset');
  assert.ok(nextWorld.snapshot().seen.includes('world-duck'));
});

test('an unrequested fully consumed cohort retains its history until it is actually requested',()=>{
  const recipes=cohortFixture(),storage=memory();
  seedCohortHistory(recipes,storage,['world-duck','world-tofu','everyday-chicken'],cohortOptions);
  const everyday=session(recipes,storage,cohortOptions);
  assert.equal(choose(everyday,'Monday',[],recipes.slice(0,2)).id,'everyday-beans');
  assert.equal(everyday.snapshot().cycle,0);
  assert.ok(everyday.snapshot().seen.includes('world-duck'));
  assert.ok(everyday.snapshot().seen.includes('world-tofu'));
  assert.equal(everyday.commit(),true);
  const world=session(recipes,storage,cohortOptions);
  assert.equal(choose(world,'Monday',[],recipes.slice(2)).id,'world-duck');
  assert.equal(world.snapshot().cycle,1);
  assert.deepEqual(new Set(world.snapshot().seen),new Set(['everyday-chicken','everyday-beans','world-duck']));
});

test('narrow category or time candidates cannot prematurely reset an editorial cohort',()=>{
  const recipes=cohortFixture(),storage=memory();
  seedCohortHistory(recipes,storage,['everyday-chicken'],cohortOptions);
  const rotation=session(recipes,storage,cohortOptions);
  assert.equal(choose(rotation,'Monday',[],[recipes[0]]),null);
  assert.equal(rotation.reason,'rotation-filter-exhausted');
  assert.equal(rotation.snapshot().cycle,0);
  assert.deepEqual(rotation.snapshot().seen,['everyday-chicken']);
  assert.equal(choose(rotation,'Monday',[],recipes.slice(0,2)).id,'everyday-beans');
});

test('callers without rotationGroup retain the original full accessible pool boundary',()=>{
  const recipes=cohortFixture(),storage=memory();
  seedCohortHistory(recipes,storage,['everyday-chicken','everyday-beans']);
  const global=session(recipes,storage);
  assert.equal(choose(global,'Monday',[],recipes.slice(0,2)),null);
  assert.equal(global.snapshot().cycle,0);
  assert.equal(choose(global,'Monday',[],recipes.slice(2)).id,'world-duck');
});

test('cohort resets remain read-only until a confirmed single-record optimistic commit',()=>{
  const recipes=cohortFixture(),storage=memory();
  const {key,raw}=seedCohortHistory(recipes,storage,['everyday-chicken','everyday-beans','world-duck'],cohortOptions);
  const cancelled=session(recipes,storage,cohortOptions);
  assert.ok(choose(cancelled,'Monday',[],recipes.slice(0,2)));
  assert.equal(storage.getItem(key),raw,'opening and reserving a reset cannot consume history');
  const confirmed=session(recipes,storage,cohortOptions);
  assert.ok(choose(confirmed,'Monday',[],recipes.slice(0,2)));
  assert.equal(confirmed.commit(),true);
  const saved=storage.getItem(key);
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(),['cycle','last','seen','version']);
  assert.equal(confirmed.commit(),true);
  assert.equal(storage.getItem(key),saved);
  assert.equal(cancelled.commit(),false,'a stale proposal cannot overwrite the confirmed one');
  assert.equal(cancelled.reason,'rotation-changed');
  assert.equal(storage.getItem(key),saved);
});

test('cohort resets never permit duplicate reservations within one weekly plan',()=>{
  const recipes=cohortFixture(),storage=memory();
  const rotation=session(recipes,storage,cohortOptions);
  assert.equal(choose(rotation,'Monday',[],[recipes[0]]).id,'everyday-chicken');
  assert.equal(choose(rotation,'Tuesday',[],[recipes[1]]).id,'everyday-beans');
  assert.equal(choose(rotation,'Wednesday',[],recipes.slice(0,2)),null);
  assert.deepEqual(rotation.snapshot().selected,['everyday-chicken','everyday-beans']);
  assert.equal(rotation.snapshot().cycle,0,'reserved IDs do not request a fresh cohort');
  assert.equal(choose(rotation,'Monday',[],recipes.slice(2)),null,'occupied reservation remains protected');
});

test('editorial cohort membership changes invalidate filtering and confirmation',()=>{
  const recipes=cohortFixture(),storage=memory();
  const rotation=session(recipes,storage,cohortOptions);
  assert.ok(choose(rotation,'Monday',[],[recipes[0]]));
  recipes[0].editorialGroup='world';
  assert.equal(rotation.filter(recipes,{day:'Tuesday'}).length,0);
  assert.equal(rotation.reason,'rotation-access-changed');
  assert.equal(rotation.commit(),false);
  assert.equal(storage.values.size,0);
});

test('Auto-fill may score adjacent proteins while ordinary planning still excludes them',()=>{
  const recipes=[dish('one-chicken','chicken'),dish('two-chicken','chicken'),dish('beans','beans')];
  const planned=[{day:'Monday',recipeId:'one-chicken'}];
  const strict=session(recipes),soft=session(recipes,memory(),{softProteinAdjacency:true});
  assert.equal(strict.filter(recipes,{day:'Tuesday',planned}).some(recipe=>recipe.id==='two-chicken'),false);
  assert.equal(soft.filter(recipes,{day:'Tuesday',planned}).some(recipe=>recipe.id==='two-chicken'),true);
  assert.equal(soft.take(recipes[1],{day:'Tuesday',planned}),true);
  assert.equal(soft.take(recipes[1],{day:'Thursday',planned}),false,'soft scoring never permits the same recipe twice in a proposal');
  const truthy=session(recipes,memory(),{softProteinAdjacency:'true'});
  assert.equal(truthy.filter(recipes,{day:'Tuesday',planned}).some(recipe=>recipe.id==='two-chicken'),false,'only an explicit boolean opts in');
});

test('soft adjacency still caps a protein at two and cheese-heavy dinners at two across reservations',()=>{
  const recipes=[dish('chicken-one','chicken'),dish('chicken-two','chicken'),dish('chicken-three','chicken'),
    dish('heavy-beans','beans',true),dish('heavy-tofu','tofu',true),dish('heavy-fish','fish',true)];
  const rotation=session(recipes,memory(),{softProteinAdjacency:true,softRecentRecipes:true});
  assert.equal(rotation.take(recipes[0],{day:'Monday'}),true);
  assert.equal(rotation.take(recipes[1],{day:'Tuesday'}),true);
  assert.equal(rotation.take(recipes[2],{day:'Friday'}),false,'a third same-protein dinner remains excluded');
  assert.equal(rotation.take(recipes[3],{day:'Wednesday'}),true);
  assert.equal(rotation.take(recipes[4],{day:'Thursday'}),true);
  assert.equal(rotation.take(recipes[5],{day:'Saturday'}),false,'a third cheese-heavy dinner remains excluded');
});

test('the previous week protein becomes a scoring input only for opted-in Auto-fill',()=>{
  const recipes=[dish('chicken','chicken'),dish('beans','beans')];
  const strict=session(recipes,memory(),{previousProtein:'chicken'});
  const soft=session(recipes,memory(),{previousProtein:'chicken',softProteinAdjacency:true});
  assert.equal(strict.filter(recipes,{day:'Monday'}).some(recipe=>recipe.id==='chicken'),false);
  assert.equal(soft.filter(recipes,{day:'Monday'}).some(recipe=>recipe.id==='chicken'),true);
});

test('soft recent history leaves seen recipes eligible without faking a new cycle or allowing same-week repeats',()=>{
  const storage=memory(),recipes=[dish('chicken','chicken'),dish('beans','beans'),dish('tofu','tofu')];
  const initial=session(recipes,storage);assert.equal(initial.take(recipes[0],{day:'Monday'}),true);assert.equal(initial.commit(),true);
  const strict=session(recipes,storage),soft=session(recipes,storage,{softProteinAdjacency:true,softRecentRecipes:true});
  assert.equal(strict.filter(recipes,{day:'Monday'}).some(recipe=>recipe.id==='chicken'),false);
  assert.equal(soft.filter(recipes,{day:'Monday'}).some(recipe=>recipe.id==='chicken'),true);
  assert.equal(soft.take(recipes[0],{day:'Monday'}),true);
  assert.equal(soft.filter(recipes,{day:'Tuesday'}).some(recipe=>recipe.id==='chicken'),false);
  assert.equal(soft.snapshot().cycle,0);assert.equal(soft.commit(),true);
  const allSeen=session(recipes,storage,{softRecentRecipes:true});
  assert.equal(allSeen.take(recipes[1],{day:'Monday'}),true);assert.equal(allSeen.take(recipes[2],{day:'Tuesday'}),true);assert.equal(allSeen.commit(),true);
  const next=session(recipes,storage,{softRecentRecipes:true});
  assert.equal(next.filter(recipes,{day:'Monday'}).length,3);
  assert.equal(next.snapshot().cycle,0,'soft recency retains dated history without synthesizing a rotation reset');
  assert.equal(new Set(next.snapshot().seen).size,3);
});

test('soft scoring options cannot bypass locked, unsuitable, non-dinner or occupied-day restrictions',()=>{
  const recipes=[dish('allowed','chicken'),dish('locked','beans'),dish('excluded','tofu'),dish('cake','eggs',false,{tag:'DESSERT'})];
  const rotation=session(recipes,memory(),{softProteinAdjacency:true,softRecentRecipes:true,isAllowed:recipe=>recipe.id!=='locked',isEligible:recipe=>recipe.id!=='excluded'});
  assert.deepEqual(rotation.filter(recipes,{day:'Monday'}).map(recipe=>recipe.id),['allowed']);
  assert.equal(rotation.filter(recipes,{day:'Monday',planned:[{day:'Monday',recipeId:'allowed'}]}).length,0);
  assert.equal(rotation.filter(recipes,{day:'not-a-day'}).length,0);
});

test('soft recency keeps editorial cohort history intact and only considers the caller-supplied pool',()=>{
  const recipes=cohortFixture(),storage=memory();
  const before=seedCohortHistory(recipes,storage,recipes.map(recipe=>recipe.id),cohortOptions);
  const soft=session(recipes,storage,{...cohortOptions,softRecentRecipes:true,softProteinAdjacency:true});
  const candidates=soft.filter(recipes.slice(0,2),{day:'Monday'});
  assert.deepEqual(candidates.map(recipe=>recipe.id),['everyday-chicken','everyday-beans']);
  assert.equal(soft.snapshot().cycle,0);assert.equal(storage.getItem(before.key),before.raw,'opening or scoring does not write or clear rotation history');
  assert.equal(soft.take(candidates[0],{day:'Monday'}),true);assert.equal(soft.commit(),true);
  assert.deepEqual(new Set(JSON.parse(storage.getItem(before.key)).seen),new Set(recipes.map(recipe=>recipe.id)));
});
