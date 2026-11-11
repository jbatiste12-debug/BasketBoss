import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),basis=require('../bb-recipe-purchase-basis.js'),canonical=require('../bb-recipe-canonical.js'),policy=require('../bb-pantry-policy.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const source={id:'leftover-gammon-rice',name:'Gammon and pea fried rice',servings:4,ingredients:[['Rice, freshly cooked','300 g dry',1.45,'Grains']],method:['Cook rice according to packet instructions; spread briefly to let steam escape.']};
const norm={id:source.id,ingredients:[{name:'Rice, freshly cooked',key:'rice freshly',quantity:300,unit:'g',status:'PARSED',recipe_id:source.id,ingredient_index:0}]};
const canonicalize=value=>String(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

test('the actual gammon ingredient uses its explicit dry weight without converting or editing the recipe',()=>{
 const recipe=copy(source),normalized=copy(norm),before=copy(recipe);
 assert.equal(basis.apply([recipe],[normalized],{canonicalize}),1);assert.deepEqual(recipe,before);
 const row=normalized.ingredients[0];assert.equal(row.name,'Rice');assert.equal(row.key,'rice');assert.equal(row.quantity,300);assert.equal(row.unit,'g');assert.equal(row.raw_shopping_key,'rice freshly');assert.equal(row.prep_note,'Rice, freshly cooked');
 assert.equal(row.purchase_source_quantity,'300 g dry');assert.equal(row.purchase_quantity_basis,'EXPLICIT_DRY_SOURCE_WEIGHT');
 const snapshot=copy(row);basis.apply([recipe],[normalized],{canonicalize});assert.deepEqual(row,snapshot,'reloading applies the source basis idempotently');
});

test('canonical recipe projection uses the source dry basis at all portions and groups ordinary rice once',()=>{
 const rows=[canonical.project(copy(norm.ingredients[0]),{sourceLine:source.ingredients[0],factor:1.5}),canonical.project({name:'Rice',key:'rice',quantity:100,unit:'g'},{sourceLine:['Rice','100 g dry'],factor:1.5})];
 assert.equal(rows[0].key,'rice');assert.equal(rows[0].name,'Rice');assert.equal(rows[0].required,450);
 const grouped=canonical.aggregate(rows);assert.equal(grouped.length,1);assert.equal(grouped[0].key,'rice');assert.equal(grouped[0].required,600);assert.equal(grouped[0].needsReview,undefined);
 assert.equal(policy.stockCompatible('Rice',grouped[0].name),true);assert.equal(policy.stockCompatible('Cooked rice','Rice'),false,'actual prepared pantry stock stays a different food state');
});

test('cooked and ready-to-eat sources are never renamed or given an invented yield',()=>{
 for(const [name,text] of [['Rice, freshly cooked','300 g'],['Cooked rice','300 g cooked'],['Microwaveable cooked rice pouches','300 g dry'],['Ready cooked rice','300 g dry'],['Leftover cooked rice','300 g dry'],['Cooked chicken','300 g dry'],['Cooked mushrooms','300 g dry']]){
  assert.equal(basis.project({name,key:name,quantity:300,unit:'g'},[name,text]),null,name+' / '+text);
 }
 const cooked=canonical.project({name:'Cooked rice',key:'cooked rice',quantity:300,unit:'g'},{sourceLine:['Cooked rice','300 g']});assert.equal(cooked.key,'cooked rice');assert.equal(cooked.quantity,300);
});

test('explicit gram and kilogram bases preserve quantities and require matching normalized evidence',()=>{
 const row={name:'Couscous, cooked',key:'couscous cooked',quantity:1500,unit:'g'};
 assert.equal(basis.project(row,['Couscous, cooked','1.5 kg dry']).key,'couscous');assert.equal(basis.project(row,['Couscous, cooked','1.5 kg dry']).quantity,1500);
 for(const quantity of [null,NaN,-1,1499])assert.equal(basis.project({...row,quantity},['Couscous, cooked','1.5 kg dry']),null);
 assert.equal(basis.project({...row,unit:'ml'},['Couscous, cooked','1.5 kg dry']),null);
 assert.equal(basis.project({...row,quantity:1500},['Couscous, cooked','1500 g (dry weight)']).key,'couscous');
});

function actual(name){const text=readFileSync(new URL('../app.html',import.meta.url),'utf8'),start=text.indexOf('function '+name+'('),end=text.indexOf('\nfunction ',start+1);assert.ok(start>=0&&end>start);return text.slice(start,end);}
test('Day done has one Rice requirement and no fallback cooked row after validated ingestion',()=>{
 const normalized=copy(norm);basis.apply([source],[normalized],{canonicalize});
 const context=vm.createContext({window:{BBRecipeCanonical:canonical},BB307_NORMALIZED:[normalized],getRecipe:()=>source,BBPriceV19:{canonical:canonicalize,recipeIngredientUnit:row=>row.unit},BB307Pantry:{pantryName:canonicalize}});
 vm.runInContext(actual('bbHomeRecipeIngredients'),context);
 const rows=copy(context.bbHomeRecipeIngredients(source.id,1));assert.equal(rows.length,1);assert.equal(rows[0].key,'rice');assert.equal(rows[0].name,'Rice');assert.equal(rows[0].required,300);assert.equal(rows[0].unit,'g');
});

test('malformed or crossed catalogue positions remain unchanged',()=>{
 for(const patch of [{recipe_id:'different'},{ingredient_index:8}]){const normalized=copy(norm);Object.assign(normalized.ingredients[0],patch);const before=copy(normalized);assert.equal(basis.apply([source],[normalized]),0);assert.deepEqual(normalized,before);}
 assert.equal(basis.apply(null,null),0);assert.equal(basis.project(null,null),null);
 assert.equal(basis.project({name:'Milk',key:'milk',quantity:300,unit:'g'},source.ingredients[0]),null,'an ingredient with a mismatched source label cannot borrow dry-rice evidence');
});
