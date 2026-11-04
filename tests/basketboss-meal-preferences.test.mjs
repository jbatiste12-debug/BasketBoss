import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-meal-preferences.js',import.meta.url),'utf8');
const dietary=fs.readFileSync(new URL('../bb-dietary-preferences.js',import.meta.url),'utf8');
const SESSION='basketboss_cloud_session_v1';
const SURVEY='bb_onboarding_fresh_once_20261028_v1';
const plain=value=>JSON.parse(JSON.stringify(value));
const preference=(scope='guest',diets=['Vegetarian'],goals=['Waste less food'])=>({version:1,scope,diets,goals});

function harness({saved=null,configured=true,survey}={}){
 const values=new Map(),events=new Map(),writes=[],storageWrites=[];
 let current=saved?plain(saved):null,saveAllowed=true,readBlocked=false,markerWriteBlocked=false,deleting=false;
 if(survey!==undefined)values.set(SURVEY,JSON.stringify(survey));
 const localStorage={
  getItem(key){if(readBlocked)throw Error('Storage unavailable');return values.get(key)??null;},
  setItem(key,value){
   if(markerWriteBlocked&&key==='basketboss_onboarding_meal_preferences_v1')throw Error('Storage full');
   storageWrites.push([key,value]);values.set(key,value);
  },
  removeItem:key=>values.delete(key)
 };
 const root={localStorage,BBAccountDeletion:{isDeleting:()=>deleting},addEventListener:(name,fn)=>events.set(name,fn)};
 const context=vm.createContext({window:root,console});
 vm.runInContext(dietary,context);vm.runInContext(source,context);
 const api=root.BBMealPreferences;
 const adapter={
  read:()=>current,
  write(next){
   const before=current;current=plain(next);
   if(!saveAllowed){current=before;return false;}
   writes.push(plain(current));return true;
  }
 };
 if(configured)api.configure(adapter);
 return {api,root,values,writes,storageWrites,adapter,
  saved:()=>current&&plain(current),load:value=>{current=value&&plain(value);},
  account(id){if(id)values.set(SESSION,JSON.stringify({user:{id}}));else values.delete(SESSION);events.get('basketboss:session-changed')?.();},
  readBlocked:value=>{readBlocked=value;},markerWriteBlocked:value=>{markerWriteBlocked=value;},
  saveAllowed:value=>{saveAllowed=value;},deleting:value=>{deleting=value;}
 };
}

test('meal choices persist through the scoped planner adapter and patches preserve other fields',()=>{
 const h=harness(),updates=[];h.api.subscribe(value=>updates.push(plain(value)));
 assert.deepEqual(plain(h.api.get()),preference('guest',[],[]));
 assert.equal(h.api.set({diets:['Vegetarian','Vegetarian'],goals:['Waste less food']}).ok,true);
 assert.deepEqual(h.saved(),preference());assert.equal(updates.length,1);
 assert.deepEqual(h.writes,[preference()]);
 assert.equal(h.api.set({goals:['Plan dinners faster']}).ok,true);
 assert.deepEqual(h.saved(),preference('guest',['Vegetarian'],['Plan dinners faster']));
 assert.equal(h.api.set({diets:[]}).ok,true);
 assert.deepEqual(h.saved(),preference('guest',[],['Plan dinners faster']));
 assert.equal(h.values.has(h.api.MIGRATION_KEY),true,'an explicit user edit claims the legacy survey');
 const snapshot=h.api.get();snapshot.diets.push('Vegan');
 assert.deepEqual(plain(h.api.get().diets),[],'read snapshots do not mutate the stored planner');
});

test('failed planner persistence rolls back values without notifications or a migration claim',()=>{
 const h=harness({saved:preference()}),updates=[];
 h.api.subscribe(value=>updates.push(value));h.saveAllowed(false);
 const result=h.api.set({diets:['Vegan']});
 assert.equal(result.ok,false);assert.match(result.error,/save/i);
 assert.deepEqual(plain(result.value),preference());assert.deepEqual(h.saved(),preference());
 assert.deepEqual(plain(h.api.get()),preference());assert.equal(updates.length,0);
 assert.equal(h.writes.length,0);assert.equal(h.values.has(h.api.MIGRATION_KEY),false);
 h.saveAllowed(true);assert.equal(h.api.set({diets:['Vegan']}).ok,true);
 assert.deepEqual(h.saved(),preference('guest',['Vegan']));assert.equal(updates.length,1);
});

test('validation rejects invalid patches without replacing valid choices',()=>{
 const h=harness({saved:preference()});
 for(const patch of [null,undefined,[],new Date(),42,'Vegetarian',{diets:'Vegan'},{goals:null},{diets:['unknown']},{goals:['unknown']},{scope:'someone-else'},{version:2}]){
  assert.equal(h.api.set(patch).ok,false,String(patch));
  assert.deepEqual(h.saved(),preference());
 }
 assert.equal(h.writes.length,0);assert.equal(h.values.has(h.api.MIGRATION_KEY),false);
 assert.throws(()=>h.api.configure({read:()=>null}),/adapter/i);
 const unavailable=harness({configured:false});
 assert.equal(unavailable.api.set({diets:['Vegetarian']}).ok,false);
});

test('normalization keeps supported choices and rejects invalid scope or malformed records',()=>{
 const {api}=harness();
 for(const record of [null,{},preference('__proto__'),preference('constructor'),{...preference(),version:2},{...preference(),diets:null},{...preference(),goals:'Waste less food'}])assert.equal(api.normalize(record),null);
 assert.deepEqual(plain(api.normalize({...preference(),diets:['Vegan','unknown','Vegetarian','Vegan'],goals:['Try new recipes','unknown']})),preference('guest',['Vegetarian','Vegan'],['Try new recipes']));
});

test('account switches isolate preferences and only a matching restored profile becomes active',()=>{
 const h=harness({saved:preference()});
 h.account('account-a');assert.deepEqual(plain(h.api.get()),preference('account-a',[],[]));
 assert.equal(h.api.set({diets:['Dairy-free']}).ok,true);
 assert.deepEqual(h.saved(),preference('account-a',['Dairy-free'],[]));
 h.account('account-b');assert.deepEqual(plain(h.api.get()),preference('account-b',[],[]));
 h.account('account-a');assert.deepEqual(plain(h.api.get()),preference('account-a',['Dairy-free'],[]));
 h.account(null);assert.deepEqual(plain(h.api.get()),preference('guest',[],[]));
 h.load(preference());assert.deepEqual(plain(h.api.get()),preference());
});

test('the separate Cook page reads scoped saved choices without a write adapter or raw storage writes',()=>{
 const h=harness({configured:false}),key='basketboss_321_unified_state_v1';
 const raw=JSON.stringify({version:2,planned:[],mealPreferences:preference()});h.values.set(key,raw);
 assert.deepEqual(plain(h.api.get()),preference());
 assert.equal(h.api.recipeAllowed({ingredients:[['Chicken','400 g']]}),false);
 assert.equal(h.api.set({diets:['Vegan']}).ok,false,'Cook must not mutate planner state without the planner adapter');
 assert.equal(h.values.get(key),raw);assert.equal(h.writes.length,0);assert.equal(h.storageWrites.length,0);
 h.account('other-account');assert.deepEqual(plain(h.api.get()),preference('other-account',[],[]));
 assert.equal(h.api.recipeAllowed({ingredients:[['Chicken','400 g']]}),true,'another account does not inherit the saved restriction');
 assert.equal(h.values.get(key),raw);assert.equal(h.storageWrites.length,0);
});

test('completed legacy onboarding imports once into the initial actor and never reapplies after edits or account changes',()=>{
 const h=harness({survey:{complete:true,diets:['Vegetarian'],goals:['Waste less food']}});
 h.account('account-a');assert.equal(h.api.migrateOnboarding(),true);
 assert.deepEqual(h.saved(),preference('account-a'));
 assert.equal(h.api.set({diets:[],goals:['Plan dinners faster']}).ok,true);
 const before=h.saved(),count=h.writes.length;
 assert.equal(h.api.migrateOnboarding(),false);assert.deepEqual(h.saved(),before);assert.equal(h.writes.length,count);
 h.account('account-b');h.load(null);
 assert.equal(h.api.migrateOnboarding(),false);assert.equal(h.writes.length,count);
 assert.deepEqual(plain(h.api.get()),preference('account-b',[],[]));
});

test('explicit empty planner preferences win over an older completed survey in every scope',()=>{
 for(const owner of ['guest','account-a']){
  const saved=preference(owner,[],[]),h=harness({saved,survey:{complete:true,diets:['Vegetarian'],goals:['Waste less food']}});
  if(owner!=='guest')h.account(owner);
  assert.equal(h.api.migrateOnboarding(),false);assert.deepEqual(h.saved(),saved);assert.equal(h.writes.length,0);
  assert.equal(h.values.has(h.api.MIGRATION_KEY),true);
  h.load(null);h.account('another-account');assert.equal(h.api.migrateOnboarding(),false);
  assert.equal(h.writes.length,0,'claiming the old survey prevents a later empty profile inheriting it');
 }
});

test('an existing profile for another actor is never replaced by the device-global survey',()=>{
 const saved=preference('first-account',['Vegan'],[]),h=harness({saved,survey:{complete:true,diets:['Vegetarian'],goals:[]}});
 h.account('second-account');assert.equal(h.api.migrateOnboarding(),false);
 assert.deepEqual(h.saved(),saved);assert.equal(h.writes.length,0);
 assert.deepEqual(plain(h.api.get()),preference('second-account',[],[]));
});

test('migration ignores incomplete or empty surveys without inventing dietary restrictions',()=>{
 for(const survey of [undefined,{complete:false,diets:['Vegetarian'],goals:[]},{complete:true,diets:['No specific preference'],goals:[]},{complete:true,diets:['unrecognized'],goals:['unrecognized']}]){
  const h=harness({survey});assert.equal(h.api.migrateOnboarding(),false);assert.equal(h.writes.length,0);
  assert.deepEqual(plain(h.api.get()),preference('guest',[],[]));
 }
});

test('storage-read and planner-save failures leave completed-survey migration safe to retry',()=>{
 const survey={complete:true,diets:['Vegetarian'],goals:[]};
 const reading=harness({survey});reading.readBlocked(true);
 assert.equal(reading.api.migrateOnboarding(),false);assert.equal(reading.writes.length,0);
 assert.equal(reading.values.has(reading.api.MIGRATION_KEY),false);
 reading.readBlocked(false);assert.equal(reading.api.migrateOnboarding(),true);
 assert.deepEqual(reading.saved(),preference('guest',['Vegetarian'],[]));
 const saving=harness({survey});saving.saveAllowed(false);
 assert.equal(saving.api.migrateOnboarding(),false);assert.equal(saving.saved(),null);
 assert.equal(saving.values.has(saving.api.MIGRATION_KEY),false);
 saving.saveAllowed(true);assert.equal(saving.api.migrateOnboarding(),true);
 assert.deepEqual(saving.saved(),preference('guest',['Vegetarian'],[]));
});

test('a failed migration-marker write cannot overwrite successfully saved scoped preferences',()=>{
 const h=harness({survey:{complete:true,diets:['Vegetarian'],goals:[]}});h.markerWriteBlocked(true);
 assert.equal(h.api.migrateOnboarding(),true);assert.deepEqual(h.saved(),preference('guest',['Vegetarian'],[]));
 assert.equal(h.values.has(h.api.MIGRATION_KEY),false);
 assert.equal(h.api.set({diets:[]}).ok,true);const count=h.writes.length;
 assert.equal(h.api.migrateOnboarding(),false);assert.deepEqual(h.saved(),preference('guest',[],[]));assert.equal(h.writes.length,count);
 h.markerWriteBlocked(false);assert.equal(h.api.migrateOnboarding(),false);
 assert.equal(h.values.has(h.api.MIGRATION_KEY),true,'a later successful claim prevents future imports');
});

test('account deletion blocks manual changes and migration without erasing saved preferences',()=>{
 const h=harness({saved:preference(),survey:{complete:true,diets:['Vegan'],goals:[]}});h.deleting(true);
 assert.equal(h.api.set({diets:['Vegan']}).ok,false);assert.equal(h.api.migrateOnboarding(),false);
 assert.deepEqual(h.saved(),preference());assert.equal(h.writes.length,0);assert.equal(h.storageWrites.length,0);
 h.deleting(false);assert.equal(h.api.set({diets:['Vegan']}).ok,true);
});

test('scoped dietary choices use the shared ingredient eligibility check and clearing removes the preference',()=>{
 const h=harness();h.api.set({diets:['Vegetarian']});
 const chicken={ingredients:[['Chicken stock','1 cube'],['Carrots','2 each']]},beans={ingredients:[['Kidney beans','1 tin']]};
 assert.equal(h.api.recipeAllowed(chicken),false);assert.equal(h.api.recipeAllowed(beans),true);
 h.account('different-account');assert.equal(h.api.recipeAllowed(chicken),true,'another actor does not inherit the restriction');
 h.account(null);h.api.set({diets:[]});assert.equal(h.api.recipeAllowed(chicken),true);
});

test('budget, pantry and novelty goals give relative preferences without writing stock or planner state',()=>{
 const h=harness();h.api.set({goals:['Spend less on groceries','Waste less food','Try new recipes']});
 const base={amount:12,servings:4,pantryBonus:0,previouslyPlanned:true},count=h.writes.length;
 assert.ok(h.api.goalScore({...base,amount:8})>h.api.goalScore({...base,amount:24}));
 assert.ok(h.api.goalScore({...base,pantryBonus:6})>h.api.goalScore(base));
 assert.ok(h.api.goalScore({...base,previouslyPlanned:false})>h.api.goalScore(base));
 assert.equal(h.writes.length,count,'scoring is read-only');
 h.api.set({goals:[]});assert.equal(h.api.goalScore({...base,pantryBonus:20,previouslyPlanned:false}),0);
});
