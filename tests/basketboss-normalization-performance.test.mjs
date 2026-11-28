import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const BASELINE='c05180b1d28b4c30d2ae7b272faeab0f0565e546';
const FILES=['bb-household-aliases.js','bb-pantry-policy.js','basketboss-pricing-v19.js'];
const baseline=new Map(FILES.map(name=>[name,execFileSync('git',['show',BASELINE+':'+name],{cwd:ROOT,encoding:'utf8',maxBuffer:4*1024*1024})]));
const current=new Map(FILES.map(name=>[name,fs.readFileSync(path.join(ROOT,name),'utf8')]));
const recipes=JSON.parse(fs.readFileSync(path.join(ROOT,'catalogues/700/release/free.recipes.json'),'utf8'));
const names=recipes.flatMap(recipe=>recipe.ingredients.map(ingredient=>ingredient[0]));
const edge=['',' ','Milk','MILK',' milk\t','Ground Beef','Cooked chicken','Frozen fresh tomatoes','Chopped tomatoes (400 g)','Pepper','Peppers','pepper powder','extra–virgin olive oil','extra—virgin olive oil','red, onions','\u0000Milk\u001f\u007f','ＦＵＬＬＷＩＤＴＨ','ßİıﬃ','e\u0301 É','Rice\u00a0  500 g','__proto__','prototype','constructor','food|g','中文牛肉','\ud800','\udfff','ﷺ'.repeat(30),'x'.repeat(256),'y'.repeat(257)];
const corpus=[...names,...edge];
let seed=59171;
for(let i=0;i<8000;i++){
 let value='';
 for(let j=0;j<i%30;j++){seed=(1664525*seed+1013904223)>>>0;value+=String.fromCharCode(seed>>>16);}
 corpus.push(value);
}

function expose(source,name){
 const anchor=name==='basketboss-pricing-v19.js'?'root.BBPriceV19=Object.freeze(':name==='bb-pantry-policy.js'?'return Object.freeze({canonicalName,':'return Object.freeze({schemaVersion:1,';
 assert.equal(source.split(anchor).length,2,'known private helper scope');
 return source.replace(anchor,"globalThis.__normalizationProbe={clean,cache:typeof cleanStrings==='undefined'?null:cleanStrings};\n"+anchor);
}
function helper(name,candidate){
 const context=vm.createContext({console,localStorage:{getItem(){return null}}});
 context.window=context;
 vm.runInContext(expose((candidate?current:baseline).get(name),name),context,{filename:name});
 return context.__normalizationProbe;
}
function capture(run){try{return {value:run()}}catch(error){return {error:error.name,message:error.message}}}
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const result=run=>{const value=capture(run);return value.error?value:{value:plain(value.value)}};

for(const name of FILES){
 test(name+': public ingredient/Unicode strings, repeated hits and evictions stay exact',()=>{
  const before=helper(name,false),after=helper(name,true);
  for(let pass=0;pass<2;pass++)for(const value of corpus)assert.equal(after.clean(value),before.clean(value));
  assert.ok(after.cache&&typeof after.cache.get==='function','a bounded private cache exists');
  assert.ok(after.cache.size<=512);
  for(const [key,value]of after.cache){assert.equal(typeof key,'string');assert.ok(key.length<=256);assert.equal(typeof value,'string');}
  const prior=after.cache.size;
  for(let i=0;i<20;i++)assert.equal(after.clean('long'+i+'z'.repeat(1000)),before.clean('long'+i+'z'.repeat(1000)));
  assert.equal(after.cache.size,prior,'long inputs bypass retention');
  for(let i=0;i<1200;i++)assert.equal(after.clean('Unique '+i),before.clean('Unique '+i));
  assert.equal(after.cache.size,512);
  assert.equal(after.clean('Milk'),before.clean('Milk'),'an evicted primitive recomputes exactly');
 });
 test(name+': original type guard and every live coercion are preserved',()=>{
  const before=helper(name,false),after=helper(name,true);
  for(const value of [null,undefined,false,true,0,-0,1,NaN,Infinity,0n,1n,Symbol('food'),new String('Milk'),Object.create(null)])assert.deepEqual(capture(()=>after.clean(value)),capture(()=>before.clean(value)));
  function live(){let calls=0;return {get calls(){return calls},value:{toString(){calls++;if(calls===4)throw Error('dynamic failure');return calls%2?'Milk':'Rice';}}};}
  const a=live(),b=live();
  for(let i=0;i<8;i++){assert.deepEqual(capture(()=>after.clean(b.value)),capture(()=>before.clean(a.value)));assert.equal(b.calls,a.calls);}
  assert.equal(b.calls,name==='basketboss-pricing-v19.js'?8:0,'pricing coerces on each call; pantry/aliases still reject objects');
  function primitive(){let calls=0;return {get calls(){return calls},value:{[Symbol.toPrimitive](){calls++;return calls%2?'Rice':'Milk';}}};}
  const p=primitive(),q=primitive();
  for(let i=0;i<8;i++){assert.deepEqual(capture(()=>after.clean(q.value)),capture(()=>before.clean(p.value)));assert.equal(q.calls,p.calls);}
 });
}
function moduleWorld(candidate){
 const context=vm.createContext({console,localStorage:{getItem(){return null},setItem(){throw Error('unexpected persistence')},removeItem(){throw Error('unexpected persistence')}}});
 context.window=context;
 for(const name of ['bb-pantry-policy.js','bb-household-aliases.js','basketboss-pricing-v19.js'])vm.runInContext((candidate?current:baseline).get(name),context,{filename:name});
 for(const [owner,methods]of [['BBHouseholdAliases',['canonicalName','canonicalStockKey','displayName','resolve']],['BBPantryPolicy',['canonicalName','stockCompatible']],['BBPriceV19',['canonical','price']]])for(const method of methods)assert.equal(typeof context[owner]?.[method],'function',owner+'.'+method+' is a real API');
 return context;
}
test('complete aliases, pantry identities/matching and all regional pack quotes retain exact outputs',()=>{
 const before=moduleWorld(false),after=moduleWorld(true);
 for(const name of [...new Set(names),...edge]){
  for(const method of ['canonicalName','displayName','canonicalStockKey'])assert.deepEqual(result(()=>after.BBHouseholdAliases[method](name)),result(()=>before.BBHouseholdAliases[method](name)),method+': '+name);
  assert.deepEqual(result(()=>after.BBPantryPolicy.canonicalName(name,after.BBPriceV19.canonical)),result(()=>before.BBPantryPolicy.canonicalName(name,before.BBPriceV19.canonical)));
  assert.deepEqual(result(()=>after.BBPriceV19.canonical(name)),result(()=>before.BBPriceV19.canonical(name)));
  for(const market of ['UK','Jersey','Guernsey','US'])for(const [unit,quantity]of [['g',750],['ml',500],['each',2],['clove',3]])assert.deepEqual(result(()=>after.BBPriceV19.price({name,unit,quantity,market})),result(()=>before.BBPriceV19.price({name,unit,quantity,market})),market+': '+name+'|'+unit);
 }
 for(const [left,right]of [['Tomatoes','Chopped tomatoes'],['Fresh chicken','Frozen chicken'],['pepper','mixed peppers'],['Milk','Oat milk'],['Butter','Unsalted butter'],['Cheddar','Parmesan'],['Rice','rice'],['tinned tomatoes','canned chopped tomatoes']])assert.deepEqual(result(()=>after.BBPantryPolicy.stockCompatible(left,right,after.BBPriceV19.canonical)),result(()=>before.BBPantryPolicy.stockCompatible(left,right,before.BBPriceV19.canonical)));
});
test('every repeated canonical callback stays live across changed outputs and failures',()=>{
 for(const owner of ['BBHouseholdAliases','BBPantryPolicy']){
  const before=moduleWorld(false),after=moduleWorld(true);let countA=0,countB=0,choice='milk';
  const callback=side=>value=>{if(side==='a')countA++;else countB++;if(choice==='throw')throw Error('live canonical failure');return choice;};
  const a=callback('a'),b=callback('b'),method=owner==='BBHouseholdAliases'?'resolve':'canonicalName';
  for(const next of ['milk','milk','rice','ground beef','throw','fresh chicken','rice','milk']){choice=next;assert.deepEqual(result(()=>after[owner][method]('Food item',b)),result(()=>before[owner][method]('Food item',a)));assert.equal(countB,countA);}
  assert.equal(countA,8,'the original canonicalizer still runs on every action');
 }
});
