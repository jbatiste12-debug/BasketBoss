import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const homeModule=createRequire(import.meta.url)('../bb-home.js');
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const FEATURES='basketboss_321_features_v1',SESSION='basketboss_cloud_session_v1',HOME='basketboss_at_home_requirements_v1';
function fixture({active=true,owned=1,target=4}={}){
 const original={id:'soap',name:'Soap',qty:4,unit:'each',targetQty:target,ownedQty:owned,manualPending:active,selected:active,owned:!active,productName:'Sensitive soap',packQuantity:1,packUnit:'each',packReviewed:true};
 const values=new Map([[FEATURES,JSON.stringify({version:1,essentials:[original]})],['inventory',JSON.stringify({rice:{qty:200,unit:'g'}})],['stock',JSON.stringify({'rice|g':200})],['ticks',JSON.stringify({'ess:soap':true})]]);
 const read=key=>JSON.parse(values.get(key)||'null'),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 let features=read(FEATURES),settlements=0,refreshes=0,pending=false,review=false,deleting=false,failRefresh=false;
 const host={household:()=>features.essentials,reload:()=>{features=read(FEATURES);},refresh:()=>{refreshes++;if(failRefresh)throw Error('paint');},
  householdAmountContext:()=>({actor:home.actor(),session:storage.getItem(SESSION),features:storage.getItem(FEATURES)}),
  settlePurchases:ids=>{settlements++;const previous=storage.getItem('ticks');return {updates:{ticks:{}},expected:{ticks:previous},history:{[ids[0]]:{kept:true}},generations:{[ids[0]]:1},superseded:{[ids[0]]:true}};},
 };
 // Exercise the production patch adapter, including its reconciliation checks.
 const line=html.split('\n').find(line=>line.trimStart().startsWith('prepareHousehold:'));
 const sandbox=vm.createContext({localStorage:storage,BB307_FEATURE_KEY:FEATURES,bb307FeatureState:features,RECIPES:[]});
 vm.runInContext(fs.readFileSync(new URL('../bb-weekly-essentials.js',import.meta.url),'utf8'),sandbox);
 sandbox.BBWeeklyEssentials=sandbox.BBWeeklyEssentials||sandbox.globalThis?.BBWeeklyEssentials;
 vm.runInContext('prepare='+line.trim().slice('prepareHousehold:'.length,-1),sandbox);
 host.prepareHousehold=entries=>{sandbox.bb307FeatureState=features;return sandbox.prepare(entries);};
 const featureStart=html.indexOf('const BB307Features=(()=>{'),featureEnd=html.indexOf('/* BasketBoss 321: optional family features in the ISOLATED',featureStart);
 const entryStart=html.indexOf('function bbHomePrepareHouseholdEntry('),entryEnd=html.indexOf('window.BBHomeHost=Object.freeze(',entryStart);
 assert.ok(featureStart>=0&&featureEnd>featureStart&&entryStart>=0&&entryEnd>entryStart);
 vm.runInContext(html.slice(featureStart,featureEnd)+html.slice(entryStart,entryEnd),sandbox);
 host.prepareHouseholdEntry=entry=>{sandbox.bb307FeatureState=features;return sandbox.bbHomePrepareHouseholdEntry(entry);};
 host.prepareHouseholdRemoval=id=>{sandbox.bb307FeatureState=features;return sandbox.bbHomePrepareHouseholdRemoval(id);};
 const win={document:{},location:{search:''},localStorage:storage,BBHomeHost:host,BBReceiptHost:{hasPendingConfirmation:()=>pending,requiresPantryReview:()=>review,canConsumePantry:()=>!review},BBAccountDeletion:{isDeleting:()=>deleting}};
 const home=homeModule.install(win);win.BBHome=home;
 return {home,host,values,storage,read,pin:host.householdAmountContext,settlements:()=>settlements,refreshes:()=>refreshes,pending:value=>pending=value,review:value=>review=value,deleting:value=>deleting=value,failRefresh:value=>failRefresh=value};
}
test('explicit confirmation updates household shortfall without a food pantry commit',()=>{
 const h=fixture(),food=[h.values.get('inventory'),h.values.get('stock')];h.review(true);
 const result=h.home.confirmHousehold('soap',{targetQty:6,ownedQty:2},h.pin());
 assert.equal(result.ok,true);assert.equal(result.id,'soap');assert.equal(result.item.targetQty-result.item.ownedQty,4);assert.equal(h.read(FEATURES).essentials[0].productName,'Sensitive soap');
 assert.deepEqual([h.values.get('inventory'),h.values.get('stock')],food);assert.equal(h.home.hasHouseholdDraft(),false);assert.equal(h.refreshes(),1);assert.equal(h.settlements(),1);
});
test('target-only amendment keeps this shop checked and partial progress',()=>{
 const h=fixture(),ticks=h.values.get('ticks');h.home.confirmHousehold('soap',{targetQty:8,ownedQty:1},h.pin());
 assert.equal(h.values.get('ticks'),ticks);assert.equal(h.settlements(),0);assert.equal(h.read(FEATURES).essentials[0].targetQty,8);
});
test('reactivating a completed essential opens a fresh weekly request without changing stock',()=>{
 const h=fixture({active:false,owned:4}),before=h.values.get('stock');const result=h.home.confirmHousehold('soap',{targetQty:6,ownedQty:4},h.pin());
 assert.equal(result.item.selected,true);assert.equal(result.item.manualPending,true);assert.equal(result.item.owned,false);assert.equal(h.settlements(),1);assert.equal(h.values.get('stock'),before);
});
test('zero and fully covered targets remain confirmed while requiring no shopping',()=>{
 const h=fixture();const result=h.home.confirmHousehold('soap',{targetQty:0,ownedQty:1},h.pin());assert.equal(result.ok,true);assert.equal(result.item.targetQty,0);assert.equal(result.item.ownedQty,1);
});
test('invalid household counts and unsupported measured patches leave all records unchanged',()=>{
 const h=fixture(),before=[...h.values];
 for(const patch of [{targetQty:-1,ownedQty:0},{targetQty:2.5,ownedQty:0},{targetQty:2,ownedQty:null},{targetQty:2,ownedQty:1,unit:'ml'},{targetQty:2,ownedQty:1,unit:'each',packQuantity:1,packUnit:'each',packReviewed:true},{targetQty:2,ownedQty:1,selected:false}])assert.throws(()=>h.home.confirmHousehold('soap',patch,h.pin()));
 assert.deepEqual([...h.values],before);
});
test('reviewed partial-container confirmation preserves capacity and settles prior credit once',()=>{
 const h=fixture();const result=h.home.confirmHousehold('soap',{unit:'ml',targetQty:1500,ownedQty:375,packQuantity:750,packUnit:'ml',packReviewed:true},h.pin());
 assert.equal(result.item.unit,'ml');assert.equal(result.item.packQuantity,750);assert.equal(result.item.ownedQty,375);assert.equal(h.settlements(),1);
});
test('new essential confirmation uses the real feature model and duplicate names cannot make another row',()=>{
 const h=fixture();const result=h.home.confirmHouseholdEntry({name:'Toilet rolls',unit:'each',targetQty:6,ownedQty:2},h.pin());
 assert.match(result.id,/^ess-/);assert.equal(result.item.targetQty-result.item.ownedQty,4);assert.equal(h.read(FEATURES).essentials.length,2);
 const before=[...h.values];assert.throws(()=>h.home.confirmHouseholdEntry({name:'TOILET ROLLS',unit:'each',targetQty:8,ownedQty:2},h.pin()),/already listed/);assert.deepEqual([...h.values],before);
 h.home.confirmHousehold(result.id,{targetQty:8,ownedQty:2},h.pin());assert.equal(h.read(FEATURES).essentials.length,2);assert.equal(h.read(FEATURES).essentials[1].targetQty,8);
});
test('real entry/removal preparation is read-only, and zero or covered new targets remain valid',()=>{
 const h=fixture(),before=[...h.values],initial=JSON.stringify(h.host.household());
 const prepared=h.host.prepareHouseholdEntry({name:'Bin bags',unit:'pack',targetQty:0,ownedQty:2});
 assert.equal(prepared.value.essentials.at(-1).targetQty,0);assert.equal(prepared.value.essentials.at(-1).ownedQty,2);assert.deepEqual([...h.values],before);assert.equal(JSON.stringify(h.host.household()),initial);
 const removed=h.host.prepareHouseholdRemoval('soap');assert.equal(removed.value.essentials[0].selected,false);assert.deepEqual([...h.values],before);assert.equal(JSON.stringify(h.host.household()),initial);
 const zero=h.home.confirmHouseholdEntry({name:'Bin bags',unit:'pack',targetQty:0,ownedQty:2},h.pin());assert.equal(zero.item.targetQty,0);assert.equal(zero.item.ownedQty,2);
 const covered=h.home.confirmHouseholdEntry({name:'Shampoo',unit:'each',targetQty:1,ownedQty:1},h.pin());assert.equal(covered.item.targetQty-covered.item.ownedQty,0);
});
test('delete removes the weekly request while preserving owned stock, metadata and purchase progress',()=>{
 const h=fixture(),before=h.read(FEATURES).essentials[0],ticks=h.values.get('ticks'),stock=h.values.get('stock');const result=h.home.removeHousehold('soap',h.pin()),row=h.read(FEATURES).essentials[0];
 assert.equal(result.ok,true);assert.equal(row.selected,false);assert.equal(row.manualPending,false);assert.equal(row.ownedQty,before.ownedQty);assert.equal(row.targetQty,before.targetQty);assert.equal(row.packQuantity,before.packQuantity);assert.equal(h.values.get('ticks'),ticks);assert.equal(h.values.get('stock'),stock);assert.equal(h.settlements(),0);
});
test('stale feature, account, pending receipt and deletion guards prevent confirmation',()=>{
 const h=fixture(),pin=h.pin();h.storage.setItem(FEATURES,JSON.stringify({...h.read(FEATURES),changed:true}));let before=[...h.values];assert.throws(()=>h.home.confirmHousehold('soap',{targetQty:6,ownedQty:1},pin),/changed/);assert.deepEqual([...h.values],before);
 const fresh=h.pin();h.storage.setItem(SESSION,JSON.stringify({user:{id:'other-account'}}));before=[...h.values];assert.throws(()=>h.home.confirmHousehold('soap',{targetQty:6,ownedQty:1},fresh),/account/);assert.deepEqual([...h.values],before);
 h.pending(true);assert.throws(()=>h.home.confirmHousehold('soap',{targetQty:6,ownedQty:1},h.pin()),/receipt/);h.pending(false);h.deleting(true);assert.throws(()=>h.home.confirmHouseholdEntry({name:'Soap',unit:'each',targetQty:6,ownedQty:1},h.pin()),/account/);
});
test('failed atomic save rolls back household and settlement records, allowing the same confirmation to retry',()=>{
 const h=fixture(),before=[...h.values],pin=h.pin(),put=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(key==='ticks'&&fail){fail=false;throw Error('quota');}put(key,value);};
 assert.throws(()=>h.home.confirmHousehold('soap',{targetQty:6,ownedQty:2},pin),/quota/);assert.deepEqual([...h.values],before);
 assert.equal(h.home.confirmHousehold('soap',{targetQty:6,ownedQty:2},pin).ok,true);
});
test('a repaint failure cannot report an already committed essential as unsaved',()=>{
 const h=fixture();h.failRefresh(true);assert.equal(h.home.confirmHousehold('soap',{targetQty:5,ownedQty:2},h.pin()).ok,true);assert.equal(h.read(FEATURES).essentials[0].targetQty,5);
});
