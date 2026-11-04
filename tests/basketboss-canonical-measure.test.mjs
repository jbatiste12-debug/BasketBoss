import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {canonicalIngredientKey} from '../bb-receipt-inventory-core.mjs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function pricing(){
 const saved=new Map(),context=vm.createContext({localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value))}});
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js'])vm.runInContext(read(file),context);
 return context.BBPriceV19;
}

test('shared exact plural aliases agree with persistent receipt identity without singularizing other foods',()=>{
 const p=pricing(),pairs={potatoes:'potato',eggs:'egg',tomatoes:'tomato',onions:'onion',peppers:'pepper',carrots:'carrot',bananas:'banana',apples:'apple',lemons:'lemon',limes:'lime',courgettes:'courgette',mushrooms:'mushroom',scallops:'scallop',wraps:'wrap'};
 for(const [plural,singular]of Object.entries(pairs)){
  assert.equal(p.canonical(plural),singular);assert.equal(p.canonical(plural),canonicalIngredientKey(plural));
  assert.equal(p.canonical(' '+plural.toUpperCase()+' '),singular);
 }
 for(const name of ['cooked carrots','frozen carrots','tinned carrots','dried carrots','carrot juice','carrot powder','red onions','sweet potatoes','asparagus','couscous'])assert.equal(p.canonical(name),name);
 assert.equal(p.getPack('wrap','each','UK').standard_pack_size,8,'a shared alias still resolves the original explicit catalogue pack');
});

test('Carrot each and Carrots grams project to one estimated mass while preserving their original measures',()=>{
 const p=pricing();
 assert.deepEqual(plain(p.canonicalMeasure('Carrot',2,'each')),{key:'carrot',quantity:160,unit:'g',estimated:true,needsReview:true,assumption:'Estimated 80 g per whole item for carrot',sourceQuantity:2,sourceUnit:'each'});
 assert.deepEqual(plain(p.canonicalMeasure('Carrots',250,'grams')),{key:'carrot',quantity:250,unit:'g',estimated:false,needsReview:false,assumption:null,sourceQuantity:250,sourceUnit:'g'});
 const normal=p.normalizeUnit('carrot',2,'each');assert.equal(normal.quantity,2);assert.equal(normal.unit,'each','stock/count normalization does not acquire a planning conversion');
});

test('all disclosed whole-produce estimates use one immutable map and retain fractional counts without rounding',()=>{
 const p=pricing(),expected={aubergine:250,courgette:200,pepper:160,'mixed peppers':160,onion:150,'red onion':150,cucumber:300,'sweet potato':200,'baking potato':200,avocado:150,carrot:80,potato:180,tomato:120,'spring onion':15,shallot:40,lettuce:300};
 assert.deepEqual(plain(p.wholeProduceGrams),expected);assert.equal(Object.isFrozen(p.wholeProduceGrams),true);
 assert.throws(()=>{p.wholeProduceGrams.carrot=100;},TypeError);
 for(const [name,weight]of Object.entries(expected)){
  const count=p.canonicalMeasure(name,1.25,'each'),mass=p.canonicalMeasure(name,weight,'g');
  assert.equal(count.quantity,weight*1.25,name);assert.equal(count.unit,'g');assert.equal(count.estimated,true);assert.equal(count.needsReview,true);assert.match(count.assumption,new RegExp(String(weight)));
  assert.equal(mass.quantity,weight);assert.equal(mass.estimated,false);assert.equal(mass.assumption,null);
 }
 assert.equal(p.canonicalMeasure('red onions',2,'each').key,'red onion','existing Pantry whole-item alias is a read-only planning projection');
 assert.equal(p.canonical('red onions'),'red onions','the planning alias does not rename historical receipt identifiers');
});

test('metric and spoon spellings preserve physical dimensions and flag only the existing dry-weight assumption',()=>{
 const p=pricing();
 for(const unit of ['kg','kilogram','kilograms'])assert.equal(p.canonicalMeasure('Carrots',.25,unit).quantity,250);
 for(const unit of ['l','litre','litres','liter','liters']){
  const value=p.canonicalMeasure('milk',.5,unit);assert.equal(value.quantity,500);assert.equal(value.unit,'ml');assert.equal(value.estimated,false);
 }
 const spice=p.canonicalMeasure('ground cumin',1.5,'teaspoons');
 assert.equal(spice.quantity,4.5);assert.equal(spice.unit,'g');assert.equal(spice.estimated,true);assert.equal(spice.assumption,'Approximate dry spoon weight');
 const oil=p.canonicalMeasure('cooking oil',2,'tablespoons');
 assert.equal(oil.quantity,30);assert.equal(oil.unit,'ml');assert.equal(oil.estimated,false);
 assert.equal(p.canonicalMeasure('honey',2,'tbsp').unit,'ml');assert.equal(p.canonicalMeasure('honey',30,'g').unit,'g');
 assert.equal(p.canonicalMeasure('carrot',100,'ml').unit,'ml');
});

test('prepared forms, varieties, packages and unspecified counts never inherit generic food-weight conversions',()=>{
 const p=pricing();
 for(const name of ['cooked carrots','frozen carrots','tinned carrots','dried carrots','carrot powder','baby carrots','baby potatoes','red pepper']){
  const value=p.canonicalMeasure(name,2,'each');assert.equal(value.quantity,2,name);assert.equal(value.unit,'each');assert.equal(value.estimated,false);
 }
 for(const unit of ['bag','pack','tin','bunch','florets']){
  const value=p.canonicalMeasure('carrot',2,unit);assert.equal(value.quantity,2);assert.equal(value.unit,unit);assert.equal(value.estimated,false);
 }
 const unknown=p.canonicalMeasure('carrot',2,'None');assert.equal(unknown.unit,'each');assert.equal(unknown.quantity,2);assert.equal(unknown.estimated,false);assert.equal(unknown.needsReview,true);assert.equal(unknown.assumption,'Count unit needs review');
 for(const args of [['carrot',null,'g'],['carrot',true,'g'],['carrot','','g'],['carrot',-1,'g'],['carrot',Infinity,'g'],['',2,'each'],['carrot',2,undefined],['carrot',2,'']])assert.equal(p.canonicalMeasure(...args),null,JSON.stringify(args));
});

test('legacy Garlic source units still require unambiguous raw cloves or bulbs and never become produce mass',()=>{
 const p=pricing();
 const clove=p.canonicalMeasure('Garlic',1.5,'each',{sourceIngredients:[['Garlic','3 cloves']]});
 assert.equal(clove.quantity,1.5);assert.equal(clove.unit,'clove');assert.equal(clove.sourceUnit,'clove');assert.equal(clove.estimated,false);
 const bulb=p.canonicalMeasure('Garlic',.5,'each',{sourceIngredients:[['Garlic','1 bulb']]});
 assert.equal(bulb.quantity,.5);assert.equal(bulb.unit,'bulb');assert.equal(bulb.estimated,false);
 assert.equal(p.canonicalMeasure('Garlic',1,'each').unit,'each');
 assert.equal(p.canonicalMeasure('Garlic',1,'each',{sourceIngredients:[['Garlic','1 bulb'],['Garlic','2 cloves']]}).unit,'each');
});

test('mixed count and mass recipe needs share a regional purchase pack once and keep source quantities unchanged',()=>{
 const p=pricing(),ingredients=Object.freeze([Object.freeze({key:'Carrot',quantity:2,unit:'each'}),Object.freeze({key:'Carrots',quantity:250,unit:'g'})]);
 const before=JSON.stringify(ingredients);
 for(const market of ['UK','Guernsey','Jersey','US']){
  const result=p.estimateMeal({ingredients,market}),line=result.lines[0],expected=p.mealPrice({name:'carrot',quantity:410,unit:'g',market});
  assert.equal(result.pending,0);assert.equal(result.lines.length,1);assert.equal(line.key,'carrot');assert.equal(line.quantity,410);assert.equal(line.unit,'g');assert.equal(line.estimated,true);
  assert.equal(line.quote.packCount,1);assert.equal(result.amount,expected.packAmount);assert.equal(line.quote.needsReview,true);assert.match(line.quote.assumption,/Estimated 80 g/);
  assert.deepEqual(plain(result.items.map(item=>({quantity:item.quantity,unit:item.unit}))),[{quantity:2,unit:'each'},{quantity:250,unit:'g'}]);
  assert.equal(Math.round(result.items.reduce((sum,item)=>sum+item.amount,0)*100),Math.round(result.amount*100));
 }
 assert.equal(JSON.stringify(ingredients),before);
 const one=p.estimateMeal({ingredients:[{key:'carrot',quantity:12,unit:'each'},{key:'carrots',quantity:40,unit:'g'}],market:'UK'});
 const two=p.estimateMeal({ingredients:[{key:'carrot',quantity:12,unit:'each'},{key:'carrots',quantity:40.01,unit:'g'}],market:'UK'});
 assert.equal(one.lines[0].quantity,1000);assert.equal(one.lines[0].quote.packCount,1);assert.equal(two.lines[0].quote.packCount,2);
});

test('incompatible liquid and prepared ingredient lines remain separate from estimated fresh produce mass',()=>{
 const p=pricing(),result=p.estimateMeal({ingredients:[{key:'carrot',quantity:2,unit:'each'},{key:'carrots',quantity:100,unit:'ml'},{key:'cooked carrots',quantity:200,unit:'g'}],market:'UK'});
 assert.equal(result.lines.length,3);
 assert.deepEqual(plain(result.lines.map(line=>[line.key,line.quantity,line.unit])),[['carrot',160,'g'],['carrot',100,'ml'],['cooked carrots',200,'g']]);
});

test('explicit count and mass shelf-price namespaces remain separate while standardized meal needs use mass packs',()=>{
 const p=pricing(),countPack=p.getPack('carrot','each','UK'),massPack=p.getPack('carrot','g','UK');
 assert.equal(countPack.standard_pack_unit,'each');assert.equal(countPack.standard_pack_size,12);assert.equal(massPack.standard_pack_unit,'g');assert.equal(massPack.standard_pack_size,1000);
 p.setPriceOverride({name:'carrot',unit:'each',market:'UK',price:2.4});p.setPriceOverride({name:'carrot',unit:'g',market:'UK',price:1.1});
 assert.equal(p.price({name:'carrot',quantity:2,unit:'each',market:'UK'}).amount,2.4);
 assert.equal(p.price({name:'carrot',quantity:250,unit:'g',market:'UK'}).amount,1.1);
 const meal=p.estimateMeal({ingredients:[{key:'Carrot',quantity:2,unit:'each'},{key:'Carrots',quantity:250,unit:'g'}],market:'UK'});
 assert.equal(meal.amount,1.1);assert.equal(meal.lines[0].quote.userOverride,true);assert.equal(meal.lines[0].quote.estimated,true);assert.match(meal.lines[0].quote.assumption,/Estimated/);
});

test('audited produce aliases remain planning-only and explicit packages do not acquire single-item weights',()=>{
 const p=pricing();
 for(const [key,canonical]of [['onion finely','onion'],['carrot finely','carrot'],['spring onions','spring onion'],['spring onions finely','spring onion'],['shallots','shallot'],['potatoes peeled and','potato']]){const value=p.canonicalMeasure(key,2,'each');assert.equal(value.key,canonical);assert.equal(value.unit,'g');assert.equal(value.estimated,true);}
 const value=p.canonicalMeasure('spring onion',1,'each',{sourceIngredients:[['Spring onions','1 bunch']]});assert.equal(value.quantity,1);assert.equal(value.unit,'bunch');assert.equal(value.estimated,false);
 const bag=p.canonicalMeasure('carrots',1,'each',{sourceIngredients:[['Carrots','1 standard bag']]});assert.equal(bag.unit,'bag');assert.equal(bag.quantity,1);assert.equal(bag.estimated,false);
 assert.equal(p.canonical('onion finely'),'onion finely','historical receipt identities are not renamed');
});
