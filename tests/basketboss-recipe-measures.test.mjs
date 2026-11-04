import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const measures=require('../bb-recipe-measures.js');
const serving=require('../bb-serving-scale.js');

test('American measures require the explicitly selected American region',()=>{
  const quantity=' 250 g\n',step='Bake at 200°C with 500 ml stock for 25 minutes.';
  for(const market of ['UK','Jersey','Guernsey',undefined,null,'','CA','us','American']){
    assert.equal(measures.quantity(quantity,'plain flour',market),quantity,String(market));
    assert.equal(measures.step(step,market),step,String(market));
  }
  assert.equal(measures.quantity('120 g','plain flour','UnitedStates'),'≈ 1 US cup (120 g)');
});

test('cup weights depend on the exact ingredient and preparation form',()=>{
  const examples=[['plain flour',120],['all-purpose flour',120],['granulated sugar',198],['caster sugar',190],['unsalted butter',226],['old-fashioned oats',89],['steel-cut oats',140]];
  for(const [name,grams] of examples)assert.equal(measures.quantity(`${grams} g`,name,'US'),`≈ 1 US cup (${grams} g)`,name);
  assert.equal(measures.quantity('60 g','plain flour','US'),'≈ ½ US cup (60 g)');
  for(const name of ['flour','self-raising flour','flour tortillas','peanut butter','oat milk','cooked oats','rice','chicken','chopped tomatoes']){
    assert.doesNotMatch(measures.quantity('120 g',name,'US'),/cup/,name);
    assert.match(measures.quantity('120 g',name,'US'),/oz \(120 g\)/,name);
  }
});

test('liquids use US customary cups and spoons, independent of food density',()=>{
  assert.equal(measures.quantity('240 ml','water','US'),'≈ 1 US cup (240 ml)');
  assert.equal(measures.quantity('15 ml','oil','US'),'≈ 1 tbsp (15 ml)');
  assert.equal(measures.quantity('5 ml','vanilla','US'),'≈ 1 tsp (5 ml)');
  assert.equal(measures.quantity('250 ml','milk','US'),'≈ 1.04 US cups (250 ml)');
  assert.equal(measures.quantity('100 ml','milk','US'),'≈ 3.33 US fl oz (100 ml)');
  assert.equal(measures.quantity('0.5 l','stock','US'),measures.quantity('500 ml','stock','US').replace('(500 ml)','(0.5 l)'));
  assert.equal(measures.quantity('250 ml','milk','US'),measures.quantity('250 ml','oil','US'));
});

test('weights retain precise source quantities and use the configured US kitchen factors',()=>{
  assert.equal(measures.quantity('28.35 g','chicken','US'),'≈ 1 oz (28.35 g)');
  assert.equal(measures.quantity('453.6 g','chicken','US'),'≈ 1 lb (453.6 g)');
  assert.equal(measures.quantity('1 kg','chicken','US'),'≈ 2.2 lb (1 kg)');
  assert.equal(measures.quantity('1,000 g','chicken','US'),'≈ 2.2 lb (1,000 g)');
  assert.equal(measures.quantity('0.1 g','saffron','US'),'≈ <0.01 oz (0.1 g)');
});

test('fractions, ranges, multipacks and whole-item counts preserve their meaning',()=>{
  assert.equal(measures.quantity('1½ kg','chicken','US'),'≈ 3.31 lb (1½ kg)');
  assert.equal(measures.quantity('1 1/2 kg','chicken','US'),'≈ 3.31 lb (1 1/2 kg)');
  assert.equal(measures.quantity('1/2 litre','milk','US'),'≈ 2.08 US cups (1/2 litre)');
  assert.equal(measures.quantity('250–300 g','chicken','US'),'≈ 8.82 oz–10.58 oz (250–300 g)');
  assert.equal(measures.quantity('2 x 500 g bags','plain flour','US'),'2 x ≈ 1.1 lb (500 g) bags');
  for(const text of ['2 eggs','6 each','2 cloves','1 bulb','a pinch','to taste','2 tbsp','3 tsp','0 g','-5 g','250mg'])assert.equal(measures.quantity(text,'','US'),text);
});

test('instructions convert temperatures without changing time, fan setting, gas mark, or food-safety target',()=>{
  const source='Bake at 200°C / 180°C fan / gas 6 for 25 minutes. Check chicken reaches 75°C.';
  assert.equal(measures.step(source,'US'),'Bake at 392°F (200°C) / 356°F (180°C) fan / gas 6 for 25 minutes. Check chicken reaches 167°F (75°C).');
  assert.equal(measures.step('Use 180-200°C for 15–20 minutes.','US'),'Use 356–392°F (180-200°C) for 15–20 minutes.');
  assert.equal(measures.step('Chill at -18°C.','US'),'Chill at -0.4°F (-18°C).');
  assert.equal(measures.step('Add 2 c beans. Bake at 200C.','US'),'Add 2 c beans. Bake at 392°F (200C).');
  assert.equal(measures.step('Stir in 120 g plain flour.','US'),'Stir in ≈ 4.23 oz (120 g) plain flour.');
});

test('display conversion happens after serving scale and cannot change recipe or pantry arithmetic',()=>{
  const recipe=Object.freeze({servings:4,quantity:'240 g',ingredient:'plain flour'});
  const pantry=Object.freeze({quantity:500,unit:'g'});
  const ratio=serving.ratio(2,recipe),scaled=serving.scaleText(recipe.quantity,ratio,recipe.ingredient);
  assert.equal(scaled,'120 g');
  assert.equal(measures.quantity(scaled,recipe.ingredient,'US'),'≈ 1 US cup (120 g)');
  assert.equal(recipe.quantity,'240 g');
  assert.equal(pantry.quantity-240*ratio,380);
  assert.equal(pantry.unit,'g');
});

test('browser UMD exposes the same pure API without requiring DOM or storage',()=>{
  const window={};
  vm.runInNewContext(fs.readFileSync('bb-recipe-measures.js','utf8'),{window});
  assert.equal(window.BBRecipeMeasures.quantity('120 g','plain flour','US'),'≈ 1 US cup (120 g)');
  assert.equal(window.BBRecipeMeasures.step('200°C','UK'),'200°C');
  assert.equal(Object.isFrozen(window.BBRecipeMeasures),true);
});
