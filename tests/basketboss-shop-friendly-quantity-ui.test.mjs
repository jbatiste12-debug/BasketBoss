import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';

const require=createRequire(import.meta.url),ui=require('../bb-shop-friendly-quantity-ui.js'),policy=require('../bb-pantry-policy.js');
const view=options=>ui.view({countGrams:policy.countGrams,...options});
const pack=(quantity,changes={})=>({kind:'pack',packQuantity:quantity,packCount:1,quantity,unit:'g',label:'pack',boughtQtyOverride:quantity,...changes});
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const row of Object.values(value))freeze(row);}return value;}

test('produce hints use existing average weights and always disclose that the count is approximate',()=>{
 assert.equal(policy.countGrams.aubergine,250);assert.equal(policy.countGrams.onion,150);
 assert.equal(view({name:'Aubergines',quantity:1200,unit:'g'}),'About 5 aubergines');
 assert.equal(view({name:'Onions',quantity:300,unit:'g'}),'About 2 onions');
 assert.equal(view({name:'Aubergine',quantity:250,unit:'g'}),'About 1 aubergine');
 assert.equal(view({name:'Courgettes',quantity:600,unit:'g'}),'About 3 courgettes');
 assert.equal(view({name:'Broccoli',quantity:700,unit:'g'}),'About 2 heads of broccoli');
 assert.doesNotMatch(view({name:'Aubergine',quantity:1200,unit:'g'}),/medium/,'no new size assumption is invented');
});

test('render-time policy input and browser default read the same existing metadata without mutation',()=>{
 const options=freeze({name:'onions',quantity:300,unit:'g',policy}),before=JSON.stringify(policy.countGrams);
 assert.equal(ui.view(options),'About 2 onions');assert.equal(JSON.stringify(policy.countGrams),before);
 const source=fs.readFileSync(new URL('../bb-shop-friendly-quantity-ui.js',import.meta.url),'utf8'),window={BBPantryPolicy:policy};
 vm.runInNewContext(source,{window});assert.equal(window.BBShopFriendlyQuantityUI.view({name:'onions',quantity:300,unit:'g'}),'About 2 onions');
});

test('whole-item aliases are explicit and preserve onion varieties, sweet potatoes and fresh state',()=>{
 assert.equal(view({name:'  FRESH whole AUBERGINES ',quantity:1000,unit:'g'}),'About 4 aubergines');
 assert.equal(view({name:'Red onions',quantity:300,unit:'g'}),'About 2 red onions');
 assert.equal(view({name:'Spring onions',quantity:300,unit:'g'}),'About 20 spring onions');
 assert.equal(view({name:'Sweet potatoes',quantity:600,unit:'g'}),'About 3 sweet potatoes');
 assert.equal(view({name:'Potatoes',quantity:540,unit:'g'}),'About 3 potatoes');
 assert.equal(view({name:'Peppers',quantity:320,unit:'g'}),'About 2 peppers');
 for(const name of ['Pepper','Black pepper','Ground black pepper','White pepper','Peppercorns'])assert.equal(view({name,quantity:100,unit:'g'}),null,'ambiguous seasoning cannot become whole produce');
 assert.equal(view({name:'Brown onions',quantity:300,unit:'g'}),'About 2 brown onions');
 assert.equal(view({name:'White onions',quantity:300,unit:'g'}),'About 2 white onions');
 assert.equal(view({name:'Yellow onions',quantity:300,unit:'g'}),'About 2 yellow onions');
 const colours={onion:100,'red onion':150,'spring onion':15};
 assert.equal(view({name:'Red onions',quantity:300,unit:'g',countGrams:colours}),'About 2 red onions','red retains its own average');
 assert.equal(view({name:'Spring onions',quantity:300,unit:'g',countGrams:colours}),'About 20 spring onions','spring retains its own average');
 assert.equal(view({name:'Brown onions',quantity:300,unit:'g',countGrams:{onion:150,'brown onion':100}}),'About 3 brown onions','a specific average takes precedence over the generic whole-onion fallback');
 assert.equal(view({name:'Red onions',quantity:300,unit:'g',countGrams:{onion:150}}),null,'red never borrows generic metadata');
 assert.equal(view({name:'Spring onions',quantity:300,unit:'g',countGrams:{onion:150}}),null,'spring never borrows generic metadata');
 for(const name of ['Frozen onions','Frozen brown onions','Chopped brown onions','Brown onion sauce','Dried onion','Onion powder','Pickled onions','Cooked aubergine','Roasted aubergines','Aubergine purée','Spring onion sauce','Chicken breast','Chicken thigh','Turkey mince'])assert.equal(view({name,quantity:300,unit:'g'}),null,name);
});

test('kilograms are read-only display input and do not introduce floats or whole items for tiny remainders',()=>{
 assert.equal(view({name:'Aubergines',quantity:1.2,unit:'kg'}),'About 5 aubergines');
 assert.equal(view({name:'Onion',quantity:299.999999,unit:'g'}),'About 2 onions');
 assert.equal(view({name:'Aubergine',quantity:500.000001,unit:'g'}),'About 2 aubergines');
 assert.equal(view({name:'Onion',quantity:0.000001,unit:'g'}),null);
 assert.equal(view({name:'Onion',quantity:30,unit:'g'}),null);
 assert.equal(view({name:'Onion',quantity:300,unit:'ml'}),null,'volume cannot become vegetable count');
});

test('changing an actual buying selection cannot change a recipe shortfall hint',()=>{
 const countGrams=freeze({...policy.countGrams}),options=freeze({name:'Aubergine',quantity:1200,unit:'g',countGrams,selection:pack(1500)}),before=JSON.stringify(options);
 assert.equal(ui.view(options),'About 5 aubergines');
 assert.equal(ui.view({...options,selection:pack(2500,{priceOverride:9.99})}),'About 5 aubergines');
 assert.equal(JSON.stringify(options),before);assert.equal(countGrams.aubergine,250);
});

test('herbs use only an explicitly selected matching pack and never invent bunch or handful weights',()=>{
 for(const name of ['Fresh basil','Fresh parsley','Coriander']){
  assert.equal(view({name,quantity:30,unit:'g',selection:pack(30)}),'1 pack');
  assert.equal(view({name,quantity:15,unit:'g',selection:pack(30)}),null,'half a pack needed is not a requirement for a whole purchased pack');
  assert.equal(view({name,quantity:30,unit:'g'}),null,'no pack size is inferred from the recipe weight');
 }
 assert.equal(view({name:'Fresh coriander',quantity:30,unit:'g',selection:pack(500)}),null);
 for(const name of ['Mixed herbs','Dried herbs','Fresh herbs'])assert.equal(view({name,quantity:30,unit:'g'}),null,name);
});

test('berries retain weight unless a matching actual pack is known; a pack is not blindly renamed a punnet',()=>{
 assert.equal(view({name:'Blueberries',quantity:250,unit:'g'}),null);
 assert.equal(view({name:'Blueberries',quantity:250,unit:'g',selection:pack(500)}),null);
 assert.equal(view({name:'Blueberries',quantity:250,unit:'g',selection:pack(250)}),'1 pack');
 assert.equal(view({name:'Strawberries',quantity:250,unit:'g',selection:pack(250,{label:'punnet'})}),null);
 assert.equal(view({name:'Frozen blueberries',quantity:250,unit:'g'}),null);
});

test('garlic clove requirements are not silently changed into bulbs',()=>{
 const bulb=pack(10,{unit:'each',label:'bulb'});
 assert.equal(view({name:'Garlic',quantity:2,unit:'clove',selection:bulb}),null);
 assert.equal(view({name:'Garlic',quantity:10,unit:'clove',selection:bulb}),'1 bulb');
 assert.equal(view({name:'Garlic cloves',quantity:20,unit:'each',selection:pack(10,{unit:'each',packCount:2,quantity:20,boughtQtyOverride:20,label:'bulb'})}),'2 bulbs');
 for(const name of ['Garlic powder','Garlic baguette','Garlic sauce'])assert.equal(view({name,quantity:10,unit:'each',selection:bulb}),null);
 assert.equal(view({name:'Garlic',quantity:10,unit:'each',selection:pack(10,{unit:'each'})}),'1 pack','a generic pack label is not evidence of one bulb');
});

test('pack fallbacks validate existing canonical units, amount and count without changing a selection',()=>{
 const selection=freeze(pack(300,{label:'tub'})),before=JSON.stringify(selection);
 assert.equal(view({name:'Coleslaw',quantity:300,unit:'g',selection}),'1 tub');
 assert.equal(view({name:'Coleslaw',quantity:200,unit:'g',selection}),null);
 for(const change of [{kind:'custom'},{kind:'exact'},{packCount:1.5},{quantity:299},{boughtQtyOverride:1},{label:'bunch'},{unit:'ml'},{packQuantity:0}])assert.equal(view({name:'Coleslaw',quantity:300,unit:'g',selection:{...selection,...change}}),null);
 assert.equal(JSON.stringify(selection),before);
});

test('unknown or invalid quantities return null so the existing precise display remains available',()=>{
 for(const quantity of [0,-1,NaN,Infinity,'300',null,1000001])assert.equal(view({name:'Onion',quantity,unit:'g'}),null);
 for(const name of ['',null,'constructor','__proto__','Unknown food'])assert.equal(view({name,quantity:300,unit:'g'}),null);
 for(const grams of [undefined,0,-1,NaN,'150'])assert.equal(ui.view({name:'Onion',quantity:300,unit:'g',countGrams:{onion:grams}}),null);
});
