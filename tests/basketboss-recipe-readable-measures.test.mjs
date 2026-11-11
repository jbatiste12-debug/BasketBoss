import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const formatter=createRequire(import.meta.url)('../bb-shop-purchase-ui.js');
const source=fs.readFileSync(new URL('../bb-recipe-measures.js',import.meta.url),'utf8');
const regionalSource=fs.readFileSync(new URL('../bb-us-market.js',import.meta.url),'utf8');
const resultSource=fs.readFileSync(new URL('../bb-cook-result.js',import.meta.url),'utf8');
function installMeasures(win,withFormatter){if(withFormatter)win.BBShopPurchaseUI=formatter;vm.runInNewContext(source,{window:win});return win.BBRecipeMeasures;}
const readable=value=>assert.doesNotMatch(value,/\d+\.\d{2,}|NaN|Infinity/);

for(const withFormatter of [true,false])test('recipe display wrappers round visible units while original conversions and source data retain precision '+(withFormatter?'with shared formatting':'before shared formatting loads'),()=>{
 const win={},api=installMeasures(win,withFormatter),recipe=Object.freeze({quantity:'240 g',name:'Chicken',step:'Stir in 240 g chicken.'}),before=JSON.stringify(recipe);
 assert.equal(api.quantity(recipe.quantity,recipe.name,'US'),'≈ 8.47 oz (240 g)');
 assert.equal(api.step(recipe.step,'US'),'Stir in ≈ 8.47 oz (240 g) chicken.');
 assert.equal(api.displayQuantity(recipe.quantity,recipe.name,'US'),'≈ 8.5 oz (240 g)');
 assert.equal(api.displayStep(recipe.step,'US'),'Stir in ≈ 8.5 oz (240 g) chicken.');
 assert.equal(api.step('Check 73.3°C.','US'),'Check 163.94°F (73.3°C).');
 assert.equal(api.displayStep('Check 73.3°C.','US'),'Check 163.9°F (73.3°C).');
 assert.equal(api.displayQuantity('533.333333 g','Rice','UK'),'533 g');
 assert.equal(api.displayQuantity('233.333333 ml','Milk','Guernsey'),'233 ml');
 assert.equal(api.displayQuantity('1.333333 each','Egg','UK'),'1.3 each');
 assert.equal(api.displayQuantity('0.666667','Egg','UK'),'0.7');assert.equal(api.displayQuantity('≈ 3 g (0.666667)','Egg','UK'),'≈ 3 g (0.7)');
 assert.equal(api.displayQuantity('0.000001','Egg','UK'),'<0.1');assert.equal(api.displayQuantity('£3.99 / $4.99 / GBP 5.99 · 0.666667','Egg','UK'),'£3.99 / $4.99 / GBP 5.99 · 0.7');
 const cups=api.displayQuantity('250 ml','Milk','US'),fluid=api.displayQuantity('100 ml','Milk','US'),tiny=api.displayQuantity('0.1 g','Saffron','US');
 assert.equal(cups,'≈ 1 US cups (250 ml)');assert.equal(fluid,'≈ 3.3 US fl oz (100 ml)');assert.equal(tiny,'≈ <0.1 oz (<1 g)');
 for(const value of [cups,fluid,tiny,api.displayStep('Use 666.666667 g chicken and 1.333333 each egg.','US')])readable(value);
 assert.equal(JSON.stringify(recipe),before);assert.equal(api.quantity('250 ml','Milk','US'),'≈ 1.04 US cups (250 ml)');
});

function regionalFixture(){
 const original='Courgette · 533.333333 g · 8.47 oz',node={nodeValue:original,parentElement:{closest:()=>null}},events=new Map(),frames=[];
 let selected='US';const doc={readyState:'complete',body:{},documentElement:{setAttribute(){},classList:{toggle(){}}},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createTreeWalker(){let read=false;return {nextNode(){if(read)return null;read=true;return node;}};}};
 const storage={getItem:key=>key==='basketboss_321_v7_market'?selected:null,setItem(){throw Error('Regional display must not rewrite saved values');}};
 const win={BBPriceV19:{regionalMarkets:{US:{currency:'USD'}}},addEventListener:(name,handler)=>events.set(name,handler)};installMeasures(win,true);
 vm.runInNewContext(regionalSource,{window:win,document:doc,location:{pathname:'/app'},localStorage:storage,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){}},requestAnimationFrame:callback=>frames.push(callback)});
 function flush(){let count=0;while(frames.length){assert.ok(++count<5);frames.shift()();}}
 flush();return {win,node,original,change(market){selected=market;events.get('basketboss:market-changed')();flush();}};
}

test('regional DOM rendering stays readable across US and UK switches while its original source cache remains precise',()=>{
 const h=regionalFixture();assert.equal(h.node.nodeValue,'Zucchini · 18.8 oz · 8.5 oz');readable(h.node.nodeValue);
 assert.equal(h.win.BasketBossMarket.usMeasurements('8.47 oz'),'8.47 oz','the existing regional conversion API remains unchanged');
 h.change('UK');assert.equal(h.node.nodeValue,'Courgette · 533 g · 8.5 oz');h.change('US');assert.equal(h.node.nodeValue,'Zucchini · 18.8 oz · 8.5 oz');
 h.node.nodeValue='Courgette · 666.666667 g';h.change('US');assert.equal(h.node.nodeValue,'Zucchini · 23.5 oz');h.change('UK');assert.equal(h.node.nodeValue,'Courgette · 667 g');readable(h.node.nodeValue);
});

test('created meal markup and region repaint use readable wrappers without modifying the generated recipe',()=>{
 let selected='US';const events=new Map(),panels=Object.fromEntries(['ingredients','method','safety'].map(name=>['[data-bb-result-'+name+']',{innerHTML:''}]));
 const win={localStorage:{getItem:()=>selected,setItem(){throw Error('Rendering must not save');}},addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name)};
 installMeasures(win,true);vm.runInNewContext(resultSource,{window:win});
 const recipe=Object.freeze({title:'Chicken dinner',servings:4,prepMinutes:5,cookMinutes:10,ingredients:Object.freeze([Object.freeze({name:'Chicken',quantity:'240 g',fromHome:true}),Object.freeze({name:'Rice',quantity:'533.333333 g',fromHome:true})]),steps:Object.freeze(['Add 240 g chicken and 1.333333 each egg.']),allergens:Object.freeze([]),safetyNotes:Object.freeze(['Check the chicken is cooked.'])}),before=JSON.stringify(recipe);
 const host={isConnected:true,innerHTML:'',querySelector:selector=>panels[selector]||null};win.BBCookResult.render(host,recipe);
 assert.match(host.innerHTML,/≈ 8\.5 oz \(240 g\)/);assert.match(host.innerHTML,/1\.3 each/);readable(host.innerHTML);assert.equal(JSON.stringify(recipe),before);
 selected='UK';events.get('basketboss:market-changed')({type:'basketboss:market-changed'});assert.match(panels['[data-bb-result-ingredients]'].innerHTML,/533 g/);assert.doesNotMatch(panels['[data-bb-result-ingredients]'].innerHTML,/533\.333333/);readable(panels['[data-bb-result-method]'].innerHTML);assert.equal(JSON.stringify(recipe),before);
});
