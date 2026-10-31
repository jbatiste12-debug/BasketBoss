import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function pricing(){
 const saved=new Map();
 const context=vm.createContext({localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v))}});
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 return context.BBPriceV19;
}
const markets=['UK','Guernsey','Jersey','US'];
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('regional pricing preserves food categories instead of silently treating every ingredient as cupboard',()=>{
 const p=pricing();
 const cases=[
  {name:'chicken breast',unit:'g',category:'Meat & fish',factors:[1,1.20,1.26,1.70]},
  {name:'double cream',unit:'ml',category:'Dairy',factors:[1,1.30,1.365,1.65]},
  {name:'onion',unit:'each',category:'Produce',factors:[1,1.24,1.302,1.80]},
  {name:'brioche buns',unit:'each',category:'Bakery',factors:[1,1.25,1.3125,1.80]},
  {name:'cooking oil',unit:'ml',category:'Cupboard',factors:[1,1.10,1.155,1.50]}
 ];
 for(const item of cases)for(const [index,market] of markets.entries()){
  const quote=p.mealPrice({name:item.name,unit:item.unit,quantity:1,market});
  assert.equal(quote.category,item.category,item.name);
  close(p.factor(market,item.name),item.factors[index]);
  close(quote.unitPrice,quote.shelfPrice/quote.packQty);
 }
});

test('pantry usage classification excludes fresh food and chilled meal bases in the same aisle',()=>{
 const p=pricing();
 for(const name of ['cooking oil','plain flour','strong white bread flour','ground cumin','ground coriander','mixed herbs','dried oregano','low-salt chicken stock','vegetable or lamb stock','reduced-salt soy sauce','apple cider vinegar','tomato ketchup','mild korma curry paste','basil pesto','panko breadcrumbs'])assert.equal(p.isPantryStaple(name),true,name);
 for(const name of ['fresh basil','basil','fresh ginger','red pepper','ground beef','medium flour tortillas','potato gnocchi','double cream','chicken breast','chickpeas','tinned green lentils','cooked rice','microwaveable wholegrain rice','fresh egg pasta','chilled penne pasta','cheese tortellini','spinach ricotta ravioli'])assert.equal(p.isPantryStaple(name),false,name);
});

test('recognized dry grains, pasta and lentils use pantry usage without treating every cupboard product as dry',()=>{
 const p=pricing();
 for(const name of ['penne pasta','long-grain rice dry','dry rice','dried pasta','orzo','spaghetti','risotto rice','couscous','quinoa','red lentils','dried red lentils','dried large pasta shells','large dried pasta shells','dry egg noodles'])assert.equal(p.isPantryStaple(name),true,name);
 for(const market of markets){
  for(const item of [{name:'penne pasta',unit:'g',quantity:125},{name:'long-grain rice dry',unit:'g',quantity:75},{name:'orzo',unit:'g',quantity:80},{name:'couscous',unit:'g',quantity:75},{name:'quinoa',unit:'g',quantity:60},{name:'dried red lentils',unit:'g',quantity:80}]){
   const shop=p.price({...item,market}),meal=p.mealPrice({...item,market});
   assert.equal(meal.costBasis,'pantry_usage',market+': '+item.name);
   close(meal.unroundedMealAmount,item.quantity/shop.packQty*(shop.shelfPrice));
   assert.ok(meal.amount<shop.amount,market+': '+item.name);
   assert.equal(shop.amount,shop.packAmount);
  }
  for(const item of [{name:'potato gnocchi',unit:'g',quantity:150},{name:'cheese tortellini',unit:'g',quantity:150},{name:'tinned green lentils',unit:'g',quantity:100}]){
   const shop=p.price({...item,market}),meal=p.mealPrice({...item,market});
   assert.equal(meal.costBasis,'full_packs');
   assert.equal(meal.amount,shop.amount);
  }
 }
});

test('meal estimates use exact fractional staple usage in every region without changing Shop pack charges',()=>{
 const p=pricing();
 for(const market of markets){
  for(const item of [{name:'cooking oil',unit:'ml',quantity:15},{name:'plain flour',unit:'g',quantity:100},{name:'dried oregano',unit:'g',quantity:3},{name:'chicken stock',unit:'ml',quantity:150},{name:'soy sauce',unit:'ml',quantity:15}]){
   const shop=p.price({...item,market});
   const meal=p.mealPrice({...item,market});
   const expected=item.quantity/shop.packQty*(shop.shelfPrice);
   close(meal.unroundedMealAmount,expected);
   assert.equal(meal.amount,Math.round((expected+Number.EPSILON)*100)/100);
   assert.equal(meal.costBasis,'pantry_usage');
   assert.equal(meal.currency,market==='US'?'$':'£');
   assert.equal(meal.packAmount,shop.amount);
   assert.ok(meal.amount<shop.amount,`${market}: ${item.name}`);
  }
 }
 // At the currently configured £2.50/litre, 15 ml is 3.75p, displayed as 4p.
 assert.equal(p.mealPrice({name:'cooking oil',quantity:15,unit:'ml',market:'UK'}).amount,.04);
 assert.equal(p.price({name:'cooking oil',quantity:15,unit:'ml',market:'UK'}).amount,2.5);
});

test('fresh food preserves whole-pack ceiling at quantity boundaries across all regions',()=>{
 const p=pricing();
 for(const market of markets)for(const quantity of [1,500,1000,1001,2200]){
  const input={name:'chicken breast',unit:'g',quantity,market};
  const shop=p.price(input),meal=p.mealPrice(input);
  assert.equal(meal.packCount,Math.ceil(quantity/shop.packQty));
  assert.equal(meal.costBasis,'full_packs');
  assert.equal(meal.amount,shop.amount);
  assert.equal(meal.unroundedMealAmount,shop.amount);
 }
});

test('meal totals round after summing raw usage, without tiny-portion floors or caps',()=>{
 const p=pricing();
 const ingredients=[{key:'cooking oil',quantity:1,unit:'ml'},{key:'plain flour',quantity:1,unit:'g'},{key:'balsamic vinegar',quantity:1,unit:'ml'}];
 const quote=p.estimateMeal({ingredients,market:'UK'});
 assert.equal(quote.amount,.01);
 assert.equal(quote.pending,0);
 assert.equal(quote.lines.reduce((n,x)=>n+x.quote.amount,0),0);
 // Larger usage must remain proportional too, rather than retaining a tiny-condiment cap.
 const regular=p.mealPrice({name:'dried oregano',quantity:3,unit:'g',market:'UK'});
 const larger=p.mealPrice({name:'dried oregano',quantity:30,unit:'g',market:'UK'});
 close(larger.unroundedMealAmount,regular.unroundedMealAmount*10);
});

test('duplicate canonical ingredients share a fresh pack after compatible mass normalization',()=>{
 const p=pricing();
 for(const market of markets){
  for(const ingredients of [
   [{key:'Chicken breast',quantity:250,unit:'g'},{key:'chicken breast, diced',quantity:250,unit:'g'}],
   [{key:'Chicken breast',quantity:.25,unit:'kg'},{key:'chicken breast',quantity:250,unit:'g'}]
  ]){
   const result=p.estimateMeal({ingredients,market});
   const expected=p.mealPrice({name:'chicken breast',quantity:500,unit:'g',market});
   assert.equal(result.amount,expected.amount);
   assert.equal(result.pending,0);
   assert.equal(result.lines.length,1);
   assert.equal(result.lines[0].quantity,500);
   assert.equal(result.lines[0].unit,'g');
   assert.equal(result.lines[0].quote.packCount,Math.ceil(500/expected.packQty));
   assert.equal(Array.from(result.lines[0].sourceIndices).join(','),'0,1');
  }
 }
});

test('staple duplicates aggregate raw quantities while incompatible measures stay separate',()=>{
 const p=pricing();
 const ingredients=Array.from({length:40},()=>({key:'cooking oil',quantity:1,unit:'ml'}));
 const summed=p.estimateMeal({ingredients,market:'UK'});
 assert.equal(summed.amount,.1);
 assert.equal(summed.lines.length,1);
 assert.equal(summed.lines[0].quantity,40);
 assert.equal(summed.lines[0].sourceIndices.length,40);
 const separate=p.estimateMeal({ingredients:[{key:'double cream',quantity:100,unit:'g'},{key:'double cream',quantity:100,unit:'ml'}],market:'UK'});
 assert.equal(separate.lines.length,2);
 assert.equal(separate.lines[0].unit,'g');
 assert.equal(separate.lines[1].unit,'ml');
 // Existing explicit dry-spoon assumptions remain visible after aggregation.
 const spoons=p.estimateMeal({ingredients:[{key:'dried oregano',quantity:1,unit:'tsp'},{key:'dried oregano',quantity:3,unit:'g'}],market:'UK'});
 assert.equal(spoons.lines.length,1);
 assert.equal(spoons.lines[0].quantity,6);
 assert.equal(spoons.lines[0].quote.needsReview,true);
 assert.match(spoons.lines[0].quote.assumption,/dry spoon/i);
});

test('regional shelf-price overrides remain scoped and feed both meal usage and actual pack cost',()=>{
 const p=pricing();
 p.setPriceOverride({name:'cooking oil',unit:'ml',market:'Guernsey',price:4});
 const guernsey=p.mealPrice({name:'cooking oil',unit:'ml',quantity:15,market:'Guernsey'});
 assert.equal(guernsey.amount,.06);
 assert.equal(guernsey.packAmount,4);
 assert.equal(guernsey.userOverride,true);
 assert.equal(p.price({name:'cooking oil',unit:'ml',quantity:15,market:'Guernsey'}).amount,4);
 assert.equal(p.mealPrice({name:'cooking oil',unit:'ml',quantity:15,market:'UK'}).userOverride,false);
 assert.equal(p.clearPriceOverride({name:'cooking oil',unit:'ml',market:'Guernsey'}),true);
 assert.equal(p.mealPrice({name:'cooking oil',unit:'ml',quantity:15,market:'Guernsey'}).userOverride,false);
});

test('invalid or missing quantities remain pending rather than becoming zero-cost ingredients',()=>{
 const p=pricing();
 for(const quantity of [null,'',' ',undefined,-1,NaN,Infinity,'optional',true,[],{}])assert.equal(p.mealPrice({name:'cooking oil',quantity,unit:'ml',market:'UK'}),null,String(quantity));
 assert.equal(p.mealPrice({quantity:1,unit:'g',market:'UK'}),null);
 assert.equal(p.mealPrice({name:'cooking oil',quantity:1,unit:'ml',market:'unknown'}),null);
 const result=p.estimateMeal({ingredients:[{key:'chicken breast',quantity:500,unit:'g'},{key:'cooking oil',quantity:null,unit:'ml'}],market:'UK'});
 assert.equal(result.amount,null);
 assert.equal(result.pending,1);
 assert.equal(result.knownAmount,8.5);
 assert.equal(p.estimateMeal({market:'UK'}).amount,null);
});

test('Shop basket repricing still charges purchased packs rather than fractional meal usage',()=>{
 const p=pricing();
 const basket={items:[{key:'cooking oil',unit:'ml',toBuy:15}]};
 assert.equal(p.repriceBasket(basket,'UK').estimateMidGbp,2.5);
 assert.equal(basket.items[0].quantityBought,1000);
 assert.equal(basket.items[0].surplus,985);
 assert.equal(p.estimateMeal({ingredients:[{key:'cooking oil',unit:'ml',quantity:15}],market:'UK'}).amount,.04);
});

test('regional pack sizes drive fresh rounding and pantry usage with scoped shelf overrides',()=>{
 const p=pricing();
 p.catalog['chicken breast|g'].regional_packs={
  UK:{size:1000,unit:'g',price:8.5,currency:'£'},
  US:{size:600,unit:'g',price:7.5,currency:'$'}
 };
 for(const [market,packs,total]of [['UK',1,8.5],['US',2,15]]){
  const quote=p.mealPrice({name:'chicken breast',unit:'g',quantity:650,market});
  assert.equal(quote.packCount,packs);
  assert.equal(quote.amount,total);
  assert.equal(quote.packQty,market==='UK'?1000:600);
 }
 p.catalog['cooking oil|ml'].regional_packs={US:{size:500,unit:'ml',price:3,currency:'$'}};
 assert.equal(p.mealPrice({name:'cooking oil',unit:'ml',quantity:15,market:'US'}).amount,.09);
 p.setPriceOverride({name:'cooking oil',unit:'ml',market:'US',price:5});
 assert.equal(p.mealPrice({name:'cooking oil',unit:'ml',quantity:15,market:'US'}).amount,.15);
 assert.equal(p.price({name:'cooking oil',unit:'ml',quantity:15,market:'US'}).amount,5);
 assert.equal(p.mealPrice({name:'cooking oil',unit:'ml',quantity:15,market:'UK'}).amount,.04);
 assert.equal(p.clearPriceOverride({name:'cooking oil',unit:'ml',market:'US'}),true);
 assert.equal(p.mealPrice({name:'cooking oil',unit:'ml',quantity:15,market:'US'}).amount,.09);
});

test('cooking tap water contributes zero without making bottled water free',()=>{
 const p=pricing();
 for(const market of markets){
  const result=p.estimateMeal({ingredients:[{key:'water',quantity:600,unit:'ml'},{key:'tap water',quantity:100,unit:'ml'}],market});
  assert.equal(result.amount,0);assert.equal(result.pending,0);
  assert.ok(p.mealPrice({name:'bottled water',quantity:600,unit:'ml',market}).amount>0);
 }
});
