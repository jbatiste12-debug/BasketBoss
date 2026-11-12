import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),aliases=require('../bb-household-aliases.js'),policy=require('../bb-pantry-policy.js');
const source=fs.readFileSync(new URL('../bb-household-aliases.js',import.meta.url),'utf8');

test('every declared exact synonym resolves to its frozen, idempotent household target',()=>{
 for(const group of aliases.groups){
  assert.equal(Object.isFrozen(group),true);assert.equal(Object.isFrozen(group.aliases),true);
  for(const name of group.aliases){assert.equal(aliases.canonicalName(name),group.target,name);assert.equal(aliases.canonicalName(aliases.canonicalName(name)),group.target,name);}
 }
 assert.equal(Object.isFrozen(aliases.groups),true);assert.throws(()=>aliases.groups[0].aliases.push('beef sausage'),TypeError);
});

test('approved ordinary names use explicit specific defaults without broad meat matching',()=>{
 const expected={'Sausages':'pork sausages','Mince':'beef mince','Bacon':'back bacon','Peppers':'mixed peppers','Onions':'brown onion','Garlic cloves':'garlic','Potatoes':'white potato','Tomatoes':'salad tomato','Milk':'semi-skimmed milk','Large eggs':'egg','Cheddar cheese':'cheddar','Butter':'salted butter','Tinned tomatoes':'chopped tomatoes','Rice':'long-grain rice','Vegetable oil':'cooking oil'};
 for(const [name,target]of Object.entries(expected))assert.equal(aliases.canonicalName(name),target,name);
 assert.equal(aliases.canonicalName('  PORK   SAUSAGES  '),'pork sausages');
});

test('different proteins, cuts, diets and food states never enter an unrelated default group',()=>{
 const protectedNames=['beef sausages','chicken sausages','turkey sausages','vegan sausages','vegetarian sausages','plant sausages','gluten-free pork sausages','cooked sausages','frozen sausages','smoked pork sausages','chorizo','pork mince','chicken mince','turkey mince','lamb mince','minced garlic','chicken breast','chicken thigh','chicken stock','streaky bacon','smoked bacon','red onion','red onions','spring onions','sweet potato','sweet potatoes','cherry tomatoes','plum tomatoes','ground black pepper','pepper','canned peppers','frozen mixed peppers','mozzarella','whole milk','skimmed milk','oat milk','almond milk','soy milk','coconut milk','unsalted butter','peanut butter','basmati rice','dry basmati rice','brown rice','jasmine rice','cooked rice','frozen rice','rice flour','rice vinegar','olive oil','sesame oil','garlic bulb','garlic powder','garlic paste'];
 for(const name of protectedNames){
  const expected=name==='spring onions'?'spring onion':name;
  assert.equal(aliases.canonicalName(name),expected,name);
 }
 for(const [a,b]of [['sausages','beef sausages'],['mince','pork mince'],['bacon','streaky bacon'],['onions','red onion'],['potatoes','sweet potato'],['milk','whole milk'],['butter','unsalted butter'],['rice','basmati rice'],['garlic','garlic bulb']])assert.notEqual(aliases.canonicalName(a),aliases.canonicalName(b));
});

test('stock-key aliases preserve the precise unit suffix and cannot invent package conversions',()=>{
 for(const unit of ['each','clove','bulb','g','kg','ml','l','pack','tin','unknown-unit']){
  assert.equal(aliases.canonicalStockKey('Sausages|'+unit),'pork sausages|'+unit);
  assert.equal(aliases.canonicalStockKey('Garlic cloves|'+unit),'garlic|'+unit);
 }
 assert.notEqual(aliases.canonicalStockKey('garlic|bulb'),aliases.canonicalStockKey('garlic cloves|clove'));
 assert.notEqual(aliases.canonicalStockKey('milk|g'),aliases.canonicalStockKey('milk|ml'));
 assert.equal(aliases.canonicalStockKey('pepper|g'),'pepper|g','ambiguous legacy pepper needs its original whole-food record');
});

test('invalid stock identities fail without replacing them with a plausible household ingredient',()=>{
 for(const name of ['',null,undefined,{},true,'__proto__','constructor','prototype','rice|g','a'.repeat(201)])assert.equal(aliases.canonicalName(name),'');
 for(const key of ['',null,'rice','rice|','|g','rice|g|ml','__proto__|g','rice|g\n'])assert.equal(aliases.canonicalStockKey(key),'');
});

test('display names title only a declared household group and retain unknown original labels',()=>{
 assert.equal(aliases.displayName('Sausages'),'Pork Sausages');assert.equal(aliases.displayName('pork sausages'),'Pork Sausages');assert.equal(aliases.displayName('milk'),'Semi-Skimmed Milk');
 for(const name of ['Whole milk','FROZEN SAUSAGES','Mum’s custom sauce',' Red onion '])assert.equal(aliases.displayName(name),name);
 assert.equal(aliases.displayName(null),'');
});

test('pre/post composition prevents old plural aliases from changing whole peppers into seasoning pepper',()=>{
 const context=vm.createContext({});context.window=context;vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),context);
 const canonical=context.BBPriceV19.canonical;
 assert.equal(canonical('Peppers'),'pepper');assert.equal(aliases.resolve('Peppers',canonical),'mixed peppers');assert.equal(aliases.resolve('pepper',canonical),'pepper');
 for(const group of aliases.groups)for(const name of group.aliases){
  const resolved=aliases.resolve(name,canonical);assert.equal(resolved,group.target,name);
  assert.equal(aliases.resolve(resolved,canonical),resolved,name);
  assert.equal(policy.canonicalName(resolved,canonical),resolved,'existing policy stays idempotent for '+name);
 }
 assert.equal(aliases.resolve('Whole milk',canonical),'whole milk');assert.equal(aliases.resolve('Unsalted butter',canonical),'unsalted butter');assert.equal(aliases.resolve('Basmati rice',canonical),'basmati rice');
});

test('a failed optional legacy canonicalizer preserves the explicit household identity',()=>{
 assert.equal(aliases.resolve('Sausages',()=>{throw Error('not ready');}),'pork sausages');
 assert.equal(aliases.resolve('Sausages',()=>null),'pork sausages');
 assert.equal(aliases.resolve(null,()=> 'rice'),'');
});

test('browser callback resolves against the current pricing module before or after that module loads',()=>{
 const context=vm.createContext({document:{}});context.window=context;vm.runInContext(source,context);
 assert.equal(context.BBPantryAliasCanonical('Peppers'),'mixed peppers');
 context.BBPriceV19={canonical:name=>name==='peppers'?'pepper':name};
 assert.equal(context.BBPantryAliasCanonical('Peppers'),'mixed peppers');assert.equal(context.BBPantryAliasCanonical('Mince'),'beef mince');
 const server=vm.createContext({});server.window=server;vm.runInContext(source,server);assert.equal(server.BBPantryAliasCanonical,undefined);
});

test('catalogue audit exposes exact mapped groups and leaves unknown descriptors for review',()=>{
 const rows=Object.freeze(['Sausages','Pork sausages','Beef sausages','Milk','Whole milk','Butter','Unsalted butter','Basmati rice','Garlic paste','Peppers','pepper']);
 const before=JSON.stringify(rows),report=aliases.audit(rows);
 assert.equal(report.total,11);assert.equal(report.recognized,5);assert.equal(report.renamed,4);assert.deepEqual(report.invalid,[]);
 assert.deepEqual(report.groups.find(group=>group.id==='pork-sausages').observed,['pork sausages','sausages']);
 for(const name of ['beef sausages','whole milk','unsalted butter','basmati rice','garlic paste','pepper'])assert.ok(report.unmapped.includes(name));
 report.groups[0].aliases.push('not a real alias');assert.equal(aliases.canonicalName('not a real alias'),'not a real alias');assert.equal(JSON.stringify(rows),before);
});

test('catalogue lookup keeps an existing exact price row before considering household spellings',()=>{
 const catalog=Object.freeze({generic:Object.freeze({ingredient:'sausages',unit:'each',uk_pack_price:2}),specific:Object.freeze({ingredient:'pork sausages',unit:'each',uk_pack_price:3})}),before=JSON.stringify(catalog);
 const canonical=name=>name.toLowerCase();
 assert.equal(aliases.catalogueName('Sausages','each',catalog,canonical),'sausages');assert.equal(aliases.catalogueName('Pork sausages','each',catalog,canonical),'pork sausages');assert.equal(JSON.stringify(catalog),before);
});

test('new household names can retain their old exact same-unit catalogue baseline',()=>{
 const catalog=Object.freeze(Object.fromEntries([['onion','g'],['potato','g'],['tomato','g'],['milk','ml'],['butter','g']].map(([ingredient,unit])=>[ingredient+'|'+unit,Object.freeze({ingredient,unit,uk_pack_price:2.5})]))),before=JSON.stringify(catalog);
 for(const [household,unit,old]of [['brown onion','g','onion'],['white potato','g','potato'],['salad tomato','g','tomato'],['semi-skimmed milk','ml','milk'],['salted butter','g','butter']])assert.equal(aliases.catalogueName(household,unit,catalog),old,household);
 assert.equal(JSON.stringify(catalog),before);
});

test('price lookup never borrows another unit, protein, cut or unknown descriptor',()=>{
 const catalog={onion:{ingredient:'onion',unit:'each'},milk:{ingredient:'milk',unit:'ml'},mince:{ingredient:'pork mince',unit:'g'},sausage:{ingredient:'chicken sausages',unit:'each'},butter:{ingredient:'unsalted butter',unit:'g'},rice:{ingredient:'basmati rice',unit:'g'},garlic:{ingredient:'garlic bulb',unit:'each'}};
 for(const [name,unit]of [['brown onion','g'],['semi-skimmed milk','g'],['beef mince','g'],['pork sausages','each'],['salted butter','g'],['long-grain rice','g'],['garlic','each'],['mature cheddar cheese','g'],['frozen pork sausages','each']])assert.equal(aliases.catalogueName(name,unit,catalog),name,name);
});

test('price spelling lookup composes with existing canonical aliases without changing the supplied catalogue',()=>{
 const catalog={potatoes:{ingredient:'potatoes',unit:'g'},eggs:{ingredient:'eggs',unit:'each'}};
 const canonical=name=>({potatoes:'potato',eggs:'egg'}[name]||name),before=JSON.stringify(catalog);
 assert.equal(aliases.catalogueName('white potato','g',catalog,canonical),'potato');assert.equal(aliases.catalogueName('Large eggs','each',catalog,canonical),'egg');assert.equal(JSON.stringify(catalog),before);
});

test('absent, incompatible or unready price catalogues leave the caller original label unchanged',()=>{
 for(const catalog of [null,undefined,{},[],42])assert.equal(aliases.catalogueName('Semi-skimmed Milk','ml',catalog),'Semi-skimmed Milk');
 assert.equal(aliases.catalogueName('Sausages','each',{row:{ingredient:'pork sausages',unit:'each'}},()=>{throw Error('not ready');}),'Sausages');
});

test('specific household identities reuse existing lookup factors without changing conversion arithmetic',()=>{
 for(const [name,base]of [['Brown onions','onion'],['White potatoes','potato'],['Salad tomatoes','tomato']]){
  const lookup=aliases.conversionName(name),old=policy.normalize(base,2,'each',{market:'UK'}),next=policy.normalize(lookup,2,'each',{market:'UK'});
  assert.equal(lookup,base);assert.deepEqual(next,old);assert.notEqual(aliases.canonicalName(name),base,'storage identity retains its specific household default');
 }
 for(const name of ['Red onion','Sweet potato','Cherry tomatoes','Chicken thigh','Whole milk'])assert.equal(aliases.conversionName(name),name.toLowerCase());
});

test('legacy manual targets resolve their alias without changing saved amounts or doubling an explicit current target',()=>{
 const home=require('../bb-home.js'),key='basketboss_at_home_requirements_v1',legacy={name:'Sausages',unit:'each',targetQty:10,extraBuffer:2,pending:true};
 const values=new Map([[key,JSON.stringify({version:1,byActor:{guest:{targets:{'sausages|each':legacy}}}})]]),storage={getItem:name=>values.get(name)??null,setItem:(name,value)=>values.set(name,value),removeItem:name=>values.delete(name)},saved=values.get(key);
 const id=(name,unit)=>aliases.canonicalName(name)+'|'+unit,host={id,requirements:()=>[{key:'Pork sausages',unit:'each',required:6}],stock:()=>({}),household:()=>[]};
 const api=home.install({localStorage:storage,document:{},location:{search:''},BBHomeHost:host,BBPantryPolicy:policy,BBPantryAliasCanonical:aliases.canonicalName,BBHouseholdAliases:aliases});
 assert.deepEqual(Object.keys(api.targets()),['pork sausages|each']);assert.equal(api.total('Pork sausages','each'),12);assert.equal(values.get(key),saved);
 const separate=api.augment([{key:'Beef sausages',unit:'each',required:6}],[],api.targets(),id);assert.equal(separate.find(row=>id(row.key,row.unit)==='pork sausages|each').required,12);assert.equal(separate.find(row=>row.key==='Beef sausages').required,6,'a generic legacy target cannot borrow a different protein requirement');
 const current={...legacy,targetQty:4,extraBuffer:0,pending:false};values.set(key,JSON.stringify({version:1,byActor:{guest:{targets:{'sausages|each':legacy,'pork sausages|each':current}}}}));
 assert.deepEqual(Object.keys(api.targets()),['pork sausages|each']);assert.equal(api.total('Pork sausages','each'),6,'an explicit later canonical target supersedes its old spelling');
});
