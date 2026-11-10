import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),canonical=require('../bb-recipe-canonical.js'),home=require('../bb-home.js'),serving=require('../bb-serving-scale.js');
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
function fixture(file='index.html'){
 const html=read(file),context=vm.createContext({window:{BBPantryPolicy:policy}});vm.runInContext(read('basketboss-aisles-v20.js'),context);vm.runInContext(read('basketboss-pricing-v19.js'),context);context.BBPriceV19=context.window.BBPriceV19;
 const at=html.indexOf('function bb172SplitOwnIngredients('),end=html.indexOf('/* A neutral cooking icon',at);assert.ok(at>=0&&end>at);vm.runInContext(html.slice(at,end),context);
 return {html,context,parse:(line)=>context.bb172ParseOwnIngredient(line,0,'bb172-own-audit-123'),split:input=>JSON.parse(JSON.stringify(context.bb172SplitOwnIngredients(input)))};
}
for(const file of ['index.html','app.html'])test(file+': messy quantities, names and preparation remain structured without invented amounts',()=>{
 const h=fixture(file);
 const onion=h.parse('1 large onion, diced');assert.equal(onion.name,'onion');assert.equal(onion.quantity,1);assert.equal(onion.unit,'each');assert.equal(onion.prep_note,'diced');assert.equal(onion.size,'large');assert.equal(onion.source,'1 large onion, diced');
 const salt=h.parse('salt and pepper to taste');assert.equal(salt.name,'salt and pepper');assert.equal(salt.quantity,null);assert.equal(salt.unit,'to taste');assert.equal(salt.needsReview,true);
 const garlic=h.parse('2-3 cloves garlic');assert.equal(garlic.name,'garlic');assert.equal(garlic.quantity,3);assert.equal(garlic.quantityMin,2);assert.equal(garlic.quantityMax,3);assert.equal(garlic.unit,'clove');assert.equal(garlic.needsReview,true);
 const tin=h.parse('400g tin chopped tomatoes');assert.equal(tin.name,'Tinned chopped tomatoes');assert.equal(tin.key,'chopped tomatoes');assert.equal(tin.quantity,400);assert.equal(tin.unit,'g');assert.equal(tin.packQuantity,400);
 const kg=h.parse('1.5 kg chicken breast');assert.equal(kg.quantity,1500);assert.equal(kg.unit,'g');assert.equal(kg.name,'chicken breast');assert.equal(kg.quantityText,'1500 g');
 const rice=h.parse('1/3 cup rice');assert.equal(rice.quantity,1/3);assert.equal(rice.unit,'cup');assert.equal(rice.quantityText,'1/3 cup');
});
test('recipe ingestion keeps prep commas and bracketed food identity while splitting actual ingredients',()=>{
 const h=fixture();assert.deepEqual(h.split('1 large onion, diced, chicken breast 500g'),['1 large onion, diced','chicken breast 500g']);
 assert.deepEqual(h.split('400g tin chopped tomatoes, drained\n1.5 kg chicken breast; 1/3 cup rice'),['400g tin chopped tomatoes, drained','1.5 kg chicken breast','1/3 cup rice']);
 assert.deepEqual(h.split('milk (oat, unsweetened) 200ml, 2 eggs'),['milk (oat, unsweetened) 200ml','2 eggs']);
 const milk=h.parse('milk (oat, unsweetened) 200ml');assert.equal(milk.name,'milk (oat, unsweetened)');assert.notEqual(milk.key,policy.canonicalName('milk'));
 assert.deepEqual(h.split('1,5 kg chicken breast, 2 eggs'),['1,5 kg chicken breast','2 eggs']);
 assert.ok(h.html.includes('const lines=bb172SplitOwnIngredients(form.elements.ingredients.value)'));
});
for(const [line,expected,unit]of [['Rice 500g',500,'g'],['1 1/2 tbsp olive oil',1.5,'tbsp'],['½ tsp salt',.5,'tsp'],['1½ cups rice',1.5,'cup'],['.5 l milk',500,'ml'],['2 x 400g tins chopped tomatoes',800,'g'],['2 eggs',2,'each'],['a pinch of salt',1,'pinch']])test('parser supports '+line,()=>{
 const row=fixture().parse(line);assert.equal(row.quantity,expected);assert.equal(row.unit,unit);assert.equal(row.source,line);assert.ok(Number.isFinite(row.quantity));
});
for(const line of ['1/0 cup rice','-2 g rice','999999999 kg rice','some rice','Rice 2 packs','<img src=x onerror=alert(1)>'])test('ambiguous or invalid ingredient stays reviewable: '+line,()=>{
 const row=fixture().parse(line);assert.ok(row);assert.equal(row.source,line);assert.equal(row.needsReview,true);assert.ok(row.quantity===null||Number.isFinite(row.quantity));
 if(/1\/0|-2|999999999|some rice|<img/.test(line))assert.equal(row.quantity,null);
});
test('nontext, blank and oversized lines are rejected rather than truncated into a different ingredient',()=>{
 const h=fixture();for(const input of [null,undefined,{},[],false,'',' ','a'.repeat(2049)])assert.equal(h.parse(input),null);
 const huge='a'.repeat(50001);assert.deepEqual(h.split(huge),[huge]);assert.equal(h.parse(h.split(huge)[0]),null);
});
test('the range warning survives normalization and grouping and includes its conservative amount',()=>{
 const h=fixture(),row=h.parse('2-3 cloves garlic'),projected=canonical.project(row,{sourceLine:[row.name,row.quantityText],factor:1,canonicalize:h.context.BBPriceV19.canonical});
 assert.equal(projected.required,3);assert.equal(projected.unit,'each');assert.equal(projected.estimated,true);assert.equal(projected.needsReview,true);assert.match(projected.assumption,/upper amount/);
 const [group]=canonical.aggregate([projected]);assert.equal(group.required,3);assert.equal(group.needsReview,true);
});
test('counts scale linearly for cooking while purchase quantities round to whole units separately',()=>{
 const h=fixture(),row=h.parse('3 eggs');for(const [people,used,bought]of [[1,.75,1],[7,5.25,6]]){
  const projected=canonical.project(row,{sourceLine:[row.name,row.quantityText],factor:serving.ratio(people,{servings:4}),canonicalize:h.context.BBPriceV19.canonical});
  assert.equal(projected.required,used);assert.equal(home.purchaseAmounts({needed:used,owned:0,multiple:1,unit:'each'}).purchaseQuantity,bought);
 }
});
test('olive oil grades share an approved identity while vegetable oil and allergy-sensitive variants stay separate',()=>{
 const h=fixture(),project=line=>{const row=h.parse(line);return canonical.project(row,{sourceLine:[row.name,row.quantityText],canonicalize:h.context.BBPriceV19.canonical,pantryRecord:{name:row.name,trackingMode:'measured',measurementReviewed:true,unit:'ml'}});};
 const groups=canonical.aggregate([project('1 tbsp olive oil'),project('2 tbsp Extra Virgin Olive Oil')]);assert.equal(groups.length,1);assert.equal(groups[0].key,'olive oil');assert.equal(groups[0].required,45);assert.equal(groups[0].unit,'ml');
 assert.notEqual(policy.canonicalName('vegetable oil'),policy.canonicalName('olive oil'));assert.notEqual(policy.canonicalName('milk (oat)'),policy.canonicalName('milk'));
});

test('metric ingestion quantizes only after conversion and never displays binary decimal tails',()=>{
 const row=fixture().parse('1.005 kilograms chicken breast');assert.equal(row.quantity,1005);assert.equal(row.quantityText,'1005 g');
 const tiny=fixture().parse('0.0000000001 g rice');assert.equal(tiny.quantity,null);assert.equal(tiny.needsReview,true);
});

test('parser-derived grocery keys classify into the existing grocery aisles',()=>{
 const h=fixture();for(const [line,aisle]of [['1 onion','Produce'],['200ml milk','Dairy & Chilled'],['500g chicken breast','Meat & Fish'],['400g tin chopped tomatoes','Cupboard / Pantry'],['1 tbsp Extra Virgin Olive Oil','Cupboard / Pantry']]){
  const row=h.parse(line);assert.equal(h.context.BBPriceV19.aisle(row.key),aisle,line);
 }
});
test('malformed ingredient text cannot create unsafe map keys or nonfinite quantities',()=>{
 const h=fixture();for(const text of ['1g __proto__','1g constructor','1g prototype','1g Rice|g'])assert.equal(h.parse(text),null);
 let seed=172;const chars='0123456789 /.-,()abc kgmltsp½⅓<>';for(let example=0;example<600;example++){let text='';for(let i=0;i<example%180+1;i++){seed=(seed*1664525+1013904223)>>>0;text+=chars[seed%chars.length];}
  const row=h.parse(text);if(!row)continue;assert.equal(row.source,text.trim());assert.ok(row.quantity===null||Number.isFinite(row.quantity)&&row.quantity>=0&&row.quantity<=1000000);assert.equal(typeof row.name,'string');assert.equal(typeof row.unit,'string');
 }
});

test('the actual saved personal-recipe loader retains source lines and scales clean quantity text',()=>{
 const h=fixture(),lines=['1 large onion, diced','1.5 kg chicken breast','1/3 cup rice','salt and pepper to taste'],stored=[{id:'bb172-own-audit-123',title:'Parser fixture',servings:4,lines}];
 Object.assign(h.context,{RECIPES:[{id:'built-in',name:'Keep original'}],BB307_NORMALIZED:[],BB172_OWN_IMAGE:'synthetic-image',console,localStorage:{getItem:()=>JSON.stringify(stored)}});
 const start=h.html.indexOf("const BB172_OWN_RECIPE_KEY='"),end=h.html.indexOf('function bb172SplitOwnIngredients(',start);vm.runInContext(h.html.slice(start,end),h.context);
 const from=h.html.indexOf('for(const own of bb172ReadOwnRecipes())'),to=h.html.indexOf('// BB v18: Preserve',from);assert.ok(from>=0&&to>from);vm.runInContext(h.html.slice(from,to),h.context);
 assert.equal(h.context.RECIPES.length,2);assert.equal(h.context.RECIPES[0].name,'Keep original');
 const own=h.context.RECIPES[1],normalized=h.context.BB307_NORMALIZED[0];assert.equal(own.ingredients.length,4);assert.deepEqual(JSON.parse(JSON.stringify(normalized.ingredients.map(row=>row.source))),lines);
 assert.equal(own.ingredients[0][1],'1 large, diced');assert.equal(own.ingredients[1][1],'1500 g');assert.equal(normalized.ingredients[1].quantity,1500);assert.equal(normalized.ingredients[3].quantity,null);
 assert.equal(serving.scaleText(own.ingredients[1][1],7/4,own.ingredients[1][0]),'2625 g');
});
