import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const editorial=require('../bb-recipe-editorial.js');
const dish=extra=>({id:'fajitas',name:'Sheet-pan chicken fajitas',category:'Family favourite',mins:30,...extra});

test('familiar curries, pasta and fajitas remain ordinary family choices without an origin claim',()=>{
  for(const id of ['fajitas','creamy-pasta','chickpea-curry','family-mild-chicken-korma-with-rice','family-cottage-pie']){
    assert.equal(editorial.primaryCollection(dish({id})),'Everyday Favourites',id);
  }
  assert.equal(editorial.primaryCollection(dish({id:'date-duck-orange'})),'Special Occasion');
});

test('World and special browse groups follow stable IDs rather than recipe-name guessing',()=>{
  const renamed=dish({id:'nigerian-steamed-bean-puddings-with-eggs',name:'A new display name'});
  assert.equal(editorial.primaryCollection(renamed),'Try the World');
  assert.equal(editorial.primaryCollection(dish({id:'persian-herb-and-kidney-bean-beef-stew'})),'Try the World');
  assert.equal(editorial.primaryCollection(dish({id:'walnut-and-pomegranate-chicken-fesenjan'})),'Try the World');
  assert.equal(editorial.primaryCollection(dish({id:'saffron-halibut-with-jeweled-barberry-rice'})),'Special Occasion');
  assert.equal(editorial.primaryCollection(dish({id:'not-curated',name:'Persian family dinner'})),null);
  assert.deepEqual(editorial.collections(dish({id:'not-curated'})),[]);
});

test('60-minute readiness is inclusive and uses the supplied duration for every collection',()=>{
  assert.deepEqual(editorial.collections(dish({mins:60})),['Everyday Favourites','60 Minutes or Less']);
  assert.deepEqual(editorial.collections(dish({mins:60.1})),['Everyday Favourites','Weekend & Slow Cooking']);
  const world=dish({id:'persian-herb-and-kidney-bean-beef-stew',mins:45});
  assert.deepEqual(editorial.collections(world),['Try the World','60 Minutes or Less']);
  assert.deepEqual(editorial.collections({...world,mins:95}),['Try the World','Weekend & Slow Cooking']);
  assert.deepEqual(editorial.collections({...world,mins:null}),['Try the World']);
});

test('explicit prep plus cooking duration takes precedence over a shorter headline time',()=>{
  assert.equal(editorial.totalMinutes(dish({prep_mins:20,cook_mins:40,mins:10})),60);
  assert.deepEqual(editorial.collections(dish({prep_mins:20,cook_mins:45,mins:10})),['Everyday Favourites','Weekend & Slow Cooking']);
  assert.equal(editorial.totalMinutes(dish({prep_mins:0,cook_mins:25})),25);
  assert.equal(editorial.totalMinutes(dish({prep_mins:15,cook_mins:0})),15);
  assert.equal(editorial.totalMinutes(dish({prep_mins:0,cook_mins:0})),null);
});

test('malformed or incomplete explicit duration cannot fall back to a misleading short time',()=>{
  for(const bad of [null,'',NaN,Infinity,-1,'15',true,undefined]){
    const recipe=dish({prep_mins:bad,cook_mins:20,mins:10});
    assert.equal(editorial.totalMinutes(recipe),null,String(bad));
    assert.deepEqual(editorial.collections(recipe),['Everyday Favourites']);
    assert.equal(editorial.totalMinutes(dish({prep_mins:5,cook_mins:bad})),null);
  }
  assert.equal(editorial.totalMinutes(dish({prep_mins:10})),null);
  assert.equal(editorial.totalMinutes(dish({cook_mins:10})),null);
  assert.equal(editorial.totalMinutes(dish({prep_mins:Number.MAX_VALUE,cook_mins:Number.MAX_VALUE})),null);
  for(const mins of [null,'',NaN,Infinity,-1,'30',0,true,undefined]){
    assert.equal(editorial.totalMinutes(dish({mins})),null,String(mins));
    assert.deepEqual(editorial.collections(dish({mins})),['Everyday Favourites']);
  }
});

test('long familiar dinners retain their family group and honest slow/weekend label',()=>{
  const slow=dish({id:'slow-beef-stew',category:'Slow cooker · Family',mins:500});
  assert.deepEqual(editorial.collections(slow),['Everyday Favourites','Weekend & Slow Cooking']);
  assert.deepEqual(editorial.collections({...slow,mins:55}),['Everyday Favourites','60 Minutes or Less','Weekend & Slow Cooking']);
  assert.deepEqual(editorial.collections({...slow,mins:null}),['Everyday Favourites','Weekend & Slow Cooking']);
});

test('side dishes, breakfast, desserts and false dinner flags receive no dinner-collection claims',()=>{
  assert.equal(editorial.isSide(dish({id:'extra-air-fryer-garlic-parmesan-potatoes'})),true);
  assert.equal(editorial.isSide(dish()),false);
  for(const recipe of [
    dish({id:'extra-air-fryer-garlic-parmesan-potatoes'}),
    dish({category:'Breakfast',dinnerEligible:true}),
    dish({category:'Desserts · Sweet treats',dinnerEligible:true}),
    dish({category:'Baking',dinnerEligible:true}),
    dish({category:'Side dishes',dinnerEligible:true}),
    dish({category:'Side dish',dinnerEligible:true}),
    dish({mealType:'side',dinnerEligible:true}),
    dish({name:'Egg muffins',dinnerEligible:true}),
    dish({name:'Banana pancakes',dinnerEligible:true}),
    dish({dinnerEligible:false,editorialCollection:'Try the World'}),
    dish({id:'mango-coconut-sticky-rice',category:'Dessert',editorialCollection:'Try the World',dinnerEligible:true})
  ]){
    assert.equal(editorial.primaryCollection(recipe),null,recipe.id+'/'+recipe.name);
    assert.deepEqual(editorial.collections(recipe),[]);
  }
});

test('explicit editorial metadata can label a new dinner but cannot invent meal eligibility',()=>{
  const recipe={id:'new-reviewed-dinner',name:'New dinner',mins:40,dinnerEligible:true,editorialCollection:'Try the World'};
  assert.deepEqual(editorial.collections(recipe),['Try the World','60 Minutes or Less']);
  assert.equal(editorial.primaryCollection({...recipe,editorialCollection:'British'}),null);
  assert.equal(editorial.primaryCollection({...recipe,dinnerEligible:false}),null);
  const unknown=dish({id:'unknown',editorialCollection:'Everyday Favourites'});
  assert.equal(editorial.primaryCollection(unknown),null);
  assert.deepEqual(editorial.collections({...unknown,category:'Dinner',editorialCollection:undefined}),['60 Minutes or Less']);
});

test('helpers handle invalid inputs and leave recipe records untouched',()=>{
  for(const value of [null,undefined,0,'fajitas',[],{}]){
    assert.equal(editorial.primaryCollection(value),null);
    assert.deepEqual(editorial.collections(value),[]);
    assert.equal(editorial.totalMinutes(value),null);
    assert.equal(editorial.isSide(value),false);
  }
  const recipe=Object.freeze(dish({ingredients:Object.freeze([Object.freeze(['Chicken breast','500 g'])]),prep_mins:10,cook_mins:25}));
  const before=JSON.stringify(recipe);
  editorial.primaryCollection(recipe);editorial.collections(recipe);editorial.totalMinutes(recipe);editorial.isSide(recipe);
  assert.equal(JSON.stringify(recipe),before);
  assert.equal('kitchenVerified' in recipe,false);
});

test('browser export respects the shared planning guard and a conservative load-order fallback',()=>{
  const source=fs.readFileSync(new URL('../bb-recipe-editorial.js',import.meta.url),'utf8');
  const context=vm.createContext({window:{}});vm.runInContext(source,context);
  assert.equal(context.window.BBRecipeEditorial.primaryCollection(dish()),'Everyday Favourites');
  assert.equal(context.window.BBRecipeEditorial.primaryCollection(dish({name:'Egg muffins'})),null);
  assert.equal(context.window.BBRecipeEditorial.primaryCollection(dish({name:'Banana pancakes'})),null);
  context.window.BBRecipePlanning={isDinner:()=>false};
  assert.equal(context.window.BBRecipeEditorial.primaryCollection(dish()),null);
});


test("Kids' Meals is a deliberate complete-meal collection, not a name or heat heuristic",()=>{
  const ids=['family-homemade-crunchy-fish-fingers','family-crispy-oven-chicken-goujons','family-mac-cheese','family-mini-cottage-pies-with-peas','beef-meatballs'];
  for(const id of ids){
    const recipe=dish({id,servings:4,mins:35});
    const before=JSON.stringify(recipe);
    assert.equal(editorial.isKidsMeal(recipe),true);
    assert.ok(editorial.collections(recipe).includes("Kids' Meals"));
    assert.equal(JSON.stringify(recipe),before,'collection membership cannot silently change portions');
    assert.equal(editorial.isKidsMeal({...recipe,kidFriendly:false}),false);
  }
  for(const id of ['extra-air-fryer-garlic-parmesan-potatoes','extra-air-fryer-crispy-chicken-tenders','persian-herb-and-kidney-bean-beef-stew','unknown-kids-dinner']){
    assert.equal(editorial.isKidsMeal(dish({id,name:'Mild kids dinner',mins:20})),false,id);
  }
});

test('explicit kids metadata respects dinner and suitability vetoes',()=>{
  const recipe={id:'new-kids-dinner',name:'New dinner',dinnerEligible:true,expansionGroup:'kid-friendly',mins:45};
  assert.equal(editorial.isKidsMeal(recipe),true);
  assert.ok(editorial.collections(recipe).includes("Kids' Meals"));
  for(const changed of [{kidFriendly:false},{dinnerEligible:false},{category:'Dessert'},{category:'Side dishes'}]){
    assert.equal(editorial.isKidsMeal({...recipe,...changed}),false);
  }
});

test('international special dishes share the occasional World quota without relabelling familiar favourites',()=>{
 for(const id of ['freekeh-stuffed-quail-with-pomegranate-glaze','tea-smoked-duck-plum-soba','saffron-halibut-with-jeweled-barberry-rice']){
  const recipe=dish({id});assert.equal(editorial.primaryCollection(recipe),'Special Occasion');assert.equal(editorial.isWorldMeal(recipe),true);
 }
 assert.equal(editorial.isWorldMeal(dish({id:'steak'})),false);
 assert.equal(editorial.isWorldMeal(dish({id:'chicken-katsu-curry'})),false);
 assert.equal(editorial.isWorldMeal(dish({id:'persian-herb-and-kidney-bean-beef-stew'})),true);
 assert.equal(editorial.isWorldMeal(dish({id:'persian-herb-and-kidney-bean-beef-stew',dinnerEligible:false})),false);
});
