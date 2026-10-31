import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const recipes=JSON.parse(read('recipes.json'));
const normalized=JSON.parse(read('normalized-ingredient-database.json'));

class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.attributes={};this.listeners={};this.style={};this.ownText='';}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.ownText='';this.children=[...children];}
  setAttribute(name,value){this.attributes[name]=String(value);}
  addEventListener(name,handler){this.listeners[name]=handler;}
}
function all(element){return [element,...element.children.filter(child=>typeof child!=='string').flatMap(all)];}

async function demo({failQuantities=false,quantityData=normalized,recipeData=recipes}={}){
  const elements=new Map(),requests=[];
  const document={
    getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},
    createElement:tag=>new Element(tag),querySelector:()=>null
  };
  const context=vm.createContext({document,Intl,
    fetch:async(url,options)=>{
      requests.push({url,options});
      if(url==='/recipes.json')return {ok:true,json:async()=>structuredClone(recipeData)};
      assert.equal(url,'/normalized-ingredient-database.json','Only public Free catalogue files may be fetched');
      return {ok:!failQuantities,json:async()=>structuredClone(quantityData)};
    }
  });
  context.window=context;
  vm.runInContext(read('basketboss-aisles-v20.js'),context);
  vm.runInContext(read('basketboss-pricing-v19.js'),context);
  // Expose existing closure state only in this test harness; production has no demo API.
  const source=read('bb-beta-landing.js').replace(/ load\(\);\n\}\)\(\);\s*$/,` globalThis.demo={mealEstimate,total,rowsForShopping,
    select(ids,counts){shown=ids.map(id=>publicRecipes.find(r=>r.id===id));portions=counts;renderMeals();renderShopping();}};
 globalThis.demoReady=load();
})();`);
  assert.notEqual(source,read('bb-beta-landing.js'),'Harness must execute the current landing implementation');
  vm.runInContext(source.replace('}catch(_){/* Keep public descriptions', '}catch(_){globalThis.loadError=_;/* Keep public descriptions'),context);
  await context.demoReady;
  if(!failQuantities&&quantityData===normalized)assert.equal(context.loadError,undefined);
  return {context,api:context.BBPriceV19,controller:context.demo,elements,requests};
}

test('public demo keeps dish prices hidden while serving controls update the budget',async()=>{
  const altered=structuredClone(recipes);
  for(const recipe of altered){recipe.cost=9999;for(const line of recipe.ingredients)line[2]=9999;}
  const h=await demo({recipeData:altered});
  const recipe=altered.find(r=>r.id==='creamy-pasta');
  h.controller.select(['creamy-pasta'],[4]);
  const plus=all(h.elements.get('demo-meals')).find(el=>el.attributes['aria-label']==='Add a serving of '+recipe.name);
  plus.listeners.click();plus.listeners.click();
  const expected=h.api.estimateMeal({recipe,normalized:normalized.recipes.find(r=>r.id===recipe.id),servings:6,market:'UK'});
  assert.equal(h.controller.total(),expected.amount);
  assert.ok(expected.amount>0&&expected.amount<9999);
  assert.doesNotMatch(h.elements.get('demo-meals').textContent,/£|\$| est\./i);
  assert.ok(h.elements.get('demo-meals').textContent.includes(recipe.name));
  assert.match(h.elements.get('demo-total').textContent,/Estimated meals \(UK\): £/);
  assert.equal(h.requests.length,2);
  for(const {options} of h.requests){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');}
});

test('public shopping preview shares packs after aggregating normalized ingredient quantities',async()=>{
  const h=await demo();
  h.controller.select(['pesto-salmon-potatoes','traybake-sausage'],[6,6]);
  const rows=h.controller.rowsForShopping();
  const potatoRows=rows.filter(row=>row.name==='potato'&&row.unit==='g');
  assert.equal(potatoRows.length,1);
  const expectedQuantity=['pesto-salmon-potatoes','traybake-sausage'].reduce((sum,id)=>{
    const recipe=recipes.find(r=>r.id===id);
    const ingredient=normalized.recipes.find(r=>r.id===id).ingredients.find(i=>i.key==='potato');
    return sum+ingredient.quantity/recipe.servings*6;
  },0);
  assert.equal(potatoRows[0].quantity,expectedQuantity);
  assert.equal(potatoRows[0].cost,h.api.price({name:'potato',quantity:expectedQuantity,unit:'g',market:'UK'}).packAmount);
  const oil=rows.find(row=>row.name==='cooking oil');
  assert.ok(oil,'All cupboard staples remain visible in the shopping basket');
  assert.equal(oil.cost,h.api.price({name:oil.name,quantity:oil.quantity,unit:oil.unit,market:'UK'}).packAmount);
});

test('failed or mismatched public quantity data shows unavailable instead of a false price',async()=>{
  const bad=structuredClone(normalized);bad.recipes[0].id='unexpected-source';
  for(const options of [{failQuantities:true},{quantityData:bad}]){
    const h=await demo(options);
    assert.equal(h.controller.total(),null);
    assert.match(h.elements.get('demo-total').textContent,/Estimate unavailable/);
    assert.doesNotMatch(h.elements.get('demo-meals').textContent,/£|\$|Estimate unavailable/);
    assert.match(h.elements.get('demo-shopping').textContent,/Pack estimates unavailable/);
    assert.doesNotMatch(h.elements.get('demo-shopping').textContent,/£0\.00/);
  }
});
