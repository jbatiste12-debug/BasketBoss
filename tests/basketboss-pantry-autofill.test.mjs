import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const {create}=createRequire(import.meta.url)('../bb-pantry-autofill.js');
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
function pricing(){const context=vm.createContext({});vm.runInContext(read('basketboss-pricing-v19.js'),context);return context.BBPriceV19.canonicalMeasure;}
const rows=(key,quantity,unit='g')=>[{key,quantity,unit}];
const planner=stock=>create({stock,canonicalMeasure:pricing()});
const DAY=86400000,NOW=Date.parse('2026-11-04T12:00:00Z');

test('known remaining stock outranks a recipe that needs entirely new ingredients',()=>{
 const pantry=planner({'rice|g':500,'carrots|g':250});
 const first={id:'rice-dinner',ingredients:rows('Rice',300)},second={id:'pasta-dinner',ingredients:rows('Pasta',300)};
 const ranked=pantry.rank([second,first]);
 assert.equal(ranked[0].candidate.id,'rice-dinner');assert.equal(ranked[0].matchedIngredients,1);
 assert.equal(ranked[0].coverage,1);assert.equal(ranked[1].score,0);
 assert.deepEqual(pantry.snapshot(),{'rice|g':500,'carrot|g':250},'ranking is read-only');
});

test('one 500 g stock source is reserved across a proposal, never reused for every dinner',()=>{
 const stock=Object.freeze({'rice|g':500}),pantry=planner(stock),meal=rows('rice',300);
 assert.equal(pantry.reserve(meal).used[0].quantity,300);
 const second=pantry.reserve(meal);assert.equal(second.used[0].quantity,200);assert.equal(second.coverage,2/3);
 assert.deepEqual(pantry.snapshot(),{});assert.equal(pantry.assess(meal).score,0);
 assert.deepEqual(stock,{'rice|g':500},'planning does not deduct saved stock');
 assert.equal(planner(stock).assess(meal).coverage,1,'a fresh attempt has an independent reservation ledger');
});

test('fixed meals reserve stock before suggestions and serving amounts determine available coverage',()=>{
 const pantry=planner({'rice|g':1000});
 pantry.reserve(rows('rice',600));
 const assessed=pantry.assess(rows('rice',800));
 assert.equal(assessed.coverage,.5);assert.equal(assessed.used[0].quantity,400);
 assert.equal(pantry.reserve(rows('rice',800)).used[0].quantity,400);assert.deepEqual(pantry.snapshot(),{});
});

test('actual canonical measure combines exact aliases, metric units and disclosed whole-produce estimates',()=>{
 const stock=Object.freeze({'Rice|kg':.5,'carrots|g':250,'Carrot|each':2}),pantry=planner(stock);
 assert.deepEqual(pantry.snapshot(),{'rice|g':500,'carrot|g':410});
 const assessed=pantry.assess([{key:'rice',quantity:300,unit:'g'},{key:'carrots',quantity:.3,unit:'kg'}]);
 assert.equal(assessed.coverage,1);assert.equal(assessed.estimated,true);
 assert.deepEqual(assessed.assumptions,['Estimated 80 g per whole item for carrot']);
 assert.deepEqual(stock,{'Rice|kg':.5,'carrots|g':250,'Carrot|each':2});
});

test('duplicate recipe aliases reserve one combined requirement rather than claiming the same stock twice',()=>{
 const pantry=planner({'carrot|g':250});
 const assessed=pantry.reserve([{key:'Carrots',quantity:100,unit:'g'},{key:'carrot',quantity:200,unit:'g'}]);
 assert.equal(assessed.requiredIngredients,1);assert.equal(assessed.matchedIngredients,1);
 assert.equal(assessed.used[0].quantity,250);assert.equal(assessed.used[0].required,300);
 assert.deepEqual(pantry.snapshot(),{});
});

test('unknown stock, invalid amounts and ambiguous units cannot create a pantry preference',()=>{
 const pantry=planner({'rice|g':'500','pasta|g':NaN,'milk|ml':null,'carrot|none':2,'salt|pinch':3,
  'beans|g':-2,'oil|ml':true,'bad|g|g':30,'constructor|g':5,'chicken|g':Infinity,'rice|kg':2000});
 assert.deepEqual(pantry.snapshot(),{});
 assert.equal(pantry.assess(rows('rice',300)).score,0);
 const invalid=planner({'rice|g':500}).assess([{key:'rice',quantity:null,unit:'g'}]);
 assert.equal(invalid.score,0);assert.equal(invalid.unmeasuredIngredients,1);
});

test('mass and volume, packages and prepared food forms remain distinct',()=>{
 const pantry=planner({'honey|g':100,'carrot|bag':1,'cooked carrots|g':300});
 for(const ingredients of [rows('honey',20,'ml'),rows('carrot',100),rows('carrot',2,'each')])assert.equal(pantry.assess(ingredients).score,0);
 assert.equal(pantry.assess(rows('cooked carrots',100)).matchedIngredients,1);
 assert.equal(pantry.assess(rows('carrot',1,'bag')).matchedIngredients,1);
});

test('uncertain recipe amounts reduce coverage instead of pretending the whole meal is covered',()=>{
 const pantry=planner({'rice|g':500});
 const assessed=pantry.assess([{key:'rice',quantity:300,unit:'g'},{key:'salt',required:null,unit:'g'}]);
 assert.equal(assessed.requiredIngredients,2);assert.equal(assessed.unmeasuredIngredients,1);assert.equal(assessed.coverage,.5);
});

test('source-proven garlic units match their own stock without inventing bulb-to-clove conversions',()=>{
 const pantry=planner({'garlic|clove':3,'garlic|bulb':1});
 const clove=pantry.assess(rows('Garlic',2,'each'),{sourceIngredients:[['Garlic','2 cloves']]});
 assert.equal(clove.used[0].unit,'clove');assert.equal(clove.used[0].quantity,2);
 assert.equal(pantry.assess(rows('Garlic',2,'each')).score,0);
});

test('ranking only receives already eligible recipes and never synthesizes forbidden candidates or expiry claims',()=>{
 const pantry=planner({'rice|g':500}),eligible=[{id:'allowed',ingredients:rows('pasta',100)}];
 assert.deepEqual(pantry.rank(eligible).map(row=>row.candidate.id),['allowed']);
 assert.equal(pantry.rank(eligible)[0].score,0);
 const output=JSON.stringify(pantry.assess(rows('rice',100)));
 assert.equal(/expir|oldest|use-by|best-before/i.test(output),false);
 const snapshot=pantry.snapshot();snapshot['rice|g']=0;assert.equal(pantry.snapshot()['rice|g'],500);
});

test('overflowing alias groups stay unreadable rather than returning as a smaller usable amount',()=>{
 const pantry=planner({'rice|g':500});
 const assessed=pantry.reserve([{key:'Rice',quantity:600000,unit:'g'},{key:'rice',quantity:600,unit:'kg'},{key:'RICE',quantity:100,unit:'g'}]);
 assert.equal(assessed.score,0);assert.equal(assessed.unmeasuredIngredients,1);
 assert.deepEqual(pantry.snapshot(),{'rice|g':500});
 const invalid=planner({'Rice|g':600000,'rice|kg':600,'RICE|g':100});
 assert.deepEqual(invalid.snapshot(),{});
});

test('simple scoring awards three per matched non-staple ingredient while staples still reserve normally',()=>{
 const pantry=create({stock:{'rice|g':500,'beans|g':300,'salt|g':100,'pepper|g':50,'olive oil|ml':500,'water|ml':1000},canonicalMeasure:pricing(),now:NOW});
 const meal=[{key:'rice',quantity:200,unit:'g'},{key:'beans',quantity:200,unit:'g'},
  {key:'salt',quantity:2,unit:'g'},{key:'pepper',quantity:1,unit:'g'},{key:'olive oil',quantity:15,unit:'ml'},{key:'water',quantity:300,unit:'ml'}];
 const score=pantry.reserve(meal);
 assert.equal(score.matchedIngredients,6);assert.equal(score.pantryMatches,2);
 assert.equal(score.pantryBonus,6);assert.equal(score.recentPenalty,0);assert.equal(score.sameProteinPenalty,0);assert.equal(score.score,6);
 assert.equal(pantry.snapshot()['salt|g'],98);assert.equal(pantry.snapshot()['olive oil|ml'],485,'ignored scoring staples still have finite planning reservations');
});

test('one food in different measured dimensions gives one overlap bonus without a density conversion',()=>{
 const pantry=create({stock:{'honey|g':50,'honey|ml':50},canonicalMeasure:pricing(),now:NOW});
 const score=pantry.assess([{key:'honey',quantity:20,unit:'g'},{key:'honey',quantity:20,unit:'ml'}]);
 assert.equal(score.used.length,2);assert.equal(score.pantryMatches,1);assert.equal(score.pantryBonus,3);
});

test('only actual dated history earns the seven- or fourteen-day penalty at exact boundaries',()=>{
 const cases=[[0,6],[7*DAY,6],[7*DAY+1,3],[8*DAY,3],[14*DAY,3],[14*DAY+1,0]];
 for(const [age,penalty]of cases){
  const pantry=create({stock:{'rice|g':500},canonicalMeasure:pricing(),now:()=>NOW,lastPlannedAt:{meal:NOW-age}});
  const score=pantry.assess(rows('rice',100),{recipeId:'meal'});
  assert.equal(score.recentPenalty,penalty,String(age));assert.equal(score.score,3-penalty);
 }
 for(const history of [{meal:'undated'},['meal'],{meal:NOW+DAY},{meal:null},{meal:true}]){
  const pantry=create({stock:{'rice|g':500},canonicalMeasure:pricing(),now:NOW,lastPlannedAt:history});
  assert.equal(pantry.assess(rows('rice',100),{recipeId:'meal',recentIds:['meal']}).recentPenalty,0,'undated IDs and invalid/future timestamps cannot invent a recent date');
 }
 const iso=create({stock:{},canonicalMeasure:pricing(),now:NOW,lastPlannedAt:{meal:new Date(NOW-DAY).toISOString()}});
 assert.equal(iso.assess([],{recipeId:'meal'}).recentPenalty,6);
});

test('same-protein penalty compares exact supplied identities without grouping other species',()=>{
 const pantry=create({stock:{'rice|g':500},canonicalMeasure:pricing(),now:NOW});
 assert.equal(pantry.assess(rows('rice',100),{protein:' Chicken ',previousProtein:'chicken'}).sameProteinPenalty,4);
 assert.equal(pantry.assess(rows('rice',100),{protein:'chicken',previousProtein:'turkey'}).sameProteinPenalty,0);
 assert.equal(pantry.assess(rows('rice',100),{protein:'salmon',previousProtein:'cod'}).sameProteinPenalty,0);
 assert.equal(pantry.assess(rows('rice',100),{protein:'salmon',previousProtein:'salmon'}).sameProteinPenalty,4);
 assert.equal(pantry.assess(rows('rice',100),{protein:'unknown',previousProtein:'unknown'}).sameProteinPenalty,0);
});

test('pantry overlap is a weighted preference and never filters out an eligible recipe',()=>{
 const pantry=create({stock:{'rice|g':500},canonicalMeasure:pricing(),now:NOW,lastPlannedAt:{recent:NOW-DAY}});
 const candidates=[{id:'recent',protein:'chicken',ingredients:rows('rice',100)},{id:'new',protein:'beans',ingredients:rows('pasta',100)}];
 const ranked=pantry.rank(candidates,{context:candidate=>({protein:candidate.protein,previousProtein:'chicken'})});
 assert.deepEqual(ranked.map(row=>row.candidate.id),['new','recent']);
 assert.equal(ranked[0].score,0);assert.equal(ranked[1].score,3-6-4);
 assert.equal(ranked.length,candidates.length,'negative scoring changes order, not eligibility');
 assert.equal(pantry.snapshot()['rice|g'],500);
});

test('coverage breaks equal formula scores without giving salt, pepper, oil or water a hidden bonus',()=>{
 const pantry=create({stock:{'rice|g':500,'salt|g':50,'pepper|g':50,'oil|ml':50,'water|ml':500},canonicalMeasure:pricing(),now:NOW});
 const ranked=pantry.rank([{id:'big',ingredients:rows('rice',1000)},{id:'covered',ingredients:rows('rice',300)}]);
 assert.equal(ranked[0].candidate.id,'covered');assert.equal(ranked[0].score,ranked[1].score);
 const staples={id:'staples',ingredients:[{key:'salt',quantity:1,unit:'g'},{key:'pepper',quantity:1,unit:'g'},{key:'oil',quantity:10,unit:'ml'},{key:'water',quantity:100,unit:'ml'}]};
 const empty={id:'new',ingredients:rows('pasta',100)};
 const tie=pantry.rank([empty,staples]);assert.equal(tie[0].candidate.id,'new');assert.equal(tie[1].score,0);assert.equal(tie[1].pantryCoverage,0);
});

test('known whole peppers remain a food match while black pepper seasoning is excluded',()=>{
 const pantry=create({stock:{'pepper|each':2,'black pepper|g':50},canonicalMeasure:pricing(),now:NOW});
 const fresh=pantry.assess(rows('pepper',1,'each'));
 assert.equal(fresh.pantryMatches,1);assert.equal(fresh.score,3);assert.equal(fresh.estimated,true);
 assert.equal(pantry.assess(rows('black pepper',1)).score,0);
});

// A deterministic producer fixture exercises the consumer's physical-source
// contract. Conversion factors belong to the injected proposal, not Autofill.
function physicalProposal({stockKey,key='rice',unit='g',unitsPerSource=1000,estimated=false,assumptions=[]}={}){
 return ({stock,ingredients})=>{
  const required=ingredients[0].required,quantity=stock[stockKey]||0,owned=quantity*unitsPerSource,deduct=Math.min(required,owned),sourceQuantity=deduct/unitsPerSource;
  const remainingStock={...stock};if(quantity-sourceQuantity>0)remainingStock[stockKey]=quantity-sourceQuantity;else delete remainingStock[stockKey];
  return {rows:[{id:key+'|'+unit,canonicalKey:key,name:key,unit,required,owned,deduct,estimated,assumptions,
   allocations:deduct>0?[{stockKey,sourceUnit:stockKey.split('|')[1],sourceQuantity,unit,quantity:deduct}]:[]}],remainingStock};
 };
}

test('injected physical proposal keeps one kilogram source in kilograms and never mutates caller stock',()=>{
 const stock=Object.freeze({'rice|kg':1}),ingredients=Object.freeze([Object.freeze({key:'rice',quantity:300,unit:'g'})]);
 const seen=[],producer=physicalProposal({stockKey:'rice|kg'});
 const pantry=create({stock,now:NOW,proposal:input=>{seen.push(JSON.parse(JSON.stringify(input)));return producer(input);}});
 assert.deepEqual(pantry.snapshot(),{'rice|kg':1});
 const assessed=pantry.assess(ingredients);assert.equal(assessed.pantryBonus,3);assert.equal(assessed.used[0].quantity,300);
 assert.deepEqual(pantry.snapshot(),{'rice|kg':1},'assessment does not reserve');
 assert.equal(Object.hasOwn(assessed,'remainingStock'),false,'the next private stock state is not exposed in the public score');
 pantry.reserve(ingredients);assert.deepEqual(pantry.snapshot(),{'rice|kg':.7});
 assert.equal(seen[0].ingredients[0].required,300,'quantity rows adapt to the shared proposal requirement field');
 assert.deepEqual(stock,{'rice|kg':1});assert.equal(Object.hasOwn(ingredients[0],'required'),false);
});

test('known packs reserve their physical count once across the week instead of projecting duplicate grams',()=>{
 const stock=Object.freeze({'pasta|pack':2});
 const pantry=create({stock,now:NOW,proposal:physicalProposal({stockKey:'pasta|pack',key:'pasta',unitsPerSource:500})});
 assert.equal(pantry.reserve(rows('pasta',500)).used[0].quantity,500);assert.deepEqual(pantry.snapshot(),{'pasta|pack':1});
 assert.equal(pantry.reserve(rows('pasta',500)).used[0].quantity,500);assert.deepEqual(pantry.snapshot(),{});
 assert.equal(pantry.reserve(rows('pasta',500)).pantryBonus,0);assert.deepEqual(stock,{'pasta|pack':2});
});

test('an unknown pack remains unchanged and contributes no overlap bonus',()=>{
 const stock=Object.freeze({'rice|pack':2});
 const pantry=create({stock,now:NOW,proposal:({stock,ingredients})=>({remainingStock:{...stock},issues:[{id:'rice|g',message:'Pack contents need review'}],
  rows:[{id:'rice|g',canonicalKey:'rice',name:'Rice',unit:'g',required:ingredients[0].required,owned:0,deduct:0,estimated:false,assumptions:[],allocations:[]}]})});
 assert.equal(pantry.reserve(rows('rice',300)).pantryBonus,0);
 assert.deepEqual(pantry.snapshot(),{'rice|pack':2});assert.deepEqual(stock,{'rice|pack':2});
});

test('mass-volume conversion occurs only through the injected, disclosed conversion proposal',()=>{
 const stock=Object.freeze({'honey|ml':100});
 assert.equal(planner(stock).assess(rows('honey',70)).pantryBonus,0,'the default cannot invent a density');
 const pantry=create({stock,now:NOW,proposal:physicalProposal({stockKey:'honey|ml',key:'honey',unitsPerSource:1.4,estimated:true,assumptions:['Known honey density: 1.4 g per ml']})});
 const score=pantry.reserve(rows('honey',70));
 assert.equal(score.pantryBonus,3);assert.equal(score.used[0].quantity,70);assert.equal(score.estimated,true);
 assert.deepEqual(score.assumptions,['Known honey density: 1.4 g per ml']);assert.deepEqual(pantry.snapshot(),{'honey|ml':50});
 assert.deepEqual(stock,{'honey|ml':100});
});

test('physical count allocations prove whole peppers are food instead of seasoning pepper',()=>{
 const stock=Object.freeze({'pepper|each':2});
 const pantry=create({stock,now:NOW,proposal:physicalProposal({stockKey:'pepper|each',key:'pepper',unitsPerSource:160,estimated:true,assumptions:['Estimated whole pepper weight: 160 g each']})});
 const score=pantry.reserve(rows('pepper',300));
 assert.equal(score.pantryBonus,3);assert.equal(score.estimated,true);assert.deepEqual(pantry.snapshot(),{'pepper|each':.125});
 assert.deepEqual(stock,{'pepper|each':2});
});

test('an unrelated whole pepper in the recipe cannot turn seasoning pepper into a pantry bonus',()=>{
 const pantry=create({stock:{'pepper|g':50},now:NOW,proposal:physicalProposal({stockKey:'pepper|g',key:'pepper',unitsPerSource:1})});
 const score=pantry.reserve(rows('pepper',2),{sourceIngredients:[['Pepper','2 g'],['Red peppers','500 g']]});
 assert.equal(score.pantryBonus,0);assert.deepEqual(pantry.snapshot(),{'pepper|g':48});
});

test('physical producer failures cannot award overlap or reserve stock and retain weighted penalties',()=>{
 const baseline={'rice|kg':1},ingredients=rows('rice',300),valid=physicalProposal({stockKey:'rice|kg'});
 const failures=[
  ()=>{throw Error('conversion unavailable');},
  ()=>({}),
  input=>({...valid(input),remainingStock:{'rice|kg':1.0000001}}),
  input=>({...valid(input),remainingStock:{'rice|kg':.7,'rice|g':100}}),
  input=>({...valid(input),remainingStock:{'rice|kg':NaN}}),
  input=>({...valid(input),remainingStock:{'rice|kg':-.1}}),
  input=>{const result=valid(input);result.rows[0].required=200;return result;},
  input=>{const result=valid(input);result.rows[0].owned=200;return result;},
  input=>{const result=valid(input);result.rows[0].allocations[0].sourceQuantity=.2;return result;},
  input=>{const result=valid(input);result.rows[0].allocations[0].quantity=200;return result;},
  input=>{const result=valid(input);result.rows[0].allocations[0].stockKey='missing|kg';return result;},
  input=>{const result=valid(input);result.rows[0].estimated=true;return result;},
  input=>{input.stock['rice|kg']=0;input.ingredients[0].required=0;throw Error('mutated clone');}
 ];
 for(const proposal of failures){
  const pantry=create({stock:baseline,proposal,now:NOW,lastPlannedAt:{meal:NOW-DAY}});
  const score=pantry.reserve(ingredients,{recipeId:'meal',protein:'chicken',previousProtein:'chicken'});
  assert.equal(score.pantryBonus,0);assert.equal(score.score,-10);assert.equal(score.used.length,0);
  assert.deepEqual(pantry.snapshot(),baseline);
  assert.deepEqual(baseline,{'rice|kg':1});assert.equal(ingredients[0].quantity,300);
  assert.equal(pantry.rank([{id:'one',ingredients},{id:'two',ingredients}]).length,2,'failed conversion cannot remove an otherwise eligible recipe');
 }
});
