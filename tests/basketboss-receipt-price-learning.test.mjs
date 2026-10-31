import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function pricing(){
 const saved=new Map();
 const context=vm.createContext({BBSupermarkets:{getSelected:()=> 'Aldi'},localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)}});
 for(const name of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),context);
 return {api:context.BBPriceV19,saved};
}
const makeResult=(request,extra={})=>({source:'account_store_receipt_regular_price',packPrice:2.37,packQuantity:request.packQuantity,packUnit:request.packUnit,currency:request.currency,samples:3,...extra});
const rice={name:'rice',unit:'g',quantity:1100,market:'UK',retailer:'Aldi'};

test('a reviewed exact receipt pack supplies full-pack and fractional pantry costs without catalogue writes',()=>{
 const {api,saved}=pricing(),original=JSON.stringify(api.catalog);
 let captured;
 api.setReceiptPriceProvider(request=>{captured=request;return makeResult(request);});
 const pack=api.getPack('rice','g','UK','Aldi');
 const shopping=api.price(rice),meal=api.mealPrice({...rice,quantity:100});
 assert.equal(captured.canonicalKey,'rice');assert.equal(captured.market,'UK');assert.equal(captured.retailer,'Aldi');assert.equal(captured.currency,'GBP');assert.equal(captured.brand,'');
 assert.equal(shopping.amount,Math.ceil(1100/pack.standard_pack_size)*2.37);
 assert.equal(meal.amount,Math.round(100/pack.standard_pack_size*2.37*100)/100);
 assert.equal(shopping.source,'account_store_receipt_regular_price');assert.equal(shopping.priceKind,'receipt_regular');assert.equal(shopping.receiptLearned,true);assert.equal(shopping.receiptSamples,3);assert.equal(shopping.sourceUrl,null);
 assert.equal(saved.size,0);assert.equal(JSON.stringify(api.catalog),original);
});
test('manual usual prices take precedence and do not call the receipt provider',()=>{
 const {api}=pricing();let called=0;
 api.setReceiptPriceProvider(request=>{called++;return makeResult(request);});
 api.setPriceOverride({...rice,price:3.19,brand:'My rice'});
 const result=api.price(rice);assert.equal(result.source,'user_shelf_price');assert.equal(result.shelfPrice,3.19);assert.equal(result.userBrand,'My rice');assert.equal(called,0);
});
test('wrong region, shop, currency, unit, pack, brand or promotional observation cannot alter estimates',()=>{
 for(const extra of [{market:'US'},{retailer:'Tesco'},{currency:'USD'},{packUnit:'ml'},{packQuantity:123},{brand:'Unselected brand'},{priceType:'promotion'},{eligibleForRegularPrice:false},{packPrice:0},{packPrice:Infinity},{samples:0}]){
  const {api}=pricing(),before=api.price(rice);
  api.setReceiptPriceProvider(request=>makeResult(request,extra));
  const after=api.price(rice);assert.equal(after.amount,before.amount,JSON.stringify(extra));assert.equal(after.receiptLearned,false);
 }
});
test('brand selection is explicit, exceptions fall back, and disconnect removes learned prices',()=>{
 const {api}=pricing();const before=api.price(rice);
 api.setReceiptPriceProvider(request=>makeResult(request,{brand:'Selected rice'}));
 assert.equal(api.price(rice).receiptLearned,false);
 assert.equal(api.price({...rice,brand:'Selected rice'}).receiptLearned,true);
 api.setReceiptPriceProvider(()=>{throw Error('Unavailable account cache');});assert.equal(api.price(rice).amount,before.amount);
 api.setReceiptPriceProvider(request=>makeResult(request));api.setReceiptPriceProvider(null);assert.equal(api.price(rice).amount,before.amount);
 assert.throws(()=>api.setReceiptPriceProvider({}));
});
test('fresh-item receipt pack pricing retains whole-pack rounding in all four regions',()=>{
 const {api}=pricing();
 api.setReceiptPriceProvider(request=>makeResult(request,{packPrice:4.13}));
 for(const market of ['UK','Guernsey','Jersey','US']){
  const pack=api.getPack('chicken breast','g',market,'Aldi');
  const result=api.mealPrice({name:'chicken breast',unit:'g',quantity:pack.standard_pack_size+1,market,retailer:'Aldi'});
  assert.equal(result.amount,8.26);assert.equal(result.packCount,2);assert.equal(result.currency,market==='US'?'$':'£');
 }
});
