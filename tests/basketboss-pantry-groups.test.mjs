import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const core=createRequire(import.meta.url)('../bb-pantry-groups.js');
const SESSION='basketboss_cloud_session_v1';
function fixture(initial={}){
 const values=new Map(Object.entries(initial));let hook=null,counter=0;
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));hook?.(key,value);},removeItem:key=>values.delete(key)};
 const win={localStorage:storage,crypto:{randomUUID:()=>`test-${++counter}`},BBAccountDeletion:{isDeleting:()=>false}};
 const api=core.install(win);
 return {api,win,values,storage,hook(fn){hook=fn;},as(actor){if(actor===null)values.delete(SESSION);else values.set(SESSION,JSON.stringify({user:{id:actor},access_token:'token-'+actor}));}};
}
const names=(api,section)=>api.snapshot(section).groups.map(group=>group.name);
test('all four existing areas get editable starter groups without writing pantry or metadata',()=>{
 const h=fixture({'basketboss_makeameal_v1_inventory':'{"rice":{"qty":200}}','basketboss_321_v7_measured_pantry':'{"rice|g":200}'}),before=[...h.values];
 assert.deepEqual(core.SECTIONS,['cupboard','fridge','freezer','essentials']);
 assert.deepEqual(names(h.api,'essentials'),['Cleaning products','Toiletries','Laundry','Baby & pet care','Other items']);
 assert.deepEqual(names(h.api,'cupboard'),['Tins & jars','Pasta, rice & grains','Baking','Herbs & spices','Other items']);
 for(const section of core.SECTIONS){assert.ok(h.api.snapshot(section).groups.length>1);assert.equal(h.api.snapshot(section).groups.at(-1).id,'other');}
 assert.deepEqual([...h.values],before);assert.equal(h.storage.getItem(core.KEY),null);
});
test('names infer useful groups, unknown foods remain Other and food forms keep separate keys',()=>{
 const {api}=fixture();
 for(const [section,name,group]of [['cupboard','Tinned tomatoes','tins'],['cupboard','Rice','grains'],['cupboard','Flour','baking'],['cupboard','Paprika','spices'],['fridge','Eggs','dairy'],['fridge','Lettuce','produce'],['fridge','Chicken breast','protein'],['freezer','Frozen leftovers','batch'],['freezer','Frozen chips','sides'],['essentials','Washing up liquid','cleaning'],['essentials','Toilet rolls','toiletries'],['essentials','Laundry detergent','laundry'],['essentials','Nappies','care']])assert.equal(api.groupFor(section,api.itemKey(name),name),group,name);
 assert.equal(api.groupFor('fridge','mystery','Mystery product'),'other');
 assert.equal(api.itemKey('  ＲＩＣＥ   cakes '),'rice cakes');
 assert.notEqual(api.itemKey('Cooked chicken'),api.itemKey('Raw chicken'));assert.notEqual(api.itemKey('Fresh spinach'),api.itemKey('Frozen spinach'));
});
test('create, assign, rename, reorder and reload retain membership without changing any quantities',()=>{
 const inventory='{"cupboard|rice":{"name":"Rice","qty":400,"unit":"g","selected":true}}',stock='{"rice|g":400}',features='{"essentials":[{"id":"soap","ownedQty":2,"targetQty":3}]}';
 const h=fixture({'basketboss_makeameal_v1_inventory':inventory,'basketboss_321_v7_measured_pantry':stock,'basketboss_321_features_v1':features});
 const id=h.api.create('cupboard','  Weekly   favourites  ',h.api.context());
 h.api.assign('cupboard',h.api.itemKey('Rice'),id,h.api.context());h.api.rename('cupboard',id,'Easy lunches',h.api.context());h.api.move('cupboard',id,-1,h.api.context());
 const reload=core.install(h.win);assert.equal(reload.groupFor('cupboard','rice','Rice'),id);assert.equal(reload.snapshot('cupboard').groups[3].name,'Easy lunches');
 for(const [key,bytes]of [['basketboss_makeameal_v1_inventory',inventory],['basketboss_321_v7_measured_pantry',stock],['basketboss_321_features_v1',features]])assert.equal(h.storage.getItem(key),bytes);
 const copy=reload.snapshot('cupboard');copy.groups[0].name='Leaked';copy.assignments.rice='other';assert.notEqual(reload.snapshot('cupboard').groups[0].name,'Leaked');assert.equal(reload.groupFor('cupboard','rice','Rice'),id);
});
test('deleting a group keeps its members in Other and removed starter groups never return',()=>{
 const h=fixture(),id=h.api.create('fridge','Lunch box');h.api.assign('fridge','cheddar',id);h.api.remove('fridge',id);
 assert.equal(h.api.groupFor('fridge','cheddar','Cheddar'),'other','explicit membership does not fall back to inferred Dairy');
 h.api.remove('fridge','dairy');assert.equal(h.api.groupFor('fridge','milk','Milk'),'other');
 assert.equal(core.install(h.win).snapshot('fridge').groups.some(group=>group.id==='dairy'),false);
 assert.equal(h.api.snapshot('cupboard').groups.some(group=>group.id==='baking'),true);
});
test('explicit assignments override the automatic suggestion and stay inside their own area',()=>{
 const h=fixture(),id=h.api.create('cupboard','Breakfast');h.api.assign('cupboard','rice',id);
 assert.equal(h.api.groupFor('cupboard','rice','Rice'),id);assert.equal(h.api.groupFor('fridge','rice','Rice'),'other');
 h.api.assign('cupboard','rice','other');assert.equal(h.api.groupFor('cupboard','rice','Rice'),'other');
 assert.throws(()=>h.api.assign('fridge','rice',id),/no longer exists/);
 assert.equal(h.api.snapshot('essentials').assignments.rice,undefined);
});
test('guest and different signed-in accounts have separate groups and assignments',()=>{
 const h=fixture(),guest=h.api.create('cupboard','Guest group');h.api.assign('cupboard','rice',guest);
 h.as('alice');assert.equal(h.api.groupFor('cupboard','rice','Rice'),'grains');const alice=h.api.create('cupboard','Alice group');h.api.assign('cupboard','rice',alice);
 h.as('bob');assert.equal(h.api.snapshot('cupboard').groups.some(group=>group.id===alice),false);h.api.rename('cupboard','grains','Bob grains');
 h.as('alice');assert.equal(h.api.groupFor('cupboard','rice','Rice'),alice);assert.equal(names(h.api,'cupboard').includes('Bob grains'),false);
 h.as(null);assert.equal(h.api.groupFor('cupboard','rice','Rice'),guest);
 assert.equal(Object.keys(JSON.parse(h.storage.getItem(core.KEY)).byActor).length,3);
});
test('stale editors cannot write into another account or replace a more recent group edit',()=>{
 const h=fixture(),guest=h.api.context();h.as('alice');assert.throws(()=>h.api.create('cupboard','Wrong account',guest),/account or groups changed/);assert.equal(h.storage.getItem(core.KEY),null);
 const alice=h.api.context();h.api.create('fridge','Lunch');const saved=h.storage.getItem(core.KEY);assert.throws(()=>h.api.create('cupboard','Stale',alice),/account or groups changed/);assert.equal(h.storage.getItem(core.KEY),saved);
 const pin=h.api.context();h.values.set(SESSION,JSON.stringify({user:{id:'alice'},access_token:'refreshed'}));assert.throws(()=>h.api.assign('fridge','milk','other',pin),/account or groups changed/);
});
test('an account switch during a verified write rolls the metadata back and preserves the new session',()=>{
 const h=fixture();h.as('alice');const id=h.api.create('cupboard','Original'),before=h.storage.getItem(core.KEY),aliceSession=h.storage.getItem(SESSION);let switched=false;
 h.hook(key=>{if(key===core.KEY&&!switched){switched=true;h.as('bob');}});
 assert.throws(()=>h.api.rename('cupboard',id,'Must not save',h.api.context()),/account or groups changed/);
 assert.equal(h.storage.getItem(core.KEY),before);assert.notEqual(h.storage.getItem(SESSION),aliceSession);assert.equal(h.api.context().actor,'bob');
});
test('quota failure and failed storage verification leave original metadata untouched',()=>{
 for(const mode of ['throw','ignore']){
  const h=fixture();h.api.create('cupboard','Original');const before=h.storage.getItem(core.KEY);let once=true;
  h.win.localStorage={...h.storage,setItem(key,value){if(key===core.KEY&&once){once=false;if(mode==='throw')throw Error('quota');return;}h.storage.setItem(key,value);}};
  const api=core.install(h.win);assert.throws(()=>api.create('fridge','Should fail'),mode==='throw'?/quota/:/could not be saved/);assert.equal(h.storage.getItem(core.KEY),before);
 }
});
test('a newer concurrent metadata write is never rolled back over',()=>{
 const h=fixture();h.api.create('cupboard','Original');const newer={version:1,byActor:{guest:{sections:{fridge:{groups:[{id:'newer',name:'Newer edit'}],assignments:{}}}}}};let once=true;
 h.hook(key=>{if(key===core.KEY&&once){once=false;h.values.set(core.KEY,JSON.stringify(newer));}});
 assert.throws(()=>h.api.create('cupboard','Losing edit'),/could not be saved/);assert.equal(h.storage.getItem(core.KEY),JSON.stringify(newer));
});
test('malformed, unsupported and incompatible saved groups are not reset or overwritten',()=>{
 for(const raw of ['{broken','[]','{}','{"version":2,"byActor":{}}',JSON.stringify({version:1,byActor:{guest:{sections:{fridge:{groups:[],assignments:{milk:'missing'}}}}}}),JSON.stringify({version:1,byActor:{guest:{sections:{fridge:{groups:[{id:'a',name:'Same'},{id:'b',name:'same'}],assignments:{}}}}}})]){
  const h=fixture({[core.KEY]:raw});assert.throws(()=>h.api.snapshot('fridge'));assert.throws(()=>h.api.create('fridge','Review later'));assert.equal(h.storage.getItem(core.KEY),raw);
 }
});
test('blank, duplicate, overlong and excessive groups are rejected; Other remains available',()=>{
 const h=fixture();for(const name of ['', '    ', 'x'.repeat(49),'  TINS & JARS  ','Other items'])assert.throws(()=>h.api.create('cupboard',name));
 assert.equal(h.storage.getItem(core.KEY),null);assert.throws(()=>h.api.rename('cupboard','other','Renamed'));assert.throws(()=>h.api.remove('cupboard','other'));assert.throws(()=>h.api.move('cupboard','other',1));assert.throws(()=>h.api.move('cupboard','grains',2));
 for(let i=0;i<36;i++)h.api.create('cupboard','Custom '+i);assert.equal(h.api.snapshot('cupboard').groups.length,41);assert.throws(()=>h.api.create('cupboard','One too many'),/40 groups/);h.api.create('fridge','Space here');
});
test('account deletion blocks edits before and during saving without recreating deleted data',()=>{
 const h=fixture();h.win.BBAccountDeletion.isDeleting=()=>true;assert.throws(()=>h.api.create('essentials','Supplies'),/deletion/);assert.equal(h.storage.getItem(core.KEY),null);
 let deleting=false;h.win.BBAccountDeletion.isDeleting=()=>deleting;h.hook(key=>{if(key===core.KEY){deleting=true;h.values.delete(core.KEY);}});
 assert.throws(()=>h.api.create('essentials','Supplies'));assert.equal(h.storage.getItem(core.KEY),null);
});
test('browser installation exposes the same API and unsafe item key names cannot mutate object prototypes',()=>{
 const h=fixture(),context=vm.createContext({window:h.win});vm.runInContext(fs.readFileSync(new URL('../bb-pantry-groups.js',import.meta.url),'utf8'),context);
 assert.equal(h.win.BBPantryGroups.KEY,core.KEY);h.win.BBPantryGroups.assign('cupboard','__proto__','grains');assert.equal(h.win.BBPantryGroups.groupFor('cupboard','__proto__','Unknown'),'grains');
 h.as('__proto__');h.win.BBPantryGroups.create('cupboard','Own namespace');assert.ok(Object.hasOwn(JSON.parse(h.storage.getItem(core.KEY)).byActor,'__proto__'));assert.equal({}.sections,undefined);
});
