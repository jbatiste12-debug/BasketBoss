import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const current=read('bb-us-market.js'),baseline=execFileSync('git',['show','c05180b:bb-us-market.js'],{cwd:root,encoding:'utf8'});
const helpers=['bb-shop-purchase-ui.js','bb-recipe-measures.js'].map(read),MARKET='basketboss_321_v7_market';
const prose=['Courgette · 100 g','Aubergine · 666.666667 grams','You’ll need 265 grams of cheddar.','Minced beef · 0.00001 g','Spring onions · 1.333333 each','Bake at 180°C for 25 minutes.','£12.34 · 1.5 litres of milk','Plain flour · 1000 g'];
const storageEntries=[[MARKET,'Guernsey'],['bb_us_fx_gbp_usd_v1',JSON.stringify({rate:1.25,date:'2026-10-30'})],['fixture-canonical-state',JSON.stringify({budget:200,quantity:666.666667,planned:[{day:'Monday',servings:4}],membership:'unchanged'})]];
function harness(source,{native=true,path='/index.html',helperMode='all'}={}){
 const values=new Map(storageEntries),events={},classes=new Map(),probe={foodNames:0,measures:0,display:0,fetches:0};
 const textNodes=prose.map(text=>({nodeValue:text,parentElement:{closest(){return null;}}}));
 textNodes.push({nodeValue:'≈ 1 US cup (120 g)',parentElement:{closest(selector){return selector.includes('[data-bb-measures]')?{}:null;}}});
 const input=disabled=>{const attrs=new Map();return {disabled,hasAttribute:k=>attrs.has(k),setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k),removeAttribute:k=>attrs.delete(k)};};
 // The original budget control logic only needs these live native properties.
 const controls=[input(false),input(true)],note={hidden:true},detail={dataset:{},textContent:'Original regional guide.'};
 const price={dataset:{},textContent:'£4.99 per month'},description={dataset:{},textContent:'Original membership explanation.'},link={dataset:{},aria:'Premium £4.99',getAttribute(){return this.aria;},setAttribute(k,v){this.aria=v;}};
 const offer={querySelectorAll:selector=>selector==='a[aria-label]'?[link]:[price],querySelector:()=>description};
 const doc={readyState:'complete',body:{},documentElement:{classList:{toggle:(name,value)=>classes.set(name,value)},setAttribute(){}},
  getElementById:id=>id==='bb17RegionCard'?{}:id==='bbUSMarketNote'?note:null,
  querySelector:selector=>selector==='#bb17RegionCard .bb17-price-details span'?detail:null,
  querySelectorAll:selector=>selector.startsWith('.bb172-budget-entry')?controls:selector.startsWith('#bbIntroTrialDialog')?[offer]:[],
  createTreeWalker(){let index=0;return {nextNode:()=>textNodes[index++]||null};}
 };
 const env={document:doc,location:{pathname:path},NodeFilter:{SHOW_TEXT:4},Intl,localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},requestAnimationFrame:fn=>fn(),MutationObserver:class{observe(){}},fetch:async()=>{probe.fetches++;return {ok:false};},addEventListener:(name,fn)=>{events[name]=fn;},__displayProbe:probe};env.window=env;
 if(native)env.BBPriceV19={regionalMarkets:{US:{currency:'USD'}}};
 if(helperMode!=='none')vm.runInNewContext(helpers[0],env);
 if(helperMode==='all'){vm.runInNewContext(helpers[1],env);const original=env.BBRecipeMeasures.displayStep;env.BBRecipeMeasures={...env.BBRecipeMeasures,displayStep(...args){probe.display++;return original(...args);}};}
 const instrumented=source.replace('function foodNames(s){','function foodNames(s){window.__displayProbe.foodNames++;').replace('function measures(s){','function measures(s){window.__displayProbe.measures++;');
 vm.runInNewContext(instrumented,env);
 const snapshot=()=>({text:textNodes.map(node=>node.nodeValue),note:{...note},detail:{...detail,dataset:{...detail.dataset}},price:{...price,dataset:{...price.dataset}},description:{...description,dataset:{...description.dataset}},link:{aria:link.aria,dataset:{...link.dataset}},controls:controls.map(control=>({disabled:control.disabled,original:control.getAttribute('data-bb-us-original-disabled')})),classes:Object.fromEntries(classes),storage:Object.fromEntries([...values].sort(([a],[b])=>a.localeCompare(b)))});
 return {probe,snapshot,textNodes,values,render:()=>events['basketboss:market-changed'](),switchTo(region){values.set(MARKET,region);events.storage({key:MARKET});},async settle(){await Promise.resolve();await Promise.resolve();}};
}

for(const helperMode of ['all','purchase-only','none'])test('non-US text keeps exact output while unused US translation work is skipped ('+helperMode+')',async()=>{
 const previous=harness(baseline,{helperMode}),next=harness(current,{helperMode});
 assert.deepEqual(next.snapshot(),previous.snapshot());
 assert.ok(previous.probe.foodNames>=prose.length);assert.equal(next.probe.foodNames,0);assert.equal(next.probe.measures,0);
 for(const market of ['UK','Jersey','Guernsey']){
  previous.switchTo(market);next.switchTo(market);await previous.settle();await next.settle();
  assert.deepEqual(next.snapshot(),previous.snapshot());
 }
 assert.equal(next.probe.foodNames,0);assert.equal(next.probe.measures,0);
 assert.equal(next.snapshot().text[2],prose[2],'already readable mentor copy remains exact');
 assert.equal(next.snapshot().text.at(-1),'≈ 1 US cup (120 g)','explicit measurement nodes retain their original source');
 assert.equal(next.values.get('fixture-canonical-state'),storageEntries[2][1]);
});

for(const native of [true,false])test('live US and UK/Guernsey switches preserve sources, decimal displays, currency and every stored byte ('+(native?'native':'legacy')+')',async()=>{
 const previous=harness(baseline,{native}),next=harness(current,{native});
 for(const market of ['US','UK','US','Guernsey','US','Jersey','US','UK']){
  previous.switchTo(market);next.switchTo(market);await previous.settle();await next.settle();
  const before=next.snapshot();assert.deepEqual(before,previous.snapshot(),market);
  for(let count=0;count<3;count++){previous.render();next.render();await previous.settle();await next.settle();}
  assert.deepEqual(next.snapshot(),before,'repeated renders do not compound translations in '+market);assert.deepEqual(next.snapshot(),previous.snapshot());
 }
 for(const h of [previous,next])h.textNodes[0].nodeValue='Courgettes · 250 g';
 for(const market of ['US','Guernsey','US','UK']){previous.switchTo(market);next.switchTo(market);await previous.settle();await next.settle();assert.deepEqual(next.snapshot(),previous.snapshot());}
 assert.equal(next.snapshot().text[0],'Courgettes · 250 g','a live owner text replacement becomes the new source');
 assert.equal(next.values.get('fixture-canonical-state'),storageEntries[2][1]);
});

test('authoritative subscription page text remains untouched and no translation is attempted',async()=>{
 const previous=harness(baseline,{path:'/pricing-sandbox.html'}),next=harness(current,{path:'/pricing-sandbox.html'});
 for(const market of ['US','UK','Guernsey']){previous.switchTo(market);next.switchTo(market);await previous.settle();await next.settle();assert.deepEqual(next.snapshot(),previous.snapshot());assert.deepEqual(next.snapshot().text,[...prose,'≈ 1 US cup (120 g)']);}
 assert.equal(next.probe.foodNames,0);assert.equal(next.probe.measures,0);assert.equal(next.probe.fetches,0);
});
