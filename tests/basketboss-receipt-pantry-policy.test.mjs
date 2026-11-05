import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Core from '../bb-receipt-inventory-core.mjs';
import {normalizeReceiptLine,prepareReceiptConfirmation,validateReceiptConfirmation,normalizePantryState} from '../bb-receipt-inventory-core.mjs';
const require=createRequire(import.meta.url),quantity=require('../bb-receipt-quantity.js');
const catalog={'ketchup|ml':{},'chopped tomatoes|tin':{},'milk|ml':{},'beef mince|g':{},'garlic|clove':{}};
const row=(name,qty,unit,extra={})=>({name,loc:'cupboard',selected:true,qty,unit,bb173StockKey:name.toLowerCase()+'|'+unit,bb173StockValue:qty,...extra});

test('reviewed staple receipt amounts become editable container counts and survive server validation unchanged',()=>{
 const raw={id:'ketchup',description:'KETCHUP 800ML',canonicalKey:'ketchup',classification:'food',quantity:800,unit:'ml',lineTotal:2.5,reviewed:true};
 const normalized=normalizeReceiptLine(raw,{catalog,market:'UK',pantryPolicy:true});
 assert.equal(normalized.quantity,1);assert.equal(normalized.unit,'each');assert.deepEqual(normalized.issues,[]);
 const body=prepareReceiptConfirmation({receiptId:'receipt-staple-policy',market:'UK',currency:'GBP',retailer:'Tesco',shopSessionId:'trip',lines:[raw]}, {requestId:'request',catalog,pantryPolicy:true});
 body.expectedScope={kind:'user',id:'policy-user'};body.inventoryBaseline={stock:{'ketchup|each':1},expectedRevision:0,initialize:true};
 const checked=validateReceiptConfirmation(body,{catalog});assert.equal(checked.lines[0].quantity,1);assert.equal(checked.lines[0].unit,'each');assert.equal(checked.lines[0].pricePaid,2.5);
 const edited=normalizeReceiptLine({...raw,quantity:3,unit:'each'},{catalog,market:'UK',pantryPolicy:true});assert.equal(edited.quantity,3);
});

test('UK informal receipt containers normalize into compatible canonical quantities',()=>{
 for(const [name,count,unit,expected,to]of [['chopped tomatoes',2,'tin',800,'g'],['beef mince',1,'pack',500,'g'],['milk',1,'pint',568,'ml'],['garlic',2,'clove',2,'each']]){
  const normalized=normalizeReceiptLine({name,canonicalKey:name,classification:'food',quantity:count,unit,reviewed:true},{catalog,market:'UK',pantryPolicy:true});
  assert.equal(normalized.quantity,expected,name);assert.equal(normalized.unit,to,name);assert.deepEqual(normalized.issues,[],name);
 }
});

test('known package stock and measured stock merge in one location without losing provenance',()=>{
 const inventory={tin:row('Chopped tomatoes',1,'tin',{packReviewed:true,packQuantity:400,packUnit:'g'}),grams:row('Chopped tomatoes',400,'g')};
 const before=JSON.stringify(inventory),result=normalizePantryState({'chopped tomatoes|tin':1,'chopped tomatoes|g':400},inventory,{market:'UK'});
 assert.equal(JSON.stringify(inventory),before,'pure review must not mutate saved data');assert.deepEqual(result.stock,{'chopped tomatoes|g':800});assert.deepEqual(result.issues,[]);
 const active=Object.values(result.inventory).filter(x=>x.selected);assert.equal(active.length,1);assert.equal(active[0].qty,800);assert.equal(active[0].unit,'g');assert.equal(active[0].pantrySourceHistory[0].quantity,1);assert.equal(active[0].pantrySourceHistory[0].unit,'tin');
});

test('different storage locations retain their own allocations when converting the same measured source',()=>{
 const inventory={a:row('Chopped tomatoes',1,'tin'),b:row('Chopped tomatoes',1,'tin',{loc:'fridge'})},result=normalizePantryState({'chopped tomatoes|tin':2},inventory,{market:'UK'});
 assert.deepEqual(result.stock,{'chopped tomatoes|g':800});assert.equal(result.inventory.a.bb173StockValue,400);assert.equal(result.inventory.b.bb173StockValue,400);assert.equal(result.inventory.b.loc,'fridge');
});

test('unknown or conflicting package contents preserve every saved source for review',()=>{
 const inventory={mystery:row('Rice',2,'bag')},stock={'rice|bag':2},result=normalizePantryState(stock,inventory,{market:'UK'});
 assert.deepEqual(result.stock,stock);assert.deepEqual(result.inventory,inventory);assert.equal(result.issues.length,1);assert.match(result.issues[0].message,/kept.*review/i);
 const conflict={a:row('Beef mince',1,'pack',{packReviewed:true,packQuantity:250,packUnit:'g'}),b:row('Beef mince',1,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'})};
 const second=normalizePantryState({'beef mince|pack':2},conflict,{market:'UK'});assert.deepEqual(second.stock,{'beef mince|pack':2});assert.deepEqual(second.inventory,conflict);assert.match(second.issues[0].message,/disagree/);
});

test('receipt review hints match existing staple containers and use known measured equivalents',()=>{
 const inventory={ketchup:row('Ketchup',1,'each',{stapleStatus:'low'}),tomatoes:row('Chopped tomatoes',1,'tin')};
 const staple=quantity.infer({name:'KETCHUP 800ML',canonicalKey:'ketchup',classification:'food',quantity:800,unit:'ml'},{market:'UK',pantryPolicy:true,inventory});
 assert.equal(staple.quantity,1);assert.equal(staple.unit,'each');assert.match(staple.note,/\+1 bottle \(matches your pantry\)/);
 const measured=quantity.infer({name:'Chopped tomatoes',canonicalKey:'chopped tomatoes',classification:'food',quantity:400,unit:'g'},{market:'UK',pantryPolicy:true,inventory});assert.equal(measured.quantity,400);assert.equal(measured.unit,'g');assert.match(measured.note,/matches your pantry/);
});

test('the actual receipt reader matches a measured condiment scan to its existing editable pantry container',async()=>{
 const policy=require('../bb-pantry-policy.js'),inventory={ketchup:row('Ketchup',1,'each',{staple:true,stapleStatus:'low'})},before=JSON.stringify(inventory);
 const win={BBPantryPolicy:policy,BBReceiptQuantity:quantity,AbortController,setTimeout,clearTimeout},requests=[];vm.runInNewContext(fs.readFileSync(new URL('../bb-receipt-scanner.js',import.meta.url),'utf8'),{window:win,console,AbortController});
 const scanner=win.BBReceiptScannerFactory({pantryPolicy:true,getKitchen:()=>inventory,getSession:()=>({user:{id:'test-reader-account'},access_token:'test-token'}),getContext:()=>({market:'UK',retailer:'Tesco'}),getCatalog:()=>catalog,preparePhoto:async()=>({mimeType:'image/jpeg',imageBase64:'test-photo'}),fetch:async path=>{
  requests.push(path);const value=path==='/api/receipt-inventory?mode=status'?{ok:true,available:true,premium:true,migrationReady:true}:path==='/api/bb173/status'?{status:'available',premium_ai:true,turnstileRequired:false}:{ok:true,reviewRequired:true,receiptInventory:{currency:'GBP',items:[{description:'KETCHUP 800ML',canonicalKey:'ketchup',classification:'food',quantity:800,unit:'ml',lineTotal:2}]}};
  return {ok:true,json:async()=>value};
 }});
 const scanned=await scanner.readReceipt({file:{},market:'UK',retailer:'Tesco',consent:true}),item=scanned.items[0];
 assert.equal(item.quantity,1);assert.equal(item.unit,'each');assert.equal(item.canonicalKey,'ketchup');assert.match(item._quantitySuggestion.note,/\+1 bottle \(matches your pantry\)/);
 assert.equal(JSON.stringify(inventory),before,'reading and suggesting never credits stock');assert.equal(requests.length,3);
});

test('whole Peppers and explicitly tagged ground pepper containers keep their distinct tracking modes',()=>{
 const whole=normalizePantryState({'pepper|each':2},{produce:row('Peppers',2,'each',{bb173StockKey:'pepper|each'})});
 assert.deepEqual(whole.stock,{'pepper|each':2});assert.notEqual(whole.inventory.produce.staple,true);
 const ground=normalizePantryState({'pepper|each':1},{spice:row('Pepper',1,'each',{staple:true,stapleStatus:'low'})});
 assert.equal(ground.inventory.spice.staple,true);assert.equal(ground.inventory.spice.stapleStatus,'low');
});

test('cloud confirmation sends a canonical measured baseline and merges the reviewed receipt into one physical row',async()=>{
 const actor='policy_cloud_user',STOCK='basketboss_321_v7_measured_pantry',KITCHEN='basketboss_makeameal_v1_inventory',values=new Map([[STOCK,JSON.stringify({'chopped tomatoes|tin':1})],[KITCHEN,JSON.stringify({tin:row('Chopped tomatoes',1,'tin')})]]),writes=[];
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push(key);},removeItem:key=>values.delete(key)},win={localStorage:storage};
 vm.runInNewContext(fs.readFileSync(new URL('../bb-receipt-inventory.js',import.meta.url),'utf8'),{window:win,console});
 let revision=0,serverStock={},receiptId=null;const bodies=[];
 const adapter=win.BBReceiptInventoryFactory({storage,core:Core,pantryPolicy:true,getSession:()=>({user:{id:actor},access_token:'policy-test-token'}),getContext:()=>({market:'UK',retailer:'Tesco',shopSessionId:'trip'}),getCatalog:()=>catalog,createId:()=> 'cloud-id',fetch:async(_path,options)=>{
  const body=options.body&&JSON.parse(options.body);if(body){bodies.push(body);revision++;if(body.action==='confirm_pantry')serverStock={...body.stock};else{serverStock={...body.inventoryBaseline.stock};for(const line of body.lines){const key=line.canonicalKey+'|'+line.unit;serverStock[key]=(serverStock[key]||0)+line.quantity;}receiptId=body.receiptId;}}
  const inventory=Object.entries(serverStock).map(([key,quantity])=>{const at=key.lastIndexOf('|');return {stockKey:key,canonicalKey:key.slice(0,at),unit:key.slice(at+1),quantity,location:'cupboard',revision};});
  return {ok:true,json:async()=>({ok:true,scope:{kind:'user',id:actor},initialized:true,inventoryRevision:revision,receiptRevision:receiptId?revision:null,receiptId,stock:serverStock,inventory,essentials:[],receipts:[],priceObservations:[],pantryReview:{required:false}})};
 }});
 const confirmed=await adapter.confirmPantry({stock:{'chopped tomatoes|tin':1},expectedRevision:0,expectedScope:{kind:'user',id:actor}});assert.equal(confirmed.localApplied,true,confirmed.localError);
 assert.deepEqual(bodies[0].stock,{'chopped tomatoes|g':400});
 const draft=await adapter.normalizeDraft({receiptId:'canonical-cloud-receipt',market:'UK',currency:'GBP',retailer:'Tesco',shopSessionId:'trip',lines:[{id:'tomatoes',name:'Chopped tomatoes',canonicalKey:'chopped tomatoes',classification:'food',quantity:400,unit:'g',pricePaid:1,reviewed:true}]});
 const result=await adapter.commitReviewedReceipt(draft);assert.equal(result.localApplied,true,result.localError);assert.deepEqual(bodies[1].inventoryBaseline.stock,{'chopped tomatoes|g':400});assert.deepEqual(JSON.parse(values.get(STOCK)),{'chopped tomatoes|g':800});
 const active=Object.values(JSON.parse(values.get(KITCHEN))).filter(value=>value.selected);assert.equal(active.length,1);assert.equal(active[0].qty,800);assert.equal(active[0].unit,'g');
});
