import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),deduction=require('../bb-pantry-deduction.js'),canonical=require('../bb-recipe-canonical.js'),{install}=require('../bb-home.js');
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory',SESSION='basketboss_cloud_session_v1',ACTOR='11111111-1111-4111-8111-111111111111';
// Only the affected paired ingredient lines are needed; the protected catalogue
// and the other ingredients, methods and prices are not copied into this fixture.
const cases=[
 {id:'moroccan-sardine-kefta-tomato',required:800,source:'2 × 400 g tins, including juice'},
 {id:'greek-green-bean-potato-ladera',required:800,source:'2 × 400 g tins, including juice'},
 {id:'beef-stifado-pearl-onions',required:400,source:'1 × 400 g tin, including juice'},
 {id:'fennel-rice-stuffed-squid',required:600,source:'600 g, including juice'},
 {id:'west-african-peanut-and-black-eyed-bean-stew',name:'Chopped Tomatoes Canned',key:'chopped tomatoes',required:400,source:'400 g, including juice'},
 {id:'mild-chicken-corn-tamales',required:300,source:'300 g'},
 {id:'king-prawn-chupe',required:150,source:'150 g'}
];
function actualFunction(html,name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name+' remains the real app helper');
 const firstEnd=html.indexOf('\n',start);if(html.slice(start,firstEnd).endsWith('}'))return html.slice(start,firstEnd);
 const end=html.indexOf('\n}',start);assert.ok(end>start);return html.slice(start,end+2);
}
function fixture(entry,recipe,{stockName='Tinned tomatoes',stockQuantity=recipe.required*2,stockUnit='g',reviewed=false,extraStock={}}={}){
 const html=read(entry),values=new Map([[STOCK,'{}'],[INVENTORY,'{}'],[SESSION,JSON.stringify({user:{id:ACTOR}})]]),writes=[],syncs=[];
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push(key);},removeItem(key){values.delete(key);writes.push(key);}};
 const state={pending:false,review:false},win={localStorage:storage,document:{},location:{search:''},BBPantryPolicy:policy,BBPantryDeduction:deduction,BBRecipeCanonical:canonical,
  BBReceiptHost:{hasPendingConfirmation:()=>state.pending,requiresPantryReview:()=>state.review,canConsumePantry:()=>!state.review,async confirmCookedPantry(packet){syncs.push(JSON.parse(JSON.stringify(packet)));return {ok:true};}}};
 const context=vm.createContext({localStorage:storage,BB307_STOCK_KEY:STOCK,bb307Market:'UK',console:{warn(){}}});vm.runInContext(read('basketboss-pricing-v19.js'),context);context.window=win;
 const start=html.indexOf('const BB307Pantry=(()=>{'),end=html.indexOf('// BasketBoss 321 v7 original-design',start);assert.ok(start>0&&end>start);vm.runInContext(html.slice(start,end)+'\nthis.pantry=BB307Pantry;',context);
 const name=recipe.name||'Chopped tomatoes canned',source={id:recipe.id,ingredients:[[name,recipe.source]]};
 context.BB307_NORMALIZED=[{id:recipe.id,ingredients:[{name,key:recipe.key||'chopped tomatoes canned',quantity:recipe.required,unit:'g'}]}];context.getRecipe=id=>id===recipe.id?source:null;
 for(const helper of ['bbHomePhysicalStock','bbHomeMeasuredTracking','bbHomeRecipeIngredients','bbHomeShoppingMeasure','bbHomeExcludedStockKeys','bbHomeConversionContext'])vm.runInContext(actualFunction(html,helper),context);
 const measured=context.bbHomeShoppingMeasure(stockName,stockQuantity,stockUnit);assert.ok(measured,'the real purchase adapter accepts this stock');
 const stockKey=context.pantry.pantryId(measured.key,measured.unit),inventory={tomatoes:{name:stockName,selected:true,loc:'cupboard',qty:measured.quantity,unit:measured.unit,bb173StockKey:stockKey,bb173StockValue:measured.quantity,...(reviewed?{trackingMode:'measured',measurementReviewed:true}:{})}};
 storage.setItem(STOCK,JSON.stringify({[stockKey]:measured.quantity,...extraStock}));storage.setItem(INVENTORY,JSON.stringify(inventory));writes.length=0;
 const occurrence=(id,day)=>'tomato-regression|dinner|'+day+'|'+id;
 win.BBHomeHost={id:context.pantry.pantryId,keys:()=>({stock:STOCK,inventory:INVENTORY}),stock:context.bbHomePhysicalStock,recipeIngredients:context.bbHomeRecipeIngredients,conversionContext:context.bbHomeConversionContext,occurrence,refresh(){},requirements:()=>[],household:()=>[]};
 const home=install(win);win.BBHome=home;
 const event=(sessionId='first')=>({sessionId,recipeId:recipe.id,day:'Monday',factor:1,actorId:ACTOR,occurrence:occurrence(recipe.id,'Monday')});
 return {home,event,state,values,writes,syncs,storage,stockKey,measured,ingredients:()=>context.bbHomeRecipeIngredients(recipe.id,1),stock:()=>JSON.parse(storage.getItem(STOCK)),inventory:()=>JSON.parse(storage.getItem(INVENTORY))};
}

for(const entry of ['index.html','app.html']){
 for(const recipe of cases)for(const reviewed of [false,true])test(entry+': '+recipe.id+' uses explicit tinned stock'+(reviewed?' with reviewed measurements':''),async()=>{
  const h=fixture(entry,recipe,{reviewed});assert.equal(h.stockKey,'chopped tomatoes|g');assert.equal(h.measured.estimated,false);
  assert.equal(h.ingredients().length,1,'paired recipe lines have one pantry identity');assert.equal(h.ingredients()[0].key,'chopped tomatoes');
  const before=[...h.values],preview=h.home.previewCook(h.event());assert.equal(preview.ok,true,preview.message);assert.deepEqual([...h.values],before);assert.equal(h.writes.length,0,'preview is read-only');
  const row=preview.rows[0];assert.equal(preview.rows.length,1);assert.equal(row.required,recipe.required);assert.equal(row.owned,recipe.required*2);assert.equal(row.deduct,recipe.required);assert.equal(row.issue,null);assert.equal(preview.issues.length,0);assert.equal(row.estimated,false,'exact grams need no pack-size assumption');
  const result=await h.home.cooked({...h.event(),expected:preview.fingerprint});assert.equal(result.ok,true);assert.equal(result.issues.length,0);assert.equal(h.stock()[h.stockKey],recipe.required);assert.equal(h.inventory().tomatoes.qty,recipe.required);assert.equal(h.syncs.length,1);
  const saved=[...h.values];assert.equal((await h.home.cooked(h.event())).already,true);assert.equal((await h.home.cooked(h.event('reopened-session'))).already,true);assert.deepEqual([...h.values],saved);assert.equal(h.syncs.length,1,'same planned cook never consumes twice');
 });

 test(entry+': fresh tomatoes cannot cover a canned-tomato recipe',async()=>{
  const h=fixture(entry,cases[0],{stockName:'Fresh tomatoes'}),before=h.stock(),preview=h.home.previewCook(h.event());
  assert.equal(h.stockKey,'tomato|g');assert.equal(preview.rows[0].owned,0);assert.equal(preview.rows[0].deduct,0);
  assert.equal((await h.home.cooked({...h.event(),expected:preview.fingerprint})).ok,true);assert.deepEqual(h.stock(),before);assert.equal(h.inventory().tomatoes.qty,1600);
 });

 test(entry+': exact metric amounts combine but unknown and incompatible tomato units stay for review',async()=>{
  const h=fixture(entry,cases[0],{stockQuantity:200,extraStock:{'Chopped tomatoes canned|kg':.1,'Tinned tomatoes|clove':2,'Tinned tomatoes|mystery':2}}),preview=h.home.previewCook(h.event());
  assert.equal(preview.rows[0].owned,300);assert.equal(preview.rows[0].deduct,300);assert.equal(preview.rows[0].issue,'unit_mismatch');assert.equal(preview.issues.length,1);
  const result=await h.home.cooked({...h.event(),expected:preview.fingerprint});assert.equal(result.ok,true);assert.equal(result.issues.length,1);assert.deepEqual(h.stock(),{'Tinned tomatoes|clove':2,'Tinned tomatoes|mystery':2});
 });

 test(entry+': actor changes and pending receipt confirmation still prevent canned stock consumption',async()=>{
  const h=fixture(entry,cases[0]),preview=h.home.previewCook(h.event());h.storage.setItem(SESSION,JSON.stringify({user:{id:'22222222-2222-4222-8222-222222222222'}}));
  const before=[...h.values];assert.equal((await h.home.cooked({...h.event(),expected:preview.fingerprint})).ok,false);assert.deepEqual([...h.values],before);
  h.storage.setItem(SESSION,JSON.stringify({user:{id:ACTOR}}));h.state.pending=true;const pending=[...h.values];assert.equal(h.home.previewCook(h.event()).ok,false);assert.equal((await h.home.cooked(h.event())).ok,false);assert.deepEqual([...h.values],pending);assert.equal(h.syncs.length,0);
 });
}

test('suffix canned-tomato aliases are exact and preserve incompatible states and food forms',()=>{
 for(const label of ['Chopped tomatoes canned','Chopped Tomatoes Canned','Chopped tomato tinned','Tomatoes canned','Plum tomatoes tinned','Whole tomatoes canned']){
  const key=policy.canonicalName(label);assert.equal(key,'chopped tomatoes',label);assert.equal(policy.canonicalName(key),key);
 }
 for(const label of ['Fresh tomatoes','Fresh chopped tomatoes canned','Frozen chopped tomatoes canned','Cooked chopped tomatoes canned','Raw chopped tomatoes canned','Dried tomatoes canned','Tomato paste canned','Tomato purée canned','Passata canned','Tomatoes canned in sauce'])assert.notEqual(policy.canonicalName(label),'chopped tomatoes',label+' remains a separate physical food');
});
