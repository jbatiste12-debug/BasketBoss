import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as rules from '../bb-kitchen-choice-rules.mjs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const household = ['Toilet rolls','ToiletRolls','toiletrolls','TOILETROLLS','Andrex toiletrolls','toilet roll','Toilet paper','Kitchen rolls','KitchenRolls','Kitchen towels','Toothpaste','Tooth paste','Tooth pastes','Luxury tooth paste','Tooth brushes','Laundry detergents','laundrydetergents','Dish washer tablets','Cling films','Bin bags','Washing-up liquid'];
const food = ['Wraps','Bread rolls','Spring rolls','Swiss roll','Sausage rolls','Sponge fingers','Sponge cake','Chicken breast','Pork sausages','Fish fingers','Milk','Eggs','Tofu','Rice','Kitchen herbs','Garlic paste'];

function harness({withRules=true}={}) {
  const context = vm.createContext({});context.window=context;
  for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js']) vm.runInContext(read(file),context);
  if(withRules)context.BBKitchenChoiceRules=rules;
  const html=read('app.html'),start=html.indexOf('function bb172Aisle('),end=html.indexOf('\n',start);
  assert.ok(start>=0&&end>start);vm.runInContext(html.slice(start,end),context);
  return context;
}

test('household product classification recognizes plural, case and compound spellings without food aliases',()=>{
  for(const name of household)assert.equal(rules.isHousehold(name),true,name);
  for(const name of food)assert.equal(rules.isHousehold(name),false,name);
  assert.equal(rules.isHousehold('Dental care','Tooth paste'),true);
});

test('semantic household classification controls shopping routing independently of shelf-aisle guesses',()=>{
  const context=harness(),before=JSON.stringify(context.BBPriceV19.catalog);
  const original=new Map([...household,...food].map(name=>[name,context.BBPriceV19.aisle(name)]));
  for(const name of household)assert.equal(context.bb172Aisle({key:name}),'Household & Other',name);
  for(const name of food)assert.equal(context.bb172Aisle({key:name}),original.get(name),name);
  for(const [name,aisle]of original)assert.equal(context.BBPriceV19.aisle(name),aisle,'the frozen aisle engine is unchanged');
  assert.equal(JSON.stringify(context.BBPriceV19.catalog),before);
});

test('routing reads product descriptions but never renames stored requests or changes quantities',()=>{
  const context=harness(),item=Object.freeze({key:'Dental care',name:'Dental care',productName:'Tooth paste',quantity:3,unit:'each'}),before=JSON.stringify(item);
  assert.equal(context.bb172Aisle(item),'Household & Other');assert.equal(JSON.stringify(item),before);
  for(const name of household){const input=Object.freeze({name,quantity:2,unit:'each'}),saved=JSON.stringify(input);assert.equal(context.bb172Aisle(input),'Household & Other');assert.equal(JSON.stringify(input),saved);}
});

test('older contexts without the optional household rules retain their existing aisle results',()=>{
  const context=harness({withRules:false});
  for(const name of [...household,...food])assert.equal(context.bb172Aisle({name}),context.BBPriceV19.aisle(name));
});
