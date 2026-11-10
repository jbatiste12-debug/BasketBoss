import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizePantryState} from '../bb-receipt-inventory-core.mjs';

const readSource=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html=readSource('index.html'),copy=value=>JSON.parse(JSON.stringify(value));
const section=(start,end)=>{const at=html.indexOf(start),to=html.indexOf(end,at);assert.ok(at>=0&&to>at,start);return html.slice(at,to);};
const keys={BB307_STOCK_KEY:'stock',BB83_KITCHEN_INVENTORY:'inventory',BB83_SHOP_STOCK_LEDGER:'legacy',BB321_SHOP_TICKS_KEY:'ticks',BB84_PURCHASED_KEY:'purchases',BB_PARTIAL_PURCHASE_KEY:'partials',BB_BETA_CHOICE_KEY:'choices',BB_BETA_RECEIPT_KEY:'receipts',BB_SHOP_SESSION_V7_KEY:'session',BB_SHOP_ARCHIVE_V7_KEY:'archives',BB307_FEATURE_KEY:'features'};
const row=(name,qty,unit='g',extra={})=>({name,qty,unit,loc:'cupboard',selected:true,bb173StockKey:name.toLowerCase()+'|'+unit,bb173StockValue:qty,...extra});
function fixture(stock={},inventory={}){
 const values=new Map(),get=key=>JSON.parse(values.get(key)||'{}');
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 for(const [key,value]of Object.entries({stock,inventory,ticks:{},purchases:{},partials:{},choices:{},receipts:{},archives:{},features:{essentials:[]},session:{version:7,id:'shop-smart-test',checkboxUndo:{},shelfEdits:{}},usualPrices:{rice:{price:2,packQuantity:1000,unit:'g'}}}))storage.setItem(key,JSON.stringify(value));
 const ctx={...keys,console,localStorage:storage,BB_WHOLE_PRODUCE_GRAMS:{},bb307Market:'UK',bbReceiptHostReady:false,bbBetaReceiptConstantsReady:true,bb307FeatureState:get('features'),bb307Stock:copy(stock),BBPantryNormalize:normalizePantryState,
  BBHome:{actor:()=> 'guest',shoppingBuys:()=>[]},bb307ActiveRetailer:()=> 'Tesco',bb307Plan:()=>({items:[]}),bb321WeeklySummary:()=>({items:[],essentials:[]}),bb172Aisle:item=>/frozen/i.test(item.key)?'Frozen':/milk|cream|cod|haddock|meat|beef|chicken|pork/i.test(item.key)?'Dairy':'Cupboard / Pantry',
  bb83ReadObject:get,bbBetaReceiptRead:()=>get('receipts'),bbBetaPurchaseChoices:()=>get('choices'),bbPartialAll:()=>get('partials'),bb321ReadShopTicks:()=>get('ticks'),bb84ReadPurchased:()=>get('purchases'),bbHomePhysicalStock:()=>get('stock'),bb307ReadStock:()=>get('stock'),bb307ReadFeatures:()=>get('features'),bbBetaPackSizes:()=>({}),bbReducedContext:()=>({actor:'guest',market:'UK'}),bbReducedProgress:()=>({ticks:get('ticks'),purchases:get('purchases'),partials:get('partials')})};
 ctx.window=ctx;vm.createContext(ctx);
 for(const file of ['basketboss-pricing-v19.js','bb-pantry-policy.js','bb-reduced-stock.js','bb-reduced-purchases.js'])vm.runInContext(readSource(file),ctx);
 vm.runInContext(section('const BB307Pantry=(()=>{','// BasketBoss 321 v7 original-design PREVIEW')+'\nthis.pantry=BB307Pantry;',ctx);
 vm.runInContext(section('function bb83StockLoc(','function bb83UnsyncedBought(')+section('function bbBetaDryVolumeUnit(','function bbBetaPackSurplus(')+section('function bbShopV7Read(','function bbShopV7Reconcile(')+section('function bbBetaShopWeek(','function bbBetaReceiptRead(')+section('function bbBetaReceiptCandidate(','function bbBetaChoiceSave(')+section('function bbBetaIsPerishable(','/* The item remains in Shop')+section('function bbHomePendingHouseholdPurchases(){','/* An item bought again after explicitly unchecking'),ctx);
 const buy=(name,qty,unit='g',options={})=>{
  const id=options.id||ctx.pantry.pantryId(name,unit),week=get('session').id;
  storage.setItem('ticks',JSON.stringify({...get('ticks'),[id]:true}));
  storage.setItem('purchases',JSON.stringify({...get('purchases'),[id]:{name,qty,unit,aisle:options.aisle||ctx.bb172Aisle({key:name}),bbBetaSelectedWeek:week,...options.purchase}}));
  storage.setItem('choices',JSON.stringify({...get('choices'),[id]:{name,qty,unit,week,mode:'exact',...options.choice}}));
  return id;
 };
 const finish=()=>{const prepared=copy(ctx.bb83TransferBought({defer:true}));if(!prepared.error)assert.equal(ctx.bbShopV7Close(prepared),true);return prepared;};
 return {ctx,values,storage,get,buy,finish,active:()=>Object.entries(get('inventory')).filter(([,r])=>r.selected).map(([id,r])=>({id,...r}))};
}

test('actual Finish increases the existing food row and preserves edited name, location, groups, notes and usual prices',()=>{
 const old=row('Rice (500 g)',200,'g',{bb173StockKey:'rice|g',loc:'fridge',customGroupId:'breakfast',notes:'keep this label',targetQty:800,packReviewed:true,packQuantity:500,packUnit:'g'}),h=fixture({'rice|g':200},{edited:old});
 const prices=h.values.get('usualPrices');h.buy('Rice',400);assert.equal(h.get('stock')['rice|g'],200,'recording Bought alone does not deposit stock');
 assert.equal(h.finish().count,1);assert.equal(h.get('stock')['rice|g'],600);assert.equal(h.active().length,1);
 assert.deepEqual(h.get('inventory').edited,{...old,qty:600,bb173StockValue:600});assert.equal(h.values.get('usualPrices'),prices);
 assert.equal(h.finish().count,0);assert.equal(h.get('stock')['rice|g'],600,'repeat Finish cannot credit twice');
});

test('actual Finish converts metric aliases and reviewed contents into the existing compatible row',()=>{
 for(const [name,stockKey,quantity,unit,metadata,bought,boughtUnit,expected]of [
  ['Rice','Rice|kilograms',.2,'kilograms',{},300,'g',500],
  ['Milk','milk|litres',.5,'litres',{},.25,'l',750],
  ['Rice','rice|pack',1,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'},200,'g',700]
 ]){
  const h=fixture({[stockKey]:quantity},{original:row(name,quantity,unit,{bb173StockKey:stockKey,...metadata,notes:'preserve'})});h.buy(name,bought,boughtUnit);
  assert.equal(h.finish().count,1,name);assert.equal(h.active().length,1,name);const [saved]=h.active();assert.equal(saved.id,'original');assert.equal(saved.unit,unit);assert.equal(saved.qty,expected/({'kilograms':1000,litres:1000,pack:500}[unit]));assert.equal(saved.notes,'preserve');assert.equal(saved.packReviewed,metadata.packReviewed);
  assert.equal(saved.bb173StockValue,expected);assert.equal(h.get('stock')[saved.bb173StockKey],expected);
 }
});

test('actual Finish creates a genuinely unmatched food while keeping other food unchanged',()=>{
 const old=row('Rice',200),h=fixture({'rice|g':200},{rice:old});h.buy('Pasta',300);assert.equal(h.finish().count,1);
 assert.equal(h.active().length,2);assert.deepEqual(h.get('inventory').rice,old);assert.equal(h.get('stock')['pasta|g'],300);
});

test('unknown or conflicting pack contents stay unchanged for review while a measured purchase adds only its known quantity',()=>{
 for(const inventory of [
  {pack:row('Rice',2,'pack')},
  {a:row('Rice',1,'pack',{packReviewed:true,packQuantity:250,packUnit:'g'}),b:row('Rice',1,'pack',{packReviewed:true,packQuantity:500,packUnit:'g'})}
 ]){
  const h=fixture({'rice|pack':2},inventory);h.buy('Rice',300);const result=h.finish();
  assert.equal(result.count,1);assert.equal(result.needsPantryReview,true);assert.deepEqual(h.get('stock'),{'rice|pack':2,'rice|g':300});
  for(const [id,original]of Object.entries(inventory))assert.deepEqual(h.get('inventory')[id],original);
 }
});

test('actual Finish adds the entire confirmed purchase including surplus once',()=>{
 const h=fixture({'rice|g':200},{rice:row('Rice',200)});h.buy('Rice',400,'g',{choice:{mode:'custom',actualQty:500,keep:true}});
 assert.equal(h.finish().count,1);assert.equal(h.get('stock')['rice|g'],700);assert.equal(h.get('inventory').rice.qty,700);assert.equal(h.finish().count,0);assert.equal(h.get('stock')['rice|g'],700);
});

test('actual Finish uses approved food aliases and leaves an unrecognized spelling as its own food',()=>{
 const h=fixture({'beef mince|g':200},{mince:row('Beef mince',200)});h.buy('Ground beef',300);assert.equal(h.finish().count,1);assert.equal(h.active().length,1);assert.equal(h.get('stock')['beef mince|g'],500);
 const typo=fixture({'tomato|g':200},{tomato:row('Tomato',200)});typo.buy('Tomatos',300);assert.equal(typo.finish().count,1);assert.equal(typo.active().length,2);assert.equal(typo.get('stock')['tomato|g'],200);assert.equal(typo.get('stock')['tomatos|g'],300);
});

for(const [owned,bought]of [['Tomato','Tinned tomatoes'],['Fresh tomatoes','Canned chopped tomatoes'],['Tomato','Tomatoes (1 tin)'],['Tomato','Tomatoes (from 2 cans)'],['Tomatoes (1 tin)','Tomatoes'],['Chopped tomatoes','Tomato purée'],['Chopped tomatoes','Tomato paste'],['Cod','Haddock'],['Beef mince','Pork mince'],['Milk','Milk (oat)'],['Whole milk','Semi-skimmed milk'],['Pasta','Pasta (gluten-free)'],['Rice (dry)','Rice (cooked)'],['Raw chicken','Cooked chicken'],['Fresh peas','Frozen peas']]){
 test('actual Finish keeps '+owned+' separate from '+bought,()=>{
  const h=fixture(),ownedKey=h.ctx.pantry.pantryId(owned,/milk/i.test(owned)?'ml':'g'),unit=ownedKey.split('|').at(-1);
  h.storage.setItem('stock',JSON.stringify({[ownedKey]:200}));h.storage.setItem('inventory',JSON.stringify({original:row(owned,200,unit,{bb173StockKey:ownedKey})}));
  h.buy(bought,300,/milk/i.test(bought)?'ml':'g');assert.equal(h.finish().count,1);assert.equal(h.active().length,2);assert.equal(h.get('stock')[ownedKey],200);assert.equal(h.get('inventory').original.qty,200);
 });
}

test('actual Finish recognizes the same explicitly gluten-free food without losing its description',()=>{
 const h=fixture({'gluten-free pasta|g':200},{gf:row('Pasta (gluten-free)',200,'g',{bb173StockKey:'gluten-free pasta|g'})});h.buy('Gluten-free pasta',300);
 assert.equal(h.finish().count,1);assert.equal(h.active().length,1);assert.equal(h.get('inventory').gf.name,'Pasta (gluten-free)');assert.equal(h.get('inventory').gf.qty,500);
});

test('exact metric and reviewed-container additions retain the established display unit through later Finish sessions',()=>{
 for(const [name,stockKey,qty,unit,metadata,bought,boughtUnit,expected]of [
  ['Rice','rice|kg',.5,'kg',{},500,'g',1],
  ['Milk','milk|L',1,'L',{},500,'ml',1.5],
  ['Chopped tomatoes','chopped tomatoes|tin',2,'tin',{packReviewed:true,packQuantity:400,packUnit:'g'},400,'g',3]
 ]){
  const h=fixture({[stockKey]:qty},{original:row(name,qty,unit,{bb173StockKey:stockKey,...metadata})});h.buy(name,bought,boughtUnit);assert.equal(h.finish().count,1);
  assert.equal(h.get('inventory').original.unit,unit);assert.equal(h.get('inventory').original.qty,expected);assert.equal(h.active().length,1);
  h.buy('Pasta',100);assert.equal(h.finish().count,1);assert.equal(h.get('inventory').original.unit,unit);assert.equal(h.get('inventory').original.qty,expected);
 }
});

test('unreviewed estimated existing containers remain separate from exact measured purchases with review',()=>{
 const original=row('Chopped tomatoes',2,'tin'),h=fixture({'chopped tomatoes|tin':2},{tins:original});h.buy('Canned chopped tomatoes',400);const result=h.finish();
 assert.equal(result.count,1);assert.equal(result.needsPantryReview,true);assert.deepEqual(h.get('inventory').tins,original);assert.deepEqual(h.get('stock'),{'chopped tomatoes|tin':2,'chopped tomatoes|g':400});assert.equal(h.active().length,2);
});

test('estimated incoming count, container and food density conversions keep raw portions separate for review',()=>{
 for(const [name,unit,qty,key,initial]of [['Chopped tomatoes','tin',1,'chopped tomatoes|g',400],['Carrot','each',1,'carrot|g',100],['Rice','cup',1,'rice|g',100]]){
  const h=fixture({[key]:initial},{original:row(name,initial,'g',{bb173StockKey:key})});h.buy(name,qty,unit);const result=h.finish();
  assert.equal(result.count,1,name);assert.equal(result.needsPantryReview,true,name);assert.equal(h.get('inventory').original.qty,initial);assert.equal(h.get('stock')[key],initial);assert.equal(h.get('stock')[h.ctx.pantry.pantryId(name,unit)],qty);assert.equal(h.active().length,2);
 }
});

test('reviewed incoming container contents may join exact measured stock',()=>{
 const h=fixture({'chopped tomatoes|g':400},{original:row('Chopped tomatoes',400)});h.buy('Tinned tomatoes',1,'tin',{purchase:{packReviewed:true,packQuantity:400,packUnit:'g'}});
 assert.equal(h.finish().count,1);assert.equal(h.get('stock')['chopped tomatoes|g'],800);assert.equal(h.active().length,1);assert.equal(h.get('inventory').original.qty,800);
});

test('grams and millilitres stay separate and request review without an assumed food density',()=>{
 const original=row('Milk',500,'ml',{loc:'fridge'}),h=fixture({'milk|ml':500},{original});h.buy('Milk',300,'g');const result=h.finish();
 assert.equal(result.count,1);assert.equal(result.needsPantryReview,true);assert.deepEqual(h.get('inventory').original,original);assert.deepEqual(h.get('stock'),{'milk|ml':500,'milk|g':300});assert.equal(h.active().length,2);
});

test('curated fresh tomato alias merges plain produce in either stored representation without matching tinned food',()=>{
 for(const [key,owned,bought]of [['tomato|g','Tomatoes','Fresh tomatoes'],['fresh tomatoes|g','Fresh tomatoes','Tomatoes']]){
  const h=fixture({[key]:200},{original:row(owned,200,'g',{bb173StockKey:key})});h.buy(bought,300);assert.equal(h.finish().count,1);assert.equal(h.active().length,1);assert.equal(h.get('inventory').original.qty,500);assert.equal(h.get('inventory').original.name,owned);assert.equal(h.get('stock')['tomato|g'],500);
 }
});

test('known descriptor aliases remain stable through subsequent unrelated Finish sessions',()=>{
 for(const name of ['Beans (tinned)','Honey (runny)','Tomatoes (canned)','Tomatoes (1 tin)']){
  const h=fixture();h.buy(name,300);assert.equal(h.finish().count,1,name);const before=copy(h.active());h.buy('Pasta',100);const result=h.finish();assert.equal(result.error,undefined,name);assert.equal(result.count,1,name);
  const after=h.active().find(r=>r.name===name);assert.ok(after,name);assert.equal(after.qty,before[0].qty,name);assert.equal(after.bb173StockKey,before[0].bb173StockKey,name);
 }
});

test('different ordinary notes and dates survive unrelated Finish and new purchases do not inherit an older expiry',()=>{
 const older=row('Rice',100,'g',{notes:'Use first',useByISO:'2026-11-07'}),newer=row('Rice',200,'g',{notes:'For next week',useByISO:'2026-11-14'}),h=fixture({'rice|g':300},{older,newer});
 h.buy('Pasta',100);assert.equal(h.finish().count,1);assert.deepEqual(h.get('inventory').older,older);assert.deepEqual(h.get('inventory').newer,newer);
 h.buy('Rice',300);assert.equal(h.finish().count,1);assert.deepEqual(h.get('inventory').older,older);assert.deepEqual(h.get('inventory').newer,newer);assert.equal(h.active().filter(r=>r.bb173StockKey==='rice|g').length,3);assert.equal(h.get('stock')['rice|g'],600);
 h.buy('Pasta',100);assert.equal(h.finish().count,1);assert.deepEqual(h.get('inventory').older,older);assert.deepEqual(h.get('inventory').newer,newer);assert.equal(h.active().filter(r=>r.bb173StockKey==='rice|g').length,3);
 const notes=fixture({'rice|g':300},{first:row('Rice',100,'g',{notes:'Use first'}),second:row('Rice',200,'g',{notes:'For next week'})});notes.buy('Rice',300);assert.equal(notes.finish().count,1);assert.equal(notes.get('inventory').first.qty,100);assert.equal(notes.get('inventory').second.qty,200);assert.equal(notes.active().length,3);
 notes.buy('Pasta',100);assert.equal(notes.finish().count,1);assert.equal(notes.get('inventory').first.qty,100);assert.equal(notes.get('inventory').second.qty,200);assert.equal(notes.active().filter(r=>r.bb173StockKey==='rice|g').length,3);
 for(const [field,date]of [['frozenAt',1],['boughtOn','2026-11-01'],['purchasedOn','2026-11-01'],['LOTcode','lot-123']]){
  const original=row('Rice',100,'g',{[field]:date}),dated=fixture({'rice|g':100},{original});dated.buy('Rice',200);assert.equal(dated.finish().count,1);assert.deepEqual(dated.get('inventory').original,original);assert.equal(dated.active().length,2);dated.buy('Pasta',100);assert.equal(dated.finish().count,1);assert.deepEqual(dated.get('inventory').original,original);assert.equal(dated.active().filter(r=>r.bb173StockKey==='rice|g').length,2);
 }
});

test('a legacy flattened key with a conflicting preserved food label requires review without any writes',()=>{
 const h=fixture({'pasta|g':200},{gf:row('Pasta (gluten-free)',200,'g',{bb173StockKey:'pasta|g'})});h.buy('Pasta',300);const before=new Map(h.values),result=h.finish();
 assert.equal(result.error,true);assert.equal(result.needsPantryReview,true);assert.deepEqual(h.values,before);
});

test('ordinary Finish purchases leave reduced and freezer quantities in their existing lots',()=>{
 const meta={version:1,actor:'guest',urgent:true,at:1,sources:['old-reduced']},h=fixture({'rice|g':600},{reduced:row('Rice',200,'g',{bbReduced:meta}),frozen:row('Rice',100,'g',{loc:'freezer'}),ordinary:row('Rice',300)});
 h.buy('Rice',400);assert.equal(h.finish().count,1);assert.equal(h.get('stock')['rice|g'],1000);assert.equal(h.active().length,3);
 assert.equal(h.get('inventory').reduced.qty,200);assert.deepEqual(h.get('inventory').reduced.bbReduced,meta);assert.equal(h.get('inventory').frozen.qty,100);assert.equal(h.get('inventory').ordinary.qty,700);assert.equal(h.get('inventory').ordinary.bbReduced,undefined);
});

test('mixed reduced and ordinary purchases add exact portions without tagging the ordinary stock',()=>{
 const h=fixture({'rice|g':200},{ordinary:row('Rice',200)}),id=h.buy('Rice',400),session=h.get('session');
 const priced=h.ctx.BBReducedPurchases.put(session,{id:'reduced-rice',purchaseId:id,actor:'guest',market:'UK',shopSessionId:session.id,name:'Rice',quantity:150,unit:'g',pricePaid:.5,at:Date.now()});h.storage.setItem('session',JSON.stringify(priced));
 assert.equal(h.finish().count,1);assert.equal(h.get('stock')['rice|g'],600);assert.equal(h.active().length,2);
 assert.equal(h.get('inventory').ordinary.qty,450);assert.equal(h.get('inventory').ordinary.bbReduced,undefined);const reduced=h.active().find(r=>r.bbReduced);assert.equal(reduced.qty,150);assert.equal(reduced.bbReduced.urgent,true);
 assert.equal(h.finish().count,0);assert.equal(h.get('stock')['rice|g'],600);
});

test('Finish deposits a partial purchase once and later receipt matching consumes its credit without a second deposit',async()=>{
 const h=fixture({'rice|g':200},{rice:row('Rice',200)}),session=h.get('session');h.storage.setItem('partials',JSON.stringify({[session.id+'|rice|g']:{name:'Rice',bought:125,required:400,unit:'g',week:session.id,aisle:'Cupboard / Pantry'}}));
 assert.equal(h.finish().count,1);assert.equal(h.get('stock')['rice|g'],325);
 const {computeReceiptCredit}=await import('../bb-receipt-inventory-core.mjs');const receipt=computeReceiptCredit({name:'Rice',canonicalKey:'rice',quantity:125,unit:'g'},h.get('receipts'),{shopSessionId:session.id});assert.equal(receipt.addedQuantity,0);assert.equal(receipt.priorCreditedQuantity,125);assert.equal(h.finish().count,0);
});

test('actual Finish places plural whole produce, chilled food and frozen food in the correct default storage',()=>{
 const cases=[['Potatoes','Produce','cupboard'],['Red onions','Produce','cupboard'],['Bananas','Produce','cupboard'],['Apples','Produce','cupboard'],['Spring onions','Produce','fridge'],['Green onion','Produce','fridge'],['Sliced potatoes','Produce','fridge'],['Frozen peas','Produce','freezer'],['Chicken breast','Meat & Fish','fridge'],['Rice','Cupboard / Pantry','cupboard'],['Milk','Dairy & Chilled','fridge']];
 const h=fixture();for(const [name,aisle]of cases)h.buy(name,500,name==='Milk'?'ml':'g',{aisle});
 assert.equal(h.finish().count,cases.length);
 for(const [name,,location]of cases){const rows=h.active().filter(row=>row.name===name);assert.equal(rows.length,1,name);assert.equal(rows[0].loc,location,name+' default category');assert.equal(rows[0].qty,500,name+' purchased amount');}
 assert.equal(h.finish().count,0,'a repeated Finish cannot create duplicate pantry entries');
});
