import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {proposal}=createRequire(import.meta.url)('../bb-pantry-deduction.js');
const food=(key,required,unit='g',extra={})=>({key,name:key,required,unit,...extra});
const pack=(packQuantity,packUnit,extra={})=>({reviewed:true,packQuantity,packUnit,...extra});
const almost=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' should equal '+expected);
function pricing(){const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),context);return context.BBPriceV19;}

test('opt-in metric conversion preserves original physical keys, unknown stock and unrelated zero values',()=>{
 const stock={'rice|kilograms':1,'rice|g':300,'herbs|handful':3,'unknown|custom-unit':0},ingredients=[food('rice',600)],before=JSON.stringify({stock,ingredients});
 const result=proposal({stock,ingredients,conversion:{}});
 assert.deepEqual(result.remainingStock,{'rice|kilograms':.4,'rice|g':300,'herbs|handful':3,'unknown|custom-unit':0});assert.equal(result.preservesSourceUnits,true);assert.equal(result.rows[0].owned,1300);assert.equal(result.rows[0].deduct,600);
 assert.deepEqual(result.rows[0].allocations,[{stockKey:'rice|kilograms',sourceUnit:'kilograms',sourceQuantity:.6,unit:'g',quantity:600,estimated:false,assumptions:[]}]);assert.equal(JSON.stringify({stock,ingredients}),before);
});

test('volume aliases allocate litres to millilitres without rewriting source units',()=>{
 const result=proposal({stock:{'milk|litres':2},ingredients:[food('milk',750,'milliliters')],conversion:{}});
 assert.deepEqual(result.remainingStock,{'milk|litres':1.25});assert.equal(result.rows[0].unit,'ml');assert.equal(result.rows[0].deduct,750);assert.equal(result.rows[0].allocations[0].sourceQuantity,.75);
});

test('a checked 500 g pack can leave half a physical pack after cooking',()=>{
 const result=proposal({stock:{'pasta|pack':2},ingredients:[food('pasta',750)],conversion:{stock:{'pasta|pack':pack(500,'g',{stockKey:'pasta|pack',sourceUnit:'pack',canonicalKey:'pasta'})}}});
 assert.deepEqual(result.remainingStock,{'pasta|pack':.5});assert.equal(result.rows[0].owned,1000);assert.equal(result.rows[0].deduct,750);assert.equal(result.rows[0].estimated,false);assert.match(result.rows[0].assumptions.join(' '),/Reviewed contents/);assert.equal(result.rows[0].allocations[0].sourceQuantity,1.5);
});

test('different checked pack sizes and duplicate recipe rows share physical stock exactly once',()=>{
 const stock={'rice|pack':1,'Rice|packs':1},conversion={stock:{'rice|pack':pack(500,'g'),'Rice|packs':pack(250,'g')}};
 const result=proposal({stock,ingredients:[food('rice',400),food('Rice',300)],conversion});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].required,700);assert.equal(result.rows[0].deduct,700);assert.equal(Object.hasOwn(result.remainingStock,'rice|pack'),false);almost(result.remainingStock['Rice|packs'],.2);almost(result.remainingStock['Rice|packs']*250,50);
 assert.equal(result.rows[0].allocations.length,2);assert.equal(result.used[0].allocations.length,2);
});

test('checked package contents can be volume or an exact number of items',()=>{
 const milk=proposal({stock:{'milk|bottle':1},ingredients:[food('milk',250,'ml')],conversion:{stock:{'milk|bottle':pack(1,'l',{sourceUnit:'bottle'})}}});assert.deepEqual(milk.remainingStock,{'milk|bottle':.75});
 const eggs=proposal({stock:{'eggs|pack':2},ingredients:[food('eggs',8,'each')],conversion:{stock:{'eggs|pack':pack(6,'each')}}});almost(eggs.remainingStock['eggs|pack'],2/3);almost(eggs.remainingStock['eggs|pack']*6,4);assert.equal(eggs.rows[0].deduct,8);
});

test('unreviewed or unknown bags remain intact while compatible measured stock can be used',()=>{
 for(const metadata of [undefined,{packQuantity:500,packUnit:'g'},{reviewed:false,packQuantity:500,packUnit:'g'}]){
  const result=proposal({stock:{'rice|bag':2,'rice|g':50,'salt|g':20},ingredients:[food('rice',100)],conversion:{stock:metadata?{'rice|bag':metadata}:{}}});
  assert.deepEqual(result.remainingStock,{'rice|bag':2,'salt|g':20});assert.equal(result.rows[0].deduct,50);assert.equal(result.rows[0].issue,'unit_mismatch');assert.match(result.rows[0].issueLabel,/2 bag.*review At home/i);
 }
});

test('incorrect package source identity or contents never consume the ambiguous stock',()=>{
 for(const metadata of [pack(500,'g',{canonicalKey:'beans'}),pack(500,'g',{sourceUnit:'bag'}),pack(500,'g',{stockKey:'rice|bag'}),pack(-1,'g'),pack(Infinity,'g'),pack('500','g'),pack(500,'handful')]){
  const result=proposal({stock:{'rice|pack':2},ingredients:[food('rice',100)],conversion:{stock:{'rice|pack':metadata}}});assert.deepEqual(result.remainingStock,{'rice|pack':2});assert.equal(result.rows[0].deduct,0);assert.equal(result.issues.length,1);
 }
});

test('retail pack metadata on already measured grams is never multiplied into stock again',()=>{
 const result=proposal({stock:{'rice|g':1000},ingredients:[food('rice',100)],conversion:{stock:{'rice|g':pack(500,'g')}}});assert.deepEqual(result.remainingStock,{'rice|g':900});assert.equal(result.rows[0].owned,1000);assert.deepEqual(result.rows[0].assumptions,[]);
});

test('no blanket weight-volume conversion is available without food-specific density',()=>{
 const stock={'milk|ml':1000},ingredients=[food('milk',250)],without=proposal({stock,ingredients,conversion:{}});assert.deepEqual(without.remainingStock,stock);assert.equal(without.rows[0].deduct,0);assert.match(without.rows[0].issueLabel,/food-specific conversion/);
 const result=proposal({stock,ingredients:[food('milk',257.5)],conversion:{foods:{milk:{densityGPerMl:1.03}}}});almost(result.remainingStock['milk|ml'],750);assert.equal(result.rows[0].estimated,true);assert.match(result.rows[0].assumptions.join(' '),/1.03 g per ml/);almost(result.rows[0].allocations[0].sourceQuantity,250);
});

test('the same supplied density supports the reverse conversion and retains source mass',()=>{
 const result=proposal({stock:{'milk|g':1030},ingredients:[food('milk',250,'ml')],conversion:{foods:{milk:{densityGPerMl:1.03,estimated:false,assumption:'Measured density for this milk'}}}});
 almost(result.remainingStock['milk|g'],772.5);almost(result.rows[0].allocations[0].sourceQuantity,257.5);assert.equal(result.rows[0].estimated,false);assert.match(result.rows[0].assumptions.join(' '),/Measured density/);
});

test('checked package contents can combine with a supplied density without inventing a universal ratio',()=>{
 const result=proposal({stock:{'syrup|bottle':2},ingredients:[food('syrup',300)],conversion:{stock:{'syrup|bottle':pack(250,'ml')},foods:{syrup:{densityGPerMl:1.2}}}});
 assert.deepEqual(result.remainingStock,{'syrup|bottle':1});assert.equal(result.rows[0].deduct,300);assert.equal(result.rows[0].allocations[0].sourceQuantity,1);assert.equal(result.rows[0].estimated,true);assert.equal(result.rows[0].assumptions.length,2);
});

test('supplied food-specific item weight converts counts and discloses its assumption',()=>{
 const conversion={foods:{carrot:{gramsPerEach:80}}};
 const fromCount=proposal({stock:{'carrot|each':3},ingredients:[food('carrot',120)],conversion});assert.deepEqual(fromCount.remainingStock,{'carrot|each':1.5});assert.equal(fromCount.rows[0].estimated,true);assert.match(fromCount.rows[0].assumptions.join(' '),/80 g per item/);
 const toCount=proposal({stock:{'carrot|g':240},ingredients:[food('carrot',2,'each')],conversion});assert.deepEqual(toCount.remainingStock,{'carrot|g':80});assert.equal(toCount.rows[0].unit,'g');assert.equal(toCount.rows[0].required,160);assert.equal(toCount.rows[0].allocations[0].estimated,true);
});

test('existing canonical whole-produce averages require the explicit basis and stay estimated',()=>{
 const p=pricing(),stock={'carrot|each':2},ingredients=[food('carrot',100)],base={canonicalMeasure:p.canonicalMeasure};
 const without=proposal({stock,ingredients,conversion:base});assert.deepEqual(without.remainingStock,stock);assert.equal(without.rows[0].deduct,0);
 const result=proposal({stock,ingredients,conversion:{...base,basis:{wholeProduce:true}}});assert.deepEqual(result.remainingStock,{'carrot|each':.75});assert.equal(result.rows[0].canonicalKey,'carrot');assert.equal(result.rows[0].estimated,true);assert.match(result.rows[0].assumptions.join(' '),/80 g per whole item/);
});

test('canonical spoon conversions require their basis and preserve stored spoon units',()=>{
 const p=pricing(),conversion={canonicalMeasure:p.canonicalMeasure,basis:{spoons:true}};
 const oil=proposal({stock:{'cooking oil|tbsp':2},ingredients:[food('cooking oil',15,'ml')],conversion});assert.deepEqual(oil.remainingStock,{'cooking oil|tbsp':1});assert.equal(oil.rows[0].estimated,false);assert.match(oil.rows[0].assumptions.join(' '),/1 tbsp = 15 ml/);
 const spice=proposal({stock:{'ground cumin|g':20},ingredients:[food('ground cumin',2,'tsp')],conversion});assert.deepEqual(spice.remainingStock,{'ground cumin|g':14});assert.equal(spice.rows[0].estimated,true);assert.equal(spice.rows[0].allocations[0].estimated,true);assert.match(spice.rows[0].assumptions.join(' '),/Approximate dry spoon weight/);
});

test('a canonical provider is never queried for guessed bag or pack contents',()=>{
 const queried=[];const result=proposal({stock:{'rice|bag':1},ingredients:[food('rice',300)],conversion:{canonicalMeasure:(_name,_quantity,unit)=>{queried.push(unit);return {key:'rice',quantity:500,unit:'g',estimated:true};},basis:{wholeProduce:true,spoons:true},catalog:{'rice|bag':{standard_pack_size:500,standard_pack_unit:'g'}}}});
 assert.deepEqual(result.remainingStock,{'rice|bag':1});assert.equal(result.rows[0].deduct,0);assert.ok(queried.every(unit=>!['bag','pack'].includes(unit)));
});

test('different weight and volume recipe rows share one source balance without double consumption',()=>{
 const result=proposal({stock:{'milk|l':1,'salt|g':10},ingredients:[food('milk',500),food('milk',750,'ml')],conversion:{foods:{milk:{densityGPerMl:1}}}});
 assert.deepEqual(result.remainingStock,{'salt|g':10});assert.equal(result.rows[0].deduct,500);assert.equal(result.rows[1].owned,500);assert.equal(result.rows[1].deduct,500);almost(result.rows.flatMap(row=>row.allocations).reduce((sum,row)=>sum+row.sourceQuantity,0),1);
});

test('explicitly checked recipe packs normalize to their real contents before grouping',()=>{
 const result=proposal({stock:{'rice|g':1000},ingredients:[food('rice',1,'pack',{reviewed:true,packQuantity:400,packUnit:'g'}),food('rice',1,'pack',{reviewed:true,packQuantity:500,packUnit:'g'})],conversion:{}});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].unit,'g');assert.equal(result.rows[0].required,900);assert.deepEqual(result.remainingStock,{'rice|g':100});
});

test('food states cannot become equivalent even if a caller supplies an overbroad identity function',()=>{
 const id=(name,unit)=>name.toLowerCase().replace(/^(?:cooked|frozen) /,'')+'|'+unit;
 for(const key of ['cooked rice|g','frozen rice|g']){const stock={[key]:500};const result=proposal({stock,ingredients:[food('rice',100)],id,conversion:{foods:{rice:{densityGPerMl:1,gramsPerEach:80}}}});assert.deepEqual(result.remainingStock,stock);assert.equal(result.rows[0].deduct,0);assert.equal(result.issues.length,1);}
});

test('a cooked display name cannot lose its food-state protection through a generic normalized key',()=>{
 const stock={'rice|g':500},result=proposal({stock,ingredients:[food('rice',100,'g',{name:'Cooked rice'})],conversion:{}});assert.deepEqual(result.remainingStock,stock);assert.equal(result.rows[0].deduct,0);assert.equal(result.issues.length,1);
 const p=pricing(),id=(name,unit)=>name.toLowerCase().replace(/^cooked /,'')+'|'+unit;
 const count=proposal({stock:{'cooked carrot|g':500},ingredients:[food('carrot',1,'each',{name:'Cooked carrot'})],id,conversion:{canonicalMeasure:p.canonicalMeasure,basis:{wholeProduce:true}}});assert.deepEqual(count.remainingStock,{'cooked carrot|g':500});assert.equal(count.rows[0].deduct,0);
});

test('conflicting raw and cooked descriptions cannot merge into an unsafe shared consumption',()=>{
 const stock={'rice|g':500,'cooked rice|g':200},id=(name,unit)=>name.toLowerCase().replace(/^cooked /,'')+'|'+unit;
 const result=proposal({stock,ingredients:[food('rice',100),food('rice',100,'g',{name:'Cooked rice'})],id,conversion:{}});
 assert.deepEqual(result.remainingStock,stock);assert.equal(result.rows[0].required,200);assert.equal(result.rows[0].deduct,0);assert.match(result.rows[0].issueLabel,/different food states/);
});

test('unknown recipe lines remain reviewable without suppressing a known quantity of the same food',()=>{
 const result=proposal({stock:{'rice|g':500,'herbs|handful':2},ingredients:[food('rice',100),food('rice',null)],conversion:{}});
 assert.deepEqual(result.remainingStock,{'rice|g':400,'herbs|handful':2});assert.equal(result.rows.length,2);assert.equal(result.rows[0].deduct,100);assert.equal(result.rows[1].issue,'amount_unknown');assert.equal(result.rows[1].allocations.length,0);
});

test('reviewed amount edits use the final row unit and zero skips an ingredient',()=>{
 const result=proposal({stock:{'carrot|each':3,'milk|l':1},ingredients:[food('carrot',160),food('milk',250,'ml')],amounts:[{id:'carrot|g',quantity:.1,unit:'kg'},{id:'milk|ml',quantity:0,unit:'ml'}],conversion:{foods:{carrot:{gramsPerEach:80}}}});
 assert.deepEqual(result.remainingStock,{'carrot|each':1.75,'milk|l':1});assert.equal(result.rows[0].deduct,100);assert.equal(result.rows[1].deduct,0);
});

test('no valid positive stock or consumption is rounded away in physical allocation mode',()=>{
 const result=proposal({stock:{'water|ml':1e-7},ingredients:[food('water',5e-8,'ml')],conversion:{}});assert.equal(result.remainingStock['water|ml'],5e-8);assert.equal(result.rows[0].deduct,5e-8);
 const thirds=proposal({stock:{'rice|pack':1},ingredients:[food('rice',1)],conversion:{stock:{'rice|pack':pack(3,'g')}}});almost(thirds.remainingStock['rice|pack']*3,2);almost(thirds.rows[0].allocations[0].sourceQuantity+thirds.remainingStock['rice|pack'],1);
});

test('unrepresentable sub-unit changes remain in stock and are flagged instead of pretending to consume',()=>{
 const stock={'rice|pack':1},result=proposal({stock,ingredients:[food('rice',2e-300)],conversion:{stock:{'rice|pack':pack(500,'g')}}});
 assert.deepEqual(result.remainingStock,stock);assert.equal(result.rows[0].deduct,0);assert.deepEqual(result.rows[0].allocations,[]);assert.match(result.rows[0].issueLabel,/too small to record safely/);
});

test('negative, non-finite or overflowing source and recipe values fail without mutation',()=>{
 for(const stock of [{'rice|g':-1},{'rice|g':Infinity},{'rice|kg':1001},{'broken':100}]){const before={...stock};assert.throws(()=>proposal({stock,ingredients:[food('rice',100)],conversion:{}}),/Review|Check/);assert.deepEqual(stock,before);}
 for(const required of [-1,Infinity,'100'])assert.throws(()=>proposal({stock:{'rice|g':500},ingredients:[food('rice',required)],conversion:{}}),/Check/);
 assert.throws(()=>proposal({stock:{'rice|pack':3000},ingredients:[food('rice',100)],conversion:{stock:{'rice|pack':pack(500,'g')}}}),/converted pantry amounts/);
});

test('invalid, conflicting or wrong-food densities fall back to review rather than a guessed conversion',()=>{
 for(const foods of [{milk:{densityGPerMl:-1}},{milk:{densityGPerMl:Infinity}},{milk:{densityGPerMl:1,canonicalKey:'oil'}},{milk:{densityGPerMl:1},Milk:{densityGPerMl:1.03}},{rice:{densityGPerMl:1}}]){
  const result=proposal({stock:{'milk|ml':1000},ingredients:[food('milk',100)],conversion:{foods}});assert.deepEqual(result.remainingStock,{'milk|ml':1000});assert.equal(result.rows[0].deduct,0);assert.equal(result.issues.length,1);
 }
});
