import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const recipes=JSON.parse(read('recipes.json'));
const normalized=JSON.parse(read('normalized-ingredient-database.json')).recipes;
const markets=['UK','Guernsey','Jersey','US'];
const affected=['tomato-mozzarella-pasta','prawn-linguine','baked-feta-orzo'];
const plain=value=>JSON.parse(JSON.stringify(value));

function harness(market='UK'){
 const saved=new Map();
 const context=vm.createContext({
  localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value))},
  bb307Market:market,bb307ActiveRetailer:()=>null,
  BB307_NORMALIZED:structuredClone(normalized),
  bbFeedingForRecipe:recipe=>recipe.servings
 });
 context.window=context;
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js','bb-serving-scale.js'])vm.runInContext(read(file),context,{filename:file});
 const html=read('app.html');
 for(const [start,end]of [
  ['function bb307MealEstimate(','function bb307SwitchIsland('],
  ['function bbRecipeMealEstimate(','window.BasketBossMealEstimate=']
 ]){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.ok(from>=0&&to>from,'Execute the actual current app pricing adapters');
  vm.runInContext(html.slice(from,to),context);
 }
 return {context,api:context.BBPriceV19};
}

for(const market of markets)for(const id of affected)for(const scale of [.5,1,2]){
 test(`${id}: whole-bulb source quote resolves in ${market} at ${scale}x portions`,()=>{
  const {context,api}=harness(market),recipe=structuredClone(recipes.find(r=>r.id===id));
  const before=JSON.stringify({recipe,normalized:context.BB307_NORMALIZED});
  const servings=recipe.servings*scale;
  const card=context.bb307MealEstimate(recipe,servings),usage=context.bbRecipeMealEstimate(recipe,servings);
  for(const result of [card,usage]){
   assert.equal(result.pending,0);
   assert.ok(Number.isFinite(result.amount)&&result.amount>0);
   const garlic=result.lines.find(row=>row.key==='garlic');
   assert.equal(garlic.unit,'bulb');
   assert.equal(garlic.quantity,scale);
   assert.equal(garlic.quote.packUnit,'bulb');
   assert.equal(garlic.quote.packQty,1);
   assert.equal(garlic.quote.catalogSource,'bulb_average_10_cloves_review');
   assert.equal(garlic.quote.needsReview,true,'Illustrative pack provenance is not promoted to verified pricing');
  }
  assert.equal(card.amount,usage.amount);
  const normal=context.BB307_NORMALIZED.find(r=>r.id===id);
  const garlic=normal.ingredients.find(row=>row.key==='garlic');
  const without=api.estimateMeal({ingredients:normal.ingredients.filter(row=>row!==garlic).map(row=>({...row,unit:api.recipeIngredientUnit(row,recipe.ingredients),quantity:row.quantity*scale})),market});
  const bulb=api.mealPrice({name:'garlic',quantity:scale,unit:'bulb',market});
  assert.ok(Math.abs(card.amount-(without.amount+bulb.amount))<.011);
  assert.equal(JSON.stringify({recipe,normalized:context.BB307_NORMALIZED}),before,'Recipe amounts and stock-facing normalized units are unchanged');
 });
}

test('whole bulbs retain their own pack units and do not become a single clove or guessed gram weight',()=>{
 const {api}=harness();
 const bulb=api.getPack('garlic','bulb'),cloves=api.getPack('garlic','clove');
 assert.equal(bulb.standard_pack_unit,'bulb');assert.equal(bulb.standard_pack_size,1);
 assert.equal(cloves.standard_pack_unit,'clove');assert.equal(cloves.standard_pack_size,10);
 assert.equal(bulb.pack_price,cloves.pack_price,'Both views describe the existing one-bulb guide pack');
 assert.equal(api.mealPrice({name:'garlic',quantity:1,unit:'bulb'}).rawPortionAmount,10*api.mealPrice({name:'garlic',quantity:1,unit:'clove'}).rawPortionAmount);
 assert.deepEqual(plain(api.normalizeUnit('garlic',.5,'bulb')),{quantity:.5,unit:'bulb',needsReview:false});
 assert.equal(api.getPack('garlic','each').standard_pack_unit,'each','An unspecified item is not reinterpreted as an explicit bulb');
 assert.equal(api.recipeIngredientUnit({key:'garlic',unit:'each'},[['Garlic','1']]),'each');
 assert.equal(api.price({name:'garlic',quantity:2,unit:'bulbs'}).packCount,2);
 assert.equal(api.price({name:'onion',quantity:1,unit:'bulb'}).amount,null,'An unrelated unknown bulb is still unpriced');
});

test('the bulb guide requires the existing disclosed ten-clove bulb pack and rejects changed assumptions',()=>{
 for(const changed of [{source:'unknown_guide'},{standard_pack_size:12},{standard_pack_unit:'each'}]){
  const {api}=harness();Object.assign(api.catalog['garlic|clove'],changed);
  assert.equal(api.mealPrice({name:'garlic',quantity:1,unit:'bulb'}).amount,null);
 }
 const {api}=harness('US');
 api.catalog['garlic|clove'].regional_packs={US:{size:20,unit:'clove',price:9,currency:'USD'}};
 assert.equal(api.getPack('garlic','clove','US').pack_price,9);
 const bulb=api.getPack('garlic','bulb','US');
 assert.equal(bulb.standard_pack_size,1);assert.equal(bulb.standard_pack_unit,'bulb');
 assert.equal(bulb.pack_price,.5*api.factor('US','garlic'),'A clove-specific regional pack is not borrowed as a bulb pack');
});

test('user and receipt prices remain scoped to their exact bulb or clove pack',()=>{
 const {api}=harness();
 api.setPriceOverride({name:'garlic',unit:'clove',market:'UK',price:4,retailer:'Tesco'});
 assert.equal(api.price({name:'garlic',quantity:1,unit:'bulb',market:'UK',retailer:'Tesco'}).shelfPrice,.5);
 api.setPriceOverride({name:'garlic',unit:'bulb',market:'UK',price:2,retailer:'Tesco'});
 assert.equal(api.price({name:'garlic',quantity:1,unit:'bulb',market:'UK',retailer:'Tesco'}).shelfPrice,2);
 assert.equal(api.price({name:'garlic',quantity:1,unit:'clove',market:'UK',retailer:'Tesco'}).shelfPrice,4);
 const fresh=harness().api,requests=[];
 fresh.setReceiptPriceProvider(request=>{
  requests.push(request);
  return {source:'account_store_receipt_regular_price',packPrice:3,packQuantity:10,packUnit:'clove',currency:'GBP',samples:1};
 });
 const bulb=fresh.price({name:'garlic',quantity:1,unit:'bulb',market:'UK',retailer:'Tesco'});
 assert.equal(bulb.receiptLearned,false);assert.equal(bulb.shelfPrice,.5);
 assert.equal(requests[0].packQuantity,1);assert.equal(requests[0].packUnit,'bulb');
 assert.equal(fresh.price({name:'garlic',quantity:1,unit:'clove',market:'UK',retailer:'Tesco'}).receiptLearned,true);
});

test('public sourced prices require matching bulb units rather than borrowing a clove product',()=>{
 const {api}=harness();
 const clove={ingredient:'garlic',unit:'clove',market:'UK',retailer:'Tesco',currency:'GBP',pack_quantity:10,pack_price:3,product_name:'Synthetic garlic cloves',source_url:'https://example.test/garlic-cloves',retrieved_at:'2026-10-31',price_type:'standard'};
 api.sourcedPrices.push(clove);
 const req={name:'garlic',quantity:1,unit:'bulb',market:'UK',retailer:'Tesco',asOf:'2026-10-31'};
 assert.equal(api.price(req).priceKind,'regional_estimate');
 assert.equal(api.price(req).shelfPrice,.5);
 api.sourcedPrices.push({...clove,unit:'bulb',pack_quantity:2,pack_price:1.25,product_name:'Synthetic two-bulb pack',source_url:'https://example.test/garlic-bulbs'});
 const quote=api.price(req);
 assert.equal(quote.priceKind,'public_online');assert.equal(quote.packUnit,'bulb');
 assert.equal(quote.packQty,2);assert.equal(quote.shelfPrice,1.25);
 assert.equal(api.price({...req,unit:'clove'}).shelfPrice,3);
});
