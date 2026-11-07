import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Core from '../bb-receipt-inventory-core.mjs';
import {normalizeReceiptLine,prepareReceiptConfirmation,validateReceiptConfirmation,normalizePantryState,normalizeFinishShopCredits,pantryLotMetadata} from '../bb-receipt-inventory-core.mjs';
const require=createRequire(import.meta.url),quantity=require('../bb-receipt-quantity.js');
const catalog={'ketchup|ml':{},'chopped tomatoes|tin':{},'milk|ml':{},'beef mince|g':{},'garlic|clove':{}};
const row=(name,qty,unit,extra={})=>({name,loc:'cupboard',selected:true,qty,unit,bb173StockKey:name.toLowerCase()+'|'+unit,bb173StockValue:qty,...extra});

test('physical partial staple containers retain their exact amount through normalization and reopening',()=>{
 for(const unit of ['each','pack','bottle','jar']){
  const stock={['olive oil|'+unit]:.5},inventory={oil:row('Olive oil',.5,unit,{staple:true,stapleStatus:'in'})};
  const first=normalizePantryState(stock,inventory,{exactConversionsOnly:true,preserveDisplayUnits:true});
  assert.deepEqual(first.stock,{'olive oil|each':.5},unit);assert.equal(first.inventory.oil.qty,.5);assert.equal(first.inventory.oil.stapleCount,.5);assert.deepEqual(first.issues,[]);
  const reopened=normalizePantryState(first.stock,first.inventory,{exactConversionsOnly:true,preserveDisplayUnits:true});
  assert.deepEqual(reopened.stock,first.stock);assert.deepEqual(reopened.inventory,first.inventory);
 }
});
test('reviewed measured spice stock and receipts retain grams while default container purchases stay counted',()=>{
 const name='Black peppercorns',facts={trackingMode:'measured',measurementReviewed:true,staple:false},inventory={spice:row(name,20,'g',facts)};
 const normalized=normalizePantryState({'black peppercorns|g':20},inventory,{exactConversionsOnly:true,preserveDisplayUnits:true});
 assert.deepEqual(normalized.stock,{'black peppercorns|g':20});assert.equal(normalized.inventory.spice.qty,20);assert.equal(normalized.inventory.spice.staple,false);assert.equal(normalized.inventory.spice.trackingMode,'measured');
 assert.deepEqual(normalizePantryState(normalized.stock,normalized.inventory).stock,normalized.stock);
 const receipt={id:'spice',description:name,canonicalKey:'black peppercorns',classification:'food',quantity:20,unit:'g',lineTotal:2,reviewed:true},context={catalog:{'black peppercorns|g':{}},market:'UK',pantryPolicy:true};
 assert.equal(normalizeReceiptLine(receipt,context).unit,'each','unmeasured cupboard mode keeps its existing container policy');
 const measured=normalizeReceiptLine({...receipt,...facts},context);assert.equal(measured.quantity,20);assert.equal(measured.unit,'g');
 const body=prepareReceiptConfirmation({receiptId:'measured-spice-receipt',market:'UK',currency:'GBP',retailer:'Tesco',shopSessionId:'trip',lines:[measured]},{requestId:'measured-spice-request',catalog:context.catalog,pantryPolicy:true});
 assert.equal(body.lines[0].quantity,20);assert.equal(body.lines[0].unit,'g');assert.equal(Object.hasOwn(body.lines[0],'trackingMode'),false,'client mode metadata is not added to the server wire schema');
 const checked=validateReceiptConfirmation({...body,expectedScope:{kind:'user',id:'policy-user'},inventoryBaseline:{stock:{'black peppercorns|g':20},expectedRevision:0,initialize:true}},{catalog:context.catalog});assert.equal(checked.lines[0].quantity,20);
 const unknown=normalizeReceiptLine({...receipt,...facts,quantity:1,unit:'each'},context);assert.ok(unknown.issues.includes('reviewed_weight_or_volume_required'),'a jar count without checked contents cannot become guessed grams');
});
test('ambiguous measured pepper is retained for review and cannot be credited as fresh produce',()=>{
 const facts={trackingMode:'measured',measurementReviewed:true,staple:false},inventory={spice:row('Pepper',20,'g',facts)},stock={'pepper|g':20};
 const kept=normalizePantryState(stock,inventory,{exactConversionsOnly:true});assert.deepEqual(kept.stock,stock);assert.deepEqual(kept.inventory,inventory);assert.equal(kept.issues.length,1);assert.match(kept.issues[0].message,/separately from whole peppers/);
 const line=normalizeReceiptLine({description:'Pepper',canonicalKey:'pepper',classification:'food',quantity:20,unit:'g',lineTotal:2,reviewed:true,...facts},{catalog:{'pepper|g':{}},market:'UK',pantryPolicy:true});assert.ok(line.issues.includes('measured_food_identity_review'));assert.equal(line.quantity,null);
});

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

test('only aliases of the same reduced batch merge while edited details and other batches remain intact',()=>{
 const reduced={version:1,actor:'lot-owner',urgent:true,at:'2026-11-05T12:00:00Z',sources:['purchase:one']};
 const inventory={first:row('Rice',.2,'kg',{loc:'fridge',bbReduced:reduced,notes:'Keep in the blue tub',groupId:'my-grains'}),alias:row('Rice',100,'g',{loc:'fridge',bbReduced:{...reduced},notes:'Keep in the blue tub'}),later:row('Rice',50,'g',{loc:'fridge',bbReduced:{...reduced,at:'2026-11-06T12:00:00Z',sources:['purchase:two']}}),ordinary:row('Rice',75,'g',{loc:'fridge',notes:'For Sunday'})};
 const result=normalizePantryState({'rice|kg':.2,'rice|g':225},inventory);
 assert.deepEqual(result.stock,{'rice|g':425});assert.deepEqual(result.issues,[]);
 assert.equal(Object.values(result.inventory).filter(value=>value.selected).length,3);
 assert.equal(result.inventory.first.qty,300);assert.equal(result.inventory.first.notes,'Keep in the blue tub');assert.equal(result.inventory.first.groupId,'my-grains');
 assert.equal(result.inventory.alias.policyMergedInto,'first');assert.equal(result.inventory.later.qty,50);assert.deepEqual(result.inventory.later.bbReduced.sources,['purchase:two']);
 assert.equal(result.inventory.ordinary.qty,75);assert.equal(result.inventory.ordinary.bbReduced,undefined);assert.equal(result.inventory.ordinary.notes,'For Sunday');
 const again=normalizePantryState(result.stock,result.inventory);assert.deepEqual(again.stock,result.stock);assert.deepEqual(again.inventory,result.inventory);
});

test('ordinary portions with distinct notes or dates retain their own allocations during unrelated normalization',()=>{
 const inventory={old:row('Rice',100,'g',{notes:'Use first',useByISO:'2026-11-07'}),newer:row('Rice',200,'g',{notes:'For next week',useByISO:'2026-11-14'}),milk:row('Milk',1,'l')},stock={'rice|g':300,'milk|l':1};
 const result=normalizePantryState(stock,inventory);assert.deepEqual(result.stock,{'rice|g':300,'milk|ml':1000});assert.deepEqual(result.issues,[]);
 assert.equal(result.inventory.old.qty,100);assert.equal(result.inventory.newer.qty,200);assert.equal(result.inventory.old.notes,'Use first');assert.equal(result.inventory.newer.notes,'For next week');assert.equal(result.inventory.old.useByISO,'2026-11-07');assert.equal(result.inventory.newer.useByISO,'2026-11-14');assert.equal(Object.values(result.inventory).filter(value=>value.selected&&value.name==='Rice').length,2);
 const again=normalizePantryState(result.stock,result.inventory);assert.deepEqual(again.stock,result.stock);assert.deepEqual(again.inventory,result.inventory);
 assert.deepEqual(pantryLotMetadata(inventory.old),{notes:'Use first',useByISO:'2026-11-07'});
 const aliases=normalizePantryState({'rice|kg':.1,'rice|g':200},{kg:row('Rice',.1,'kg',{notes:'Same reserve',lotId:'lot-one',useByISO:'2026-11-14'}),g:row('Rice',200,'g',{notes:'Same reserve',lotId:'lot-one',useByISO:'2026-11-14'})});
 assert.equal(aliases.inventory.kg.qty,300);assert.equal(aliases.inventory.kg.notes,'Same reserve');assert.equal(aliases.inventory.g.selected,false);
});

test('dated and undated ordinary portions remain separate through repeated normalization in either row order',()=>{
 for(const field of ['useByISO','bestBeforeISO','lotId','openedAt','notes','note'])for(const reversed of [false,true]){
  const dated=row('Rice',100,'g',{[field]:field==='lotId'?'older-lot':'2026-11-07'}),undated=row('Rice',300,'g'),inventory=reversed?{undated,dated}:{dated,undated},stock={'rice|g':400};
  const first=normalizePantryState(stock,inventory),again=normalizePantryState(first.stock,first.inventory);
  assert.deepEqual(first.issues,[]);assert.deepEqual(first.stock,stock);assert.equal(first.inventory.dated.qty,100);assert.equal(first.inventory.undated.qty,300);assert.equal(first.inventory.undated[field],undefined);assert.equal(Object.values(first.inventory).filter(value=>value.selected).length,2);
  assert.deepEqual(again.stock,stock);assert.deepEqual(again.inventory,first.inventory);assert.equal(again.inventory.undated[field],undefined);
 }
 const notes={older:row('Rice',100,'g',{notes:'Use first'}),newer:row('Rice',200,'g',{notes:'For next week'}),blank:row('Rice',300,'g')},three=normalizePantryState({'rice|g':600},notes),again=normalizePantryState(three.stock,three.inventory);
 assert.equal(Object.values(three.inventory).filter(value=>value.selected).length,3);assert.equal(three.inventory.blank.qty,300);assert.equal(three.inventory.blank.notes,undefined);assert.deepEqual(again.inventory,three.inventory);
});

test('Finish-only exact conversion mode retains unreviewed estimates while defaults remain unchanged',()=>{
 for(const [name,qty,unit,key]of [['Chopped tomatoes',2,'tin','chopped tomatoes'],['Beef mince',1,'pack','beef mince'],['Carrot',2,'each','carrot']]){
  const stock={[key+'|'+unit]:qty},inventory={food:row(name,qty,unit,{bb173StockKey:key+'|'+unit})},result=normalizePantryState(stock,inventory,{exactConversionsOnly:true,preserveDisplayUnits:true});
  assert.deepEqual(result.stock,stock,name);assert.deepEqual(result.inventory,inventory,name);assert.equal(result.issues[0].estimatedConversion,true,name);
  assert.notDeepEqual(normalizePantryState(stock,inventory).stock,stock,'existing policy estimates remain available outside Finish');
 }
});

test('historical Finish credits move only with exact measurements or reviewed container contents',()=>{
 const id='historical-trip|chopped tomatoes|tin',credits={[id]:{name:'Chopped tomatoes',unit:'tin',qty:2,credited:2,week:'historical-trip',stockBasis:'full-purchase'}},input=JSON.stringify(credits);
 const unreviewed=normalizeFinishShopCredits(credits);assert.deepEqual(unreviewed,credits);assert.equal(unreviewed['historical-trip|chopped tomatoes|g'],undefined,'two unreviewed tins cannot invent an 800 g receipt credit');assert.equal(JSON.stringify(credits),input);
 const inventory={food:row('Chopped tomatoes',2,'tin',{packReviewed:true,packQuantity:300,packUnit:'g'})},reviewed=normalizeFinishShopCredits(credits,{inventory});
 assert.equal(reviewed['historical-trip|chopped tomatoes|g'].policyAvailableCredit,600);assert.equal(reviewed[id].policyCreditMovedTo,'historical-trip|chopped tomatoes|g');assert.deepEqual(normalizeFinishShopCredits(reviewed,{inventory}),reviewed);
 const metric=normalizeFinishShopCredits({'trip|rice|kg':{name:'Rice',unit:'kg',credited:.75,week:'trip'}});assert.equal(metric['trip|rice|g'].policyAvailableCredit,750);assert.equal(metric['trip|rice|kg'].policyCreditMovedTo,'trip|rice|g');
 const counted={'trip|carrot|each':{name:'Carrot',unit:'each',credited:2,week:'trip'}};assert.deepEqual(normalizeFinishShopCredits(counted),counted,'a counted produce purchase is not an exact gram credit');
 const staple=normalizeFinishShopCredits({'trip|ketchup|ml':{name:'Ketchup',unit:'ml',credited:800,week:'trip'}});assert.equal(staple['trip|ketchup|each'].policyAvailableCredit,1,'established staple container tracking remains available');
});

test('Finish-only display preservation keeps exact kilograms, litres and reviewed containers through repeat normalization',()=>{
 for(const config of [
  {name:'Rice',key:'rice',unit:'kg',qty:.5,base:'g',bought:500,expected:1},
  {name:'Milk',key:'milk',unit:'l',qty:1,base:'ml',bought:500,expected:1.5},
  {name:'Chopped tomatoes',key:'chopped tomatoes',unit:'tin',qty:2,base:'g',bought:400,expected:3,extra:{packReviewed:true,packQuantity:400,packUnit:'g'}}
 ]){
  const {name,key,unit,qty,base,bought,expected,extra={}}=config,stock={[key+'|'+unit]:qty,[key+'|'+base]:bought},inventory={original:row(name,qty,unit,{...extra,notes:'Keep my display'}),alias:row(name,bought,base,{notes:'Keep my display'})},options={exactConversionsOnly:true,preserveDisplayUnits:true};
  const result=normalizePantryState(stock,inventory,options);assert.deepEqual(result.issues,[],name);assert.equal(result.inventory.original.unit,unit);assert.equal(result.inventory.original.qty,expected);assert.equal(result.inventory.original.notes,'Keep my display');assert.equal(result.inventory.original.bb173StockKey,key+'|'+base);assert.equal(result.inventory.original.bb173StockValue,result.stock[key+'|'+base]);assert.equal(result.inventory.alias.selected,false);
  const again=normalizePantryState(result.stock,result.inventory,options);assert.deepEqual(again.stock,result.stock);assert.deepEqual(again.inventory,result.inventory);
 }
});

test('unknown or conflicting package contents preserve every saved source for review',()=>{
 const inventory={mystery:row('Rice',2,'bag')},stock={'rice|bag':2},result=normalizePantryState(stock,inventory,{market:'UK'});
 assert.deepEqual(result.stock,stock);assert.deepEqual(result.inventory,inventory);assert.equal(result.issues.length,1);assert.match(result.issues[0].message,/kept.*review/i);
 const conflict={a:row('Beef mince',1,'pack',{packReviewed:true,packQuantity:250,packUnit:'g'}),b:row('Beef mince',1,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'})};
 const second=normalizePantryState({'beef mince|pack':2},conflict,{market:'UK'});assert.deepEqual(second.stock,{'beef mince|pack':2});assert.deepEqual(second.inventory,conflict);assert.match(second.issues[0].message,/disagree/);
});

test('a legacy stock key cannot flatten a meaningful qualifier still present in its linked food name',()=>{
 for(const [name,key]of [['Pasta (gluten-free)','pasta'],['Milk (oat)','milk'],['Rice (cooked)','rice']]){
  const inventory={food:row(name,200,'g',{bb173StockKey:key+'|g',notes:'Keep this food separate'})},stock={[key+'|g']:200};
  const result=normalizePantryState(stock,inventory);assert.deepEqual(result.stock,stock);assert.deepEqual(result.inventory,inventory);assert.equal(result.issues.length,1);assert.equal(result.issues[0].identityConflict,true,name);assert.match(result.issues[0].message,/identity disagree.*kept for review/i);
 }
 const aliases=normalizePantryState({'carrot|g':200},{food:row('Carrots',200,'g',{bb173StockKey:'carrot|g'})});assert.deepEqual(aliases.issues,[]);assert.equal(aliases.inventory.food.qty,200);
 const unnamed=normalizePantryState({'rice|g':200},{food:row('',200,'g',{bb173StockKey:'rice|g'})});assert.deepEqual(unnamed.issues,[]);assert.equal(unnamed.inventory.food.qty,200);
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
 assert.deepEqual(whole.stock,{'pepper|g':320});assert.equal(whole.inventory.produce.qty,320);assert.notEqual(whole.inventory.produce.staple,true);
 const ground=normalizePantryState({'pepper|each':1},{spice:row('Pepper',1,'each',{staple:true,stapleStatus:'low'})});
 assert.equal(ground.inventory.spice.staple,true);assert.equal(ground.inventory.spice.stapleStatus,'low');
});

test('cloud confirmation sends a canonical measured baseline and merges the reviewed receipt into one physical row',async()=>{
 const actor='policy_cloud_user',STOCK='basketboss_321_v7_measured_pantry',KITCHEN='basketboss_makeameal_v1_inventory',values=new Map([[STOCK,JSON.stringify({'chopped tomatoes|tin':1})],[KITCHEN,JSON.stringify({tin:row('Chopped tomatoes',1,'tin',{packReviewed:true,packQuantity:400,packUnit:'g'})})]]),writes=[];
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
