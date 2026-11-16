import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),value=require('../bb-shop-value.js');
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
const pin={actor:'alice',market:'UK',retailer:'Tesco',sessionId:'shop-one',planKey:'original-meals'};
const session=()=>({version:7,id:'shop-one',bought:{},purchases:{},partials:{},shelfEdits:{}});
const row=(name,required,owned,extra={})=>({key:name,unit:'g',required,owned,measured:true,...extra});
const canonicalId=item=>(item.key||item.name).toLowerCase()+'|'+item.unit;
const packQuote=(_,quantity)=>({amount:Math.ceil(quantity/500)*2,costBasis:'full_packs'});
const input=(rows,extra={})=>({session:session(),context:pin,rows,quote:packQuote,canonicalId,...extra});
function actual(name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);
 const lineEnd=html.indexOf('\n',start);if(html.slice(start,lineEnd).endsWith('}'))return html.slice(start,lineEnd);
 const end=html.indexOf('\n}',start);assert.ok(end>start,name);return html.slice(start,end+2);
}

test('fully covered ingredients and partial stock are counted separately using pack differences',()=>{
 const result=value.prepare(input([row('Rice',600,600),row('Pasta',600,100)]));
 assert.equal(result.coveredCount,1);assert.equal(result.partialCount,1);
 assert.equal(result.estimatedAvoided,6);assert.equal(result.pricedCount,2);
});
test('partial grams that still need the same pack do not manufacture savings',()=>{
 const result=value.prepare(input([row('Rice',400,100)]));
 assert.equal(result.partialCount,1);assert.equal(result.estimatedAvoided,0);
});
test('uncertain, unmeasured, manual, staple and mismatched ownership are excluded',()=>{
 for(const unsafe of [{measured:false},{essential:true},{staple:true},{assumed:true},{manual:true},{needsReview:true},{quantityEstimated:true},{pantryMismatch:['unknown unit']},{bb172Assumed:true},{needsRecipeReview:true},{shopOwnedAnchor:true}])assert.equal(value.prepare(input([row('Rice',500,500,unsafe)])),null,JSON.stringify(unsafe));
 assert.equal(value.prepare(input([row('water',500,500)])),null);
 assert.equal(value.prepare(input([row('Rice',500,0)])),null);
});
test('unknown prices retain truthful coverage counts without a pound claim',()=>{
 const result=value.prepare(input([row('Rice',500,500)],{quote:()=>({amount:null})}));
 assert.equal(result.coveredCount,1);assert.equal(result.pricedCount,0);
 assert.equal(result.unknownPriceCount,1);assert.equal(result.estimatedAvoided,0);
});
test('exact canonical aliases count once while distinct cuts remain separate',()=>{
 const id=item=>(item.key==='Sausages'?'pork sausages':item.key.toLowerCase())+'|'+item.unit;
 const result=value.prepare(input([row('Sausages',6,6,{unit:'each'}),row('Pork sausages',6,6,{unit:'each'}),row('Chicken breast',500,500),row('Chicken thighs',500,500)],{canonicalId:id}));
 assert.equal(result.coveredCount,3);assert.equal(result.estimatedAvoided,6);
});
test('conflicting canonical duplicates and invalid quote bases are withheld safely',()=>{
 assert.equal(value.prepare(input([row('Rice',500,500),row('Rice',600,600)])),null);
 for(const quote of [()=>({amount:-1}),()=>({amount:2,costBasis:'portion'}),(_,quantity)=>({amount:quantity===500?1:5})]){
  const result=value.prepare(input([row('Rice',500,100)],{quote}));
  assert.equal(result.estimatedAvoided,0);assert.equal(result.unknownPriceCount,1);
 }
});
test('captured pre-purchase coverage cannot inflate after ticks or receipt credits',()=>{
 const controller=value.create(),before=controller.capture(input([row('Rice',1000,500)]));
 controller.capture(input([row('Rice',1000,1500)],{session:{...session(),purchases:{rice:{qty:1000}}}}));
 assert.deepEqual(controller.preview(pin),before);assert.equal(before.partialCount,1);assert.equal(before.estimatedAvoided,2);
});
test('actor, market, store, session and plan changes invalidate the comparison',()=>{
 const controller=value.create();controller.capture(input([row('Rice',500,500)]));
 for(const change of [{actor:'bob'},{market:'US'},{retailer:'Waitrose'},{sessionId:'shop-two'},{planKey:'new-meals'}])assert.equal(controller.preview({...pin,...change}),null);
 assert.equal(controller.capture(input([row('Rice',1000,1000)],{context:{...pin,planKey:'new-meals'}})),null,'a changed plan cannot rewrite this trip baseline');
});
test('current purchases and receipts prevent retrospective claims but closed-trip partials do not',()=>{
 for(const changed of [{bought:{rice:true}},{purchases:{rice:{qty:500}}},{partials:{'shop-one|rice|g':{week:'shop-one',bought:1}}},{shelfEdits:{rice:{kind:'shop-owned-v1'}}},{completedPurchases:{rice:{}}},{reducedPurchases:{rice:{}}}])assert.equal(value.prepare(input([row('Rice',500,500)],{session:{...session(),...changed}})),null);
 assert.equal(value.prepare(input([row('Rice',500,500)],{hasPurchases:true})),null);
 const old={...session(),partials:{'shop-before|rice|g':{week:'shop-before',bought:50}}};
 assert.equal(value.prepare(input([row('Rice',500,500)],{session:old})).coveredCount,1);
});
test('Finish is one-shot and a fresh controller after reload cannot invent a baseline',()=>{
 const controller=value.create();controller.capture(input([row('Rice',500,500)]));
 assert.equal(controller.complete(pin).coveredCount,1);assert.equal(controller.complete(pin),null);
 assert.equal(controller.capture(input([row('Rice',500,500)])),null);
 assert.equal(value.create().complete(pin),null);
});
test('real regional pack guides use full packs and withhold prices marked for review',()=>{
 const context=vm.createContext({});
 for(const name of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),context);
 const engine=context.BBPriceV19;
 for(const market of ['UK','Guernsey','Jersey','US']){
  const retailer=market==='US'?'Walmart':'Tesco';
  const quote=(item,quantity)=>engine.price({name:item.key,unit:item.unit,quantity,market,retailer});
  const required=engine.price({name:'chicken breast',unit:'g',quantity:1500,market,retailer});
  const remaining=engine.price({name:'chicken breast',unit:'g',quantity:500,market,retailer});
  const result=value.prepare(input([row('chicken breast',1500,1000)],{context:{...pin,market},quote}));
  if(required.needsReview||remaining.needsReview){assert.equal(result.estimatedAvoided,0,market);assert.equal(result.unknownPriceCount,1,market);}
  else{assert.ok(result.estimatedAvoided>0,market);assert.equal(result.estimatedAvoided,Math.round((required.amount-remaining.amount)*100)/100,market);}
 }
});

const keys={BB_SHOP_SESSION_V7_KEY:'session',BB_SHOP_ARCHIVE_V7_KEY:'archive',BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_BETA_CHOICE_KEY:'choices',BB_PARTIAL_PURCHASE_KEY:'partials',BB_BETA_RECEIPT_KEY:'receipts',BB307_STOCK_KEY:'stock',BB307_FEATURE_KEY:'features'};
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.isConnected=false;this.classList={add(){}};}
 connect(on){this.isConnected=on;for(const child of this.children)child.connect(on);}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);node.connect(this.isConnected);}}
 appendChild(node){this.append(node);}
 insertBefore(node){node.parent=this;this.children.unshift(node);node.connect(this.isConnected);}
 remove(){this.connect(false);if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
 get firstChild(){return this.children[0]||null;}
 setAttribute(key,value){this.attributes[key]=value;}
 removeAttribute(key){delete this.attributes[key];}
 addEventListener(name,listener){this.listeners[name]=listener;}
 focus(){}
 click(){if(!this.disabled)this.onclick?.();}
}
function fixture(){
 const values=new Map(),read=key=>JSON.parse(values.get(key)||'{}'),notices=[],shown=[],ended=[],events={};let failArchive=false,actor='alice',market='UK',retailer='Tesco',planKey='original-meals',next=0,stock=500;
 const storage={getItem:key=>values.get(key)??null,setItem(key,bytes){if(failArchive&&key==='archive')throw Error('full');values.set(key,String(bytes));},removeItem:key=>values.delete(key)};
 for(const [key,data]of Object.entries({session:session(),archive:{},ticks:{},purchases:{},choices:{},partials:{},receipts:{},features:{}}))storage.setItem(key,JSON.stringify(data));
 const body=new Element('body');body.connect(true);const app=new Element('main');app.id='app';body.append(app);
 const find=(node,id)=>node.id===id?node:node.children.map(child=>find(child,id)).find(Boolean);
 const document={body,activeElement:body,createElement:tag=>new Element(tag),getElementById:id=>find(body,id)};
 const win={document,localStorage:storage,BBShopValue:{...value,mount(summary,options){shown.push(copy(summary));return value.mount(summary,options);}},BBRecipeCanonical:{},BBHome:{actor:()=>actor,completionChanges:()=>({})},BBWeeklyShop:{end:id=>ended.push(id)},BBShopOwnership:{enabled:()=>false},addEventListener(name,listener){events[name]=listener;}};
 const ctx=vm.createContext({...keys,window:win,document,localStorage:storage,console:{error(){},warn(){}},bbReceiptHostReady:false,bb307Market:market,bb307ActiveRetailer:()=>retailer,
  bbHomeCanonicalRecipeNeeds:()=>[{key:'Rice',unit:'g',required:1000,planKey}],bb321LunchboxRequirements:()=>[],BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit},
  bbShopV7Session:()=>read('session'),bb307Plan:()=>({items:[{key:'Rice',unit:'g',required:1000,pantryUsed:stock,toBuy:Math.max(0,1000-stock)}]}),bb321UnifiedShop:items=>items,
  bbHomePhysicalStock:()=>({'rice|g':stock}),bbPantryReconcileStock:()=>({pantry:{'rice|g':stock},estimates:{},mismatches:{}}),bb15Quote:item=>packQuote(item,item.toBuy),bb83ReadObject:read,bbReceiptPantryReviewRequired:()=>false,
  bb172ShopDialogOpen:false,bb172ShopUncheckedRows:()=>[],bbBetaPendingBought:()=>[],bbHomePendingHouseholdPurchases:()=>[],bb172ShopSetActive(){},bbShopV7New:()=> 'shop-next-'+(++next),bbBetaShopWeek:()=>read('session').id,
  bb307ReceiptPriceContext:()=>({sessionId:read('session').id}),bb307OpenReceiptPrices:()=>notices.push('receipt-opened'),notify:message=>notices.push(message),
  bb321ReadShopTicks:()=>read('ticks'),bb84ReadPurchased:()=>read('purchases'),bbPartialAll:()=>read('partials'),bbBetaPurchaseChoices:()=>read('choices'),bbPartialKey:item=>read('session').id+'|'+item.id,
  bbShopNeedPresentation:item=>({targetQuantity:item.toBuy}),bb84DisplayedPurchase:(_,qty)=>qty,bb84DetailFor:item=>({name:item.key,unit:item.unit}),bb172Aisle:()=> 'Cupboard / Pantry'
 });
 for(const name of ['bbShopV7Read','bbShopV7Write','bbShopV7Snapshot','bbShopV7Close','bbShopValueContext','bbShopValueCapture','bbShopValueFinishPin','bbShopValueAfterFinish','bb84SetPrimaryPurchase','bb172ShopPrompt'])vm.runInContext(actual(name),ctx);
 vm.runInContext('var bbShopValueController;',ctx);
 return {ctx,values,read,storage,shown,ended,notices,events,app,setStock:n=>{stock=n;},failArchive:on=>{failArchive=on;},setActor:id=>{actor=id;},setMarket:name=>{market=name;ctx.bb307Market=name;},setStore:name=>{retailer=name;},setPlan:n=>{planKey=n;ctx.bbHomeCanonicalRecipeNeeds=()=>[{key:'Rice',unit:'g',required:n,needsReview:false}];},capture:()=>ctx.bbShopValueCapture(),
  prompt(kind='finish'){ctx.bb172ShopPrompt(kind);const overlay=document.getElementById('bb172ShopConfirm'),dialog=overlay.children[0],buttons=dialog.children.find(node=>node.className==='bb172-shop-dialog-actions');return {overlay,finish:buttons.children[1],scan:buttons.children[2],stay:buttons.children[0]};}};
}
test('actual capture reads measured physical stock and excludes reconciliation assumptions',()=>{
 const h=fixture();h.ctx.bbPantryReconcileStock=()=>({pantry:{'rice|g':500},estimates:{'rice|g':{assumptions:['approximate scoop']}},mismatches:{}});
 h.capture();assert.equal(h.ctx.bbShopValueFinishPin(),null);
 const fresh=fixture();fresh.storage.setItem('receipts',JSON.stringify({'receipt-other-id':{week:'shop-one',credited:500}}));fresh.capture();assert.equal(fresh.ctx.bbShopValueFinishPin(),null);
});
test('the actual purchase handler captures coverage before recording a new bought quantity',()=>{
 const h=fixture();assert.equal(h.ctx.bb84SetPrimaryPurchase('rice|g',true,{key:'Rice',unit:'g',toBuy:500}),true);
 assert.equal(h.read('purchases')['rice|g'].qty,500);h.setStock(1000);
 h.capture();const note=h.ctx.bbShopValueFinishPin();assert.ok(note);h.ctx.bbShopValueAfterFinish(note);
 assert.equal(h.shown[0].partialCount,1);assert.equal(h.shown[0].coveredCount,0);assert.equal(h.shown[0].estimatedAvoided,2);
});
test('explicit Finish durably archives before showing a value note and cannot settle twice',()=>{
 const h=fixture();h.capture();const dialog=h.prompt();dialog.finish.click();
 assert.ok(h.read('archive')['shop-one']);assert.equal(h.read('session').id,'shop-next-1');assert.equal(h.shown.length,1);assert.deepEqual(h.ended,['shop-one']);
 dialog.finish.click();assert.equal(h.shown.length,1);assert.equal(Object.keys(h.read('archive')).length,1);
});
test('failed archive preserves the baseline for retry and generic close never shows a value note',()=>{
 const h=fixture();h.capture();const dialog=h.prompt();h.failArchive(true);dialog.finish.click();
 assert.equal(h.read('session').id,'shop-one');assert.equal(h.shown.length,0);assert.equal(dialog.overlay.isConnected,true);
 h.failArchive(false);dialog.finish.click();assert.equal(h.shown.length,1);
 const generic=fixture();generic.capture();assert.equal(generic.ctx.bbShopV7Close(),true);assert.equal(generic.shown.length,0,'Clear week/restore/next week uses the unchanged generic writer');
});
test('Finish and scan receipt shows coverage once after its successful archive',()=>{
 const h=fixture();h.capture();h.prompt().scan.click();assert.equal(h.shown.length,1);assert.ok(h.notices.includes('receipt-opened'));assert.ok(h.read('archive')['shop-one']);
});
test('plan, account, market and retailer changes suppress the old note',()=>{
 for(const change of [h=>h.setActor('bob'),h=>h.setMarket('US'),h=>h.setStore('Waitrose'),h=>h.setPlan(1500)]){
  const h=fixture();h.capture();const saved=h.ctx.bbShopValueFinishPin();assert.ok(saved);change(h);h.ctx.bbShopValueAfterFinish(saved);assert.equal(h.shown.length,0);
 }
});
test('the value card hides unknown money, uses safe text and remains dismissible',()=>{
 const h=fixture(),summary=value.prepare(input([row('Rice',500,500)],{quote:()=>({amount:null})}));
 const card=value.mount(summary,{document:h.ctx.document,parent:h.app});assert.ok(card);const lines=node=>[node.textContent||'',...node.children.flatMap(lines)];
 const text=lines(card).join(' ');assert.match(text,/already covered 1 planned ingredient/);assert.doesNotMatch(text,/[£$]/);assert.match(text,/No reliable price/);assert.match(text,/Actual checkout prices may vary/);
 card.children[0].children[1].listeners.click();assert.equal(card.isConnected,false);
});
