import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fixture} from './basketboss-pantry-policy-ui.test.mjs';
import {transform700PantrySelection} from '../tools/catalogue700/pantry-selection.mjs';
const {createRemovalHost}=createRequire(import.meta.url)('../bb-pantry-selection.js');
const source=fs.readFileSync(new URL('../shopping-inventory.js',import.meta.url),'utf8');
const stockKey='basketboss_321_v7_measured_pantry',inventoryKey='basketboss_makeameal_v1_inventory';
const seed=()=>({
 inventory:{'cupboard|rice':{name:'Rice',loc:'cupboard',qty:500,unit:'g',selected:true,bb173StockKey:'rice|g',bb173StockValue:500},'fridge|milk':{name:'Milk',loc:'fridge',qty:1000,unit:'ml',selected:true,bb173StockKey:'milk|ml',bb173StockValue:1000},'freezer|peas':{name:'Peas',loc:'freezer',qty:350,unit:'g',selected:true,bb173StockKey:'peas|g',bb173StockValue:350}},
 stock:{'rice|g':500,'milk|ml':1000,'peas|g':350},requirements:[{key:'Rice',unit:'g',required:800},{key:'Milk',unit:'ml',required:1500},{key:'Peas',unit:'g',required:500}]
});
async function selectedFixture(options={}){let host;const h=await fixture({...seed(),live:true,...options,sourceOverride:transform700PantrySelection(source),configureWindow(win){win.BBPantrySelection={bind(adapter){host=createRemovalHost(adapter);}};}});assert.ok(host,'generated pantry binds its existing transaction');return {...h,host};}

test('bulk deletion uses the actual pantry transaction, removes only selected stock and recalculates shopping',async()=>{
 const h=await selectedFixture();h.storage.setItem('saved-plan-sentinel',JSON.stringify({planned:[{recipeId:'fajitas',day:'Monday'}]}));h.storage.setItem('shopping-history-sentinel','kept');
 const proposal=h.host.preview(['cupboard|rice','fridge|milk']);assert.equal(proposal.ok,true);assert.deepEqual(h.stock(),seed().stock,'preview never saves');
 const result=await h.host.remove(proposal);assert.equal(result.ok,true);assert.equal(result.removed,2);assert.deepEqual(h.stock(),{'peas|g':350});
 assert.equal(h.inventory()['cupboard|rice'].selected,false);assert.equal(h.inventory()['fridge|milk'].selected,false);assert.equal(h.inventory()['freezer|peas'].selected,true);
 assert.deepEqual(h.needed().map(row=>row.toBuy),[800,1500,150]);assert.equal(h.storage.getItem('shopping-history-sentinel'),'kept');assert.equal(JSON.parse(h.storage.getItem('saved-plan-sentinel')).planned[0].recipeId,'fajitas');assert.equal(h.syncs(),1);
});

test('selection supports unknown amounts while unrelated foods and household records remain intact',async()=>{
 const data=seed();data.inventory['cupboard|tuna-unknown']={name:'John West Tuna Chunks',loc:'cupboard',qty:null,unit:'tin',selected:true};data.inventory['household|soap']={name:'Soap',loc:'household',qty:2,unit:'each',selected:true};
 const h=await selectedFixture(data),soap=JSON.stringify(h.inventory()['household|soap']);
 assert.equal(h.host.preview(['household|soap']).ok,false);const result=await h.host.remove(h.host.preview(['cupboard|tuna-unknown']));assert.equal(result.ok,true);assert.equal(h.inventory()['cupboard|tuna-unknown'].selected,false);assert.equal(JSON.stringify(h.inventory()['household|soap']),soap);assert.deepEqual(h.stock(),data.stock);
});

test('selected variant keys never delete another same-name food source',async()=>{
 const data=seed();data.inventory['freezer|rice']={name:'Rice',loc:'freezer',qty:200,unit:'g',selected:true,bb173StockKey:'rice|g',bb173StockValue:200};data.stock['rice|g']=700;
 const h=await selectedFixture(data),result=await h.host.remove(h.host.preview(['cupboard|rice']));assert.equal(result.ok,true);assert.equal(h.inventory()['freezer|rice'].selected,true);assert.equal(h.stock()['rice|g'],200);assert.equal(h.stock()['milk|ml'],1000);
});

test('a storage failure rolls back the real inventory, measured stock and staged selection before retry',async()=>{
 const h=await selectedFixture(),beforeStock=h.storage.getItem(stockKey),beforeInventory=h.storage.getItem(inventoryKey),original=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key===stockKey&&fail){fail=false;throw Error('Synthetic storage failure');}return original(key,value);};
 const proposal=h.host.preview(['cupboard|rice','fridge|milk']),result=await h.host.remove(proposal);assert.equal(result.ok,false);assert.equal(h.storage.getItem(stockKey),beforeStock);assert.equal(h.storage.getItem(inventoryKey),beforeInventory);assert.equal(h.host.rows().length,3);
 const retry=await h.host.remove(h.host.preview(['cupboard|rice','fridge|milk']));assert.equal(retry.ok,true);assert.deepEqual(h.stock(),{'peas|g':350});
});

test('stale physical stock, changed quantities and switched accounts reject confirmation without deleting food',async()=>{
 for(const kind of ['stock','quantity','account']){
  const h=await selectedFixture(),proposal=h.host.preview(['cupboard|rice']);
  if(kind==='stock')h.storage.setItem(stockKey,JSON.stringify({...h.stock(),'rice|g':450}));
  if(kind==='quantity'){assert.equal(h.host.editor.update('cupboard|rice',{qty:450,unit:'g'}).ok,true);await h.host.editor.flush();}
  if(kind==='account')h.storage.setItem('basketboss_cloud_session_v1',JSON.stringify({user:{id:'another-account'},access_token:'synthetic'}));
  const before=JSON.stringify([...h.values]),result=await h.host.remove(proposal);assert.equal(result.ok,false,kind);assert.equal(JSON.stringify([...h.values]),before,kind);assert.equal(h.inventory()['cupboard|rice'].selected,true,kind);
 }
});

test('double confirmation is one transaction and a later online failure does not resurrect committed food',async()=>{
 const h=await selectedFixture({onlineError:true}),proposal=h.host.preview(['cupboard|rice']);const first=h.host.remove(proposal),second=await h.host.remove(proposal);assert.equal(second.ok,false);const result=await first;assert.equal(result.ok,true);assert.equal(h.inventory()['cupboard|rice'].selected,false);assert.equal(h.syncs(),1);assert.equal(h.stock()['rice|g'],undefined);
});

test('cancelled or malformed selections have no mutation and generated binding fails closed when its anchor moves',async()=>{
 const h=await selectedFixture(),before=JSON.stringify([...h.values]);
 for(const keys of [[],['missing'],['cupboard|rice','cupboard|rice'],['household|soap']])assert.equal(h.host.preview(keys).ok,false);
 assert.equal((await h.host.remove(null)).ok,false);assert.equal(JSON.stringify([...h.values]),before);
 assert.throws(()=>transform700PantrySelection('unrecognised source'),/pantry_selection_anchor/);
});
