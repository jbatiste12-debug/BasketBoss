import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),quantity=require('../bb-receipt-quantity.js');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function actual(name){const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);const lineEnd=html.indexOf('\n',start);if(html.slice(start,lineEnd).endsWith('}'))return html.slice(start,lineEnd);const end=html.indexOf('\n}',start);assert.ok(end>start,name);return html.slice(start,end+2);}
const copy=value=>JSON.parse(JSON.stringify(value));
const keys={BB83_KITCHEN_INVENTORY:'inventory',BB307_STOCK_KEY:'stock',BB83_SHOP_STOCK_LEDGER:'legacy',BB_BETA_RECEIPT_KEY:'receipts',BB_BETA_CHOICE_KEY:'choices',BB_PARTIAL_PURCHASE_KEY:'partials',BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_SHOP_SESSION_V7_KEY:'session',BB307_FEATURE_KEY:'features'};
class Element{
 constructor(tag,cl='',text=''){this.tagName=tag;this.className=cl;this.ownText=text;this.children=[];this.attributes={};this.value='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(key,value){this.attributes[key]=String(value);}
 focus(){}
 get textContent(){return this.ownText+this.children.map(node=>node.textContent).join('');}
 set textContent(value){this.ownText=String(value);this.children=[];}
 all(tag){return this.children.flatMap(node=>[...(node.tagName===tag?[node]:[]),...node.all(tag)]);}
}
function fixture({name='Rice',unit='g',needed=400,aisle='Cupboard / Pantry',household=false}={}){
 const values=new Map(),read=key=>JSON.parse(values.get(key)||'{}'),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const id=household?'ess:cleaner':name.toLowerCase()+'|'+unit,item={id,name,unit,aisle,checked:false,basketItem:{key:name,name,unit,toBuy:needed}};
 for(const [key,value]of Object.entries({session:{version:7,id:'shop-test',checkboxUndo:{}},stock:{},inventory:{},receipts:{},ticks:{},purchases:{},choices:{},partials:{},features:{version:1,essentials:household?[{id:'cleaner',name,unit,qty:needed,targetQty:needed,ownedQty:0,selected:true}]:[]},basketboss_cloud_session_v1:{user:{id:'tester'}}}))storage.setItem(key,JSON.stringify(value));
 const win={BBReceiptQuantity:quantity,BBHome:{shoppingBuys:()=>[],completionChanges:()=>({})},BBHomeHost:{reload(){}},localStorage:storage};
 const ctx=vm.createContext({...keys,window:win,localStorage:storage,console:{error(){},warn(){}},BBPriceV19:{canonical:value=>value.toLowerCase()},BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit,pantryName:name=>name.toLowerCase(),normaliseStock:copy},bb307Market:'UK',bb307Stock:{},bb307FeatureState:read('features'),
  bb83ReadObject:read,bb321ReadShopTicks:()=>read('ticks'),bb84ReadPurchased:()=>read('purchases'),bbBetaPurchaseChoices:()=>read('choices'),bbPartialAll:()=>read('partials'),bbShopV7Session:()=>read('session'),bbBetaShopWeek:()=>read('session').id,bbBetaReceiptRead:()=>read('receipts'),bbBetaReceiptId:id=>read('session').id+'|'+id,
  bb172Aisle:()=>aisle,bbBetaDryVolumeUnit:()=>false,bbBetaPackSpec:()=>({size:500,review:false}),bbBetaAutomaticPack:()=>null,bb321TinSpec:()=>null,bb307ReadStock:()=>read('stock'),bb307ReadFeatures:()=>read('features'),bb83StockLoc:()=>household?'cupboard':'fridge',bb83KitchenName:name=>name.toLowerCase(),bbHomePhysicalStock:()=>read('stock'),
  bb321WeeklySummary:()=>({items:household?[]:[item.basketItem],essentials:household?[{id:'cleaner',name,unit,qty:needed}]:[]}),
  bb83BoughtCandidates:()=>Object.entries(read('purchases')).filter(([id])=>!id.startsWith('ess:')&&read('ticks')[id]).map(([id,row])=>({id,...row})),bb307Plan:()=>({items:[]}),render(){},bb172StorefrontRefresh(){},notify(){},
  bb172StorefrontEl:(tag,cl,text)=>new Element(tag,cl,text),bb172StorefrontButton:(text,cl,fn)=>Object.assign(new Element('button',cl,text),{click:fn})});
 for(const name of ['bbShopV7Write','bb84DetailFor','bb84DisplayedPurchase','bb84SavedPurchased','bb84RecordExtra','bb84SetPrimaryPurchase','bbBetaReceiptCandidate','bbBetaChoiceInfo','bbBetaChoiceSurplus','bbBetaPendingPartials','bbBetaPendingBought','bbBetaIsPerishable','bbPartialRound','bbPartialKey','bbPartialDetails','bbPartialSet','bbBetaShopChoiceRow','bbHomePendingHouseholdPurchases','bb83TransferBought'])vm.runInContext(actual(name),ctx);
 return {values,read,storage,ctx,win,item,id,amount:total=>ctx.bbPartialSet({...item,checked:!!read('ticks')[id]},total),check:on=>ctx.bb84SetPrimaryPurchase(id,on,item.basketItem,household),pending:()=>copy(ctx.bbBetaPendingBought()),finish:()=>copy(ctx.bb83TransferBought()),drawer:()=>ctx.bbBetaShopChoiceRow({...item,checked:!!read('ticks')[id]})};
}

test('one checkbox tap confirms the displayed amount directly and unticking preserves the prior partial purchase',()=>{
 const h=fixture();assert.equal(h.amount(100),true);assert.equal(h.check(true),true);assert.equal(h.read('ticks')[h.id],true);assert.equal(h.read('purchases')[h.id].qty,400);assert.equal(h.read('choices')[h.id].mode,'exact');assert.deepEqual(h.read('stock'),{});
 assert.equal(h.check(false),true);assert.deepEqual(h.read('choices'),{});assert.equal(h.read('partials')['shop-test|'+h.id].bought,100);
});
test('different amount below the shortfall stays To buy, updates a total rather than incrementing it, and Finish credits it once',()=>{
 const h=fixture();assert.equal(h.amount(150),true);assert.equal(h.amount(150),true);assert.equal(h.read('ticks')[h.id],undefined);assert.equal(h.read('partials')['shop-test|'+h.id].bought,150);assert.equal(h.ctx.bbPartialDetails(h.item).remaining,250);assert.equal(h.pending()[0].qty,150);
 assert.equal(h.finish().count,1);assert.equal(h.read('stock')['rice|g'],150);assert.equal(h.finish().count,0);assert.equal(h.read('stock')['rice|g'],150);
});
test('checkbox records the displayed tin or loaf while keeping an exact gram label exact',()=>{
 for(const [name,needed,already,unit,actualBought]of [['Chopped tomatoes',200,0,'g',400],['Chopped tomatoes',350,150,'g',550],['Rice',400,0,'g',400],['Bread',3,0,'each',18]]){
  const h=fixture({name,needed,unit});vm.runInContext(actual('bb321TinSpec'),h.ctx);if(already)h.amount(already);assert.equal(h.check(true),true);assert.equal(h.read('purchases')[h.id].actualQty,actualBought);assert.equal(h.ctx.bb84SavedPurchased(h.id),actualBought);assert.equal(h.finish().count,1);assert.equal(h.read('stock')[name.toLowerCase()+'|'+unit],actualBought);
 }
 const h=fixture({name:'Chopped tomatoes',needed:200});vm.runInContext(actual('bb321TinSpec'),h.ctx);h.ctx.bb307Market='US';h.check(true);assert.equal(h.read('purchases')[h.id].actualQty,200,'US label shows customary weight, not a rounded UK tin');
});
test('actual surplus survives plan expansion and selecting a further amount records a new exact total',()=>{
 const h=fixture({name:'Chopped tomatoes',needed:200});vm.runInContext(actual('bb321TinSpec'),h.ctx);h.check(true);assert.equal(h.ctx.bb84SavedPurchased(h.id),400);vm.runInContext(actual('bbShopV7Reconcile'),h.ctx);h.ctx.bbShopV7Read=h.read;
 assert.equal(h.ctx.bbShopV7Reconcile([{key:'Chopped tomatoes',unit:'g',toBuy:300}],[]),true);assert.equal(h.read('ticks')[h.id],true);assert.equal(h.ctx.bb84SavedPurchased(h.id),400);
 assert.equal(h.ctx.bbShopV7Reconcile([{key:'Chopped tomatoes',unit:'g',toBuy:500}],[]),true);assert.equal(h.read('ticks')[h.id],undefined);assert.equal(h.read('partials')['shop-test|'+h.id].bought,400,'real pack amount becomes the partial against the larger need');
});
test('entering a larger measured pack records all purchased fresh food and transfers the full amount once',()=>{
 const h=fixture({name:'Chicken thighs',needed:600,aisle:'Meat & Fish'});assert.equal(h.amount(1000),true);assert.equal(h.read('purchases')[h.id].qty,600);assert.equal(h.read('choices')[h.id].actualQty,1000);assert.equal(h.read('choices')[h.id].keep,true);
 assert.equal(h.finish().count,1);assert.equal(h.read('stock')['chicken thighs|g'],1000);assert.equal(h.finish().count,0);assert.equal(h.amount(1500),false,'processed purchase cannot be edited or credited twice');
});
test('editing a fully bought row down to a partial or zero corrects its bought state without losing other purchases',()=>{
 const h=fixture();h.check(true);h.storage.setItem('purchases',JSON.stringify({...h.read('purchases'),'milk|ml':{qty:500,unit:'ml'}}));h.amount(50);assert.equal(h.read('ticks')[h.id],undefined);assert.equal(h.ctx.bbPartialDetails(h.item).remaining,350);assert.equal(h.read('purchases')['milk|ml'].qty,500);
 h.amount(0);assert.equal(h.read('partials')['shop-test|'+h.id],undefined);assert.equal(h.pending().length,0);
});
test('invalid, fractional discrete, and incompatible corrections preserve the saved purchase',()=>{
 const h=fixture({name:'Eggs',unit:'each',needed:6});h.amount(2);const before=[...h.values];for(const amount of [-1,NaN,Infinity,1000001,1.5])assert.equal(h.amount(amount),false);assert.deepEqual([...h.values],before);
 h.storage.setItem('partials',JSON.stringify({['shop-test|'+h.id]:{bought:100,unit:'g'}}));const changed=[...h.values];assert.equal(h.amount(2),false);assert.deepEqual([...h.values],changed);
});
test('failure writing the purchase rolls ticks, quantities, choices and session back together',()=>{
 const h=fixture(),before=new Map(h.values),put=h.storage.setItem;let fail=true;h.storage.setItem=(key,value)=>{if(fail&&key==='purchases'){fail=false;throw Error('quota');}put(key,value);};assert.equal(h.amount(700),false);assert.deepEqual(h.values,before);assert.deepEqual(h.read('stock'),{});assert.equal(h.amount(700),true);
});
test('household partial and larger actual purchase amounts credit separate essentials balances',()=>{
 for(const [needed,bought]of [[1000,375],[375,750]]){
  const h=fixture({name:'Kitchen cleaner',unit:'ml',needed,aisle:'Household & Other',household:true});assert.equal(h.amount(bought),true);assert.equal(h.ctx.bbHomePendingHouseholdPurchases()[0].quantity,bought);const result=h.finish();assert.equal(result.count,1,JSON.stringify({needed,bought,result,features:h.read('features')}));assert.equal(h.read('features').essentials[0].ownedQty,bought);assert.deepEqual(h.read('stock'),{});assert.equal(h.finish().count,0);
 }
});
test('drawer shows a single custom amount input only after the explicit action, including existing partial total',()=>{
 const h=fixture();h.amount(150);const drawer=h.drawer();assert.equal(drawer.all('input').length,0);assert.deepEqual(drawer.all('button').map(x=>x.textContent),['Enter different amount','Already have enough']);drawer.all('button')[0].click();assert.equal(drawer.all('input').length,1);assert.equal(drawer.all('input')[0].value,'150');assert.equal(drawer.all('input')[0].min,'0');assert.doesNotMatch(drawer.textContent,/standard pack|provisional|Record amount|Bought part|Finish shopping to add/i);
 drawer.all('input')[0].value='250';drawer.all('button').find(x=>x.textContent==='Save amount').click();assert.equal(h.ctx.bbPartialDetails(h.item).remaining,150);
});
test('an already open amount drawer cannot write into another account or another shopping trip',()=>{
 for(const mode of ['account','trip']){
  const h=fixture(),drawer=h.drawer();drawer.all('button')[0].click();const input=drawer.all('input')[0];input.value='500';if(mode==='account')h.storage.setItem('basketboss_cloud_session_v1',JSON.stringify({user:{id:'other'}}));else h.storage.setItem('session',JSON.stringify({...h.read('session'),id:'shop-other'}));const before=[...h.values];drawer.all('button').find(x=>x.textContent==='Save amount').click();assert.deepEqual([...h.values],before);assert.match(drawer.textContent,/Shopping changed/);
 }
});
