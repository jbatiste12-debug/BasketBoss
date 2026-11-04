import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const diets = createRequire(import.meta.url)('../bb-dietary-preferences.js');
const recipe = (...ingredients) => ({id:'dinner', name:'Dinner', ingredients:ingredients.map(name => [name, '1 each'])});

test('normalizes supported onboarding labels without letting No preference cancel a restriction', () => {
  assert.deepEqual(diets.normalizeDiets(['Vegetarian', 'Gluten free', 'Dairy‑free', 'Vegetarian', 'No specific preference', 'unsupported']), ['vegetarian','gluten-free','dairy-free']);
  assert.deepEqual(diets.normalizeDiets(null), []);
});
test('vegetarian recipes reject meat, fish and hidden animal stocks or sauces regardless of their title', () => {
  for (const ingredient of ['Chicken breast','Steaks','Mince','Beef stock','Stock cubes','Fish sauce','Oyster sauce','Worcestershire sauce','Gelatine','Pancetta','Anchovies','Parmesan','Hard cheese','Pesto']) {
    assert.equal(diets.recipeAllowed({...recipe('Rice', ingredient), name:'Vegetarian family dinner', vegetarian:true}, ['Vegetarian']), false, ingredient);
  }
  assert.equal(diets.recipeAllowed(recipe('Vegetable stock','Chickpeas','Coconut milk'), ['vegetarian']), true);
  assert.equal(diets.recipeAllowed(recipe('Kidney beans','Oyster mushrooms','Goat’s cheese','Beef tomatoes','Duck eggs'), ['vegetarian']), true);
  assert.equal(diets.recipeAllowed(recipe('Cauliflower steaks','Lentil mince'), ['vegetarian']), true);
});
test('uses explicitly listed alternatives without inventing substitutions for compound ingredients', () => {
  for (const ingredient of ['Vegetarian sausages','Vegan fish sauce','Vegetarian hard cheese','Plant-based mince']) assert.equal(diets.recipeAllowed(recipe(ingredient), ['vegetarian']), true, ingredient);
  for (const ingredient of ['Chicken or tofu','Chicken with vegetarian sauce','Parmesan or vegetarian hard cheese']) assert.equal(diets.recipeAllowed(recipe(ingredient), ['vegetarian']), false, ingredient);
  assert.equal(diets.recipeAllowed(recipe('Vegan mayonnaise','Vegan chicken pieces'), ['vegan']), true);
});
test('vegan is stricter than vegetarian and excludes egg, honey, dairy and unspecified Quorn', () => {
  for (const ingredient of ['Eggs','Honey','Cheddar','Natural yoghurt','Mayonnaise','Quorn mince','Vegetarian sausages']) assert.equal(diets.recipeAllowed(recipe(ingredient), ['vegan']), false, ingredient);
  assert.equal(diets.recipeAllowed(recipe('Tofu','Lentils','Peanut butter','Coconut milk','Rice'), ['vegan']), true);
});
test('dairy-free keeps eggs and plant foods but rejects lactose-free milk and mixed dairy ingredients', () => {
  for (const ingredient of ['Eggs','Mayonnaise','Coconut milk','Almond milk','Oat cream','Peanut butter','Butter beans','Cocoa butter','Dairy-free yoghurt']) assert.equal(diets.recipeAllowed(recipe(ingredient), ['dairy-free']), true, ingredient);
  for (const ingredient of ['Milk','Lactose-free milk','Oat milk and butter','Coconut cream with milk','Whey powder','Ghee']) assert.equal(diets.recipeAllowed(recipe(ingredient), ['dairy-free']), false, ingredient);
});
test('gluten-free checks recipe ingredients and honors explicit gluten-free or naturally free alternatives', () => {
  for (const ingredient of ['Pasta','Wheat flour','Couscous','Soy sauce','Tamari','Oats','Soba noodles','Gluten-free bread with wheat breadcrumbs']) assert.equal(diets.recipeAllowed(recipe(ingredient), ['gluten-free']), false, ingredient);
  for (const ingredient of ['Gluten-free pasta','Gluten-free soy sauce','Rice noodles','Chickpea flour','Cornflour','Buckwheat flour','Rice']) assert.equal(diets.recipeAllowed(recipe(ingredient), ['gluten-free']), true, ingredient);
});
test('combined preferences intersect and missing ingredients fail closed only when a restriction is active', () => {
  assert.equal(diets.recipeAllowed(recipe('Eggs','Milk'), ['vegetarian','dairy-free']), false);
  assert.equal(diets.recipeAllowed(recipe('Eggs','Rice'), ['vegetarian','dairy-free']), true);
  assert.equal(diets.recipeAllowed({id:'unknown'}, ['vegetarian']), false);
  assert.equal(diets.recipeAllowed({id:'unknown'}, []), true);
  assert.equal(diets.recipeAllowed({id:'bad', ingredients:[{}]}, ['vegan']), false);
  assert.equal(diets.recipeAllowed({...recipe('Rice'), vegan:false}, ['vegan']), false);
  for (const ingredients of [[{key:'chicken_stock'}],[{key:'tuna_fillets'}],[{name:'Beef stock'}],['Chicken breast']]) assert.equal(diets.recipeAllowed({ingredients}, ['Vegetarian']), false);
  assert.equal(diets.recipeAllowed({ingredients:[{key:'coconut_milk'}]}, ['Vegan','Dairy-free']), true);
});
test('the real catalogue honors dietary ingredients without changing recipe data', () => {
  const recipes = JSON.parse(fs.readFileSync(new URL('../recipes.json', import.meta.url))), before=JSON.stringify(recipes), byId=new Map(recipes.map(recipe => [recipe.id,recipe]));
  assert.equal(diets.recipeAllowed(byId.get('fajitas'), ['vegetarian']), false);
  assert.equal(diets.recipeAllowed(byId.get('steak'), ['vegetarian']), false);
  assert.equal(diets.recipeAllowed(byId.get('bbq-chicken-pizza'), ['gluten-free']), false);
  assert.equal(diets.recipeAllowed(byId.get('chickpea-curry'), ['vegan','gluten-free','dairy-free']), true);
  assert.equal(diets.recipeAllowed(byId.get('honey-garlic-tofu'), ['vegetarian']), true);
  assert.equal(diets.recipeAllowed(byId.get('honey-garlic-tofu'), ['vegan']), false);
  assert.equal(diets.recipeAllowed(byId.get('mushroom-risotto'), ['vegetarian']), false);
  assert.equal(diets.recipeAllowed(byId.get('tomato-mozzarella-pasta'), ['vegetarian']), true);
  assert.equal(diets.recipeAllowed(byId.get('tomato-mozzarella-pasta'), ['dairy-free']), false);
  assert.equal(JSON.stringify(recipes), before);
});
