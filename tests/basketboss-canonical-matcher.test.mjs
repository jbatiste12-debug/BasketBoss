import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const policy=require('../bb-pantry-policy.js');
const {proposal}=require('../bb-pantry-deduction.js');
const home=require('../bb-home.js');
const context={pantryMode:true,market:'UK'};
const food=(name,required,unit='g')=>({key:name,name,required,unit});
const id=(name,unit)=>policy.canonicalName(name)+'|'+unit;

test('comparison keys normalize punctuation, counts, plurals and ordinary qualifiers',()=>{
 for(const [label,expected]of [
  ['2 Large Brown Onions','onion'],['ONIONS!','onion'],['Sausages','sausage'],
  ['Tomatoes','tomato'],['Berries','berry'],['Leaves','leaf'],
  ['Fresh, British organic onions','onion'],['Pork sausages','sausage'],
  ['Free-range chicken sausages','sausage'],['Semi-skimmed milk','milk'],
  ['Full-fat milk','milk'],['Extra-virgin olive oil','olive oil'],
 ])assert.equal(policy.getCanonicalMatchKey(label),expected,label);
});

test('a generic food can cover its ordinary qualified form in either direction',()=>{
 for(const [generic,specific]of [
  ['Sausage','Pork sausages'],['Sausages','Chicken sausages'],
  ['Sausage','Smoked pork sausages'],['Sausage','Fresh chicken sausages'],
  ['Milk','Whole milk'],['Milk','Semi-skimmed milk'],
  ['Cheddar','Mature cheddar cheese'],['Cheese','Mature cheddar cheese'],
  ['Onion','Large brown onions'],['Onions','Red onions'],
  ['Berry','Berries'],['Leaf','Leaves'],
 ])for(const [left,right]of [[generic,specific],[specific,generic]]){
  assert.equal(policy.stockCompatible(left,right),true,left+' / '+right);
 }
});

test('normalizing qualifiers never makes two named varieties interchangeable',()=>{
 for(const [left,right]of [
  ['Pork sausages','Chicken sausages'],['Pork sausages','Beef sausages'],
  ['Whole milk','Semi-skimmed milk'],['Red onions','Brown onions'],
  ['Mature cheddar cheese','Mild cheddar cheese'],
 ])assert.equal(policy.stockCompatible(left,right),false,left+' / '+right);
});

test('diet, preparation, form and actual food heads protect separate stock',()=>{
 for(const [left,right]of [
  ['Sausage','Vegan sausages'],['Sausage','Vegetarian sausages'],
  ['Pork sausages','Gluten-free pork sausages'],['Sausage','Cooked sausages'],
  ['Sausage','Raw sausages'],['Sausage','Frozen sausages'],
  ['Milk','Oat milk'],['Milk','Almond milk'],['Milk','Soy milk'],
  ['Milk','Coconut milk'],['Milk','Lactose-free milk'],
  ['Milk','Milk chocolate'],['Butter','Peanut butter'],['Butter','Butter beans'],
  ['Garlic','Garlic powder'],['Chicken','Chicken stock'],['Cheese','Cream cheese'],
  ['Broccoli','Broccoli florets'],['Tomato','Tinned tomatoes'],
  ['Tomato','Tomato paste'],['Tomato','Tomato puree'],['Stock','Stock granules'],
  ['Chicken breast','Chicken thigh'],['Chicken','Chicken mince'],
  ['Pepper','Whole red peppers'],['Pasta','Fresh pasta'],['Sugar','Brown sugar'],
 ])for(const [a,b]of [[left,right],[right,left]])assert.equal(policy.stockCompatible(a,b),false,a+' / '+b);
});

test('comparison preserves physical saved identities and existing quantity-note cleanup',()=>{
 const names=['Sausages','Pork sausages','Whole milk','Mature cheddar cheese','2 Large Brown Onions'];
 const before=names.map(name=>policy.canonicalName(name));
 for(const name of names){policy.getCanonicalMatchKey(name);policy.stockCompatible(name,'Sausage');}
 assert.deepEqual(names.map(name=>policy.canonicalName(name)),before);
 assert.equal(policy.canonicalName('Sausages'),'sausages');
 assert.equal(policy.canonicalName('Pork sausages'),'pork sausages');
 assert.equal(policy.canonicalName('Baking potatoes (about 250 g each)'),'baking potato');
});

test('actual deduction keeps six needed, uses five sausage pieces once and buys one',()=>{
 const stock={'sausages|each':5};
 const result=proposal({stock,ingredients:[food('Chicken sausages',6,'each')],conversion:context});
 assert.equal(result.rows[0].required,6);assert.equal(result.rows[0].deduct,5);
 assert.equal(result.rows[0].required-result.rows[0].deduct,1);
 assert.equal(result.rows[0].allocations[0].stockKey,'sausages|each');
 assert.deepEqual(result.remainingStock,{});assert.deepEqual(stock,{'sausages|each':5});
 const shared=proposal({stock,ingredients:[food('Chicken sausages',6,'each'),food('Pork sausages',6,'each')],conversion:context});
 assert.equal(shared.rows.reduce((sum,row)=>sum+row.deduct,0),5);
 assert.equal(shared.rows.reduce((sum,row)=>sum+row.required-row.deduct,0),7);
});

test('actual home food target credits generic milk stock against the qualified recipe need',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const requirements=[food('Whole milk',300,'ml')],stock={'milk|ml':200};
 const win={localStorage:storage,location:{search:''},document:{},BBPantryPolicy:policy,BBHomeHost:{id,requirements:()=>requirements,stock:()=>({...stock})}};
 const api=home.install(win),info=api.foodTarget({name:'Milk',unit:'ml',qty:200,automaticNeeded:true,extraBuffer:0});
 assert.equal(info.targetProblem,'');assert.equal(info.totalNeeded,300);assert.equal(info.shortfall,100);
 const result=proposal({stock,ingredients:requirements,conversion:context});
 assert.equal(result.rows[0].required,300);assert.equal(result.rows[0].deduct,200);
 assert.equal(result.rows[0].required-result.rows[0].deduct,100);
 assert.deepEqual(stock,{'milk|ml':200});
});

test('unlisted specific foods reserve their physical stock before a generic request',()=>{
 for(const [generic,specific,unit]of [['Sausage','Turkey sausage','each'],['Butter','Cold butter','g'],['Cheese','Mature cheddar cheese','g']]){
  const genericKey=id(generic,unit),specificKey=id(specific,unit),stock={[genericKey]:5,[specificKey]:5};
  const result=proposal({stock,ingredients:[food(generic,6,unit),food(specific,5,unit)],conversion:context});
  const row=result.rows.find(item=>item.name===specific);
  assert.equal(row.deduct,5);assert.equal(row.allocations[0].stockKey,specificKey);
  assert.equal(result.rows.find(item=>item.name===generic).deduct,5);
  assert.deepEqual(result.remainingStock,{});assert.deepEqual(stock,{[genericKey]:5,[specificKey]:5});
 }
});

test('protected dietary and physical words remain present in comparison keys',()=>{
 for(const [label,protectedWord]of [
  ['Vegan sausages','vegan'],['Vegetarian sausages','vegetarian'],['Plant based sausages','plant'],
  ['Gluten-free pasta','glutenfree'],['Oat milk','oat'],['Almond milk','almond'],['Soy milk','soy'],['Coconut milk','coconut'],
  ['Tinned tomatoes','tinned'],['Canned tomatoes','tinned'],['Dried berries','dried'],['Frozen onions','frozen'],
  ['Garlic powder','powder'],['Stock granules','granule'],['Tomato paste','paste'],['Tomato purée','puree'],
  ['Chicken stock','stock'],['Chicken broth','broth'],['Beef mince','mince'],['Pork sausages','sausage'],
  ['Chicken breasts','breast'],['Chicken thighs','thigh'],['Bacon rashers','rasher'],['Streaky bacon','streaky'],
 ])assert.ok(policy.getCanonicalMatchKey(label).split(' ').includes(protectedWord),label);
 assert.equal(policy.getCanonicalMatchKey('Chicken'),'chicken','a food that is also a qualifier keeps its noun');
 assert.notEqual(policy.getCanonicalMatchKey('5% fat beef mince'),policy.getCanonicalMatchKey('20% fat beef mince'));
});
