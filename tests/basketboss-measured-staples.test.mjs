import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),recipes=require('../bb-recipe-canonical.js'),deduction=require('../bb-pantry-deduction.js');
const measured=(name,qty=20,unit='g')=>({name,qty,unit,trackingMode:'measured',measurementReviewed:true});
const id=(name,unit)=>policy.canonicalName(name)+'|'+unit;

test('measured staple mode requires an explicit reviewed physical unit and never reinterprets legacy counts',()=>{
 for(const unit of ['g','kg','oz','lb','ml','l','fl oz'])assert.equal(policy.isContainerTracked(measured('Black Peppercorns','',unit)),false);
 assert.equal(policy.isContainerTracked({...measured('Black Peppercorns'),measurementReviewed:false}),true);
 assert.equal(policy.isContainerTracked({...measured('Black Peppercorns'),unit:'each'}),true);
 assert.equal(policy.isContainerTracked({name:'Black Peppercorns',qty:20,unit:'each'}),true);
 assert.equal(policy.isContainerTracked({...measured('Olive oil',.5,'bottle'),packReviewed:true,packQuantity:750,packUnit:'ml'}),false);
 assert.equal(policy.isContainerTracked(measured('Olive oil',.5,'bottle')),true,'an unchecked bottle does not imply a volume');
 assert.equal(policy.isContainerTracked({name:'Peppers',qty:2,unit:'each',staple:false}),false);
 assert.equal(policy.containerLabel('Black Peppercorns'),'jar');
 assert.match(policy.measuredIdentityProblem(measured('Pepper')),/whole peppers/);
 assert.match(policy.measuredIdentityProblem(measured('Black pepper'),()=> 'pepper'),/whole peppers/);
 assert.equal(policy.measuredIdentityProblem(measured('Black Peppercorns')),'');
 assert.equal(policy.measuredIdentityProblem(measured('Peppers')),'');
});

test('recipe projection keeps actual measured spice and oil requirements while legacy containers retain presence tracking',()=>{
 const spice=recipes.project({name:'Black Peppercorns',quantity:5,unit:'g'},{pantryRecord:measured('Black Peppercorns')});
 assert.equal(spice.unit,'g');assert.equal(spice.required,5);assert.equal(spice.staple,false);
 const oil=recipes.project({name:'Olive oil',quantity:2,unit:'tbsp'},{pantryRecord:measured('Olive oil',100,'ml')});
 assert.equal(oil.unit,'ml');assert.equal(oil.required,30);assert.equal(oil.staple,false);
 const legacy=recipes.project({name:'Black Peppercorns',quantity:5,unit:'g'});
 assert.equal(legacy.unit,'each');assert.equal(legacy.required,1);assert.equal(legacy.staple,true);
 const grouped=recipes.aggregate([spice,{...spice,quantity:3,required:3}]);
 assert.equal(grouped[0].required,8);assert.equal(grouped[0].trackingMode,'measured');
 assert.equal(recipes.project({name:'Black Peppercorns',quantity:5,unit:'g'},{pantryRecord:measured('Olive oil')}).staple,true,'a different food record cannot select this ingredient’s tracking mode');
});

test('reviewed measured spice stock deducts exact grams and leaves unmeasured jars untouched',()=>{
 const stock={'black peppercorns|g':20,'black peppercorns|each':1};
 const result=deduction.proposal({stock,ingredients:[{name:'Black Peppercorns',unit:'g',required:5}],id,conversion:{pantryMode:true,measuredStockKeys:['black peppercorns|g'],measuredFoods:['Black Peppercorns']}});
 assert.equal(result.rows[0].deduct,5);assert.equal(result.remainingStock['black peppercorns|g'],15);assert.equal(result.remainingStock['black peppercorns|each'],1);
 assert.equal(stock['black peppercorns|g'],20,'a proposal never changes saved stock');
});

test('measured spices never invent a teaspoon-to-gram density',()=>{
 const result=deduction.proposal({stock:{'black peppercorns|g':20},ingredients:[{name:'Black Peppercorns',unit:'tsp',required:1}],id,conversion:{pantryMode:true,measuredStockKeys:['black peppercorns|g'],measuredFoods:['Black Peppercorns'],basis:{spoons:true}}});
 assert.equal(result.rows[0].deduct,0);assert.equal(result.remainingStock['black peppercorns|g'],20);assert.equal(result.rows[0].issue,'unit_mismatch');
 const oil=deduction.proposal({stock:{'olive oil|ml':100},ingredients:[{name:'Olive oil',unit:'tbsp',required:2}],id,conversion:{pantryMode:true,measuredStockKeys:['olive oil|ml'],measuredFoods:['Olive oil']}});
 assert.equal(oil.rows[0].deduct,30);assert.equal(oil.remainingStock['olive oil|ml'],70);
});

test('legacy staple containers still use stock status without consuming an invented gram amount',()=>{
 const result=deduction.proposal({stock:{'black peppercorns|each':20},ingredients:[{name:'Black Peppercorns',unit:'g',required:5}],id,conversion:{pantryMode:true}});
 assert.equal(result.rows[0].staple,true);assert.equal(result.rows[0].covered,true);assert.equal(result.rows[0].deduct,0);assert.equal(result.remainingStock['black peppercorns|each'],20);
});

test('a catalogue key collision cannot let measured seasoning supply a whole pepper or the reverse',()=>{
 const collapsed=(name,unit)=>/pepper/i.test(name)?'pepper|'+unit:id(name,unit);
 for(const [food,recipe]of[['Black Peppercorns','Peppers'],['Peppers','Black Peppercorns'],['Pepper','Pepper']]){
  const result=deduction.proposal({stock:{'pepper|g':20},ingredients:[{name:recipe,unit:'g',required:5}],id:collapsed,conversion:{pantryMode:true,measuredStockKeys:['pepper|g'],measuredFoods:[food]}});
  assert.equal(result.rows[0].deduct,0,food+' must not supply '+recipe);assert.equal(result.remainingStock['pepper|g'],20);assert.equal(result.rows[0].issue,'unit_mismatch');
 }
});

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function hostFixture(records,stock,canonicalize=policy.canonicalName){
 const storage={getItem:key=>key==='basketboss_makeameal_v1_inventory'?JSON.stringify(records):null};
 const win={BBPantryPolicy:policy,BBHome:{targets:()=>({})}},context=vm.createContext({window:win,localStorage:storage,BB307Pantry:{pantryName:canonicalize},BBPriceV19:{canonicalMeasure:()=>null},bb307Market:'UK',bbHomePhysicalStock:()=>stock,bbHomeStapleState:()=>({}),bbHomeExcludedStockKeys:()=>[]});
 const source=(first,last)=>html.slice(html.indexOf('function '+first+'('),html.indexOf('function '+last+'('));
 vm.runInContext(source('bbHomeMeasuredTracking','bbHomeRecipeIngredients')+source('bbHomeApplyStapleShopping','bbHomeCupboardStapleItems')+source('bbHomeConversionContext','bbHomePlanningStock'),context);
 return {lookup:name=>vm.runInContext('bbHomeMeasuredTracking',context)(name),shopping:rows=>vm.runInContext('bbHomeApplyStapleShopping',context)(rows),conversion:()=>vm.runInContext('bbHomeConversionContext',context)()};
}
test('actual app planner preserves measured grams and cooking context proves every allocated stock contribution',()=>{
 const row={...measured('Black Peppercorns'),loc:'cupboard',selected:true,bb173StockKey:'black peppercorns|g',bb173StockValue:20};
 const h=hostFixture({pepper:row},{'black peppercorns|g':20}),source={key:'Black Peppercorns',unit:'g',required:5,toBuy:0};
 assert.equal(h.lookup('Black Peppercorns').qty,20);
 assert.equal(h.shopping([source])[0].unit,'g');
 assert.deepEqual(Array.from(h.conversion().measuredStockKeys),['black peppercorns|g']);
 const mixed=hostFixture({pepper:row,unchecked:{...row,qty:5,bb173StockValue:5,measurementReviewed:false}},{'black peppercorns|g':25});
 assert.deepEqual(Array.from(mixed.conversion().measuredStockKeys),[],'one reviewed row cannot grant permission to consume an unreviewed aggregate');
 const collision=hostFixture({pepper:row},{'pepper|g':20},()=> 'pepper');
 assert.equal(collision.lookup('Peppers'),null,'the planner cannot select seasoning stock for whole peppers through a shared catalogue key');
 assert.equal(collision.lookup('Pepper'),null,'a bare ambiguous ingredient needs identity review');
});
