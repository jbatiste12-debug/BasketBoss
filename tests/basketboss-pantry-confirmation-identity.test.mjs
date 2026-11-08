import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as Core from '../bb-receipt-inventory-core.mjs';

const require=createRequire(import.meta.url),{install}=require('../bb-home.js'),reducedStock=require('../bb-reduced-stock.js');
const source=fs.readFileSync(process.env.BB_RECEIPT_IDENTITY_SOURCE||new URL('../bb-receipt-inventory.js',import.meta.url),'utf8');
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const KEYS={stock:'basketboss_321_v7_measured_pantry',kitchen:'basketboss_makeameal_v1_inventory',owner:'basketboss_receipt_projection_owner_v1',session:'basketboss_cloud_session_v1'};
const scope={kind:'user',id:ACTOR},cacheKey=value=>'basketboss_receipt_inventory_v1:'+ACTOR+':'+value.kind+':'+value.id;
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>String(value).trim().toLowerCase();
const row=(name,quantity,unit,extra={})=>({name,selected:true,loc:'cupboard',qty:quantity,unit,bb173StockKey:canonical(name)+'|g',bb173StockValue:quantity*(unit==='kg'?1000:1),...extra});

function fixture({stock={'rice|g':1000},kitchen={rice:row('Rice',1,'kg')},owner=true,serverScope=scope,confirmStock,mutateResponse,afterPost,tracking=true}={}){
 const values=new Map([[KEYS.stock,JSON.stringify(stock)],[KEYS.kitchen,JSON.stringify(kitchen)],[KEYS.session,JSON.stringify({user:{id:ACTOR},access_token:'original-token'})]]),writes=[],posts=[],settlements=[],projections=[];
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push(key);},removeItem:key=>{values.delete(key);writes.push(key);}};
 let revision=1,serverStock=clone(stock),session={user:{id:ACTOR},access_token:'original-token'},context={market:'UK',retailer:'Tesco',shopSessionId:'shop-current'};
 if(owner)values.set(KEYS.owner,JSON.stringify(typeof owner==='object'?owner:{version:1,actorId:ACTOR,cacheKey:cacheKey(scope),scope,initialized:true,inventoryRevision:revision,serverStock:Core.normalizeStockMap(stock)}));
 const snapshot=()=>({ok:true,initialized:true,inventoryRevision:revision,scope:clone(serverScope),stock:clone(serverStock),inventory:Object.entries(Core.normalizeStockMap(serverStock)).map(([stockKey,quantity])=>({stockKey,canonicalKey:stockKey.slice(0,stockKey.lastIndexOf('|')),unit:stockKey.slice(stockKey.lastIndexOf('|')+1),quantity,location:'cupboard',revision})),essentials:[],priceObservations:[],receipts:[],pantryReview:{required:false}});
 const fetch=async(url,options)=>{
  assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,'Bearer '+session.access_token);
  let receipt=null;
  if(options.method==='POST'){
   const body=JSON.parse(options.body);posts.push(body);
   if(body.action==='confirm_pantry'){assert.equal(body.expectedRevision,revision);serverStock=clone(confirmStock===undefined?body.stock:confirmStock);}
   else{
    receipt=Core.validateReceiptConfirmation(body,{catalog:{'rice|g':{}}});assert.equal(receipt.inventoryBaseline.expectedRevision,revision);serverStock=clone(receipt.inventoryBaseline.stock);
    if(receipt.addToPantry!==false)for(const line of receipt.lines.filter(value=>value.kind==='food'))serverStock[line.canonicalKey+'|'+line.unit]=(serverStock[line.canonicalKey+'|'+line.unit]||0)+line.quantity;
   }
   revision++;afterPost?.({values,storage,setSession:value=>{session=value;},setContext:value=>{context=value;}});
  }
  const response={...snapshot(),...(receipt?{receiptId:receipt.receiptId,receiptRevision:revision,duplicate:false}:{})};mutateResponse?.(response);
  return {ok:true,status:200,json:async()=>clone(response)};
 };
 const root={localStorage:storage,document:{},location:{search:''},BBReducedStock:{...reducedStock,settleInventory(value){settlements.push(clone(value));return reducedStock.settleInventory(value);}}};
 vm.runInNewContext(source,{window:root,URL,Date,console});
 const adapter=root.BBReceiptInventoryFactory({core:Core,storage,fetch,getSession:()=>session,getContext:()=>context,canonicalize:canonical,getCatalog:()=>({'rice|g':{},'bread|each':{},'milk|ml':{}}),pantryPolicy:tracking,onProjection:value=>projections.push(value)});
 const confirm=async(next=readStock())=>adapter.confirmPantry({stock:next,expectedRevision:revision,expectedScope:serverScope,shopSessionId:'shop-current'});
 const readStock=()=>JSON.parse(storage.getItem(KEYS.stock)||'{}'),readKitchen=()=>JSON.parse(storage.getItem(KEYS.kitchen)||'{}');
 return {root,adapter,storage,values,writes,posts,settlements,projections,confirm,readStock,readKitchen,setServerStock:value=>{serverStock=clone(value);revision++;},revision:()=>revision};
}

test('same-scope acknowledgement preserves exact Kitchen units, split lots, zero rows and metadata while advancing server state',async()=>{
 const reduced={version:1,actor:ACTOR,urgent:false,at:'2026-11-08T09:00:00Z',sources:['receipt:earlier:rice']};
 const kitchen={older:row('Rice',.3,'kg',{loc:'fridge',notes:'Use first',useByISO:'2026-11-09',lotId:'lot-one'}),later:row('Rice',700,'g',{loc:'freezer',bbReduced:reduced,packReviewed:true,packQuantity:500,packUnit:'g'}),empty:row('Bread',0,'g',{selected:true,note:'Keep this jar',bb173StockKey:'bread|g',bb173StockValue:0})};
 const h=fixture({kitchen}),before=h.storage.getItem(KEYS.kitchen),owner=JSON.parse(h.storage.getItem(KEYS.owner));
 const result=await h.confirm();assert.equal(result.localApplied,true);assert.equal(h.storage.getItem(KEYS.kitchen),before);assert.equal(h.settlements.length,0);assert.deepEqual(h.readStock(),{'rice|g':1000});
 const nextOwner=JSON.parse(h.storage.getItem(KEYS.owner));assert.equal(nextOwner.inventoryRevision,owner.inventoryRevision+1);assert.deepEqual(nextOwner.serverStock,{'rice|g':1000});assert.equal(h.adapter.getCachedProjection().inventoryRevision,nextOwner.inventoryRevision);assert.equal(h.projections.length,1);assert.deepEqual(clone(h.projections[0].inventory),kitchen);assert.equal(h.posts.length,1);
});

test('a depleted physical map retains its zero Kitchen allocation instead of removing undo metadata',async()=>{
 const kitchen={rice:row('Rice',0,'kg',{bb173StockValue:0,selected:true,notes:'My original bag'})},h=fixture({stock:{},kitchen}),before=h.storage.getItem(KEYS.kitchen);
 assert.equal((await h.confirm()).localApplied,true);assert.equal(h.storage.getItem(KEYS.kitchen),before);assert.deepEqual(h.readStock(),{});assert.equal(h.readKitchen().rice.selected,true);assert.equal(h.readKitchen().rice.bb173StockKey,'rice|g');
});

test('decimal equality uses exact quantities and a real small delta still projects',async()=>{
 for(const amount of [1e-9,.1+.2,1/3]){
  const h=fixture({stock:{'rice|g':amount},kitchen:{rice:row('Rice',amount/1000,'kg')},tracking:false}),before=h.storage.getItem(KEYS.kitchen);
  assert.equal((await h.confirm()).localApplied,true);assert.equal(h.storage.getItem(KEYS.kitchen),before);assert.equal(h.readStock()['rice|g'],amount);
 }
 const amount=.1+.2,next=amount+1e-9,h=fixture({stock:{'rice|g':amount},kitchen:{rice:row('Rice',amount/1000,'kg')},confirmStock:{'rice|g':next},tracking:false});
 assert.equal((await h.confirm()).localApplied,true);assert.equal(h.readStock()['rice|g'],next);assert.equal(h.readKitchen().rice.unit,'g');assert.equal(h.readKitchen().rice.qty,next);assert.equal(h.settlements.length,1);
 const rounded=fixture({stock:{'rice|g':amount},kitchen:{rice:row('Rice',amount/1000,'kg')}});assert.equal((await rounded.confirm()).localApplied,true);assert.equal(rounded.readStock()['rice|g'],.3);assert.equal(rounded.readKitchen().rice.unit,'g','policy normalization changing exact bytes must not pass the preservation guard');
});

test('changed confirmations and authoritative remote refreshes keep the existing projection path',async()=>{
 const h=fixture();assert.equal((await h.confirm({'rice|g':600})).localApplied,true);assert.deepEqual(h.readStock(),{'rice|g':600});assert.equal(h.readKitchen().rice.unit,'g');assert.equal(h.readKitchen().rice.qty,600);assert.equal(h.settlements.length,1);
 h.setServerStock({'rice|g':450});assert.equal((await h.adapter.synchronize()).localApplied,true);assert.deepEqual(h.readStock(),{'rice|g':450});assert.equal(h.readKitchen().rice.qty,450);assert.equal(h.settlements.length,2);
});

test('GET refreshes and receipt imports keep projecting even when physical stock is unchanged',async()=>{
 const get=fixture();assert.equal((await get.adapter.synchronize()).localApplied,true);assert.equal(get.readKitchen().rice.unit,'g');assert.equal(get.settlements.length,1);
 for(const addToPantry of [false,true]){
  const h=fixture(),draft=await h.adapter.normalizeDraft({receiptId:'receipt-identity-'+addToPantry,market:'UK',currency:'GBP',retailer:'Tesco',shopSessionId:'shop-current',addToPantry,lines:[{id:'rice-line',description:'Rice',canonicalKey:'rice',classification:'food',quantity:100,unit:'g',lineTotal:1,reviewed:true}]});
  const result=await h.adapter.commitReviewedReceipt(draft,{idempotencyKey:'identity-request-'+addToPantry});assert.equal(result.localApplied,true,result.localError);assert.equal(h.readKitchen().rice.unit,'g');assert.equal(h.readStock()['rice|g'],addToPantry?1100:1000);assert.equal(h.settlements.length,1);assert.equal(h.posts[0].action,'confirm_receipt');
 }
});

test('first-owner and explicit household-scope adoption do not bypass projection even at equal balances',async()=>{
 for(const config of [{owner:false},{serverScope:{kind:'household',id:'household_00001'}}]){
  const h=fixture(config);assert.equal((await h.confirm()).localApplied,true);assert.equal(h.readKitchen().rice.unit,'g');assert.equal(h.readKitchen().rice.receiptActorId,ACTOR);assert.equal(h.settlements.length,1);assert.deepEqual(JSON.parse(h.storage.getItem(KEYS.owner)).scope,config.serverScope||scope);
 }
});

test('raw stock aliases and explicit zero keys require projection rather than preserving mismatched representations',async()=>{
 for(const stock of [{'rice|kg':1},{'Rice|g':1000},{'rice|g':1000,'bread|g':0}]){
  const h=fixture({stock});assert.equal((await h.confirm()).localApplied,true);assert.deepEqual(h.readStock(),{'rice|g':1000});assert.equal(h.readKitchen().rice.unit,'g');assert.equal(h.settlements.length,1);
 }
});

test('unchanged acknowledgements still validate malformed inventory and stale revisions before any local write',async()=>{
 for(const mutateResponse of [response=>{response.inventory[0].quantity=999;},response=>{response.inventory[0].location='garage';},response=>{response.inventoryRevision=0;},response=>{response.inventory={};}]){
  const h=fixture({mutateResponse}),before=[...h.values];const result=await h.confirm();assert.equal(result.localApplied,false);assert.equal(result.syncRequired,true);assert.deepEqual([...h.values],before);assert.equal(h.writes.length,0);assert.equal(h.projections.length,0);
 }
});

test('another owner, changed account, refreshed token and changed context cannot apply an acknowledgement',async()=>{
 const wrongOwner={version:1,actorId:OTHER,cacheKey:'basketboss_receipt_inventory_v1:'+OTHER+':user:'+OTHER,scope:{kind:'user',id:OTHER},inventoryRevision:1,serverStock:{'rice|g':1000}};
 const owner=fixture({owner:wrongOwner}),before=[...owner.values];const rejected=await owner.confirm();assert.equal(rejected.localApplied,false);assert.match(rejected.localError,/other_account/);assert.deepEqual([...owner.values],before);
 for(const identity of [{user:{id:OTHER},access_token:'other-token'},{user:{id:ACTOR},access_token:'refreshed-token'}]){
  const h=fixture({afterPost:({setSession})=>setSession(identity)}),saved=[...h.values];const result=await h.confirm();assert.equal(result.localApplied,false);assert.equal(result.syncRequired,true);assert.deepEqual([...h.values],saved);assert.equal(h.writes.length,0);
 }
 const context=fixture({afterPost:({setContext})=>setContext({market:'UK',retailer:'Aldi',shopSessionId:'shop-current'})}),saved=[...context.values];const result=await context.confirm();assert.equal(result.localApplied,false);assert.equal(result.syncRequired,true);assert.deepEqual([...context.values],saved);assert.equal(context.writes.length,0);
});

test('actual Day done and online acknowledgement preserve a reversible Kitchen allocation, earlier Cook and later purchases',async()=>{
 const h=fixture({stock:{'rice|g':1000},kitchen:{rice:row('Rice',1,'kg',{notes:'Original bag'})}});
 const contexts=[{kind:'dinner',recipeId:'dinner',name:'Dinner',day:'Monday',factor:1,occurrence:'week|dinner|Monday',ingredients:[{key:'rice',unit:'g',required:200}]},{kind:'breakfast',recipeId:'breakfast',name:'Breakfast',day:'Monday',factor:1,occurrence:'week|breakfast|Monday',ingredients:[{key:'rice',unit:'g',required:300}]}];
 h.root.BBHomeHost={id:(name,unit)=>canonical(name)+'|'+unit,keys:()=>({stock:KEYS.stock,inventory:KEYS.kitchen}),stock:h.readStock,dayMeals:()=>contexts,recipeIngredients:(id,factor)=>contexts.find(item=>item.recipeId===id)?.ingredients.map(item=>({...item,required:item.required*factor})),occurrence:(id,day,kind='dinner')=>contexts.find(item=>item.recipeId===id&&item.day===day&&item.kind===kind)?.occurrence,completionKeys:()=>[],household:()=>[],requirements:()=>[],refresh(){},notify(){}};
 h.root.BBReceiptHost={canConsumePantry:()=>true,hasPendingConfirmation:()=>false,requiresPantryReview:()=>false,async confirmCookedPantry({stock}){const result=await h.confirm(stock);return {...result,ok:result.localApplied===true};}};
 const home=install(h.root),dinner=contexts[0];h.root.BBHome=home;
 assert.equal((await home.cooked({sessionId:'earlier-cook',recipeId:dinner.recipeId,day:'Monday',kind:'dinner',factor:1,actorId:ACTOR,occurrence:dinner.occurrence})).ok,true);assert.equal(h.readKitchen().rice.unit,'kg');assert.equal(h.readKitchen().rice.qty,.8);
 const preview=home.previewDay({day:'Monday',actorId:ACTOR});assert.equal((await home.finishDay({day:'Monday',actorId:ACTOR,expected:preview.fingerprint})).ok,true);assert.deepEqual(h.readStock(),{'rice|g':500});assert.equal(h.readKitchen().rice.unit,'kg');assert.equal(h.readKitchen().rice.qty,.5);
 h.storage.setItem(KEYS.stock,JSON.stringify({'rice|g':600}));const kitchen=h.readKitchen();kitchen.rice.qty=.6;kitchen.rice.bb173StockValue=600;h.storage.setItem(KEYS.kitchen,JSON.stringify(kitchen));
 const undo=home.previewUndoDay({day:'Monday',actorId:ACTOR});assert.equal(undo.ok,true,undo.message);const result=await home.undoDay({day:'Monday',actorId:ACTOR,expected:undo.fingerprint});assert.equal(result.ok,true,result.message);
 assert.deepEqual(h.readStock(),{'rice|g':900});assert.equal(h.readKitchen().rice.unit,'kg');assert.ok(Math.abs(h.readKitchen().rice.qty-.9)<1e-12);assert.equal(h.readKitchen().rice.notes,'Original bag');assert.equal(home.isCooked(dinner.occurrence),true);assert.equal(home.isCooked(contexts[1].occurrence),false);assert.equal(result.remainingConfirmedCount,1);
});
