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
