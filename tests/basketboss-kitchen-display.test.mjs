import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),serving=require('../bb-serving-scale.js'),measures=require('../bb-recipe-measures.js');

test('five-serving kitchen labels use half counts without changing source scaling',()=>{
 const recipe=Object.freeze({servings:4,quantity:'1 medium',name:'Onion'}),factor=serving.ratio(5,recipe);
 assert.equal(factor,1.25);
 assert.equal(serving.practicalText(recipe.quantity,factor,recipe.name),'≈ 1 ½ medium');
 assert.equal(serving.practicalText('1 can',factor,'Coconut milk'),'≈ 1 ½ cans');
 assert.equal(serving.practicalText('2 tins',factor,'Chopped tomatoes'),'2 ½ tins');
 assert.equal(serving.practicalText('1 large, chopped',factor,'Onion'),'≈ 1 ½ large, chopped');
 assert.equal(serving.practicalText('1 each',factor,'Aubergine'),'≈ 1 ½ each');
 assert.equal(serving.practicalText('1 large',factor,'Cauliflower'),'≈ 1 ½ large');
 assert.equal(serving.practicalText('1 (optional)',factor,'Lime'),'≈ 1 ½ (optional)');
 assert.equal(serving.practicalText('1 punnet',factor,'Cherry tomatoes'),'≈ 1 ½ punnets');
 assert.equal(serving.practicalText('1 bunch',factor,'Spring onions'),'≈ 1 ½ bunches');
 assert.equal(serving.scaleText(recipe.quantity,factor,recipe.name,{roundCounts:false}),'1 ¼ medium');
 assert.equal(2-1*factor,.75,'stock arithmetic keeps the precise required count');
 assert.equal(recipe.quantity,'1 medium');
});

test('half-count ties round upwards, small counts stay usable, and ingredient names agree',()=>{
 assert.equal(serving.practicalText('1 can',.25,'Beans'),'≈ ½ can');
 assert.equal(serving.practicalText('1 onion',.75,'Onion'),'≈ 1 onion');
 assert.equal(serving.practicalText('2 eggs',1.125,'Eggs'),'≈ 2 ½ eggs');
 assert.equal(serving.practicalText('½ tin',1.25,'Tomatoes'),'≈ ½ tin');
 assert.equal(serving.practicalText('1 ¼ onions',1,'Onion'),'≈ 1 ½ onions');
 assert.equal(serving.practicalText('1 1/4 onions',1,'Onion'),'≈ 1 ½ onions');
 assert.equal(serving.practicalText('1–2 cans',1.25,'Beans'),'≈ 1 ½–2 ½ cans');
 assert.equal(serving.practicalText('1 tin',2,'Beans'),'2 tins','a double batch still scales from the base quantity');
 for(let people=1;people<=12;people++)assert.doesNotMatch(serving.practicalText('1 medium',people/4,'Onion'),/[¼¾]/);
});

test('multipacks preserve printed pack weights while only the can count scales',()=>{
 assert.equal(serving.practicalText('1 × 400 g tin',1.25,'Tomatoes'),'≈ 1 ½ × 400 g tins');
 assert.equal(serving.practicalText('2 x 400 g cans',.5,'Tomatoes'),'1 x 400 g can');
 assert.equal(serving.practicalText('2 x 400 g cans',1.25,'Tomatoes'),'2 ½ x 400 g cans');
});

test('metric labels retain existing kitchen precision and ambiguous quantities are not guessed',()=>{
 assert.equal(serving.practicalText('300 g dry rice',1.25,'Rice'),'375 g dry rice');
 assert.equal(serving.practicalText('150 g',1.25,'Spinach'),'190 g');
 assert.equal(serving.practicalText('300 ml',1.25,'Stock'),'375 ml');
 for(const raw of ['1 kg','250 g','3 grams','1 l','1 litre','100 ml']){
  assert.equal(serving.practicalText(raw,1.25,'Ingredient'),serving.scaleText(raw,1.25,'Ingredient',{roundCounts:false}),raw);
 }
 assert.equal(serving.practicalText('250–300 g',1.5,'Rice'),'375–450 g');
 assert.equal(serving.practicalText('1 tsp',1.25,'Onion powder'),'1 ¼ tsp');
 for(const raw of ['to taste','a pinch','for serving','-1 can'])assert.equal(serving.practicalText(raw,1.25,'Onion'),raw);
 assert.equal(serving.practicalText('1 can',0,'Beans'),'1 can');
 assert.equal(serving.practicalText('1 can',NaN,'Beans'),'1 can');
});

test('American display conversion remains isolated to the American region',()=>{
 const amount=serving.practicalText('300 ml',1.25,'Milk');
 for(const region of ['UK','Guernsey','Jersey'])assert.equal(measures.quantity(amount,'Milk',region),'375 ml');
 assert.match(measures.quantity(amount,'Milk','US'),/^≈ .*US cups \(375 ml\)$/);
 for(const region of ['UK','US','Guernsey','Jersey'])assert.equal(measures.quantity(serving.practicalText('1 can',1.25,'Beans'),'Beans',region),'≈ 1 ½ cans');
});

test('Shop count labels buy complete items while metric inputs and amounts remain unchanged',()=>{
 const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
 const fn=html.match(/function bb80ShoppingQuantity\([\s\S]*?\n}/)?.[0];assert.ok(fn);
 const sandbox={BBServing:serving,BBPriceV19:{formatQuantity:(n,u)=>n+' '+u},bb307Market:'UK',bbWholeProduceCount:()=>null,bb321TinShoppingQuantity:()=>null};
 vm.createContext(sandbox);vm.runInContext(fn,sandbox);
 assert.equal(sandbox.bb80ShoppingQuantity('Tomatoes',1.25,'cans'),'2 cans');
 assert.equal(sandbox.bb80ShoppingQuantity('Garlic',1.25,'clove'),'2 cloves (1 bulb)');
 assert.equal(sandbox.bb80ShoppingQuantity('Onion',1.25,'medium'),'≈ 1 ½ medium');
 assert.equal(sandbox.bb80ShoppingQuantity('Onion',1.25,'each'),'2 onions');
 const quantity=187.5;assert.equal(sandbox.bb80ShoppingQuantity('Spinach',quantity,'g'),'187.5 g');assert.equal(quantity,187.5);
 assert.match(html,/bbRecipeIngredientQuantity\(recipe,item,factor\)/);
 assert.match(html,/bbRecipeIngredientQuantity\(r,i,cookFactor\)/);
 assert.match(html,/event:\{sessionId:cookReceipt,recipeId:id,day,factor:cookFactor/,'pantry updates retain the original recipe and precise factor');
});
