import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),method=require('../bb-cook-method.js');

test('equivalent prawn instructions become one action with full doneness and overcooking advice',()=>{
 const source='Add prawns and cook until pink and opaque. Cook prawns until opaque and pink all the way through; avoid prolonged cooking.';
 assert.equal(method.normalizeStep(source),'Add prawns and cook until opaque and pink all the way through; avoid prolonged cooking.');
 assert.deepEqual(method.sourceMethod([source]),[source]);
});

test('additional prawn timing and unrelated preparation are not mistaken for equivalent instructions',()=>{
 for(const source of [
  'Cook prawns for 2–3 minutes until pink and opaque. Cook prawns until opaque and pink all the way through; avoid prolonged cooking.',
  'Cook prawns until pink and opaque; do not cook beyond 3 minutes. Cook prawns until opaque and pink; do not cook beyond 3 minutes.',
  'Cook prawns until pink and opaque. Cook prawns until golden on the outside.',
  'Cook prawns until pink and opaque. Add prawns and cook until pink and opaque.'
 ]){
  assert.equal(method.normalizeStep(source),source);
 }
});

test('salmon prep and general hot-pan guidance precede its sear and set-aside action',()=>{
 const source='Sear salmon until nearly cooked and set aside. Pat salmon dry before searing to help it colour evenly. Cook in batches in a properly hot pan so the protein colours and the vegetables stay crisp-tender instead of steaming.';
 assert.equal(method.normalizeStep(source),'Pat salmon dry before searing to help it colour evenly. Cook in batches in a properly hot pan so the protein colours and the vegetables stay crisp-tender instead of steaming. Sear salmon until nearly cooked and set aside.');
});

test('only explicit same-food prep dependencies move, without changing safety advice',()=>{
 const source='Cook diced chicken in a large pan until golden. Cut chicken into even pieces and cook until the centre is cooked through. Before serving, cut into the thickest piece: it should be steaming hot throughout with no pink meat, and the juices should run clear. If unsure, continue cooking.';
 assert.equal(method.normalizeStep(source),'Cut chicken into even pieces. Cook diced chicken in a large pan until golden. Cook until the centre is cooked through. Before serving, cut into the thickest piece: it should be steaming hot throughout with no pink meat, and the juices should run clear. If unsure, continue cooking.');
 const other='Cook linguine in salted water until al dente. Pat the fish or seafood dry before searing and cook just until opaque and tender, without letting the edges dry out.';
 assert.equal(method.normalizeStep(other),other);
});

test('a named cooked protein is set aside after cooking; reserving sauce remains in place',()=>{
 assert.equal(method.normalizeStep('Set salmon aside. Sear salmon for 3 minutes. Add sauce.'),'Sear salmon for 3 minutes. Set salmon aside. Add sauce.');
 const sauce='Set half the sauce aside. Cook salmon for 3 minutes.';
 assert.equal(method.normalizeStep(sauce),sauce);
});

test('only adjacent unmeasured exact repetitions collapse',()=>{
 assert.equal(method.normalizeStep('Stir well. Stir well.'),'Stir well.');
 for(const text of ['Stir well. Add the sauce. Stir well.','Add 1 tbsp oil. Add 1 tbsp oil.','Cook for two minutes. Cook for two minutes.','Simmer for a minute. Simmer for a minute.','Turn again. Turn again.','Bake for 20 minutes. Bake for 20 minutes.'])assert.equal(method.normalizeStep(text),text);
});

test('timings, temperature, units, abbreviations and fractional quantities remain exact',()=>{
 const source='Heat to 200°C (180°C fan). Add 1.5 tbsp oil, ½ tsp salt and approx. 2 g pepper, e.g. black pepper. Stir for 2–3 minutes; check the centre reaches 75°C. Rest for 5 minutes before serving.';
 assert.equal(method.normalizeStep(source),source);
 assert.deepEqual(method.normalizeMethod([source]),[source]);
 const notation='Check that 75°C > 70°C. Keep the probe clean.';
 assert.equal(method.normalizeStep(notation),notation);
 for(const leading of ['1.5 tbsp oil goes into the pan.','1–2 minutes is enough.','1-2 minutes is enough.','1:30 is shown on the timer.']){
  assert.equal(method.normalizeStep(leading),leading);
  assert.deepEqual(method.sourceMethod(leading),[leading]);
 }
});

test('original source cards remain available when preparation order changes the first duration',()=>{
 const source='Sear salmon for 3 minutes. Pat salmon dry before searing and leave for 2 minutes.';
 assert.equal(method.sourceMethod([source])[0],source);
 assert.equal(method.normalizeMethod([source])[0],'Pat salmon dry before searing and leave for 2 minutes. Sear salmon for 3 minutes.');
 assert.equal(method.sourceMethod([source])[0].match(/\d+ minutes/)[0],'3 minutes');
});

test('AI markdown numbering, bullets, wrapped lines and objects preserve semantic cards',()=>{
 const ai='## Method\n1. **Heat** the oven to 200°C.\n   Line a tin.\n2. Bake for 20–25 minutes.\n## Notes\nDo not make this a step.';
 assert.deepEqual(method.parseMethod(ai),['Heat the oven to 200°C. Line a tin.','Bake for 20–25 minutes.']);
 assert.deepEqual(method.normalizeMethod('- Stir in 200 ml stock.\n- Simmer for 5 minutes.'),['Stir in 200 ml stock.','Simmer for 5 minutes.']);
 assert.deepEqual(method.normalizeMethod([{step:1,instruction:'2. **Simmer** for 10 minutes.'},{text:'Serve.'}]),['Simmer for 10 minutes.','Serve.']);
 assert.deepEqual(method.parseMethod('### Step 1\nHeat the oven.\nLine the tin.\n### Step 2\nBake for 20 minutes.'),['Heat the oven. Line the tin.','Bake for 20 minutes.']);
 const multi='Heat the oil. Add garlic; stir until fragrant.';
 assert.deepEqual(method.normalizeMethod([multi]),[multi]);
});

test('recipe methods fall through empty or invalid sources to steps without mutating the recipe',()=>{
 for(const invalid of [undefined,null,{},[],['**'],['### Method'],'## Method']){
  const recipe={method:invalid,steps:['Heat oil.','Cook for 4 minutes.']},before=JSON.stringify(recipe);
  assert.deepEqual(method.normalizeMethod(recipe),recipe.steps);
  assert.equal(JSON.stringify(recipe),before);
 }
 assert.deepEqual(method.normalizeMethod({instructions:{steps:[{description:'Roast for 20 minutes.'}]}}),['Roast for 20 minutes.']);
});

test('method parser excludes ingredient and metadata sections from recipe markdown',()=>{
 const source='# Dinner\nServings: 2\n## Ingredients\n- 250 g chicken\n- 1 tbsp oil\n## Instructions\n1. Heat oil.\n2. Cook chicken for 10 minutes.\n### Nutrition\n400 kcal';
 assert.deepEqual(method.sourceMethod(source),['Heat oil.','Cook chicken for 10 minutes.']);
 assert.deepEqual(method.normalizeMethod('## Ingredients\n- 1 tbsp oil'),[]);
 assert.deepEqual(method.normalizeMethod('Servings: 2\nPrep time: 5 minutes\nHeat oil.'),['Heat oil.']);
});

test('valid arrays keep positions and card counts, including invalid entries',()=>{
 const source=['Heat oil.',null,{instruction:'Cook chicken.'},'','### Method'];
 assert.deepEqual(method.sourceMethod(source),['Heat oil.','','Cook chicken.','','']);
 assert.deepEqual(method.normalizeMethod(source),['Heat oil.','','Cook chicken.','','']);
 assert.equal(method.normalizeMethod(['Stir. Stir.','Serve.']).length,2);
 for(const value of ['',null,undefined,42,{},'**','### Method','Ingredients:','Step 2:'])assert.equal(method.normalizeStep(value),'');
});

test('literal unknown markup remains text for the display escaping boundary',()=>{
 assert.equal(method.normalizeStep('<img src=x onerror=alert(1)> Stir well.'),'<img src=x onerror=alert(1)> Stir well.');
});

test('only known generic batch guidance can lose its vegetable tail with explicit categorized evidence',()=>{
 const guidance='Cook in batches in a properly hot pan so the protein colours and the vegetables stay crisp-tender instead of steaming.';
 assert.equal(method.normalizeStep(guidance,{ingredients:[['Salmon','200 g',1,'Fish'],['Oil','1 tbsp',1,'Other']]}),'Cook in batches in a properly hot pan so the protein colours instead of steaming.');
 for(const ingredients of [['Salmon','Oil'],[['Salmon','200 g',1,'Fish'],['Peas','100 g',1,'Vegetables']],[],[{name:'Salmon'}]])assert.equal(method.normalizeStep(guidance,{ingredients}),guidance);
});

test('normalization is idempotent across repeated display, speech and chat boundaries',()=>{
 const recipe={method:['Sear salmon until nearly cooked and set aside. Pat salmon dry before searing to help it colour evenly. Cook in batches in a properly hot pan so the protein colours and the vegetables stay crisp-tender instead of steaming.','Add prawns and cook until pink and opaque. Cook prawns until opaque and pink all the way through; avoid prolonged cooking.'],ingredients:[['Salmon','200 g',1,'Fish']]};
 const normalized=method.normalizeMethod(recipe);
 assert.deepEqual(method.normalizeMethod(normalized,recipe),normalized);
 assert.deepEqual(normalized.map(step=>method.normalizeStep(step)),normalized);
});

test('browser and CommonJS expose the same pure public API',()=>{
 const context=vm.createContext({window:{}});
 vm.runInContext(fs.readFileSync(new URL('../bb-cook-method.js',import.meta.url),'utf8'),context);
 assert.deepEqual(Object.keys(context.window.BBCookMethod),['sourceMethod','normalizeStep','normalizeMethod','parseMethod']);
 assert.equal(context.window.BBCookMethod.normalizeStep('Stir. Stir.'),'Stir.');
});
