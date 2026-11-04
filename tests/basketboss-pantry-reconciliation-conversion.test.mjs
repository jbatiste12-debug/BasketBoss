import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html=read('index.html'),STOCK='basketboss_321_v7_measured_pantry',INVENTORY='basketboss_makeameal_v1_inventory';
const plain=value=>JSON.parse(JSON.stringify(value));
function named(name,next){const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction '+next+'(',start);assert.ok(start>=0&&end>start,name);return html.slice(start,end);}
const wrapper=named('bbPantryReconcileStock','bb307Plan'),planner=named('bb307Plan','bb307SetPantry'),unified=named('bb321UnifiedShop','bb321LunchboxHTML');
function fixture({stock={},requirements=[{key:'rice',unit:'g',required:1500}],lunch=[],inventory={},review=false,legacy={},module=true,filter=value=>value}={}){
 const values=new Map([[STOCK,JSON.stringify(stock)],[INVENTORY,JSON.stringify(inventory)]]),writes=[];
 let physicalReads=0;
 const ctx={console,Intl,BB307_STOCK_KEY:STOCK,bb307Market:'UK',bb307Stock:{},BB321_RESEARCH_QUOTES:[],
  localStorage:{getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,String(value));writes.push([key,value]);}},
  bbHomePhysicalStock:()=>{physicalReads++;return JSON.parse(values.get(STOCK));},
  bb307Selections:()=>[{id:'fixture',servings:4}],bb307ActiveRetailer:()=> 'Aldi',
  bbReceiptPantryReviewRequired:()=>review,bbReceiptHasAuthoritativePantry:()=>!Object.keys(legacy).length,
  bbBetaStockForCurrentWeek:filter,bbHomeLegacyPantry:()=>legacy,
  bb307NormaliseName:value=>String(value).toLowerCase(),bb321LunchboxRequirements:()=>plain(lunch)};
 ctx.window=ctx;vm.createContext(ctx);
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(read(file),ctx);
 if(module)vm.runInContext(read('bb-pantry-deduction.js'),ctx);
 ctx.BB_WHOLE_PRODUCE_GRAMS=ctx.BBPriceV19.wholeProduceGrams;
 ctx.BB307_SOURCE_RECIPES=[{id:'fixture',servings:4,ingredients:requirements.map(row=>[row.key,row.required+' '+row.unit,1])}];
 ctx.BB307_NORMALIZED=[{id:'fixture',ingredients:requirements.map(row=>({...row,name:row.key,quantity:row.required,status:'PARSED'}))}];
 const begin=html.indexOf('const bb307EstimateBasket=(()=>{'),end=html.indexOf('// BasketBoss 321 v7 original-design',begin);
 vm.runInContext(html.slice(begin,end)+'\nthis.pantry=BB307Pantry;',ctx);
 // The old reader rounds/canonicalises; the physical helper must be used by the
 // new shared reconciliation, preserving raw aliases and submilligram residue.
 ctx.bb307ReadStock=()=>{try{return ctx.pantry.normaliseStock(JSON.parse(values.get(STOCK)));}catch{return {};}};
 vm.runInContext(named('bbHomePhysicalStock','bb307ReadStock'),ctx);
 const physical=ctx.bbHomePhysicalStock;ctx.bbHomePhysicalStock=()=>{physicalReads++;return physical();};
 const lunchBegin=html.indexOf('const BB321Lunch=(()=>{'),lunchEnd=html.indexOf('/* BasketBoss 321 v8 —',lunchBegin);
 vm.runInContext(html.slice(lunchBegin,lunchEnd),ctx);
 vm.runInContext(named('bbHomeConversionContext','bbHomePlanningStock')+'\n'+wrapper+'\n'+planner+'\n'+unified,ctx);
 return {ctx,values,writes,before:JSON.stringify([...values]),stock:()=>JSON.parse(values.get(STOCK)),plan:()=>ctx.bb307Plan(),shop:()=>ctx.bb321UnifiedShop(ctx.bb307Plan().items),project:rows=>ctx.bbPantryReconcileStock(JSON.parse(values.get(STOCK)),rows),physicalReads:()=>physicalReads};
}
const approx=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,actual+' should equal '+expected);

test('real planner and unified Shopping credit kilograms against gram requirements without rewriting saved stock',()=>{
 const stock={'Rice|kilograms':1,'salt|g':.0000001,'herbs|handful':2},h=fixture({stock});
 for(const result of [h.plan().items,h.shop()]){assert.equal(result.length,1);assert.equal(result[0].required,1500);assert.equal(result[0].pantryUsed,1000);assert.equal(result[0].toBuy,500);assert.deepEqual(plain(result[0].pantryMismatch),[]);}
 const projected=h.project([{key:'rice',unit:'g',required:300}]);approx(projected.remainingStock['Rice|kilograms'],.7);assert.equal(projected.remainingStock['salt|g'],.0000001);
 assert.deepEqual(h.stock(),stock);assert.equal(JSON.stringify([...h.values]),h.before);assert.equal(h.writes.length,0);
});

test('recipe and lunch needs reserve one checked physical pack once before reporting the remaining shortfall',()=>{
 const h=fixture({stock:{'rice|pack':1},requirements:[{key:'rice',unit:'g',required:400}],lunch:[{name:'rice',unit:'g',qty:300,days:['Tuesday']}],inventory:{'cupboard|rice':{bb173StockKey:'rice|pack',bb173StockValue:1,qty:1,packReviewed:true,packQuantity:500,packUnit:'g'}}});
 assert.equal(h.plan().items[0].toBuy,0);
 const row=h.shop()[0];assert.equal(row.required,700);assert.equal(row.pantryUsed,500);assert.equal(row.toBuy,200);assert.deepEqual(plain(row.pantryMismatch),[]);assert.match(row.quantityAssumptions.join(' '),/Reviewed contents: 1 pack = 500 g/);
 assert.deepEqual(h.stock(),{'rice|pack':1});assert.equal(h.writes.length,0);
});

test('food-specific reviewed density provides an estimated partial Shopping credit without a unit mismatch',()=>{
 const h=fixture({stock:{'honey|ml':100},requirements:[{key:'honey',unit:'g',required:200}],inventory:{'cupboard|honey':{bb173StockKey:'honey|ml',measurementReviewed:true,densityGPerMl:1.4,measurementEstimated:true,measurementAssumption:'Estimated honey density: 1.4 g per ml'}}});
 for(const row of [h.plan().items[0],h.shop()[0]]){assert.equal(row.pantryUsed,140);assert.equal(row.toBuy,60);assert.equal(row.quantityEstimated,true);assert.match(row.quantityAssumptions.join(' '),/1.4 g per ml/);assert.deepEqual(plain(row.pantryMismatch),[]);}
 assert.deepEqual(h.stock(),{'honey|ml':100});assert.equal(h.writes.length,0);
});

test('unknown pack contents and unsupported density leave the full amount to buy with a clear review message',()=>{
 for(const config of [{stock:{'rice|pack':2},requirements:[{key:'rice',unit:'g',required:200}]},{stock:{'honey|ml':100},requirements:[{key:'honey',unit:'g',required:200}]}]){
  const h=fixture(config),row=h.shop()[0];assert.equal(row.pantryUsed,0);assert.equal(row.toBuy,200);assert.match(row.pantryMismatch.join(' '),/review At home/i);assert.deepEqual(h.stock(),config.stock);assert.equal(h.writes.length,0);
 }
});

test('unresolved extra packaging does not warn when compatible measured stock already covers the need',()=>{
 const h=fixture({stock:{'rice|pack':2,'rice|g':300},requirements:[{key:'rice',unit:'g',required:200}]}),row=h.shop()[0];
 assert.equal(row.toBuy,0);assert.equal(row.pantryUsed,200);assert.deepEqual(plain(row.pantryMismatch),[]);assert.deepEqual(h.stock(),{'rice|pack':2,'rice|g':300});
});

test('a proposal maps normalized target units back without allocating the same physical amount twice',()=>{
 const h=fixture({stock:{'carrot|g':100}}),rows=[{key:'carrot',unit:'each',required:1},{key:'carrot',unit:'g',required:100}],before=JSON.stringify(rows),result=h.project(rows);
 assert.equal(result.pantry['carrot|each'],1);assert.equal(result.pantry['carrot|g'],20);assert.deepEqual(plain(result.remainingStock),{});assert.equal(JSON.stringify(rows),before);assert.deepEqual(h.stock(),{'carrot|g':100});
 const metric=fixture({stock:{'rice|kg':1}}).project([{key:'rice',unit:'kilograms',required:1.5}]);assert.equal(metric.pantry['rice|kilograms'],1);assert.deepEqual(plain(metric.remainingStock),{});
});

test('weekly review gates withhold physical pantry and legacy ownership from both planning and unified Shopping',()=>{
 const h=fixture({stock:{'rice|kg':2},review:true,legacy:{rice:true}});
 assert.equal(h.plan().items[0].toBuy,1500);assert.equal(h.shop()[0].toBuy,1500);assert.equal(h.physicalReads(),0,'pending review cannot even expose a physical source to reconciliation');assert.equal(h.writes.length,0);
});

test('legacy receipt withholding remains ahead of the shared physical proposal',()=>{
 let inspected;
 const h=fixture({stock:{'rice|kg':1},filter:source=>{inspected=plain(source);return {'rice|kg':.4};}}),row=h.shop()[0];
 assert.deepEqual(inspected,{'rice|kg':1});assert.equal(row.pantryUsed,400);assert.equal(row.toBuy,1100);assert.deepEqual(h.stock(),{'rice|kg':1});
});

test('missing shared module retains the old strict fallback and never enables a blanket mass-volume bridge',()=>{
 const metric=fixture({module:false,stock:{'rice|kg':1}});assert.equal(metric.shop()[0].toBuy,500);
 const liquid=fixture({module:false,stock:{'honey|ml':100},requirements:[{key:'honey',unit:'g',required:200}]});assert.equal(liquid.shop()[0].toBuy,200);assert.deepEqual(liquid.stock(),{'honey|ml':100});
});


test('an unknown target unit keeps its own review warning after another valid requirement',()=>{
 const h=fixture({stock:{'rice|g':100,'herbs|g':50}}),result=h.project([{key:'rice',unit:'g',required:100},{key:'herbs',unit:'handful',required:2}]);
 assert.equal(result.pantry['rice|g'],100);assert.equal(result.pantry['herbs|handful'],0);assert.match(result.mismatches['herbs|handful'].join(' '),/Amount or unit needs review/);assert.deepEqual(plain(result.remainingStock),{'herbs|g':50});assert.deepEqual(h.stock(),{'rice|g':100,'herbs|g':50});
});


test('corrupt saved pantry renders full Shopping needs and an explicit review message without legacy credit',()=>{
 for(const stored of ['not valid JSON',JSON.stringify({'rice|kg':'1'}),JSON.stringify({'rice|kg':-1})]){
  const h=fixture({stock:{'rice|kg':1},legacy:{rice:true}});h.values.set(STOCK,stored);
  assert.throws(()=>h.ctx.bbHomePhysicalStock(),/./,'the real physical reader rejects the saved record');
  for(const row of [h.plan().items[0],h.shop()[0]]){assert.equal(row.pantryUsed,0);assert.equal(row.toBuy,1500);assert.match(row.pantryMismatch.join(' '),/Review your saved pantry amounts and units/);}
  assert.equal(h.values.get(STOCK),stored);assert.equal(h.writes.length,0);
 }
});


test('unknown pack stock cannot regain full coverage through an old owned tick',()=>{
 const h=fixture({stock:{'rice|pack':2},legacy:{rice:true}}),row=h.shop()[0];assert.equal(row.toBuy,1500);assert.equal(row.pantryUsed,0);assert.match(row.pantryMismatch.join(' '),/review At home/i);assert.equal(h.writes.length,0);
});
