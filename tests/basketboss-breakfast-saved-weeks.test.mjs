import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const weeks=createRequire(import.meta.url)('../bb-saved-weeks.js');
const memory=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
const plan=()=>({
 planned:[{day:'Monday',recipeId:'family-dinner',servings:5}],
 plannedBreakfasts:[{day:'Monday',recipeId:'eggs-on-toast',servings:1},{day:'Tuesday',recipeId:'eggs-on-toast',servings:3}],
 plannedDesserts:[{day:'Monday',recipeId:'brownies',servings:2}],
 servings:4,feedingSet:true,
 mealServings:{'family-dinner':6,'eggs-on-toast':2,brownies:4,unplanned:9},
 dayServings:{Monday:{recipeId:'family-dinner',count:5}},
 pantry:{eggs:true},access_token:'private-account-token',recipePhotos:{'eggs-on-toast':'private-photo'}
});

test('saved weeks retain separate dinner, breakfast and dessert quantities on the same day',()=>{
 const value=plan(),before=JSON.stringify(value),saved=weeks.capture({plan:value});
 assert.deepEqual(saved.planned,value.planned);
 assert.deepEqual(saved.plannedBreakfasts,value.plannedBreakfasts);
 assert.deepEqual(saved.plannedDesserts,value.plannedDesserts);
 assert.deepEqual(saved.mealServings,{'family-dinner':6,'eggs-on-toast':2,brownies:4});
 assert.deepEqual(saved.dayServings,{Monday:{recipeId:'family-dinner',count:5}});
 assert.deepEqual(weeks.validateWeek(saved),saved);
 assert.equal(JSON.stringify(value),before,'capturing a reusable week never edits the active week');
 for(const secret of ['private-account-token','private-photo','unplanned','"pantry"'])assert(!JSON.stringify(saved).includes(secret));
 value.plannedBreakfasts[0].servings=12;
 assert.equal(saved.plannedBreakfasts[0].servings,1,'saved portions are copied rather than linked to the active row');
});

test('repeated breakfast recipes keep each day’s independent portions through storage round trips',()=>{
 const storage=memory(),model=weeks.createStore({storage,now:()=>10}),week=weeks.capture({plan:plan()});
 assert.equal(model.save('Breakfast family week',week).ok,true);
 const read=model.read();assert.equal(read.ok,true);
 assert.deepEqual(read.weeks[0].week.plannedBreakfasts,[{day:'Monday',recipeId:'eggs-on-toast',servings:1},{day:'Tuesday',recipeId:'eggs-on-toast',servings:3}]);
 assert.equal(read.weeks[0].week.plannedDesserts[0].servings,2);
 assert.match(weeks.summary(read.weeks[0].week),/1 dinner · 2 breakfasts · 1 dessert/);
});

test('legacy saved weeks without breakfast fields load as empty without rewriting their stored bytes',()=>{
 const storage=memory(),legacy=weeks.capture({plan:{planned:[{day:'Friday',recipeId:'old-dinner'}],plannedDesserts:[{day:'Sunday',recipeId:'old-dessert'}],servings:4}});
 delete legacy.plannedBreakfasts;
 const raw=JSON.stringify({version:1,weeks:[{id:'legacy',name:'Before breakfast',savedAt:1,week:legacy}]}),key=weeks.KEY+'guest';storage.setItem(key,raw);
 const result=weeks.createStore({storage}).read();assert.equal(result.ok,true);
 assert.deepEqual(result.weeks[0].week.plannedBreakfasts,[]);
 assert.deepEqual(result.weeks[0].week.planned,[{day:'Friday',recipeId:'old-dinner'}]);
 assert.deepEqual(result.weeks[0].week.plannedDesserts,[{day:'Sunday',recipeId:'old-dessert'}]);
 assert.equal(storage.getItem(key),raw,'reading an old version1 week does not migrate or overwrite account storage');
});

test('a breakfast-only week is saveable and preserves unloaded recipe IDs for host access validation',()=>{
 const storage=memory(),model=weeks.createStore({storage}),week=weeks.capture({plan:{planned:[],plannedBreakfasts:[{day:'Saturday',recipeId:'premium-breakfast-not-yet-loaded',servings:2}],servings:4}});
 assert.equal(model.save('Saturday breakfast',week).ok,true);
 const saved=model.read().weeks[0].week;
 assert.deepEqual(saved.plannedBreakfasts,week.plannedBreakfasts);
 assert.match(weeks.summary(saved),/0 dinners · 1 breakfast · 0 desserts/);
});

test('bad breakfast slots or portions reject the entire save and preserve an existing saved week',()=>{
 const invalid=[null,false,{},[{day:'Monday',recipeId:'x'},{day:'Monday',recipeId:'y'}],[{day:'Funday',recipeId:'x'}],[{day:'Monday',recipeId:'__proto__'}],...[-1,0,1.5,13,'2',null,Infinity,NaN].map(servings=>[{day:'Monday',recipeId:'x',servings}])];
 for(const slots of invalid){
  const storage=memory(),model=weeks.createStore({storage});assert.equal(model.save('Original',weeks.capture({plan:plan()})).ok,true);
  const before=[...storage.values],week=weeks.capture({plan:plan()});week.plannedBreakfasts=slots;
  assert.equal(model.save('Invalid',week).ok,false,JSON.stringify(slots));assert.deepEqual([...storage.values],before);
 }
});

test('dinner and dessert slot portion validation uses the same bounds as optional breakfasts',()=>{
 for(const field of ['planned','plannedDesserts'])for(const servings of [0,13,'2',null,Infinity]){
  const value=plan();value[field][0].servings=servings;
  assert.throws(()=>weeks.capture({plan:value}),/Review meal servings/);
 }
});

test('an older breakfast row without slot portions retains its recipe-level fallback rather than inventing portions',()=>{
 const value=plan();delete value.plannedBreakfasts[0].servings;
 const saved=weeks.validateWeek(weeks.capture({plan:value}));
 assert.equal(Object.hasOwn(saved.plannedBreakfasts[0],'servings'),false);
 assert.equal(saved.mealServings['eggs-on-toast'],2);
 assert.equal(saved.plannedBreakfasts[1].servings,3);
});

test('breakfast save failures roll back only this write and retain unrelated pantry and other-account data',()=>{
 const storage=memory(),model=weeks.createStore({storage,context:()=>({actor:'one',ready:true})}),week=weeks.capture({plan:plan()});
 storage.setItem('pantry','{"eggs|each":9}');storage.setItem(weeks.KEY+'two','other-account');assert.equal(model.save('Original',week).ok,true);
 const before=[...storage.values],write=storage.setItem;let fail=true;
 storage.setItem=(key,value)=>{write(key,value);if(fail&&key===weeks.KEY+'one'){fail=false;throw Error('quota');}};
 assert.equal(model.save('Another breakfast week',week).ok,false);assert.deepEqual([...storage.values],before);
});
