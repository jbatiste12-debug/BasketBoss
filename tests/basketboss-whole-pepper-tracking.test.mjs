import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as core from '../bb-receipt-inventory-core.mjs';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),recipe=require('../bb-recipe-canonical.js'),quantities=require('../bb-receipt-quantity.js');
const catalog={'pepper|each':{},'black pepper|g':{}},row=(name,qty,unit,extra={})=>({name,qty,unit,selected:true,loc:'fridge',bb173StockKey:'pepper|'+unit,bb173StockValue:qty,...extra});

test('whole pepper context is distinct from culinary spice and count-to-weight is explicit',()=>{
 for(const name of ['Peppers','PEPPERS400G','Bell pepper','Red pepper','Capsicum'])assert.equal(policy.isWholePepper(name,'g'),true,name);
 for(const name of ['Ground pepper','Black pepper','White pepper','Red pepper flakes','Peppercorn sauce'])assert.equal(policy.isWholePepper(name,'each'),false,name);
 assert.equal(policy.isWholePepper('Pepper','each',{staple:true}),false);
 assert.equal(policy.isWholePepper('Pepper','g',{staple:false}),true);
 assert.equal(policy.normalize('pepper',2,'each',{wholePepper:true}).quantity,320);
 assert.equal(policy.normalize('pepper',2,'each').unit,'each','ambiguous legacy identity alone cannot invent a food weight');
});

test('receipt review keeps measured whole peppers and converts spice purchases to their container',()=>{
 for(const [name,quantity,unit,expected,base]of [['PEPPERS 400G',400,'g',400,'g'],['Peppers',2,'each',320,'g'],['Ground Pepper',50,'g',1,'each']]){
  const input={description:name,canonicalKey:'pepper',classification:'food',quantity,unit,reviewed:true};
  const line=core.normalizeReceiptLine(input,{catalog,market:'UK',pantryPolicy:true});
  assert.equal(line.quantity,expected,name);assert.equal(line.unit,base,name);assert.deepEqual(line.issues,[]);
  const inferred=quantities.infer(input,{pantryPolicy:true,market:'UK',catalog});assert.equal(inferred.quantity,expected,name);assert.equal(inferred.unit,base,name);
 }
});

test('whole pepper grams and known counts normalize without becoming spice jars',()=>{
 const measured=core.normalizePantryState({'pepper|g':400},{food:row('Peppers',400,'g')});
 assert.deepEqual(measured.stock,{'pepper|g':400});assert.equal(measured.inventory.food.staple,false);assert.equal(measured.inventory.food.qty,400);
 const counted=core.normalizePantryState({'pepper|each':2},{food:row('Peppers',2,'each')});
 assert.deepEqual(counted.stock,{'pepper|g':320});assert.equal(counted.inventory.food.staple,false);assert.equal(counted.inventory.food.unit,'g');
 assert.equal(core.normalizePantryState(counted.stock,counted.inventory).inventory.food.staple,false,'repeated normalization keeps its food identity');
 const spice=core.normalizePantryState({'pepper|each':1},{spice:row('Ground pepper',1,'each',{loc:'cupboard',staple:true,stapleStatus:'in'})});
 assert.deepEqual(spice.stock,{'pepper|each':1});assert.equal(spice.inventory.spice.staple,true);
});

test('ambiguous legacy pepper quantities remain intact for review',()=>{
 const inventory={food:row('Peppers',2,'each'),spice:row('Ground pepper',1,'each',{loc:'cupboard',staple:true})};
 const mixed=core.normalizePantryState({'pepper|each':3},inventory);
 assert.deepEqual(mixed.stock,{'pepper|each':3});assert.deepEqual(mixed.inventory,inventory);assert.match(mixed.issues[0].message,/share this saved balance/);
 const unclassified=core.normalizePantryState({'pepper|each':1},{});
 assert.deepEqual(unclassified.stock,{'pepper|each':1});assert.match(unclassified.issues[0].message,/kept for review/);
});

test('recipe aggregation preserves whole food grams alongside the spice-container reminder',()=>{
 const rows=[{name:'Peppers',key:'pepper',required:400,unit:'g'},{name:'Peppers',key:'pepper',required:2,unit:'each'},{name:'Pepper',key:'pepper',required:1,unit:'tsp'}];
 const grouped=recipe.aggregate(rows);assert.equal(grouped.length,2);
 const food=grouped.find(value=>value.staple!==true),spice=grouped.find(value=>value.staple===true);
 assert.equal(food.unit,'g');assert.equal(food.required,720);assert.equal(food.pendingSources.length,0);
 assert.equal(spice.unit,'each');assert.equal(spice.required,1);
});

test('Finish shop pepper credits keep grams and migrate known whole-count proof to matching grams',()=>{
 const credits={'trip-a|pepper|g':{name:'pepper',unit:'g',week:'trip-a',credited:400},'trip-b|pepper|each':{name:'Peppers',unit:'each',week:'trip-b',credited:2}};
 const normalized=core.normalizeFinishShopCredits(credits);
 assert.equal(normalized['trip-a|pepper|g'].credited,400);assert.equal(normalized['trip-a|pepper|each'],undefined);
 assert.equal(normalized['trip-b|pepper|g'].policyAvailableCredit,320);
 assert.equal(normalized['trip-b|pepper|each'].policyCreditMovedTo,'trip-b|pepper|g');
});

test('known In stock containers cover Low containers elsewhere, while explicit unknown stays reviewable',()=>{
 const inventory={low:{name:'Ketchup',selected:true,qty:1,unit:'each',loc:'cupboard',bb173StockKey:'ketchup|each',bb173StockValue:1,staple:true,stapleStatus:'low'},in:{name:'Ketchup',selected:true,qty:1,unit:'each',loc:'fridge',bb173StockKey:'ketchup|each',bb173StockValue:1,staple:true,stapleStatus:'in'}};
 const normalized=core.normalizePantryState({'ketchup|each':2},inventory);
 assert.equal(normalized.inventory.low.stapleStatus,'in');assert.equal(normalized.inventory.in.stapleStatus,'in');
 assert.equal(policy.stapleStatus({qty:1,stapleStatus:'unknown'}),'unknown');
 const unknown=core.normalizePantryState({'pepper|each':1},{spice:row('Pepper',1,'each',{staple:true,stapleStatus:'unknown'})});
 assert.equal(unknown.inventory.spice.stapleStatus,'unknown');assert.equal(unknown.inventory.spice.qty,1);
});

test('the cloud receipt adapter retains separate whole-food and spice-container balances',async()=>{
 const actor='00000000-0000-4000-8000-000000000077',data=new Map(),stock={},receipts=new Map();let revision=0;
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
 const scope={kind:'user',id:actor},snapshot=extra=>({ok:true,initialized:revision>0,scope,inventoryRevision:revision,stock:{...stock},inventory:Object.entries(stock).map(([stockKey,quantity])=>{const [canonicalKey,unit]=stockKey.split('|');return {stockKey,canonicalKey,unit,quantity,location:'fridge',revision};}),essentials:[],priceObservations:[],receipts:[...receipts.values()],...extra});
 const win={localStorage:storage,BBPantryPolicy:policy};
 vm.runInNewContext(fs.readFileSync(new URL('../bb-receipt-inventory.js',import.meta.url),'utf8'),{window:win,console,AbortController,setTimeout,clearTimeout});
 const adapter=win.BBReceiptInventoryFactory({storage,core,pantryPolicy:true,getCatalog:()=>catalog,getSession:()=>({access_token:'synthetic',user:{id:actor}}),getContext:()=>({market:'UK',retailer:'Tesco',shopSessionId:'pepper-trip'}),fetch:async(_url,options)=>{
  if(options.method==='GET')return {ok:true,json:async()=>snapshot()};
  const body=core.validateReceiptConfirmation(JSON.parse(options.body),{catalog});
  for(const key of Object.keys(stock))delete stock[key];Object.assign(stock,body.inventoryBaseline.stock);
  for(const line of body.lines)stock[line.canonicalKey+'|'+line.unit]=(stock[line.canonicalKey+'|'+line.unit]||0)+line.quantity;
  revision++;receipts.set(body.receiptId,{receiptId:body.receiptId,confirmedAt:'2026-11-05T12:00:00Z',foodSubtotal:2,essentialsSubtotal:0,adjustmentTotal:0});
  return {ok:true,json:async()=>snapshot({receiptId:body.receiptId,receiptRevision:revision})};
 }});
 for(const [receiptId,name,quantity]of [['food-pepper','Peppers',400],['spice-pepper','Ground pepper',50]]){
  const draft=await adapter.normalizeDraft({receiptId,currency:'GBP',retailer:'Tesco',shopSessionId:'pepper-trip',items:[{name,canonicalKey:'pepper',classification:'food',quantity,unit:'g',reviewed:true,lineTotal:2}]});
  draft.lines[0].reviewed=true;
  const result=await adapter.commitReviewedReceipt(draft);assert.equal(result.ok,true);assert.equal(result.localApplied,true,result.localError);
 }
 assert.deepEqual(JSON.parse(storage.getItem('basketboss_321_v7_measured_pantry')),{'pepper|g':400,'pepper|each':1});
 const inventory=Object.values(JSON.parse(storage.getItem('basketboss_makeameal_v1_inventory'))).filter(row=>row.selected);
 assert.equal(inventory.find(row=>row.unit==='g').staple,false);assert.equal(inventory.find(row=>row.unit==='each').staple,true);
 await adapter.synchronize();assert.deepEqual(JSON.parse(storage.getItem('basketboss_321_v7_measured_pantry')),{'pepper|g':400,'pepper|each':1});
});
