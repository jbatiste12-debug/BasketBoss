import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {proposal}=createRequire(import.meta.url)('../bb-pantry-deduction.js');
const food=(key,required,unit='g',extra={})=>({key,name:key,required,unit,...extra});
const context=extra=>({pantryMode:true,market:'UK',...extra});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,actual+' should equal '+expected);

test('culinary uses of stocked staples check availability without measured deductions',()=>{
 const stock={'ketchup|each':1,'soy sauce|bottle':1,'olive oil|ml':500,'honey|jar':1,'salt|g':50,'pepper|each':1};
 const ingredients=[food('ketchup',1,'tbsp'),food('soy sauce',2,'tsp'),food('olive oil',15,'ml'),food('honey',1,'tbsp'),food('salt',1,'pinch'),food('pepper',1,'tsp')];
 const before=JSON.stringify({stock,ingredients});const result=proposal({stock,ingredients,conversion:context()});
 assert.equal(result.rows.length,6);assert.equal(result.issues.length,0);assert.deepEqual(result.used,[]);assert.deepEqual(result.remainingStock,stock);
 for(const row of result.rows){assert.equal(row.staple,true,row.name);assert.equal(row.stapleStatus,'in');assert.equal(row.covered,true);assert.equal(row.deduct,0);assert.equal(row.owned,0,'a container is not a fabricated measured volume');assert.equal(row.canDeduct,false);assert.deepEqual(row.allocations,[]);assert.match(row.stockLabel,/In stock.*container tracking/);}
 assert.equal(JSON.stringify({stock,ingredients}),before);
});

test('explicit Low or Out overrides positive container stock and requests restocking without consuming it',()=>{
 for(const status of ['low','out']){
  const stock={'ketchup|each':2},result=proposal({stock,ingredients:[food('ketchup',15,'ml')],conversion:context({staples:{ketchup:{status,count:2}}})}),row=result.rows[0];
  assert.deepEqual(result.remainingStock,stock);assert.equal(row.stapleStatus,status);assert.equal(row.stapleRestock,true);assert.equal(row.covered,false);assert.equal(row.stapleCount,2);assert.equal(row.deduct,0);assert.deepEqual(result.used,[]);
 }
 const missing=proposal({stock:{},ingredients:[food('soy sauce',1,'tbsp')],conversion:context()}).rows[0];assert.equal(missing.stapleStatus,'out');assert.equal(missing.stapleRestock,true);assert.equal(missing.covered,false);
});

test('an explicitly stocked staple needs no invented physical quantity and unknown status is reviewable',()=>{
 const available=proposal({stock:{},ingredients:[food('olive oil',2,'tsp')],conversion:context({staples:{'olive oil':{status:'in'}}})});
 assert.equal(available.rows[0].covered,true);assert.deepEqual(available.remainingStock,{});assert.deepEqual(available.used,[]);
 const unknown=proposal({stock:{'olive oil|bottle':1},ingredients:[food('olive oil',1,'tbsp')],conversion:context({staples:{'olive oil':'unknown'}})});
 assert.equal(unknown.rows[0].covered,false);assert.equal(unknown.issues.length,1);assert.match(unknown.issues[0].message,/status.*saved container stays unchanged/);assert.deepEqual(unknown.remainingStock,{'olive oil|bottle':1});
});

test('a whole or large sauce amount is flagged instead of assuming a container holds enough',()=>{
 const result=proposal({stock:{'ketchup|each':1},ingredients:[food('ketchup',500,'ml')],conversion:context({staples:{ketchup:'in'}})});
 assert.equal(result.rows[0].staple,true);assert.equal(result.rows[0].covered,false);assert.equal(result.rows[0].deduct,0);assert.equal(result.issues.length,1);assert.match(result.issues[0].message,/larger.*saved quantity stays unchanged/);assert.deepEqual(result.remainingStock,{'ketchup|each':1});
 const combined=proposal({stock:{'ketchup|each':1},ingredients:[food('ketchup',3,'tbsp'),food('ketchup',3,'tbsp')],conversion:context()});assert.equal(combined.rows[0].required,90);assert.equal(combined.rows[0].covered,false);assert.equal(combined.issues.length,1);
});

test('a UK tin and a measured receipt share one ingredient requirement without double stock allocation',()=>{
 const stock={'tinned tomatoes|tin':1,'chopped tomatoes|g':400},result=proposal({stock,ingredients:[food('chopped tomatoes',600)],conversion:context()});
 assert.equal(result.rows[0].owned,800);assert.equal(result.rows[0].deduct,600);assert.deepEqual(result.remainingStock,{'chopped tomatoes|g':200});assert.equal(result.rows[0].estimated,true);assert.match(result.rows[0].assumptions.join(' '),/UK default.*400 g/);
 assert.equal(result.rows[0].allocations.reduce((total,row)=>total+row.quantity,0),600);
});

test('reviewed package size wins over the UK default and keeps source metadata intact',()=>{
 const stock={'beef mince|pack':1},metadata={reviewed:true,packQuantity:750,packUnit:'g',sourceUnit:'pack',canonicalKey:'beef mince'},before=JSON.stringify(metadata);
 const supplied=proposal({stock,ingredients:[food('beef mince',500)],conversion:context({stock:{'beef mince|pack':metadata}})});
 assert.equal(supplied.rows[0].owned,750);near(supplied.remainingStock['beef mince|pack'],1/3);assert.equal(supplied.rows[0].estimated,false);assert.match(supplied.rows[0].assumptions.join(' '),/Reviewed contents.*750/);assert.equal(JSON.stringify(metadata),before);
 const estimated=proposal({stock,ingredients:[food('beef mince',500)],conversion:context()});assert.equal(estimated.rows[0].owned,500);assert.deepEqual(estimated.remainingStock,{});assert.equal(estimated.rows[0].estimated,true);
});

test('UK bag, pint and garlic clove defaults align with measured recipe requirements',()=>{
 const spinach=proposal({stock:{'spinach|bag':1},ingredients:[food('spinach',150)],conversion:context()});assert.equal(spinach.remainingStock['spinach|bag'],.25);assert.equal(spinach.rows[0].deduct,150);assert.match(spinach.rows[0].assumptions.join(' '),/200 g/);
 const milk=proposal({stock:{'milk|pint':1},ingredients:[food('milk',500,'ml')],conversion:context()});near(milk.remainingStock['milk|pint'],68/568);assert.equal(milk.rows[0].owned,568);assert.equal(milk.rows[0].deduct,500);
 const garlic=proposal({stock:{'garlic|clove':2,'garlic|each':1},ingredients:[food('garlic',1,'clove')],conversion:context({canonicalMeasure:()=>({key:'garlic',quantity:4,unit:'g'}),basis:{wholeProduce:true}})});
 assert.equal(garlic.rows[0].unit,'each');assert.equal(garlic.rows[0].required,1);assert.equal(garlic.rows[0].owned,3);assert.deepEqual(garlic.remainingStock,{'garlic|clove':1,'garlic|each':1});
});

test('spoonfuls are culinary volumes without a blanket grams to millilitres ratio',()=>{
 const spoon=proposal({stock:{'lemon juice|ml':100},ingredients:[food('lemon juice',1,'tbsp'),food('lemon juice',2,'tsp')],conversion:context()});
 assert.equal(spoon.rows.length,1);assert.equal(spoon.rows[0].required,25);assert.equal(spoon.remainingStock['lemon juice|ml'],75);
 const mismatch=proposal({stock:{'yoghurt|g':500},ingredients:[food('yoghurt',1,'tbsp')],conversion:context()});assert.deepEqual(mismatch.remainingStock,{'yoghurt|g':484.6875});assert.equal(mismatch.issues.length,0);assert.equal(mismatch.rows[0].estimated,true);assert.match(mismatch.rows[0].assumptions.join(' '),/ingredient-specific/);
});

test('unknown containers and incompatible edited units preserve stock with a review flag',()=>{
 const stock={'mystery grain|bag':2,'milk|ml':500};
 const result=proposal({stock,ingredients:[food('mystery grain',300)],conversion:context()});assert.deepEqual(result.remainingStock,stock);assert.equal(result.rows[0].deduct,0);assert.equal(result.issues.length,1);
 const edited=proposal({stock,ingredients:[food('milk',100,'ml')],amounts:[{id:'milk|ml',quantity:1,unit:'scoop'}],conversion:context()});assert.deepEqual(edited.remainingStock,stock);assert.equal(edited.rows[0].deduct,0);assert.match(edited.issues[0].message,/edited unit.*saved stock stays unchanged/);
});

test('fresh produce and differently prepared food cannot borrow canned or raw container stock',()=>{
 const fresh=proposal({stock:{'fresh tomatoes|each':2},ingredients:[food('chopped tomatoes',400)],conversion:context()});assert.deepEqual(fresh.remainingStock,{'fresh tomatoes|each':2});assert.equal(fresh.rows[0].owned,0);
 const cooked=proposal({stock:{'cooked beef mince|g':500},ingredients:[food('beef mince',250)],conversion:context()});assert.deepEqual(cooked.remainingStock,{'cooked beef mince|g':500});assert.equal(cooked.rows[0].owned,0);
 const produce=proposal({stock:{'red pepper|g':200},ingredients:[food('red pepper',100)],conversion:context()});assert.equal(produce.rows[0].staple,undefined);assert.equal(produce.remainingStock['red pepper|g'],100);
});

test('a canonical whole pepper count stays produce unless explicitly tracked as a staple',()=>{
 const stock={'pepper|each':2},ingredients=[food('pepper',1,'each')];
 const produce=proposal({stock,ingredients,conversion:context()});
 assert.deepEqual(produce.remainingStock,{'pepper|each':1});assert.equal(produce.rows[0].deduct,1);assert.equal(produce.rows[0].staple,undefined);assert.equal(produce.issues.length,0);
 const explicit=proposal({stock,ingredients,conversion:context({staples:{pepper:'in'}})});
 assert.deepEqual(explicit.remainingStock,stock);assert.equal(explicit.rows[0].staple,true);assert.equal(explicit.rows[0].deduct,0);assert.equal(explicit.rows[0].covered,false);assert.match(explicit.issues[0].message,/larger/);
 const black=proposal({stock:{'black pepper|each':1},ingredients:[food('black pepper',1,'tsp')],conversion:context()});assert.equal(black.rows[0].staple,true);assert.equal(black.rows[0].covered,true);assert.deepEqual(black.remainingStock,{'black pepper|each':1});
});
test('a measured whole-peppers recipe consumes produce rather than treating it as a spice jar',()=>{
 for(const staples of [{},{pepper:'in'}]){
  const result=proposal({stock:{'pepper|g':400},ingredients:[food('pepper',250,'g',{name:'Peppers'})],conversion:context({staples})});
  assert.equal(result.rows[0].staple,undefined);assert.equal(result.rows[0].deduct,250);assert.deepEqual(result.remainingStock,{'pepper|g':150});assert.equal(result.issues.length,0);
 }
});
test('ground pepper stays a culinary staple when the underlying catalogue key is generic pepper',()=>{
 const result=proposal({stock:{'pepper|g':50},ingredients:[food('pepper',2,'g',{name:'Ground pepper'})],conversion:context()});
 assert.equal(result.rows[0].staple,true);assert.equal(result.rows[0].covered,true);assert.equal(result.rows[0].deduct,0);assert.deepEqual(result.remainingStock,{'pepper|g':50});
});
test('excluded ambiguous count stock stays intact and cannot cover a whole-pepper requirement',()=>{
 const stock={'pepper|each':3},conversion=context({excludedStockKeys:['pepper|each'],staples:{pepper:{status:'in',count:1}},canonicalMeasure:()=>({key:'pepper',quantity:160,unit:'g'}),basis:{wholeProduce:true}});
 const result=proposal({stock,ingredients:[food('pepper',250,'g',{name:'Peppers'})],conversion}),row=result.rows[0];
 assert.deepEqual(result.remainingStock,stock);assert.equal(row.owned,0);assert.equal(row.deduct,0);assert.equal(Math.max(0,row.required-row.owned),250);assert.equal(row.issue,'unit_mismatch');assert.match(row.issueLabel,/ingredient identity review/);assert.equal(result.issues.length,1);
});
test('review exclusions preserve a spice jar while known whole-pepper grams still deduct normally',()=>{
 const stock={'pepper|each':1,'pepper|g':400},conversion=context({excludedStockKeys:['pepper|each'],staples:{pepper:{status:'in',count:1}},canonicalMeasure:()=>({key:'pepper',quantity:160,unit:'g'}),basis:{wholeProduce:true}});
 const whole=proposal({stock,ingredients:[food('pepper',250,'g',{name:'Peppers'})],conversion});
 assert.deepEqual(whole.remainingStock,{'pepper|each':1,'pepper|g':150});assert.equal(whole.rows[0].owned,400);assert.equal(whole.rows[0].deduct,250);assert.equal(whole.rows[0].issue,'unit_mismatch');
 const spice=proposal({stock,ingredients:[food('pepper',1,'tsp',{name:'Ground pepper'})],conversion});assert.equal(spice.rows[0].covered,true);assert.deepEqual(spice.remainingStock,stock,'an explicit seasoning status remains valid without consuming the jar');
 const unambiguous=proposal({stock:{'pepper|g':400},ingredients:[food('pepper',250,'g',{name:'Peppers'})],conversion:context()});assert.equal(unambiguous.issues.length,0);assert.deepEqual(unambiguous.remainingStock,{'pepper|g':150});
});

test('legacy callers retain strict measured deduction and opt in independently',()=>{
 const stock={'ketchup|ml':800};
 const legacy=proposal({stock,ingredients:[food('ketchup',15,'ml')]});assert.deepEqual(legacy.remainingStock,{'ketchup|ml':785});assert.equal(legacy.rows[0].staple,undefined);
 const converted=proposal({stock:{'spinach|bag':1},ingredients:[food('spinach',100)],conversion:{}});assert.deepEqual(converted.remainingStock,{'spinach|bag':1});assert.equal(converted.rows[0].deduct,0);
});
