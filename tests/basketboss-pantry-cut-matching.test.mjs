import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),{proposal}=require('../bb-pantry-deduction.js'),home=require('../bb-home.js');
const id=(name,unit)=>policy.canonicalName(name)+'|'+unit;
const ingredient=(name,required,unit='g')=>({name,key:name,required,unit});
const context={pantryMode:true,market:'Guernsey'};

test('a food name without a cut covers the same declared food as fillets or portions',()=>{
 for(const [base,cut]of [
  ['Smoked haddock','Smoked haddock fillets'],['Haddock','Smoked haddock fillet'],
  ['Salmon','Salmon fillets'],['Smoked salmon','Smoked salmon portions'],
  ['Red snapper','Red snapper fillets'],['Rainbow trout','Rainbow trout portions'],
  ['Cod','Cod portion'],['Sardines','Sardine fillets'],
  ['Frozen haddock','Frozen haddock fillets'],['Vegan fish','Vegan fish fillets'],
 ])for(const [left,right]of [[base,cut],[cut,base]])assert.equal(policy.stockCompatible(left,right),true,left+' / '+right);
});

test('terminal cut matching keeps different foods and specifically named varieties separate',()=>{
 for(const [left,right]of [
  ['Cod','Haddock fillets'],['Smoked haddock','Smoked salmon fillets'],
  ['Fish','Haddock fillets'],['Atlantic salmon','Pacific salmon fillets'],
  ['Smoked haddock','Fresh haddock fillets'],['Red snapper','Yellow snapper fillets'],
  ['Pork','Beef fillets'],['Chicken breast','Turkey breast fillets'],
  ['Haddock fillets','Cod fillets'],['Salmon portions','Trout portions'],
  ['Haddock fillets','Haddock portions'],
 ])for(const [a,b]of [[left,right],[right,left]])assert.equal(policy.stockCompatible(a,b),false,a+' / '+b);
});

test('cut descriptions cannot erase dietary, processing or protected physical forms',()=>{
 for(const [left,right]of [
  ['Haddock','Frozen haddock fillets'],['Haddock','Dried haddock fillets'],
  ['Haddock','Cooked haddock portions'],['Haddock','Raw haddock fillets'],
  ['Haddock','Tinned haddock fillets'],['Fish','Vegan fish fillets'],
  ['Fish','Vegetarian fish portions'],['Fish','Gluten-free fish fillets'],
  ['Haddock','Haddock mince'],['Haddock','Haddock stock'],['Haddock','Haddock broth'],
  ['Haddock','Haddock powder'],['Haddock','Haddock paste'],['Haddock','Haddock puree'],
  ['Chicken breast','Chicken thigh fillets'],['Chicken','Chicken breast fillets'],
  ['Haddock','Haddock fingers'],['Haddock','Haddock cakes'],['Haddock','Breaded haddock fillets'],
  ['Haddock','Battered haddock fillets'],['Haddock','Crumbed haddock portions'],['Haddock','Stuffed haddock fillets'],
  ['Broccoli','Broccoli florets'],['Sugar','Brown sugar portions'],['Pasta','Fresh pasta portions'],
 ])for(const [a,b]of [[left,right],[right,left]])assert.equal(policy.stockCompatible(a,b),false,a+' / '+b);
});

test('comparison leaves physical identities, comparison keys and metric normalization unchanged',()=>{
 const rows=[
  ['Smoked haddock','smoked haddock','haddock'],
  ['Smoked haddock fillets','smoked haddock fillets','haddock fillet'],
  ['Frozen haddock fillets','frozen haddock fillets','frozen haddock fillet'],
 ];
 for(const [label,canonical,key]of rows){
  const before=policy.normalize(label,200,'g',{market:'Guernsey'});
  assert.equal(policy.stockCompatible(label,'Smoked haddock fillets'),label.startsWith('Frozen')?false:true);
  assert.equal(policy.canonicalName(label),canonical);
  assert.equal(policy.getCanonicalMatchKey(label),key);
  assert.deepEqual(policy.normalize(label,200,'g',{market:'Guernsey'}),before);
  assert.equal(before.quantity,200);assert.equal(before.unit,'g');
 }
});

test('the actual food target gives 600 g required, 200 g owned and 400 g to buy',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const requirements=[ingredient('Smoked haddock fillets',600)],stock={'smoked haddock|g':200};
 const win={localStorage:storage,location:{search:''},document:{},BBPantryPolicy:policy,bb307ActiveMarket:()=> 'Guernsey',BBHomeHost:{id,requirements:()=>requirements,stock:()=>({...stock})}};
 const info=home.install(win).foodTarget({name:'Smoked haddock',unit:'g',qty:200,automaticNeeded:true,extraBuffer:0});
 assert.equal(info.targetProblem,'');assert.equal(info.totalNeeded,600);assert.equal(info.shortfall,400);
 const result=proposal({stock,ingredients:requirements,conversion:context}),row=result.rows[0];
 assert.equal(row.required,600);assert.equal(row.deduct,200);assert.equal(row.required-row.deduct,400);
 assert.equal(row.allocations[0].stockKey,'smoked haddock|g');assert.deepEqual(result.remainingStock,{});
 assert.deepEqual(stock,{'smoked haddock|g':200});
});

test('two compatible recipe cuts can spend generic stock only once',()=>{
 const stock={'haddock|g':200},result=proposal({stock,ingredients:[ingredient('Smoked haddock fillets',600),ingredient('Haddock portions',300)],conversion:context});
 assert.equal(result.rows.reduce((sum,row)=>sum+row.required,0),900);
 assert.equal(result.rows.reduce((sum,row)=>sum+row.deduct,0),200);
 assert.equal(result.rows.reduce((sum,row)=>sum+row.required-row.deduct,0),700);
 assert.equal(result.rows.flatMap(row=>row.allocations).reduce((sum,row)=>sum+row.sourceQuantity,0),200);
 assert.deepEqual(stock,{'haddock|g':200});
});

test('specific fillet stock remains reserved before generic food uses the shared balance',()=>{
 const stock={'haddock|g':200,'smoked haddock fillets|g':600},result=proposal({stock,ingredients:[ingredient('Haddock',300),ingredient('Smoked haddock fillets',600)],conversion:context});
 const specific=result.rows.find(row=>row.name==='Smoked haddock fillets'),generic=result.rows.find(row=>row.name==='Haddock');
 assert.equal(specific.deduct,600);assert.equal(specific.allocations[0].stockKey,'smoked haddock fillets|g');
 assert.equal(generic.deduct,200);assert.equal(generic.required-generic.deduct,100);
 assert.deepEqual(stock,{'haddock|g':200,'smoked haddock fillets|g':600});
});

test('matching names never turns saved counts or unreviewed packs into grams',()=>{
 for(const unit of ['each','pack']){
  const stock={['smoked haddock|'+unit]:200},before=JSON.stringify(stock),result=proposal({stock,ingredients:[ingredient('Smoked haddock fillets',600)],conversion:context});
  assert.equal(result.rows[0].deduct,0);assert.equal(result.rows[0].issue,'unit_mismatch');
  assert.equal(JSON.stringify(stock),before);assert.deepEqual(result.remainingStock,stock);
 }
});

test('legacy strict deduction callers do not opt into generic cut matching',()=>{
 const stock={'smoked haddock|g':200};
 for(const conversion of [undefined,{}]){
  const result=proposal({stock,ingredients:[ingredient('Smoked haddock fillets',600)],conversion});
  assert.equal(result.rows[0].deduct,0);assert.deepEqual(result.remainingStock,stock);
 }
});
