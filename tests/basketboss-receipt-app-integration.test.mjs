import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
function namedFunction(name,next){
 const start=index.indexOf('function '+name+'('),end=index.indexOf('\nfunction '+next+'(',start);
 assert.ok(start>=0&&end>start,'Function boundaries exist for '+name);return index.slice(start,end);
}
function planner({review=false,authoritative=false,stock={},legacy=true,assumed=false}={}){
 const item={key:'chicken breast',unit:'g',required:600,toBuy:600};
 const context=vm.createContext({
  state:{pantry:legacy?{'chicken breast':true}:{}},bb307Market:'UK',bb307Stock:{},BB307_SOURCE_RECIPES:[],BB307_NORMALIZED:[],BB321_RESEARCH_QUOTES:[],
  bb307Selections:()=>[],bb307ActiveRetailer:()=> 'Aldi',bb307ReadStock:()=>({...stock}),bb307NormaliseName:value=>value,
  bbReceiptPantryReviewRequired:()=>review,bbReceiptHasAuthoritativePantry:()=>authoritative,bbBetaStockForCurrentWeek:value=>value,
  BB307Pantry:{pantryId:(name,unit)=>name+'|'+unit,stockForBasket:value=>({...value})},
  bb307EstimateBasket:args=>({items:[{...item,toBuy:Math.max(0,item.required-(args.pantry?.['chicken breast|g']||0))}]}),
  BBPriceV19:{repriceBasket:value=>value},bb321UnifiedShop:value=>value,bb172StapleAssumesOnHand:()=>assumed,bb172AssumesOnHand:()=>assumed,
  bb15Quote:value=>({amount:value.toBuy>0?4.5:0}),bb307FeatureState:{essentials:[]},bbShopV7Reconcile:()=>true,notify(){},bb321ReadShopTicks:()=>({}),bb84SeedPreviouslyBought(){},bb84ExtraNeeded:()=>0,bb321Number:Number
 });
 vm.runInContext(namedFunction('bb307Plan','bb307SetPantry')+'\n'+namedFunction('bb321WeeklySummary','bb321TinSpec'),context);
 return context;
}
test('pending Pantry review withholds measured stock and legacy owned flags from shopping deduction',()=>{
 const context=planner({review:true,stock:{'chicken breast|g':500},legacy:true});
 assert.equal(context.bb307Plan().items[0].toBuy,600);
});
test('confirmed absolute stock cannot resurrect a removed food through legacy ownership flags',()=>{
 assert.equal(planner({authoritative:true,stock:{},legacy:true}).bb307Plan().items[0].toBuy,600);
 assert.equal(planner({authoritative:true,stock:{'chicken breast|g':500},legacy:true}).bb307Plan().items[0].toBuy,100);
 assert.equal(planner({authoritative:false,stock:{},legacy:true}).bb307Plan().items[0].toBuy,0,'Existing Free/guest ownership flags remain supported');
});
test('unmeasured staple assumptions cannot override reviewed absolute stock or pending review',()=>{
 for(const options of [{authoritative:true,assumed:true},{review:true,assumed:true}]){
  const context=planner(options),summary=context.bb321WeeklySummary({items:[{key:'chicken breast',unit:'g',required:600,toBuy:100}]});
  assert.equal(summary.items[0].toBuy,100);assert.equal(summary.items[0].bb172Assumed,undefined);
 }
 const legacy=planner({assumed:true}).bb321WeeklySummary({items:[{key:'chicken breast',unit:'g',required:600,toBuy:100}]});
 assert.equal(legacy.items[0].toBuy,0);
});
test('essential product and region metadata survive saved feature normalization and addition',()=>{
 const start=index.indexOf('const BB307Features=(()=>{'),marker='return {normaliseFeatures,toggleFavourite,storeMealBasket,addSavedMeals,addEssential,getRestockSuggestions,rankFridgeRecipes};',end=index.indexOf('\n})();',index.indexOf(marker,start))+6;
 assert.ok(start>=0&&end>start);const context=vm.createContext({});vm.runInContext(index.slice(start,end)+';globalThis.features=BB307Features',context);
 const raw={name:'Shampoo',qty:2,unit:'pack',estimatedPackPrice:3.49,productName:'Family shampoo250ml',brand:'Family',packQuantity:250,packUnit:'ml',priceMarket:'US',priceRetailer:'Walmart',priceCurrency:'USD',priceScope:'store'};
 const added=context.features.addEssential({},raw,[]).essentials[0],again=context.features.normaliseFeatures({essentials:[added]},[]).essentials[0];
 for(const key of Object.keys(raw))assert.equal(again[key],raw[key],key);
 const legacy=context.features.normaliseFeatures({essentials:[{name:'Shampoo',qty:1,unit:'pack',estimatedPackPrice:2}]},[]).essentials[0];
 assert.equal(legacy.estimatedPackPrice,2);assert.equal(legacy.priceMarket,null);assert.equal(legacy.priceCurrency,null,'Legacy price is preserved without inventing a region');
});
test('both app entrypoints retain matching integration and all inline scripts parse',()=>{
 assert.equal(app,index);
 for(const [name,source] of [['index',index],['app',app]]){
  let count=0;for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc\s*=|application\/(?:ld\+)?json/i.test(match[1])||!match[2].trim())continue;
   new vm.Script(match[2],{filename:name+' inline '+(++count)});
  }
  assert.ok(count>20);
 }
});
