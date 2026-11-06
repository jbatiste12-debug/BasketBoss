import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const policy=createRequire(import.meta.url)('../bb-pantry-policy.js');

test('condiments, culinary oils, honey, spices and sauces use staple mode while core foods do not',()=>{
 for(const name of ['KETCHUP 800ML','Tomato ketchup','Soy sauce','Olive oil','Cooking oil','Honey','Salt','Pepper','Black pepper','Dried oregano','Paprika','Ground cumin','Mixed herbs','Curry powder','Red pepper flakes','Mayonnaise','Mustard','Pesto sauce','Fish sauce'])assert.equal(policy.isStaple(name),true,name);
 for(const name of ['Chicken breast','Honey roast ham','Chopped tomatoes','Baked beans in tomato sauce','Bell peppers','Red pepper','Chilli peppers','Fresh basil','Pasta','Milk','Salad leaves','Frozen peas','Potatoes'])assert.equal(policy.isStaple(name),false,name);
 assert.equal(policy.containerLabel('Ketchup'),'bottle');assert.equal(policy.containerLabel('Honey'),'jar');assert.equal(policy.containerLabel('Salt'),'jar');assert.equal(policy.containerLabel('Milk'),'unit');
});

test('canned tomato aliases merge while fresh, frozen and cooked food states remain distinct',()=>{
 for(const name of ['Tinned tomatoes','Canned tomatoes','Tinned chopped tomatoes','Chopped tomatoes','Chopped canned tomatoes','Tinned tomato','Chopped tomato'])assert.equal(policy.canonicalName(name),'chopped tomatoes');
 assert.notEqual(policy.canonicalName('Fresh tomatoes'),policy.canonicalName('Tinned tomatoes'));
 assert.equal(policy.canonicalName('Canned kidney beans'),'kidney beans');assert.equal(policy.canonicalName('Tinned baked beans'),'baked beans');
 assert.equal(policy.canonicalName('Dried kidney beans',()=> 'kidney beans'),'dried kidney beans');
 assert.equal(policy.canonicalName('Frozen chicken',()=> 'chicken'),'frozen chicken');assert.equal(policy.canonicalName('Cooked chicken',()=> 'chicken'),'cooked chicken');
 assert.equal(policy.canonicalName('Tinned tomatoes',()=> 'tomato'),'chopped tomatoes');
 assert.equal(policy.canonicalName(' Rice 500 g '),'rice');assert.equal(policy.canonicalName('KETCHUP 2 x 800ML'),'ketchup');
 for(const name of [null,{},'', '__proto__','constructor','rice|g'])assert.equal(policy.canonicalName(name),'');
});

test('only exact fresh tomato labels share the existing fresh-produce tomato identity',()=>{
 const pricingContext=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),pricingContext);
 for(const canonicalize of [undefined,pricingContext.BBPriceV19.canonical]){
  for(const label of ['Tomato','Tomatoes','Fresh tomato','Fresh tomatoes','Tomatoes (fresh)']){
   const key=policy.canonicalName(label,canonicalize);assert.equal(key,'tomato',label);assert.equal(policy.canonicalName(key,canonicalize),key,label+' is stable');
  }
  for(const label of ['Tinned tomatoes','Canned tomatoes','Tomatoes (1 tin)'])assert.equal(policy.canonicalName(label,canonicalize),'chopped tomatoes',label);
  for(const label of ['Fresh peas','Fresh chopped tomatoes','Frozen tomatoes','Cooked tomatoes','Dried tomatoes','Tomato purée','Tomato paste'])assert.notEqual(policy.canonicalName(label,canonicalize),'tomato',label+' keeps its own state or food form');
 }
});

test('parenthetical food, diet and state descriptors survive pantry matching and canonical callbacks',()=>{
 const pricingContext=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),pricingContext);
 const canonicalize=pricingContext.BBPriceV19.canonical;
 for(const [label,expected]of [['Pasta (gluten-free)','gluten-free pasta'],['Milk (oat)','oat milk'],['Milk (cow)','cow milk'],['Chicken breast (cooked)','cooked chicken breast'],['Rice (dry)','dry rice'],['Frozen chicken (thawed)','thawed frozen chicken'],['Beef mince (5% fat)','5% fat beef mince']]){
  assert.equal(policy.canonicalName(label),expected,label);
  assert.equal(policy.canonicalName(label,canonicalize),expected,label+' with catalogue aliases');
  assert.equal(policy.canonicalName(expected,canonicalize),expected,label+' remains stable');
 }
 for(const [left,right]of [['Chicken breast','Turkey breast'],['Chicken breast (cooked)','Chicken breast (raw)'],['Pasta (gluten-free)','Pasta'],['Milk (oat)','Milk (cow)'],['Rice (dry)','Rice (cooked)'],['Beef mince (5% fat)','Beef mince (20% fat)']])assert.notEqual(policy.canonicalName(left,canonicalize),policy.canonicalName(right,canonicalize),left+' / '+right);
 assert.equal(policy.canonicalName('Pasta (gluten-free)',()=> 'pasta'),'gluten-free pasta','a broad callback cannot discard an explicit diet qualifier');
 assert.equal(policy.canonicalName('Milk (oat)',()=> 'milk'),'oat milk','a broad callback cannot discard an explicit food qualifier');
});

test('quantity-only and repeated parentheticals retain the ordinary food identity',()=>{
 for(const label of ['Rice (500 g)','Rice (2 x 500 g)','Rice (rice)','Rice (rice 500 g)'])assert.equal(policy.canonicalName(label),'rice',label);
 assert.equal(policy.canonicalName('Chicken breast (cooked chicken breast)'),'cooked chicken breast');
 assert.equal(policy.canonicalName('Gluten-free pasta (gluten-free)'),'gluten-free pasta');
 assert.equal(policy.canonicalName('Milk (whole milk)'),'whole milk');
});

test('explicit serving notes and source counts leave food identity and density unchanged',()=>{
 for(const note of ['optional','optional topping','to serve','optional, to serve','for serving','for topping','for the topping','for garnish','for dusting','for greasing','divided'])assert.equal(policy.canonicalName('Soured cream ('+note+')'),'soured cream',note);
 assert.equal(policy.normalize('Soured cream (optional topping)',4,'tbsp').quantity,60,'a serving note cannot disable the existing food-specific conversion');
 assert.equal(policy.canonicalName('Cooked salmon (from 2 fillets)'),'cooked salmon');
 assert.equal(policy.canonicalName('Salmon (2 fillets)'),'salmon');
 for(const label of ['Pasta (gluten-free)','Milk (oat)','Salmon (smoked)','Peas (fresh)','Chicken (cooked)','Rice (dry)','Beef mince (5% fat)'])assert.notEqual(policy.canonicalName(label),policy.canonicalName(label.replace(/ \([^)]*\)/,'')),label);
 assert.equal(policy.canonicalName('Salmon (from 2 trout fillets)'),'from 2 trout fillets salmon','an explicit different species is not a quantity-only note');
});

test('approved aliases and protected parenthetical qualifiers have a stable pantry identity',()=>{
 const pricingContext=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),pricingContext);
 for(const canonicalize of [undefined,pricingContext.BBPriceV19.canonical])for(const [label,expected]of [['Beans (tinned)','beans'],['Kidney beans (canned)','kidney beans'],['Honey (runny)','honey'],['Honey (clear)','honey'],['Tomatoes (tinned)','chopped tomatoes'],['Meat (ground beef)','beef mince meat'],['Vegetables (zucchini)','courgette vegetables'],['Pasta (gluten-free)','gluten-free pasta'],['Milk (oat)','oat milk'],['Chicken (cooked)','cooked chicken'],['Beef mince (5% fat)','5% fat beef mince']]){
  let key=policy.canonicalName(label,canonicalize);assert.equal(key,expected,label);
  for(let pass=0;pass<3;pass++){key=policy.canonicalName(key,canonicalize);assert.equal(key,expected,label+' pass '+(pass+2));}
 }
});

test('counted tin and can parentheses preserve tomato processing without assuming other containers are canned',()=>{
 const pricingContext=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../basketboss-pricing-v19.js',import.meta.url),'utf8'),pricingContext);
 for(const canonicalize of [undefined,pricingContext.BBPriceV19.canonical]){
  for(const label of ['Tomatoes (1 tin)','Tomatoes (from 2 cans)','Tomatoes (1 x 400 g tin)','Tomatoes (can)']){
   const key=policy.canonicalName(label,canonicalize);assert.equal(key,'chopped tomatoes',label);
   assert.equal(policy.canonicalName(key,canonicalize),key,label+' is stable');
   assert.notEqual(key,policy.canonicalName('Fresh tomatoes',canonicalize));assert.notEqual(key,policy.canonicalName('Tomatoes',canonicalize));
  }
  for(const label of ['Tomatoes (1 jar)','Tomatoes (from 2 bottles)','Tomatoes (1 bag)','Tomatoes (1 pack)'])assert.notEqual(policy.canonicalName(label,canonicalize),'chopped tomatoes',label+' does not prove canned processing');
 }
});

test('UK container defaults convert specified core foods to canonical base units with review labels',()=>{
 for(const [name,quantity,unit,amount,base]of [['Chopped tomatoes',1,'tin',400,'g'],['Beans',2,'tins',800,'g'],['Kidney beans',.5,'can',200,'g'],['Spinach',1,'bag',200,'g'],['Salad leaves',2,'bags',400,'g'],['Beef mince',1,'pack',500,'g'],['Turkey mince',2,'packs',1000,'g']]){
  const result=policy.normalize(name,quantity,unit,{market:'UK'});assert.equal(result.quantity,amount,name);assert.equal(result.unit,base);assert.equal(result.estimated,true);assert.match(result.assumption,/Standard UK default.*Check/);
 }
 const tin=policy.normalize('Chopped tomatoes',1,'tin'),receipt=policy.normalize('Chopped tomatoes',400,'g');assert.equal(tin.unit,receipt.unit);assert.equal(tin.quantity+receipt.quantity,800,'one default tin plus a 400 g purchase has one 800 g base balance');
 for(const market of ['UK','Guernsey','Jersey'])assert.equal(policy.defaultPack('Mince','pack',{market}).quantity,500);
 assert.equal(policy.defaultPack('Mince','pack',{market:'US'}).quantity,454);
});

test('exact metric, culinary volume, pint and garlic count conversions do not invent density',()=>{
 for(const [name,quantity,unit,amount,base]of [['Milk',1,'pint',568,'ml'],['Milk',.5,'pints',284,'ml'],['Milk',1,'l',1000,'ml'],['Pasta',.5,'kg',500,'g'],['Garlic',1,'clove',1,'each'],['Garlic',2.5,'cloves',2.5,'each'],['Oil',1,'tbsp',15,'ml'],['Honey',2,'tsp',10,'ml'],['Eggs',2,'count',2,'each']]){
  const result=policy.normalize(name,quantity,unit);assert.equal(result.quantity,amount,name);assert.equal(result.unit,base);assert.equal(result.estimated,false);
 }
 assert.equal(policy.normalize('Milk',1,'pint',{market:'US'}).quantity,473);
 assert.equal(policy.normalize('Garlic',1,'bulb').quantity,10);assert.equal(policy.normalize('Garlic',1,'bulb').estimated,true);
 assert.equal(policy.normalize('Rice',1,'clove'),null);
 assert.equal(policy.normalize('Honey',1,'tbsp').unit,'ml','spoon volume cannot become grams without density');
});

test('reviewed container sizes override defaults and already measured stock is never multiplied again',()=>{
 const reviewed={packReviewed:true,packQuantity:500,packUnit:'g'};
 assert.equal(policy.normalize('Chopped tomatoes',2,'tin',reviewed).quantity,1000);
 assert.equal(policy.normalize('Chopped tomatoes',2,'tin',reviewed).estimated,false);
 assert.equal(policy.normalize('Rice',.5,'bag',{reviewed:true,packQuantity:2,packUnit:'kg'}).quantity,1000);
 assert.equal(policy.normalize('Milk',.5,'bottle',{reviewed:true,packQuantity:750,packUnit:'ml'}).quantity,375);
 assert.equal(policy.normalize('Chopped tomatoes',800,'g',reviewed).quantity,800);
 assert.equal(policy.normalize('Chopped tomatoes',1,'tin',{reviewed:true,packQuantity:0,packUnit:'g'}),null,'invalid checked contents require review rather than falling back');
});

test('unknown, incompatible and out of range unit entries return review fallback without altering source data',()=>{
 const source={name:'Spinach',quantity:1,unit:'mystery crate'},before=JSON.stringify(source);
 for(const [name,quantity,unit,options]of [['Spinach',1,'mystery crate',{}],['Frozen spinach',1,'bag',{}],['Dried beans',1,'tin',{}],['Rice',1,'bag',{}],['Rice',1,'pack',{}],['Milk',1000000,'pint',{}],['Rice',1000000,'kg',{}],['Rice',1e-9,'g',{}],['Rice',-1,'g',{}],['Rice',Infinity,'g',{}],['Rice',true,'g',{}],['Rice',null,'g',{}],['Rice','not a number','g',{}]])assert.equal(policy.normalize(name,quantity,unit,options),null,name+' '+unit);
 assert.equal(JSON.stringify(source),before);assert.equal(policy.normalize('Rice',0,'g').quantity,0);
 assert.equal(policy.normalize('Milk',1,'ml',null).quantity,1);assert.equal(policy.defaultPack('Unknown',null,null),null);
});

test('only small culinary staple uses are covered by status and larger measured ingredient use stays explicit',()=>{
 for(const [name,quantity,unit]of [['Ketchup',1,'tbsp'],['Soy sauce',2,'tsp'],['Olive oil',15,'ml'],['Honey',30,'g'],['Salt',2,'pinches'],['Pepper',null,'to taste']])assert.equal(policy.smallUse(name,quantity,unit),true,name);
 for(const [name,quantity,unit]of [['Milk',15,'ml'],['Honey',300,'g'],['Ketchup',800,'ml'],['Soy sauce',1,'bottle'],['Pepper',5,'pinches'],['Honey',2,'unknown scoop'],['Olive oil',-1,'ml']])assert.equal(policy.smallUse(name,quantity,unit),false,name);
});

test('staple receipt quantities become containers rather than volume entries and explicit count wins',()=>{
 const one=policy.staplePurchase({name:'KETCHUP 800ML',quantity:800,unit:'ml'});assert.equal(one.quantity,1);assert.equal(one.unit,'each');assert.equal(one.label,'bottle');assert.equal(one.estimated,true);assert.match(one.assumption,/Check the container count/);
 assert.equal(policy.staplePurchase({name:'Ketchup',quantity:1600,unit:'ml',packCount:2}).quantity,2);
 assert.equal(policy.staplePurchase({name:'Soy sauce',quantity:2,unit:'bottles'}).quantity,2);
 assert.equal(policy.staplePurchase({name:'Honey',quantity:3,unit:'jars'}).quantity,3);
 assert.equal(policy.staplePurchase({name:'Salt',quantity:2,unit:'packs'}).quantity,2);
 for(const input of [{name:'Milk',quantity:1,unit:'bottle'},{name:'Ketchup',quantity:1.5,unit:'bottle'},{name:'Ketchup',quantity:800,unit:'ml',packCount:1.5},{name:'Ketchup',quantity:800,unit:'ml',packCount:0},{name:'Ketchup',quantity:1,unit:'crate'}])assert.equal(policy.staplePurchase(input),null);
 for(const input of [null,[],true,'Ketchup'])assert.equal(policy.staplePurchase(input),null);
});

test('explicit stock status controls staples, quantity derives status only when actually known',()=>{
 for(const [record,expected]of [[{status:'In Stock'},'in'],[{stockStatus:'Running Low',qty:2},'low'],[{stapleStatus:'Out',qty:2},'out'],[{containerCount:2},'in'],[{stapleCount:0},'out'],[{qty:null},'unknown'],[{},'unknown'],[null,'unknown'],['In Stock','in']])assert.equal(policy.stapleStatus(record),expected);
 assert.equal(policy.stapleStatus({bb173StockKey:'ketchup|each'},{'ketchup|each':1}),'in');
 assert.equal(policy.stapleStatus({bb173StockKey:'ketchup|each'},{'ketchup|each':0}),'out');
 assert.equal(policy.stapleStatus({status:'Low'},10),'low','positive count never overrides an explicit Low status');
});

test('browser installation and native Node import expose the same pure rules without storage writes',async()=>{
 const source=fs.readFileSync(new URL('../bb-pantry-policy.js',import.meta.url),'utf8'),win={},context=vm.createContext({window:win});vm.runInContext(source,context);
 assert.equal(win.BBPantryPolicy.normalize('Milk',1,'pint').quantity,568);
 const imported=await import('../bb-pantry-policy.js');assert.equal(imported.default,policy);
 assert.equal(Object.isFrozen(policy),true);
});


test('oversized piece and container conversions remain reviewable instead of producing invalid stock',()=>{
 for(const [name,unit]of [['Carrots','each'],['Bread','loaf'],['Garlic','bulb'],['Celery','stalk']])assert.equal(policy.normalize(name,1000000,unit),null);
});


test('runny and clear honey use the same cupboard identity as pantry Honey',()=>{
 for(const name of['Runny honey','Clear honey','Honey'])assert.equal(policy.canonicalName(name),'honey');
});
