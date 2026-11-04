import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),policy=require('../bb-pantry-policy.js'),display=require('../bb-pantry-display.js');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=name=>{const source=html.match(new RegExp('function '+name+'\\([\\s\\S]*?\\n}'))?.[0];assert.ok(source,name+' exists');return source;};
function fixture(states={}){
 const context=vm.createContext({Intl,window:{BBPantryPolicy:policy,BBPantryDisplay:display},bb307Market:'UK',bbHomeStapleState:()=>states,
  BB307Pantry:{pantryId:(name,unit)=>policy.canonicalName(name)+'|'+unit},BBPriceV19:{formatQuantity:(n,u)=>n+' '+u},
  bbWholeProduceCount:()=>null,bb321TinShoppingQuantity:()=>null,BBServing:{practicalText:value=>value},
  esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 vm.runInContext(extract('bb80ShoppingQuantity')+'\n'+extract('bb321UsedInLine'),context);return context;
}
test('counted staples use the shared standard container in UK and US shopping labels',()=>{
 const h=fixture({pepper:{status:'out'}});
 for(const market of ['UK','US'])for(const [name,label]of [['Olive Oil','bottle'],['Sesame oil','bottle'],['Soy Sauce','bottle'],['Honey','jar'],['Paprika','jar'],['Pepper','jar']]){
  assert.equal(h.bb80ShoppingQuantity(name,1,'each',market),'1 '+label);
  assert.equal(h.bb80ShoppingQuantity(name,2,'each',market),'2 '+label+'s');
 }
});
test('whole peppers and other counted foods never become spice containers or unchecked-unit warnings',()=>{
 const h=fixture();
 for(const market of ['UK','US']){
  assert.equal(h.bb80ShoppingQuantity('Pepper',1,'each',market),'1 pepper');
  assert.equal(h.bb80ShoppingQuantity('Pepper',1,'each',market,{staple:true}),'1 jar','a promoted spice can carry an explicit display context');
  assert.equal(h.bb80ShoppingQuantity('Carrot',2,'each',market),'2 carrots');
  assert.equal(h.bb80ShoppingQuantity('Mystery food',1,'each',market),'1 item');
  assert.equal(h.bb80ShoppingQuantity('Mystery food',1,'pack',market),'1 pack');
  assert.doesNotMatch(h.bb80ShoppingQuantity('Mystery food',1,'each',market),/check unit|Review/);
 }
 const quantity=453.6;assert.equal(h.bb80ShoppingQuantity('Rice',quantity,'g','US'),'1 lb');assert.equal(h.bb80ShoppingQuantity('Rice',quantity,'g','UK'),'453.6 g');assert.equal(quantity,453.6);
});
test('meal attribution follows a canonical ingredient across units and contains only ordered unique days',()=>{
 const h=fixture(),sources=new Map([
  ['soy sauce|ml',[{day:'Thursday',qty:15,unit:'ml',recipeName:'Stir fry',assumption:'source needs review'}]],
  ['soy sauce|tsp',[{day:'Monday',qty:2,unit:'tsp',batchLeftoverDay:'Saturday'},{day:'Thu',qty:1,unit:'tsp'}]],
  ['honey|ml',[{day:'Tuesday',qty:15,unit:'ml'}]]
 ]),item={key:'Soy Sauce',unit:'each',required:1};
 const before=JSON.stringify([...sources]);
 assert.equal(h.bb321UsedInLine(item,sources),'<small class="bb321-shop-used-in">For: Mon • Thu • Sat</small>');
 assert.equal(JSON.stringify([...sources]),before,'display does not change source amounts or units');assert.equal(item.required,1);
 assert.doesNotMatch(h.bb321UsedInLine(item,sources),/review|total|title=|15|tsp/i);
});
test('source-free and manually added rows use Pantry top-up without exposing unrecognized source text',()=>{
 const h=fixture();
 for(const item of [{key:'Rice',unit:'g'},{key:'Rice',unit:'g',manualBuyQty:500}])assert.equal(h.bb321UsedInLine(item,new Map()),'<small class="bb321-shop-used-in">Pantry top-up</small>');
 assert.equal(h.bb321UsedInLine({key:'Rice',unit:'g'},new Map([['rice|g',[{day:'<script>private source needs review</script>',qty:999}]]])),'<small class="bb321-shop-used-in">Pantry top-up</small>');
});
