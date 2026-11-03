import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const speech=createRequire(import.meta.url)('../bb-cook-speech-text.js');

test('ingredients become deterministic friendly quantity-first prompts',()=>{
 assert.equal(speech.ingredient({name:'Gnocchi',quantity:'250 g',index:0}),'First up, grab 250 grams of gnocchi. Say “next ingredient” when you’re ready.');
 assert.equal(speech.ingredient({name:'Milk',quantity:'150 ml',index:1}),'Next, get 150 millilitres of milk. Say “next ingredient” when you’re ready.');
 const input={name:'Cheddar',quantity:'265 g',index:2};assert.equal(speech.ingredient(input),speech.ingredient(input));assert.equal(speech.answer(input),'You’ll need 265 grams of cheddar.');
});

test('counts retain ingredient nouns without duplication and quantities are not rounded',()=>{
 for(const [name,quantity,expected]of [['Onion','2 onions','2 onions'],['Mixed peppers','3 peppers','3 mixed peppers'],['Chicken breast','2 boneless breasts','2 boneless chicken breasts'],['Onions','1','1 onion'],['Red onions','2 medium','2 medium red onions'],['Eggs','2','2 eggs'],['Lemon','2','2 lemons'],['White fish fillets','4','4 white fish fillets'],['Rice','300 g dry','300 grams of dry rice'],['Chicken breast','600 g boneless chicken breast','600 grams of boneless chicken breast']])assert.equal(speech.phrase({name,quantity}),expected);
 assert.equal(speech.answer({name:'Oil',quantity:'1 tbsp, plus more for frying'}),'You’ll need 1 tablespoon of oil, plus more for frying.');
 assert.equal(speech.answer({name:'Salt',quantity:'to taste'}),'You’ll need salt, to taste.');
 assert.match(speech.answer({name:'Cheddar',quantity:'265.5 g'}),/265\.5 grams/);
});

test('weights, volumes, spoonfuls, cooking times and oven settings have spoken units',()=>{
 assert.equal(speech.plain('Add 1 kg rice, 1 g salt, 0.5g pepper, 500ml water, 1 l stock and 2 tbsp oil. Cook 25 mins then rest 1 hr and 30 secs.'),'Add 1 kilogram rice, 1 gram salt, 0.5 grams pepper, 500 millilitres water, 1 litre stock and 2 tablespoons oil. Cook 25 minutes then rest 1 hour and 30 seconds.');
 assert.equal(speech.plain('Heat oven to 200°C (180°C fan), Gas 6. Use 75°C for 30 seconds.'),'Heat oven to 200 degrees Celsius (180 degrees Celsius fan), gas mark 6. Use 75 degrees Celsius for 30 seconds.');
 assert.equal(speech.plain('200C/180C fan/Gas mark 6; 350°F.'),'200 degrees Celsius/180 degrees Celsius fan/Gas mark 6; 350 degrees Fahrenheit.');
 assert.equal(speech.plain('1 tsp, 2tsp, 1tbsp, 20mg and 100 cl.'),'1 teaspoon, 2 teaspoons, 1 tablespoon, 20 milligrams and 100 centilitres.');
});

test('fractions, ranges and pack quantities preserve the original numeric values',()=>{
 assert.equal(speech.plain('½ tsp, 1/2tbsp, 1½ tsp and 20–22 min.'),'½ teaspoons, 1/2 tablespoons, 1½ teaspoons and 20 to 22 minutes.');
 assert.equal(speech.phrase({name:'Chopped tomatoes',quantity:'2 × 400 g tins'}),'2 tins of chopped tomatoes, 400 grams each');
 assert.equal(speech.phrase({name:'Chickpeas',quantity:'1 × 400 g tin'}),'1 tin of chickpeas, 400 grams');
 assert.equal(speech.plain('Use 10% fat yoghurt and vitamin B12.'),'Use 10 per cent fat yoghurt and vitamin B12.');
});

test('step phrasing retains full safety, allergen and temperature instructions',()=>{
 const text='Roast for 20–22 minutes at 180°C fan. Before serving, cut into the thickest piece: it should be steaming hot throughout with no pink meat, and the juices should run clear. If unsure, continue cooking. Do not serve to anyone with a nut allergy.';
 const result=speech.step({text,index:1,count:4});
 assert.match(result,/^Step 2 of 4\. Next, roast for 20 to 22 minutes at 180 degrees Celsius fan\./);
 assert.ok(result.includes('Before serving, cut into the thickest piece: it should be steaming hot throughout with no pink meat, and the juices should run clear. If unsure, continue cooking. Do not serve to anyone with a nut allergy.'));
 assert.match(result,/Say “next step” when you’re ready\.$/);
 assert.match(speech.step({text:'Finally, fold in the herbs.',index:2,count:3}),/^Step 3 of 3\. Finally, fold/);
 assert.doesNotMatch(speech.step({text:'Finally, fold in the herbs.',index:2,count:3}),/To finish, Finally/);
});

test('phrasing never truncates long instructions or invents missing amounts',()=>{
 const text=Array.from({length:150},()=> 'Keep checking the centre is steaming hot.').join(' ');
 const result=speech.step({text,index:0,count:1});assert.ok(result.includes(text.slice(text.indexOf(' ')+1)));assert.ok(result.length>4000);
 assert.equal(speech.phrase({name:'Salt',quantity:''}),'');assert.match(speech.ingredient({name:'Salt'}),/Check the ingredient and its amount on screen/);
 assert.equal(speech.step({text:''}),'');
});

test('practical half counts sound natural without losing their approximation or pack weight',()=>{
 assert.equal(speech.phrase({name:'Onion',quantity:'≈ 1 ½ medium'}),'approximately 1 ½ medium onions');
 assert.equal(speech.phrase({name:'Aubergine',quantity:'≈ 1 ½ each'}),'approximately 1 ½ aubergines');
 assert.equal(speech.phrase({name:'Tomatoes',quantity:'≈ 1 ½ × 400 g tins'}),'approximately 1 ½ tins of tomatoes, 400 grams each');
 assert.equal(speech.phrase({name:'Onion',quantity:'1 medium'}),'1 medium onion');
 assert.equal(speech.phrase({name:'Rice',quantity:'375 g dry rice'}),'375 grams of dry rice');
});


test('public catalogue quantities and every step number survive speech formatting',()=>{
 const recipes=JSON.parse(fs.readFileSync(new URL('../recipes.json',import.meta.url),'utf8'));
 const numbers=value=>String(value).match(/\d+(?:\.\d+)?/g)||[];
 for(const recipe of recipes){
  for(const text of recipe.method||[])assert.deepEqual(numbers(speech.plain(text)),numbers(text),recipe.id+' method numbers');
  for(const item of recipe.ingredients||[])assert.deepEqual(numbers(speech.phrase({name:item[0],quantity:item[1]})).sort(),numbers(item[1]).concat(numbers(item[0])).sort(),recipe.id+' ingredient numbers');
 }
});
