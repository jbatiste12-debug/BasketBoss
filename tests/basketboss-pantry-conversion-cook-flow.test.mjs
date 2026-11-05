import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),{install}=require('../bb-home.js'),deduction=require('../bb-pantry-deduction.js');
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory',HOME='basketboss_at_home_requirements_v1',SESSION='basketboss_cloud_session_v1',PLAN='basketboss_321_unified_state_v1',ACTOR='11111111-1111-4111-8111-111111111111';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
const almost=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' should equal '+expected);
function actualFunction(html,name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name+' must be the real host helper');
 const firstEnd=html.indexOf('\n',start),first=html.slice(start,firstEnd);if(first.endsWith('}'))return first;
 const end=html.indexOf('\n}',start);assert.ok(end>start,name+' must have its complete function body');return html.slice(start,end+2);
}
const linked=(key,quantity,unit,extra={})=>({name:key.slice(0,key.lastIndexOf('|')),selected:true,loc:'cupboard',qty:quantity,unit,bb173StockKey:key,bb173StockValue:quantity,...extra});
const ingredient=(key,required,unit='g')=>({key,name:key,required,unit});
function fixture(entry,{stock,inventory,ingredients}){
 const html=read(entry),values=new Map([[STOCK,JSON.stringify(stock)],[INVENTORY,JSON.stringify(inventory)],[SESSION,JSON.stringify({user:{id:ACTOR}})],[PLAN,JSON.stringify({planned:[{day:'Monday',recipeId:'meal'},{day:'Tuesday',recipeId:'meal'}]})]]);
 const writes=[],syncs=[],settled=[],state={ingredients:copy(ingredients),refreshes:0};
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,String(value));writes.push(key);},removeItem:key=>{values.delete(key);writes.push(key);}};
 const win={localStorage:storage,document:{},location:{search:''},BBPantryDeduction:deduction,BBReceiptHost:{hasPendingConfirmation:()=>false,requiresPantryReview:()=>false,canConsumePantry:()=>true,async confirmCookedPantry(packet){syncs.push(copy(packet));return {ok:true};}}};
 const context=vm.createContext({localStorage:storage,BB307_STOCK_KEY:STOCK,bb307Market:'UK',console:{warn(){}}});vm.runInContext(read('basketboss-pricing-v19.js'),context);
 const pantryStart=html.indexOf('const BB307Pantry=(()=>{'),pantryEnd=html.indexOf('// BasketBoss 321 v7 original-design',pantryStart);assert.ok(pantryStart>0&&pantryEnd>pantryStart);vm.runInContext(html.slice(pantryStart,pantryEnd),context);
 const pantry=vm.runInContext('BB307Pantry',context);context.window=win;
 for(const name of ['bbHomePhysicalStock','bbHomeExcludedStockKeys','bbHomeConversionContext'])vm.runInContext(actualFunction(html,name),context);
 const hostCode=html.slice(html.indexOf('window.BBHomeHost=Object.freeze('),html.indexOf('window.BBPantryCameraHost='));assert.match(hostCode,/stock:\s*bbHomePhysicalStock/,'Cook must read raw physical balances, not the legacy normalized projection');
 const occurrence=(recipeId,day)=>'cycle-one|dinner|'+day+'|'+recipeId;
 const host={id:pantry.pantryId,keys:()=>({stock:STOCK,inventory:INVENTORY}),stock:context.bbHomePhysicalStock,conversionContext:context.bbHomeConversionContext,
  recipeIngredients:(_id,factor)=>state.ingredients.map(row=>({...row,required:row.required===null?null:row.required*factor})),occurrence,
  settlePurchases(ids){settled.push(ids);return null;},refresh:()=>state.refreshes++,household:()=>[],requirements:()=>[]};win.BBHomeHost=host;
 const home=install(win);win.BBHome=home;
 const event=(sessionId='first',day='Monday',factor=1)=>({sessionId,recipeId:'meal',day,factor,actorId:ACTOR,occurrence:occurrence('meal',day)});
 return {values,writes,syncs,settled,state,storage,home,host,event,stock:()=>JSON.parse(storage.getItem(STOCK)),inventory:()=>JSON.parse(storage.getItem(INVENTORY)),context:()=>context.bbHomeConversionContext(),
  async cook(sessionId='first',day='Monday',factor=1){const value=event(sessionId,day,factor),preview=home.previewCook(value);assert.equal(preview.ok,true,preview.message);return home.cooked({...value,expected:preview.fingerprint});}};
}

for(const entry of ['index.html','app.html']){
 test(entry+': confirmed Cook preserves a checked pack source and its metadata for a second meal',async()=>{
  const key='Rice|packs',h=fixture(entry,{stock:{[key]:2},inventory:{cupboard:linked(key,2,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'})},ingredients:[ingredient('rice',250)]});
  const before=[...h.values],preview=h.home.previewCook(h.event());assert.equal(preview.rows[0].owned,1000);assert.deepEqual([...h.values],before,'preview must remain read-only');
  assert.equal((await h.cook()).ok,true);assert.deepEqual(h.stock(),{[key]:1.5});let row=h.inventory().cupboard;assert.equal(row.bb173StockKey,key);assert.equal(row.bb173StockValue,1.5);assert.equal(row.qty,1.5);assert.equal(row.packQuantity,500);assert.equal(row.packReviewed,true);assert.equal(h.context().stock[key].packQuantity,500);assert.ok(h.settled[0].includes('rice|pack'),'purchase settlement includes the physical source unit');
  const again=h.home.previewCook(h.event('second','Tuesday',2));assert.equal(again.rows[0].owned,750);assert.equal((await h.cook('second','Tuesday',2)).ok,true);assert.deepEqual(h.stock(),{[key]:.5});row=h.inventory().cupboard;assert.equal(row.bb173StockKey,key);assert.equal(row.bb173StockValue,.5);assert.equal(row.packQuantity,500);assert.deepEqual(h.syncs.at(-1).stock,{[key]:.5});
  const after=[...h.values];assert.equal((await h.home.cooked(h.event('another-session','Tuesday',2))).already,true);assert.deepEqual([...h.values],after);assert.equal(h.syncs.length,2);
 });

 test(entry+': an unknown bag stays intact while a compatible measured amount is deducted',async()=>{
  const bag=linked('rice|bag',2,'bag',{packReviewed:false,packQuantity:500,packUnit:'g'}),h=fixture(entry,{stock:{'rice|bag':2,'rice|g':50},inventory:{bag,measured:linked('rice|g',50,'g')},ingredients:[ingredient('rice',100)]});
  const preview=h.home.previewCook(h.event());assert.equal(preview.rows[0].deduct,50);assert.equal(preview.issues.length,1);assert.match(preview.rows[0].issueLabel,/review At home/i);
  const result=await h.cook();assert.equal(result.ok,true);assert.equal(result.issues.length,1);assert.deepEqual(h.stock(),{'rice|bag':2});assert.deepEqual(h.inventory().bag,bag);assert.equal(h.inventory().measured.bb173StockValue,0);assert.match(result.message,/need review/);
 });

 test(entry+': a reviewed density keeps source litres and linked display millilitres consistent',async()=>{
  const key='Milk|litres',h=fixture(entry,{stock:{[key]:1},inventory:{milk:linked(key,1,'ml',{qty:1000,measurementReviewed:true,densityGPerMl:1.03,measurementEstimated:false,measurementAssumption:'Measured density for this milk'})},ingredients:[ingredient('milk',257.5)]});
  const preview=h.home.previewCook(h.event());assert.equal(preview.rows[0].estimated,false);assert.match(preview.rows[0].assumptions.join(' '),/Measured density/);assert.equal((await h.cook()).ok,true);almost(h.stock()[key],.75);let row=h.inventory().milk;assert.equal(row.bb173StockKey,key);almost(row.bb173StockValue,.75);almost(row.qty,750);assert.equal(row.densityGPerMl,1.03);
  assert.equal((await h.cook('second','Tuesday')).ok,true);almost(h.stock()[key],.5);row=h.inventory().milk;almost(row.bb173StockValue,.5);almost(row.qty,500);assert.equal(row.measurementReviewed,true);
 });

 test(entry+': raw aliases, unknown units, tiny stock and unrelated zero values survive confirmed cooking',async()=>{
  const key='Carrots|kilograms',stock={[key]:1,'Herbs|handful':2,'tiny|g':.00004,'zero|mystery':0},herbs=linked('Herbs|handful',2,'handful'),h=fixture(entry,{stock,inventory:{carrot:linked(key,1,'kg'),herbs},ingredients:[ingredient('carrot',300)]});
  assert.equal((await h.cook()).ok,true);almost(h.stock()[key],.7);assert.deepEqual(Object.keys(h.stock()),Object.keys(stock));assert.equal(h.stock()['Herbs|handful'],2);assert.equal(h.stock()['tiny|g'],.00004);assert.equal(h.stock()['zero|mystery'],0);assert.equal(h.inventory().carrot.bb173StockKey,key);almost(h.inventory().carrot.qty,.7);assert.deepEqual(h.inventory().herbs,herbs);
 });

 test(entry+': changing reviewed contents after preview invalidates the confirmation without spending stock',async()=>{
  const key='rice|pack',h=fixture(entry,{stock:{[key]:2},inventory:{rice:linked(key,2,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'})},ingredients:[ingredient('rice',250)]});
  const event=h.event(),preview=h.home.previewCook(event),inventory=h.inventory();inventory.rice.packQuantity=400;h.storage.setItem(INVENTORY,JSON.stringify(inventory));const before=[...h.values],writes=h.writes.length;
  const result=await h.home.cooked({...event,expected:preview.fingerprint});assert.equal(result.ok,false);assert.equal(result.needsReview,true);assert.deepEqual([...h.values],before);assert.equal(h.writes.length,writes);assert.equal(h.syncs.length,0);assert.equal(h.settled.length,0);assert.equal(h.values.has(HOME),false);
 });

 test(entry+': conflicting reviewed pack sizes never choose the last Kitchen record',async()=>{
  const key='rice|pack',h=fixture(entry,{stock:{[key]:2},inventory:{first:linked(key,1,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'}),second:linked(key,1,'pack',{packReviewed:true,packQuantity:250,packUnit:'g'})},ingredients:[ingredient('rice',100)]});
  const before=h.inventory(),preview=h.home.previewCook(h.event());assert.equal(preview.rows[0].deduct,0);assert.equal(preview.issues.length,1);assert.equal((await h.cook()).ok,true);assert.deepEqual(h.stock(),{[key]:2});assert.deepEqual(h.inventory(),before);
 });

 test(entry+': conflicting item weights cannot silently fall back to a generic whole-produce average',()=>{
  const key='carrot|each',h=fixture(entry,{stock:{[key]:2},inventory:{first:linked(key,1,'each',{measurementReviewed:true,gramsPerEach:60}),second:linked(key,1,'each',{measurementReviewed:true,gramsPerEach:100})},ingredients:[ingredient('carrot',80)]});
  const preview=h.home.previewCook(h.event());assert.equal(preview.rows[0].deduct,0);assert.equal(preview.rows[0].canDeduct,false);assert.equal(preview.issues.length,1);assert.deepEqual(h.stock(),{[key]:2});
 });

 test(entry+': one reviewed pack record cannot provide contents for an unreviewed positive source',()=>{
  const key='rice|pack',h=fixture(entry,{stock:{[key]:2},inventory:{first:linked(key,1,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'}),second:linked(key,1,'pack')},ingredients:[ingredient('rice',100)]});
  const preview=h.home.previewCook(h.event());assert.equal(preview.rows[0].deduct,0);assert.equal(preview.issues.length,1);assert.deepEqual(h.stock(),{[key]:2});
 });
}
