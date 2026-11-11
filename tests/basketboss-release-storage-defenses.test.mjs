import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const FEATURE='basketboss_321_features_v1',STOCK='basketboss_321_v7_measured_pantry';
const broken=['{broken','null','[]','false','4','"old text"'];
const copy=value=>JSON.parse(JSON.stringify(value));
function actual(name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);
 const lineEnd=html.indexOf('\n',start);if(html.slice(start,lineEnd).endsWith('}'))return html.slice(start,lineEnd);
 const end=html.indexOf('\n}',start);assert.ok(end>start,name);return html.slice(start,end+2);
}
function adapter(name){
 const line=html.split('\n').find(line=>line.trimStart().startsWith(name+':'));
 assert.ok(line,name);return line.trim().slice(name.length+1).replace(/,$/,'');
}
function storageFixture(raw){
 const values=new Map([[STOCK,'{"rice|g":666.666667}']]);if(raw!==undefined)values.set(FEATURE,raw);
 const writes=[],storage={getItem:key=>values.get(key)??null,setItem(key,value){writes.push(key);values.set(key,String(value));},removeItem(key){writes.push(key);values.delete(key);}};
 const original={version:1,essentials:[{id:'soap',name:'Soap',unit:'each',qty:6,targetQty:6,ownedQty:2,selected:true,owned:false,manualPending:true}]};
 const win={localStorage:storage};
 const ctx=vm.createContext({window:win,localStorage:storage,BB307_FEATURE_KEY:FEATURE,bb307FeatureState:copy(original),RECIPES:[],console:{warn(){}},notify(){}});
 vm.runInContext(fs.readFileSync(new URL('../bb-weekly-essentials.js',import.meta.url),'utf8'),ctx);ctx.BBWeeklyEssentials=win.BBWeeklyEssentials;
 const begin=html.indexOf('const BB307Features=(()=>{'),end=html.indexOf('/* BasketBoss 321: optional family features',begin);assert.ok(begin>=0&&end>begin);
 vm.runInContext(html.slice(begin,end),ctx);
 for(const name of ['bb307ReadFeatures','bb307StoreFeatures','bbHomePrepareHouseholdEntry','bbHomePrepareHouseholdRemoval'])vm.runInContext(actual(name),ctx);
 vm.runInContext('this.prepareHousehold='+adapter('prepareHousehold')+';this.completeHousehold='+adapter('completeHousehold')+';',ctx);
 return {ctx,values,writes,storage,original};
}

test('unreadable optional feature data cannot be replaced by a screen-reader fallback',()=>{
 for(const raw of broken){
  const h=storageFixture(raw),before=new Map(h.values);
  h.ctx.bb307FeatureState=h.ctx.bb307ReadFeatures();
  assert.equal(h.ctx.bb307StoreFeatures(),false,raw);
  assert.deepEqual(h.values,before,'all original bytes remain available for recovery');assert.equal(h.writes.length,0);
 }
});

test('absent keys and valid legacy essentials without override or category fields remain supported',()=>{
 const legacy={essentials:[{id:'rolls',name:'Toilet rolls',qty:6,unit:'each',selected:true,owned:true}]};
 for(const raw of [undefined,'{}',JSON.stringify(legacy)]){
  const h=storageFixture(raw),stock=h.storage.getItem(STOCK);
  h.ctx.bb307FeatureState=h.ctx.bb307ReadFeatures();assert.equal(h.ctx.bb307StoreFeatures(),true);
  const saved=JSON.parse(h.storage.getItem(FEATURE));
  if(raw===JSON.stringify(legacy)){assert.equal(saved.essentials[0].name,'Toilet rolls');assert.equal(saved.essentials[0].qty,6);assert.equal(saved.essentials[0].owned,true);}
  assert.equal(h.storage.getItem(STOCK),stock);assert.deepEqual(h.writes,[FEATURE]);
 }
});

test('every household proposal refuses unreadable saved features before it can produce a replacement',()=>{
 for(const raw of broken){
  const h=storageFixture(raw),before=new Map(h.values);
  for(const proposal of [()=>h.ctx.bbHomePrepareHouseholdEntry({name:'Toothpaste',unit:'each',targetQty:4,ownedQty:1}),()=>h.ctx.bbHomePrepareHouseholdRemoval('soap'),()=>h.ctx.prepareHousehold([['soap',{targetQty:8,ownedQty:2}]]),()=>h.ctx.completeHousehold('soap')])assert.throws(proposal,/Saved household data needs review/);
  assert.deepEqual(h.values,before);assert.equal(h.writes.length,0);assert.equal(h.ctx.bb307FeatureState.essentials[0].ownedQty,2);
 }
});

test('valid legacy household proposals preserve old stock and retain the expected raw record',()=>{
 const raw=JSON.stringify({essentials:[{id:'soap',name:'Soap',unit:'each',qty:6,selected:true,owned:false}]}),h=storageFixture(raw),before=new Map(h.values);
 const added=h.ctx.bbHomePrepareHouseholdEntry({name:'Toothpaste',unit:'each',targetQty:4,ownedQty:1});
 assert.equal(added.expected,raw);assert.equal(added.value.essentials[0].name,'Soap');assert.equal(added.value.essentials.at(-1).ownedQty,1);
 const changed=h.ctx.prepareHousehold([['soap',{targetQty:8,ownedQty:2}]]);assert.equal(changed.expected,raw);assert.equal(changed.value.essentials[0].targetQty,8);
 assert.deepEqual(h.values,before,'preparing a proposal never changes saved data');assert.equal(h.writes.length,0);
});

const objectKeys={BB307_STOCK_KEY:'stock',BB83_KITCHEN_INVENTORY:'inventory',BB83_SHOP_STOCK_LEDGER:'legacy',BB_BETA_RECEIPT_KEY:'receipts',BB307_FEATURE_KEY:'features',BB_SHOP_SESSION_V7_KEY:'session',BB84_PURCHASED_KEY:'purchases',BB_PARTIAL_PURCHASE_KEY:'partials',BB321_SHOP_TICKS_KEY:'ticks',BB_BETA_CHOICE_KEY:'choices'};
function purchaseFixture(corruptKey,raw){
 const values=new Map(Object.values(objectKeys).map(key=>[key,'{}']));values.set('stock','{"rice|g":666.666667}');values.set('features','{"essentials":[]}');
 if(corruptKey)values.set(corruptKey,raw);
 let reads=0;const writes=[],storage={getItem:key=>values.get(key)??null,setItem(key,value){writes.push(key);values.set(key,String(value));}};
 const session={version:7,id:'trip',shelfEdits:{}},win={localStorage:storage,BBShopOwnership:{},BBHome:{actor:()=> 'guest',shoppingBuys:()=>[]}};
 const ctx=vm.createContext({...objectKeys,window:win,localStorage:storage,bb307Market:'UK',bbShopV7Session:()=>session,bbBetaReceiptId:id=>'trip|'+id,bb83ReadObject:key=>{reads++;try{return JSON.parse(storage.getItem(key)||'{}');}catch{return {};}}});
 vm.runInContext(actual('bbShopOwnedChanges'),ctx);
 const update={session,purchases:{},partials:{},ticks:{},choices:{}};
 return {values,writes,ctx,reads:()=>reads,prepare:()=>ctx.bbShopOwnedChanges('rice|g',update,{name:'Rice',unit:'g'})};
}

test('purchase proposals cannot replace malformed stock, inventory, receipt or household object maps',()=>{
 for(const key of ['stock','inventory','legacy','receipts','features','basketboss_at_home_requirements_v1','ticks','purchases','partials','choices'])for(const raw of broken){
  const h=purchaseFixture(key,raw),before=new Map(h.values);
  assert.throws(h.prepare,/Saved At home data needs review/,'reject '+key+' before deriving an empty fallback');
  assert.equal(h.reads(),0,'no permissive reader has been called');assert.equal(h.writes.length,0);assert.deepEqual(h.values,before);
 }
});

test('purchase guards allow missing optional maps and keep six-decimal legacy stock exact',()=>{
 const h=purchaseFixture(),before=new Map(h.values),result=h.prepare();
 assert.equal(result.beforeStock['rice|g'],666.666667);assert.equal(result.expected.stock,'{"rice|g":666.666667}');
 assert.equal(result.expected.basketboss_at_home_requirements_v1,null);assert.deepEqual(h.values,before);assert.equal(h.writes.length,0);
});

function migrationFixture(corruptKey,raw){
 const records={partials:{'2026-11-10|rice|g':{bought:.666667,unit:'g'}},receipts:{'2026-11-10|rice|g':{credited:.666667,unit:'g'}},ticks:{'rice|g':true},purchases:{'rice|g':{qty:.666667,name:'Rice',unit:'g'}},choices:{'rice|g':{mode:'exact',qty:.666667,unit:'g'}},stock:{'rice|g':666.666667}};
 const values=new Map(Object.entries(records).map(([key,value])=>[key,JSON.stringify(value)]));if(corruptKey)values.set(corruptKey,raw);
 const writes=[],storage={getItem:key=>values.get(key)??null,setItem(key,value){writes.push(key);values.set(key,String(value));},removeItem:key=>values.delete(key)};
 const ctx=vm.createContext({...objectKeys,localStorage:storage,window:{},console:{error(){}}});
 for(const name of ['bbShopV7Read','bbShopV7Write','bbShopV7New','bbShopV7Session'])vm.runInContext(actual(name),ctx);
 return {values,writes,storage,ctx};
}

test('legacy-session migration cannot overwrite unreadable progress or receipt records',()=>{
 for(const key of ['partials','receipts','purchases','choices'])for(const raw of broken){
  const h=migrationFixture(key,raw),before=new Map(h.values);
  assert.throws(()=>h.ctx.bbShopV7Session(),/migration not saved; no legacy data discarded/);
  assert.deepEqual(h.values,before);assert.equal(h.writes.length,0);assert.equal(h.storage.getItem('session'),null);
 }
 const h=migrationFixture(),stock=h.storage.getItem('stock'),session=h.ctx.bbShopV7Session();
 assert.equal(session.version,7);assert.equal(session.purchases['rice|g'].qty,.666667);
 assert.equal(session.partials[session.id+'|rice|g'].bought,.666667);
 assert.equal(JSON.parse(h.storage.getItem('receipts'))[session.id+'|rice|g'].credited,.666667);
 assert.equal(h.storage.getItem('stock'),stock);
 const writes=h.writes.length;assert.equal(h.ctx.bbShopV7Session().id,session.id);assert.equal(h.writes.length,writes,'valid migration is retained without a second write');
});

test('transaction preflight validates known maps before any write and preserves unrelated scalar settings',()=>{
 for(const key of ['ticks','purchases','partials','choices'])for(const raw of broken){
  const h=migrationFixture(key,raw),before=new Map(h.values);
  assert.equal(h.ctx.bbShopV7Write({unrelated:{kept:true},[key]:{}}),false);
  assert.deepEqual(h.values,before);assert.equal(h.writes.length,0,'even an earlier unrelated update is not written');
 }
 const h=migrationFixture();h.values.set('unrelated-scalar','7');assert.equal(h.ctx.bbShopV7Write({'unrelated-scalar':8}),true);
 assert.equal(h.storage.getItem('unrelated-scalar'),'8','the general writer still supports non-map keys');
});
