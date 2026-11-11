import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const continuation=require('../bb-shop-continuation.js'),ownership=require('../bb-shop-ownership.js');
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const HOME='basketboss_at_home_requirements_v1',TOKEN='basketboss_cloud_session_v1';
const keys={BB_SHOP_SESSION_V7_KEY:'session',BB_SHOP_ARCHIVE_V7_KEY:'archive',BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_BETA_CHOICE_KEY:'choices',BB_PARTIAL_PURCHASE_KEY:'partials',BB_BETA_RECEIPT_KEY:'receipts',BB307_STOCK_KEY:'stock',BB307_FEATURE_KEY:'features'};
const copy=value=>JSON.parse(JSON.stringify(value));
function actual(name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);
 const lineEnd=html.indexOf('\n',start);if(html.slice(start,lineEnd).endsWith('}'))return html.slice(start,lineEnd);
 const end=html.indexOf('\n}',start);assert.ok(end>start,name);return html.slice(start,end+2);
}
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.disabled=false;this.isConnected=false;this.classList={add(){}};}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);node.connect(this.isConnected);}}
 appendChild(node){this.append(node);}
 connect(value){this.isConnected=value;for(const child of this.children)child.connect(value);}
 remove(){this.connect(false);if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
 setAttribute(key,value){this.attributes[key]=value;}
 removeAttribute(key){delete this.attributes[key];}
 addEventListener(name,handler){this.listeners[name]=handler;}
 focus(){}
 click(){if(!this.disabled)this.onclick?.();}
}
function fixture(){
 const values=new Map(),read=key=>JSON.parse(values.get(key)||'{}'),writes=[],notices=[],ended=[];
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){writes.push(key);values.set(key,String(value));},removeItem:key=>values.delete(key)};
 let actor='alice',next=0;
 const rice={key:'Rice',unit:'g',required:500,pantryUsed:350,toBuy:150};
 const sausages={key:'Pork sausages',unit:'each',required:6,pantryUsed:5,toBuy:1};
 const cleaner={id:'cleaner',name:'Kitchen cleaner',unit:'ml',targetQty:1000,ownedQty:625,pantryUsed:625,qty:375};
 const purchases={'pork sausages|each':{name:'Pork sausages',unit:'each',qty:1,actualQty:6,bbBetaSelectedWeek:'shop-original'}};
 const partials={'shop-original|rice|g':{name:'Rice',unit:'g',bought:50,required:150,week:'shop-original'},'shop-original|ess:cleaner':{name:'Kitchen cleaner',unit:'ml',bought:125,required:375,week:'shop-original'}};
 const session={version:7,id:'shop-original',createdAt:'2026-11-10T12:00:00Z',checkboxUndo:{},purchases,partials,shelfEdits:{
  'rice|g':{kind:'shop-owned-v1',amount:50,essential:false,anchor:rice},
  'pork sausages|each':{kind:'shop-owned-v1',amount:6,essential:false,anchor:sausages},
  'ess:cleaner':{kind:'shop-owned-v1',amount:125,essential:true,anchor:cleaner}
 }};
 const receipts={};
 for(const [id,name,unit,credited]of [['rice|g','Rice','g',50],['pork sausages|each','Pork sausages','each',6],['ess:cleaner','Kitchen cleaner','ml',125]])receipts['shop-original|'+id]={name,unit,credited,qty:credited,week:'shop-original',stockBasis:id.startsWith('ess:')?'household-purchase':'full-purchase'};
 const manual={pending:true,quantity:100,name:'Rice',unit:'g',kind:'food',shopSessionId:'shop-original',boughtAtRequest:50};
 for(const [key,value]of Object.entries({session,archive:{},ticks:{'pork sausages|each':true},purchases,partials,choices:{'pork sausages|each':{mode:'custom',week:'shop-original',qty:1,actualQty:6,unit:'each'}},receipts,
  stock:{'rice|g':400,'pork sausages|each':11,'milk|l':.875},features:{version:1,essentials:[{...cleaner,ownedQty:750}]},
  [TOKEN]:{user:{id:'alice'},access_token:'synthetic-close-token'},
  [HOME]:{version:1,byActor:{alice:{manualBuys:{current:manual,settled:{...manual,pending:false,quantity:0},otherTrip:{...manual,shopSessionId:'shop-elsewhere'}},manualRequests:{original:'preserve-request-intent'}},bob:{manualBuys:{foreign:manual}}}}
 }))storage.setItem(key,JSON.stringify(value));
 const body=new Element('body');body.connect(true);
 const document={body,activeElement:body,createElement:tag=>new Element(tag)};
 const win={localStorage:storage,document,BBShopContinuation:continuation,BBShopOwnership:{...ownership,enabled:()=>true},BBHome:{actor:()=>actor},BBWeeklyShop:{end:id=>ended.push(id)}};
 const ctx=vm.createContext({...keys,window:win,document,localStorage:storage,console:{error(){},warn(){}},bbReceiptHostReady:false,bb307Market:'UK',bb307Stock:read('stock'),bb307FeatureState:read('features'),
  BB307Pantry:{pantryId:(name,unit)=>name.toLowerCase()+'|'+unit},bb307ActiveRetailer:()=> 'Tesco',bb307ReadStock:()=>read('stock'),bb307ReadFeatures:()=>read('features'),
  bb321ReadShopTicks:()=>read('ticks'),bbPartialAll:()=>read('partials'),bbBetaShopWeek:()=>read('session').id,bbShopV7New:()=> 'shop-next-'+(++next),
  bbShopV7Session:()=>read('session'),bb321TinSpec:()=>null,notify:message=>notices.push(message),
  bb172ShopDialogOpen:false,bb172ShopUncheckedRows:()=>[{}, {}, {}, {}],bb172ShopSetActive(){},
  bbBetaPendingBought:()=>[],bbHomePendingHouseholdPurchases:()=>[],bb307ReceiptPriceContext:()=>({shopSessionId:read('session').id}),bb307OpenReceiptPrices(){}
 });
 ctx.bb321WeeklySummary=()=>{
  const current=read('session'),stock=read('stock');
  const items=[{...rice,pantryUsed:Math.min(500,stock['rice|g']),toBuy:Math.max(0,500-stock['rice|g'])},{...sausages,pantryUsed:6,toBuy:0},{key:'Milk',unit:'l',required:2,pantryUsed:.875,toBuy:1.125}];
  const essentials=[{...cleaner,ownedQty:read('features').essentials[0].ownedQty,pantryUsed:read('features').essentials[0].ownedQty,qty:1000-read('features').essentials[0].ownedQty},{id:'unmeasured',name:'Kitchen rolls',unit:'pack'}];
  return {items:ownership.anchor(items,current,{idFor:row=>row.key.toLowerCase()+'|'+row.unit}),essentials:ownership.anchor(essentials,current,{essential:true,idFor:row=>'ess:'+row.id})};
 };
 for(const name of ['bbShopV7Read','bbShopV7Write','bbShopV7Snapshot','bbShopExactQuantity','bbShopPurchasePack','bb84DisplayedPurchase','bbShopNeedPresentation','bbPartialRound','bbPartialKey','bbPartialDetails','bbShopPrepareRemaining','bbShopV7Close','bb172ShopPrompt'])vm.runInContext(actual(name),ctx);
 writes.length=0;
 return {ctx,win,values,storage,read,writes,notices,ended,setActor:value=>{actor=value;},close:transfer=>ctx.bbShopV7Close(transfer),prompt(){ctx.bb172ShopPrompt('finish');const overlay=body.children.at(-1),dialog=overlay.children[0],actions=dialog.children.find(node=>node.className==='bb172-shop-dialog-actions');return {overlay,finish:actions.children[1]};}};
}

test('immediate Finish snapshots the exact unbought remainder and preserves every already deposited purchase',()=>{
 const h=fixture(),stock=h.values.get('stock'),features=h.values.get('features'),receipts=h.values.get('receipts');
 assert.equal(h.close(),true);
 const archived=h.read('archive')['shop-original'],saved=archived.savedRemaining;
 assert.deepEqual(saved.rows,[
  {id:'rice|g',name:'Rice',unit:'g',quantity:100,kind:'food'},
  {id:'milk|l',name:'Milk',unit:'l',quantity:1.125,kind:'food'},
  {id:'ess:cleaner',name:'Kitchen cleaner',unit:'ml',quantity:250,kind:'household'},
  {id:'ess:unmeasured',name:'Kitchen rolls',unit:'pack',quantity:null,quantityNeedsReview:true,kind:'household'}
 ]);
 assert.equal(saved.actorId,'alice');assert.equal(saved.market,'UK');assert.equal(saved.shopSessionId,'shop-original');
 assert.equal(archived.purchases['pork sausages|each'].actualQty,6);assert.equal(archived.bought['pork sausages|each'],true);
 for(const [key,bytes]of [['stock',stock],['features',features],['receipts',receipts]])assert.equal(h.values.get(key),bytes,key+' must not be credited again at Finish');
 for(const key of ['ticks','purchases','choices'])assert.deepEqual(h.read(key),{});
 assert.equal(h.read('session').fromSavedShop,'shop-original');assert.equal(h.read('partials')['shop-original|rice|g'].bought,50);
 assert.deepEqual(h.ended,['shop-original']);
 const pending=continuation.listPending(h.read('archive'),{actor:'alice',market:'UK'});
 assert.deepEqual(pending.map(copy),[saved]);
 assert.deepEqual(continuation.listPending(h.read('archive'),{actor:'bob',market:'UK'}),[]);
 assert.deepEqual(continuation.listPending(h.read('archive'),{actor:'alice',market:'US'}),[]);
});

test('Finish carries only the current actor current-trip manual remainder without changing request history',()=>{
 const h=fixture(),before=copy(h.read(HOME));assert.equal(h.close(),true);
 const after=h.read(HOME),next=h.read('session').id;
 assert.deepEqual(after.byActor.alice.manualBuys.current,{...before.byActor.alice.manualBuys.current,shopSessionId:next,boughtAtRequest:0});
 assert.deepEqual(after.byActor.alice.manualBuys.settled,before.byActor.alice.manualBuys.settled);
 assert.deepEqual(after.byActor.alice.manualBuys.otherTrip,before.byActor.alice.manualBuys.otherTrip);
 assert.deepEqual(after.byActor.alice.manualRequests,before.byActor.alice.manualRequests);assert.deepEqual(after.byActor.bob,before.byActor.bob);
 const prepared=copy(h.ctx.bbShopPrepareRemaining(h.read('session')));
 assert.equal(prepared.ok,true);assert.equal(prepared.snapshot.rows.find(row=>row.id==='rice|g').quantity,100,'the prior trip partial must not be subtracted from the new physical balance twice');
 assert.equal(prepared.snapshot.rows.find(row=>row.id==='ess:cleaner').quantity,250);
});

for(const failKey of [HOME,'archive','session','ticks','purchases','choices'])test('failed '+failKey+' write rolls back the remainder, manual buys and trip together for retry',()=>{
 const h=fixture(),before=new Map(h.values),put=h.storage.setItem;let fail=true;
 h.storage.setItem=(key,value)=>{if(fail&&key===failKey){fail=false;throw Error('synthetic quota failure');}put(key,value);};
 assert.equal(h.close(),false);assert.deepEqual(h.values,before);assert.deepEqual(h.ended,[]);
 assert.equal(h.close(),true);assert.equal(h.read('archive')['shop-original'].savedRemaining.rows[0].quantity,100);
 assert.equal(h.read(HOME).byActor.alice.manualBuys.current.shopSessionId,h.read('session').id);assert.deepEqual(h.ended,['shop-original']);
});

test('invalid saved remainder data rejects Finish without clearing the trip or changing stock',()=>{
 const h=fixture(),summary=h.ctx.bb321WeeklySummary;
 h.ctx.bb321WeeklySummary=()=>({...summary(),essentials:[{id:'invalid',name:'',unit:'pack',qty:1}]});
 const before=new Map(h.values);assert.equal(h.close(),false);assert.deepEqual(h.values,before);assert.deepEqual(h.ended,[]);
 assert.ok(h.notices.some(message=>/review/i.test(message)));
});

test('an immediate Finish with an uncredited skipped purchase preserves all progress for review',()=>{
 const h=fixture(),before=new Map(h.values);
 assert.equal(h.close({count:0,skipped:1,shopSessionId:'shop-original'}),false);
 assert.deepEqual(h.values,before);assert.deepEqual(h.ended,[]);
});

test('legacy Finish keeps its established handling of skipped purchase transfers',()=>{
 const h=fixture();h.win.BBShopOwnership={...ownership,enabled:()=>false};
 assert.equal(h.close({count:0,skipped:1,shopSessionId:'shop-original'}),true);
 assert.equal(h.read('archive')['shop-original'].savedRemaining,undefined);
 assert.deepEqual(h.ended,['shop-original']);
});

test('corrupt or non-object archived history is preserved byte for byte when Finish is rejected',()=>{
 for(const bytes of ['{broken','null','[]','true','123','"archive"']){
  const h=fixture();h.values.set('archive',bytes);const before=new Map(h.values);
  assert.equal(h.close(),false,bytes);assert.deepEqual(h.values,before,bytes);assert.deepEqual(h.ended,[]);
 }
});

test('a completed continuation settles the prior pending snapshot only for the same actor and market',()=>{
 for(const scope of [{actorId:'alice',market:'UK',expected:'continued'},{actorId:'bob',market:'UK',expected:'pending'},{actorId:'alice',market:'US',expected:'pending'}]){
  const h=fixture(),session=h.read('session');session.fromSavedShop='shop-previous';h.storage.setItem('session',JSON.stringify(session));
  h.storage.setItem('archive',JSON.stringify({'shop-previous':{version:7,id:'shop-previous',savedRemaining:{version:1,status:'pending',actorId:scope.actorId,market:scope.market}}}));
  assert.equal(h.close(),true);assert.equal(h.read('archive')['shop-previous'].savedRemaining.status,scope.expected);
 }
});

for(const [name,change]of [
 ['actor',h=>h.setActor('bob')],['market',h=>{h.ctx.bb307Market='US';}],
 ['token',h=>h.storage.setItem(TOKEN,JSON.stringify({user:{id:'alice'},access_token:'another-synthetic-token'}))],
 ['active trip',h=>h.storage.setItem('session',JSON.stringify({...h.read('session'),id:'shop-newer'}))]
])test('a Finish dialog opened before the '+name+' changes cannot archive its stale remainder',()=>{
 const h=fixture(),dialog=h.prompt();change(h);const before=new Map(h.values);dialog.finish.click();
 assert.deepEqual(h.values,before);assert.deepEqual(h.ended,[]);assert.equal(dialog.overlay.isConnected,false);
 assert.ok(h.notices.some(message=>/account or shop changed/i.test(message)));
});

test('a detached immediate Finish confirmation cannot rotate the trip twice',()=>{
 const h=fixture(),dialog=h.prompt();dialog.finish.click();const after=new Map(h.values);dialog.finish.onclick();
 assert.deepEqual(h.values,after);assert.deepEqual(h.ended,['shop-original']);
});
