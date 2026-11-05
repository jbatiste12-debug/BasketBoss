import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const api=createRequire(import.meta.url)('../bb-reduced-purchases.js'),html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const section=(from,to)=>{const start=html.indexOf(from);assert.ok(start>=0);const end=html.indexOf(to,start);assert.ok(end>start);return html.slice(start,end);};
const keys={BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_PARTIAL_PURCHASE_KEY:'partials',BB_BETA_CHOICE_KEY:'choices',BB_SHOP_SESSION_V7_KEY:'session',BB_SHOP_ARCHIVE_V7_KEY:'archives',BB307_STOCK_KEY:'stock',BB307_FEATURE_KEY:'features'};
const now=Date.parse('2026-11-05T12:00:00Z'),context={actor:'alice',market:'UK'},id='rice|g';
function fixture(){
 const saved=new Map(),storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value)),removeItem:key=>saved.delete(key)},read=key=>JSON.parse(saved.get(key)||'{}');
 for(const [key,value]of Object.entries({session:{version:7,id:'shop-main',checkboxUndo:{}},ticks:{},purchases:{},partials:{},choices:{},archives:{},features:{essentials:[]},stock:{}}))storage.setItem(key,JSON.stringify(value));
 let baseline=2,next=0;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const win={BBReducedPurchases:api,BBHome:{actor:()=>context.actor},BBHomeHost:{reload(){}}};
 const scope={...keys,window:win,localStorage:storage,console,Date:Clock,bb307Market:'UK',bb307FeatureState:read('features'),bbReceiptHostReady:false,
  bb15Quote:item=>({amount:Math.ceil((item.toBuy-1e-10)/500)*baseline,packQty:500,packUnit:'g',shelfPrice:baseline}),
  bbShopV7Read:read,bbShopV7Session:()=>read('session'),bbShopV7New:()=> 'shop-next-'+ ++next,
  bb321ReadShopTicks:()=>read('ticks'),bb84ReadPurchased:()=>read('purchases'),bbPartialAll:()=>read('partials'),bbBetaPurchaseChoices:()=>read('choices'),bbPartialKey:item=>'shop-main|'+item.id,
  bb84DisplayedPurchase:(_item,qty)=>qty,bb84DetailFor:item=>({name:item.key||item.name,unit:item.unit}),bb172Aisle:()=> 'Cupboard / Pantry'};
 vm.createContext(scope);
 vm.runInContext(section('function bbReducedContext(', 'function bbReducedPrepareQuickPurchase('),scope);
 vm.runInContext(section('function bb84SetPrimaryPurchase(', 'function bb84ExtraNeeded('),scope);
 vm.runInContext(section('function bbShopV7Write(', 'function bbShopV7Session('),scope);
 vm.runInContext(section('function bbShopV7Close(', 'function bbShopV7Reconcile('),scope);
 return {scope,storage,read,saved,baseline:value=>{baseline=value;},buy:quantity=>scope.bb84SetPrimaryPurchase(id,true,{key:'Rice',unit:'g',toBuy:quantity}),undo:()=>scope.bb84SetPrimaryPurchase(id,false,{key:'Rice',unit:'g',toBuy:500}),close:()=>scope.bbShopV7Close(),budget:total=>api.budget({total,session:read('session'),archives:read('archives'),context,progress:{ticks:read('ticks'),purchases:read('purchases'),partials:read('partials')},quote:(_line,q)=>({amount:Math.ceil((q-1e-10)/500)*baseline}),now})};
}
test('the actual checkbox and Finish archive retain ordinary spend after pantry reduces the next shortfall',()=>{
 const h=fixture();assert.equal(h.buy(500),true);assert.equal(h.read('session').reducedPurchases['cost:'+id].pricePaid,2);
 assert.equal(h.close(),true);assert.equal(h.budget(2).total,4,'£2 already bought plus £2 still to buy');
 assert.equal(Object.keys(h.read('archives')['shop-main'].reducedPurchases).length,1);
 assert.equal(api.stockCredits(h.read('archives')['shop-main'],context).length,0,'normal purchases cannot become Use soon');
});
test('undoing the actual purchase checkbox removes its ordinary cost before Finish',()=>{
 const h=fixture();assert.equal(h.buy(500),true);assert.equal(h.undo(),true);assert.equal(Object.keys(h.read('session').reducedPurchases).length,0);
 assert.equal(h.close(),true);assert.equal(h.budget(2).total,2);
});
test('more than twenty finished shops cannot erase money spent in the current week',()=>{
 const h=fixture();for(let trip=0;trip<25;trip++){assert.equal(h.buy(500),true);assert.equal(h.close(),true);}
 assert.equal(Object.keys(h.read('archives')).length,25);
 assert.equal(h.budget(0).total,50,'all twenty-five £2 purchases remain in the calendar-week total');
});
test('editing a saved baseline after buying does not rewrite the trip estimate',()=>{
 const h=fixture();assert.equal(h.buy(500),true);h.baseline(5);assert.equal(h.close(),true);
 assert.equal(h.read('archives')['shop-main'].reducedPurchases['cost:'+id].pricePaid,2);assert.equal(h.budget(5).total,7);
});
test('household purchase snapshots price the bought amount without repricing its weekly target',()=>{
 const h=fixture();h.scope.bb307FeatureState.essentials=[{id:'soap',name:'Soap',unit:'g',targetQty:1000,ownedQty:0,estimatedPackPrice:3}];
 const before=JSON.stringify(h.scope.bb307FeatureState),session={version:7,id:'shop-main',bought:{'ess:soap':true},purchases:{'ess:soap':{name:'Soap',unit:'g',qty:500,actualQty:500,bbBetaSelectedWeek:'shop-main'}},partials:{}};
 const result=h.scope.bbPurchaseCostsForSnapshot(session);assert.equal(result.reducedPurchases['cost:ess:soap'].pricePaid,2);assert.equal(JSON.stringify(h.scope.bb307FeatureState),before);
});
test('ordinary spending next to a partial reduced purchase survives the actual Finish snapshot',()=>{
 const h=fixture();const value=api.put(h.read('session'),{...context,id,purchaseId:id,shopSessionId:'shop-main',name:'Rice',unit:'g',quantity:500,pricePaid:1,at:now});h.storage.setItem('session',JSON.stringify(value));
 assert.equal(h.buy(1000),true);assert.equal(h.close(),true);assert.equal(h.budget(0).total,3,'500g reduced £1 plus 500g ordinary £2');
});
