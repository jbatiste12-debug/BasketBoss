import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),{proposal}=require('../bb-pantry-deduction.js'),home=require('../bb-home.js');
const food=(key,required,unit='g')=>({key,name:key,required,unit});
const context={pantryMode:true,market:'UK'};
const pairs=[['Rice','Basmati rice'],['Rice','Jasmine rice'],['Rice','Brown rice'],['Rice','Long grain rice'],['Rice','Dry rice'],['Pasta','Penne'],['Pasta','Spaghetti'],['Pasta','Fusilli pasta'],['Onions','Red onions'],['Potatoes','Baking potatoes'],['Milk','Semi-skimmed milk'],['Cheddar','Mature cheddar'],['Flour','Plain flour'],['Sugar','Caster sugar'],['Chicken breast','Chicken breast fillets'],['Olive oil','Extra virgin olive oil']];
for(const [generic,specific]of pairs)test('generic pantry entry covers compatible recipe: '+generic+' / '+specific,()=>{
 assert.equal(policy.stockCompatible(generic,specific),true);
 assert.equal(policy.stockCompatible(specific,generic),true);
 const unit=generic==='Milk'?'ml':'g',key=policy.canonicalName(generic)+'|'+unit,stock={[key]:200};
 const result=proposal({stock,ingredients:[food(specific,300,unit)],conversion:{...context,...(generic==='Olive oil'?{staples:{'olive oil':'in'}}:{})}}),row=result.rows[0];
 if(generic==='Olive oil'){assert.equal(row.stapleStatus,'in');assert.deepEqual(result.remainingStock,stock);}
 else{assert.equal(row.required,300);assert.equal(row.deduct,200);assert.equal(row.required-row.deduct,100);assert.deepEqual(result.remainingStock,{});assert.equal(row.allocations[0].stockKey,key);}
 assert.equal(stock[key],200,'a planning proposal never mutates the saved stock map');
});
const distinct=[['Rice','Cooked rice'],['Rice','Frozen rice'],['Rice','Rice flour'],['Rice','Rice noodles'],['Basmati rice','Jasmine rice'],['Pasta','Fresh pasta'],['Pasta','Gluten-free pasta'],['Pasta','Cooked pasta'],['Milk','Oat milk'],['Milk','Lactose-free milk'],['Whole milk','Semi-skimmed milk'],['Chicken breast','Chicken thigh'],['Chicken breast','Cooked chicken breast'],['Chicken breast','Turkey breast'],['Potatoes','Sweet potatoes'],['Onion','Spring onion'],['Onion','Onion powder'],['Flour','Self-raising flour'],['Flour','Bread flour'],['Sugar','Brown sugar'],['Tomato','Chopped tomatoes']];
for(const [generic,specific]of distinct)test('distinct food retains its separate stock: '+generic+' / '+specific,()=>{
 assert.equal(policy.stockCompatible(generic,specific),false);
 const stock={[policy.canonicalName(generic)+'|g']:500},result=proposal({stock,ingredients:[food(specific,300)],conversion:context});
 assert.equal(result.rows[0].deduct,0);assert.deepEqual(result.remainingStock,stock);
});
test('two recipe varieties share the generic stock once, including duplicate meal requirements',()=>{
 const result=proposal({stock:{'rice|g':200},ingredients:[food('Basmati rice',300),food('Basmati rice',300),food('Jasmine rice',200)],conversion:context});
 assert.equal(result.rows.reduce((sum,row)=>sum+row.required,0),800);assert.equal(result.rows.reduce((sum,row)=>sum+row.deduct,0),200);assert.equal(result.rows.reduce((sum,row)=>sum+row.required-row.deduct,0),600);
 assert.deepEqual(result.remainingStock,{});assert.equal(result.rows.flatMap(row=>row.allocations).reduce((sum,row)=>sum+row.sourceQuantity,0),200);
});
test('exact stock is reserved for its specific requirement before using a generic pool',()=>{
 const result=proposal({stock:{'rice|g':100,'basmati rice|g':200},ingredients:[food('Rice',200),food('Basmati rice',200)],conversion:context});
 assert.equal(result.rows.find(row=>row.name==='Basmati rice').deduct,200);assert.equal(result.rows.find(row=>row.name==='Rice').deduct,100);assert.deepEqual(result.remainingStock,{});
});
test('source-specific cup and whole-food weights are preserved when names share a family',()=>{
 const cup=proposal({stock:{'rice|g':300},ingredients:[food('Risotto rice',1,'cup')],conversion:context}).rows[0];
 assert.equal(cup.required,policy.normalize('Risotto rice',1,'cup',{market:'UK'}).quantity);
 const potato=proposal({stock:{'potato|g':300},ingredients:[food('Baking potatoes',1,'each')],conversion:context}).rows[0];
 assert.equal(potato.required,policy.normalize('Baking potatoes',1,'each',{market:'UK'}).quantity);assert.equal(potato.deduct,potato.required);
});
test('unreviewed packs cannot be mistaken for grams across a generic family',()=>{
 const stock={'rice|pack':1},result=proposal({stock,ingredients:[food('Basmati rice',300)],conversion:context});
 assert.equal(result.rows[0].deduct,0);assert.equal(result.rows[0].issue,'unit_mismatch');assert.deepEqual(result.remainingStock,stock);
});
test('a generic pantry target adds only the extra buffer after compatible meal needs',()=>{
 const id=(name,unit)=>policy.canonicalName(name)+'|'+unit,items=[food('Basmati rice',300)],target={name:'Rice',unit:'g',targetQty:300,pending:true,extraBuffer:100};
 const rows=home.augment(items,[],{'rice|g':target},id);assert.equal(rows.reduce((sum,row)=>sum+row.required,0),400);
 const result=proposal({stock:{'rice|g':200},ingredients:rows,conversion:context});assert.equal(result.rows.reduce((sum,row)=>sum+row.required-row.deduct,0),200);
 assert.equal(items.length,1);assert.equal(items[0].required,300);
});
test('family matching remains opt-in for callers using the legacy strict conversion contract',()=>{
 const stock={'rice|g':200};for(const conversion of [undefined,{}]){const result=proposal({stock,ingredients:[food('Basmati rice',300)],conversion});assert.equal(result.rows[0].deduct,0);assert.deepEqual(result.remainingStock,stock);}
});

test('plain sausage counts cover pork sausage needs without renaming or weighing saved stock',()=>{
 for(const generic of ['Sausage','Sausages'])for(const specific of ['Pork sausage','Pork sausages'])for(const [owned,needed]of [[generic,specific],[specific,generic]]){
  assert.equal(policy.stockCompatible(owned,needed),true,owned+' / '+needed);
  const key=policy.canonicalName(owned)+'|each',stock={[key]:5},before=JSON.stringify(stock),result=proposal({stock,ingredients:[food(needed,6,'each')],conversion:context}),row=result.rows[0];
  assert.equal(row.required,6);assert.equal(row.deduct,5);assert.equal(row.required-row.deduct,1);assert.equal(row.allocations[0].stockKey,key);assert.equal(row.allocations[0].sourceQuantity,5);
  assert.deepEqual(result.remainingStock,{});assert.equal(JSON.stringify(stock),before);
 }
 assert.equal(policy.canonicalName('Sausages'),'sausages');assert.equal(policy.canonicalName('Pork sausages'),'pork sausages');
 const weighed={'sausages|g':500},incompatible=proposal({stock:weighed,ingredients:[food('Pork sausages',6,'each')],conversion:context});
 assert.equal(incompatible.rows[0].deduct,0);assert.equal(incompatible.rows[0].issue,'unit_mismatch');assert.deepEqual(incompatible.remainingStock,weighed,'a matching food family supplies no invented grams per sausage');
 for(const conversion of [undefined,{}])assert.equal(proposal({stock:{'sausages|each':5},ingredients:[food('Pork sausages',6,'each')],conversion}).rows[0].deduct,0,'legacy strict callers retain their previous contract');
});
test('sausage stock is allocated once across recipe names and specific stock is reserved first',()=>{
 const stock={'sausages|each':5},result=proposal({stock,ingredients:[food('Pork sausages',6,'each'),food('Sausages',6,'each')],conversion:context});
 assert.equal(result.rows.reduce((sum,row)=>sum+row.deduct,0),5);assert.equal(result.rows.reduce((sum,row)=>sum+row.required-row.deduct,0),7);assert.equal(result.rows.flatMap(row=>row.allocations).reduce((sum,row)=>sum+row.sourceQuantity,0),5);assert.deepEqual(stock,{'sausages|each':5});
 const reserved=proposal({stock:{'sausage|each':5,'pork sausages|each':5},ingredients:[food('Sausage',6,'each'),food('Pork sausages',5,'each')],conversion:context});
 assert.equal(reserved.rows.find(row=>row.name==='Pork sausages').deduct,5);assert.equal(reserved.rows.find(row=>row.name==='Sausage').deduct,5);assert.deepEqual(reserved.remainingStock,{});
});

import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const id=(name,unit)=>policy.canonicalName(name)+'|'+unit;
test('actual unified Shop uses five generic sausages once against the six-piece pork recipe requirement',()=>{
 const recipes=JSON.parse(fs.readFileSync(new URL('../recipes.json',import.meta.url),'utf8')),normalized=JSON.parse(fs.readFileSync(new URL('../normalized-ingredient-database.json',import.meta.url),'utf8')).recipes;
 const recipe=recipes.find(row=>row.id==='sausage-gnocchi'),source=normalized.find(row=>row.id===recipe.id).ingredients[0];
 assert.equal(recipe.ingredients[0][0],'Pork sausages');assert.equal(source.quantity,6);assert.equal(source.unit,'each');
 const stock={'sausages|each':5},before=JSON.stringify(stock),scope=vm.createContext({BBPantryPolicy:policy,BBPantryDeduction:{proposal},BB307Pantry:{pantryId:id},bbHomeConversionContext:()=>context,bb307ReadStock:()=>({...stock}),bbHomePhysicalStock:()=>({...stock}),bbBetaStockForCurrentWeek:value=>value,bbReceiptPantryReviewRequired:()=>false,bbReceiptHasAuthoritativePantry:()=>true,bbHomeLegacyPantry:()=>({}),bb321LunchboxRequirements:()=>[],bbHomeApplyStapleShopping:items=>items,bb307Stock:{}});scope.window=scope;
 const lunchStart=html.indexOf('const BB321Lunch=(()=>{'),lunchEnd=html.indexOf('/* BasketBoss 321 v8 —',lunchStart);assert.ok(lunchStart>=0&&lunchEnd>lunchStart);vm.runInContext(html.slice(lunchStart,lunchEnd),scope);
 for(const [name,next]of [['bbPantryReconcileStock','bb307Plan'],['bb321UnifiedShop','bb321LunchboxHTML']]){const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction '+next+'(',start);assert.ok(start>=0&&end>start);vm.runInContext(html.slice(start,end),scope);}
 const requirement={key:source.key,name:source.name,required:source.quantity,unit:source.unit},row=scope.bb321UnifiedShop([requirement])[0];
 assert.equal(row.required,6);assert.equal(row.pantryUsed,5);assert.equal(row.toBuy,1);assert.equal(JSON.stringify(stock),before,'Shop only reads the saved five-piece balance');
 const both=scope.bb321UnifiedShop([requirement,{key:'sausages',required:6,unit:'each'}]);
 assert.equal(both.reduce((sum,item)=>sum+item.pantryUsed,0),5);assert.equal(both.reduce((sum,item)=>sum+item.toBuy,0),7);assert.equal(JSON.stringify(stock),before);
});
test('the actual Shop reconciliation wrapper credits generic stock across recipe varieties once',()=>{
 const a=html.indexOf('function bbPantryReconcileStock('),b=html.indexOf('\nfunction ',a+20),scope=vm.createContext({BB307Pantry:{pantryId:id},bbHomeConversionContext:()=>context,window:{BBPantryPolicy:policy,BBPantryDeduction:{proposal}}});
 assert.ok(a>=0&&b>a);vm.runInContext(html.slice(a,b),scope);
 const stock={'rice|g':200},one=scope.bbPantryReconcileStock(stock,[food('Basmati Rice',300)]);assert.equal(one.pantry['basmati rice|g'],200);
 const both=scope.bbPantryReconcileStock(stock,[food('Basmati Rice',300),food('Jasmine Rice',400)]);assert.equal(Object.values(both.pantry).reduce((sum,n)=>sum+n,0),200);assert.equal(stock['rice|g'],200);
});
test('the actual At home editor and generic total helper agree with the Shop shortfall',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const requirements=[food('Basmati Rice',300)],win={localStorage:storage,location:{search:''},document:{},BBPantryPolicy:policy,BBHomeHost:{id,requirements:()=>requirements,stock:()=>({'rice|g':200})}};
 const api=home.install(win),row={name:'Rice',unit:'g',qty:200,automaticNeeded:true,extraBuffer:0},info=api.foodTarget(row);
 assert.equal(info.targetProblem,'');assert.equal(info.totalNeeded,300);assert.equal(info.shortfall,100);assert.equal(api.total('Rice','g'),300);
 const buffer=api.foodTarget({...row,extraBuffer:100});assert.equal(buffer.totalNeeded,300);assert.equal(buffer.requiredQuantity,400);assert.equal(buffer.shortfall,200);
});
