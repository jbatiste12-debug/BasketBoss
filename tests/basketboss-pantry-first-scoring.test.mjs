import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),autofill=require('../bb-pantry-autofill.js');
const deduction=require('../bb-pantry-deduction.js'),policy=require('../bb-pantry-policy.js');
const NOW=Date.parse('2026-11-11T12:00:00Z');
const ingredient=(key,required,unit='g')=>({key,name:key,required,unit});
const recipe=(id,...ingredients)=>({id,ingredients});
const id=(name,unit)=>policy.canonicalName(name)+'|'+unit;
const clone=value=>JSON.parse(JSON.stringify(value));
function physical(stock,{conversion={},...options}={}){
 return autofill.create({stock,now:NOW,scoringMode:'pantry-first',
  proposal:input=>deduction.proposal({...input,id,conversion:{pantryMode:true,market:'UK',...conversion}}),...options});
}

test('pantry-first ranks ingredient percentage ahead of absolute matches and weighted history bonuses',()=>{
 const pantry=physical({'rice|g':50,'beans|g':100},{lastPlannedAt:{single:NOW},priorityStockKeys:['beans|g']});
 const many=recipe('many',ingredient('Rice',100),ingredient('Beans',100),ingredient('Pasta',100));
 const single=recipe('single',ingredient('Rice',100));
 const ranked=pantry.rank([many,single]);
 assert.equal(ranked[0].candidate.id,'single');
 assert.equal(ranked[0].score,100);assert.equal(ranked[0].availabilityPercent,100);
 assert.equal(ranked[0].availableIngredients,1);assert.equal(ranked[0].eligibleIngredients,1);
 assert.equal(ranked[0].fullyCoveredIngredients,0);assert.equal(ranked[0].fullCoveragePercent,0);
 assert.equal(ranked[0].quantityCoverage,.5);assert.equal(ranked[0].pantryCoverage,.5);
 assert.equal(ranked[0].recentPenalty,6,'recency remains descriptive rather than defeating the requested pantry order');
 assert.equal(ranked[1].score,100*2/3);assert.equal(ranked[1].fullyCoveredIngredients,1);
});

test('equal availability uses allocated quantity coverage and then deterministic candidate order',()=>{
 const pantry=physical({'rice|g':50,'beans|g':100});
 const partial=recipe('partial',ingredient('Rice',100)),full=recipe('full',ingredient('Beans',100));
 const ranked=pantry.rank([partial,full]);
 assert.deepEqual(ranked.map(row=>row.candidate.id),['full','partial']);
 assert.equal(ranked[0].score,ranked[1].score);assert.equal(ranked[0].quantityCoverage,1);
 const tied=pantry.rank([recipe('second-name',ingredient('Rice',100)),recipe('first-name',ingredient('Rice',100))]);
 assert.deepEqual(tied.map(row=>row.candidate.id),['second-name','first-name']);
 assert.deepEqual(pantry.snapshot(),{'rice|g':50,'beans|g':100});
});

test('existing meals and sequential suggestions share the original physical reservation ledger',()=>{
 const stock=Object.freeze({'rice|g':500,'beans|g':300}),pantry=physical(stock);
 pantry.reserve([ingredient('Rice',200)]);
 const candidates=[recipe('rice-meal',ingredient('Rice',300)),recipe('beans-meal',ingredient('Beans',300))];
 const first=pantry.rank(candidates)[0];assert.equal(first.candidate.id,'rice-meal');
 pantry.reserve(first.candidate.ingredients);
 assert.equal(pantry.assess(candidates[0].ingredients).availabilityPercent,0);
 const next=pantry.rank(candidates)[0];assert.equal(next.candidate.id,'beans-meal');pantry.reserve(next.candidate.ingredients);
 assert.deepEqual(pantry.snapshot(),{});assert.deepEqual(stock,{'rice|g':500,'beans|g':300});
});

test('measured leftovers across storage sources use only the injected conversion and retain exact fractions',()=>{
 // The host supplies one live stock snapshot for Cupboard, Fridge and Freezer;
 // source names/units remain physical and are allocated by the shared producer.
 const stock=Object.freeze({'chicken breast|g':533.333333,'rice|kg':.3,'peas|g':200});
 const ingredients=Object.freeze([Object.freeze(ingredient('Chicken breast',600)),Object.freeze(ingredient('Rice',300)),Object.freeze(ingredient('Peas',200))]);
 const pantry=physical(stock),before=clone(stock),score=pantry.assess(ingredients);
 assert.equal(score.availableIngredients,3);assert.equal(score.eligibleIngredients,3);assert.equal(score.availabilityPercent,100);
 assert.equal(score.fullyCoveredIngredients,2);assert.ok(score.quantityCoverage<1);
 assert.equal(score.used.find(row=>row.key==='chicken breast').quantity,533.333333);
 assert.deepEqual(stock,before);assert.deepEqual(pantry.snapshot(),before);
 assert.equal(ingredients[0].required,600);assert.equal(stock['chicken breast|g'],533.333333);
});

test('unmeasured and status-only staples cannot inflate pantry availability',()=>{
 const pantry=physical({'rice|g':200,'salt|each':1,'olive oil|each':1},{conversion:{staples:{salt:{status:'in'},'olive oil':{status:'in'}}}});
 const score=pantry.assess([ingredient('Rice',100),ingredient('Pasta',100),ingredient('Salt',2),ingredient('Olive oil',10,'ml'),ingredient('Water',null,'ml')]);
 assert.equal(score.eligibleIngredients,2);assert.equal(score.availableIngredients,1);assert.equal(score.availabilityPercent,50);
 assert.equal(score.quantityCoverage,.5);assert.equal(score.fullyCoveredIngredients,1);
 assert.deepEqual(pantry.snapshot(),{'rice|g':200,'salt|each':1,'olive oil|each':1});
});

test('explicitly measured staples count with finite coverage and remain eligible after reservation',()=>{
 const pantry=physical({'rice|g':100,'salt|g':2},{conversion:{measuredStockKeys:['salt|g'],measuredFoods:['Salt']}});
 const meal=[ingredient('Rice',100),ingredient('Salt',2)];
 const first=pantry.reserve(meal);assert.equal(first.eligibleIngredients,2);assert.equal(first.availableIngredients,2);assert.equal(first.fullCoveragePercent,100);
 const next=pantry.assess(meal);assert.equal(next.eligibleIngredients,2);assert.equal(next.availableIngredients,0);assert.equal(next.availabilityPercent,0);
 assert.deepEqual(pantry.snapshot(),{});
});

test('canonical duplicate recipe lines count once and unfamiliar non-staples reduce coverage',()=>{
 const pantry=physical({'rice|g':300});
 const score=pantry.assess([ingredient('Rice',100),ingredient('Rice',200),ingredient('Unfamiliar vegetable',null)]);
 assert.equal(score.eligibleIngredients,2);assert.equal(score.availableIngredients,1);assert.equal(score.availabilityPercent,50);
 assert.equal(score.fullyCoveredIngredients,1);assert.equal(score.quantityCoverage,.5);
});

test('count and weight remain distinct unless the existing proposal has reviewed conversion evidence',()=>{
 const pantry=physical({'eggs|each':2,'rice|pack':1,'honey|ml':100});
 const eggs=pantry.assess([ingredient('Eggs',3,'each')]);
 assert.equal(eggs.availabilityPercent,100);assert.equal(eggs.quantityCoverage,2/3);assert.equal(eggs.fullyCoveredIngredients,0);
 assert.equal(pantry.assess([ingredient('Rice',100)]).availabilityPercent,0);
 assert.equal(pantry.assess([ingredient('Honey',100)]).availabilityPercent,0);
 assert.deepEqual(pantry.snapshot(),{'eggs|each':2,'rice|pack':1,'honey|ml':100});
});

test('an invalid injected proposal has zero preference and cannot reserve or modify stock',()=>{
 const stock=Object.freeze({'rice|g':300}),ingredients=Object.freeze([Object.freeze(ingredient('Rice',100))]);
 const pantry=autofill.create({stock,scoringMode:'pantry-first',proposal:input=>{
  input.stock['rice|g']=0;input.ingredients[0].required=0;throw Error('unavailable');
 }});
 const score=pantry.reserve(ingredients);assert.equal(score.score,0);assert.equal(score.availabilityPercent,0);assert.equal(score.availableIngredients,0);
 assert.deepEqual(pantry.snapshot(),stock);assert.equal(ingredients[0].required,100);assert.equal(stock['rice|g'],300);
});

test('the default weighted scoring result and field shape remain unchanged',()=>{
 const stock={'rice|g':100},proposal=input=>deduction.proposal({...input,id,conversion:{pantryMode:true,market:'UK'}}),ingredients=[ingredient('Rice',100)];
 const weighted=autofill.create({stock,proposal,now:NOW}).assess(ingredients,{recipeId:'rice'});
 const unknownMode=autofill.create({stock,proposal,now:NOW,scoringMode:'other'}).assess(ingredients,{recipeId:'rice'});
 assert.deepEqual(weighted,unknownMode);assert.equal(weighted.score,3);
 for(const key of ['eligibleIngredients','availableIngredients','fullyCoveredIngredients','availabilityPercent','fullCoveragePercent','quantityCoverage'])assert.equal(Object.hasOwn(weighted,key),false,key);
});

test('canonical-only mode scores explicit measured staples without inventing missing staple stock',()=>{
 const canonicalMeasure=(name,quantity,unit)=>({key:policy.canonicalName(name),quantity,unit});
 const stock=Object.freeze({'rice|g':100,'salt|g':2}),pantry=autofill.create({stock,canonicalMeasure,scoringMode:'pantry-first'});
 const meal=[ingredient('Rice',100),ingredient('Salt',2),ingredient('Olive oil',10,'ml'),ingredient('Water',null,'ml')];
 const first=pantry.reserve(meal);assert.equal(first.eligibleIngredients,2);assert.equal(first.availableIngredients,2);assert.equal(first.availabilityPercent,100);
 const next=pantry.assess(meal);assert.equal(next.eligibleIngredients,2);assert.equal(next.availableIngredients,0);assert.equal(next.score,0);
 assert.deepEqual(stock,{'rice|g':100,'salt|g':2});
});
