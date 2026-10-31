import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync('bb-us-market.js','utf8');

function harness({native=true,path='/index.html',text='$12.34 · Courgette · 100 g'}={}){
 const values=new Map([
  ['basketboss_321_v7_market','US'],
  ['bb_us_fx_gbp_usd_v1',JSON.stringify({rate:1.25,date:'2026-10-30'})]
 ]);
 const listeners={},classes=new Map();let fetches=0;
 const node={nodeValue:text,parentElement:{closest(){return null;}}};
 function input(disabled){const attrs=new Map();return {disabled,hasAttribute:k=>attrs.has(k),setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k),removeAttribute:k=>attrs.delete(k)};}
 const control=input(false),disabledControl=input(true);
 const note={hidden:true};
 const detail={dataset:{},textContent:'Original region explanation'};
 const nodes={bb17RegionCard:{},bbUSMarketNote:note};
 const document={
  readyState:'complete',body:{},
  documentElement:{classList:{toggle:(name,value)=>classes.set(name,value)},setAttribute(){}},
  getElementById:id=>nodes[id]??null,
  querySelector:selector=>selector==='#bb17RegionCard .bb17-price-details span'?detail:null,
  querySelectorAll:selector=>selector.startsWith('.bb172-budget-entry')?[control,disabledControl]:[],
  createTreeWalker(){let read=false;return {nextNode(){if(read)return null;read=true;return node;}};}
 };
 const env={document,location:{pathname:path},NodeFilter:{SHOW_TEXT:4},Intl,
  localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},
  requestAnimationFrame:fn=>fn(),MutationObserver:class {observe(){}},
  fetch:async()=>{fetches++;return {ok:false};},
  addEventListener:(name,fn)=>{listeners[name]=fn;}
 };
 env.window=env;
 if(native)env.BBPriceV19={regionalMarkets:{US:{currency:'USD'}}};
 vm.runInNewContext(code,env);
 return {node,note,detail,control,disabledControl,classes,get fetches(){return fetches;},
  switchTo(region){values.set('basketboss_321_v7_market',region);listeners.storage({key:'basketboss_321_v7_market'});}
 };
}

test('native US guides retain USD prices, localize ingredients and keep USD controls available without FX',()=>{
 const h=harness();
 assert.equal(h.node.nodeValue,'$12.34 · Zucchini · 3.5 oz');
 assert.equal(h.fetches,0);
 assert.equal(h.control.disabled,false);
 assert.equal(h.classes.get('bb-us-legacy-pricing'),false);
 assert.equal(h.disabledControl.disabled,true);
 assert.match(h.note.textContent,/illustrative US pack sizes and USD price guides/);
 assert.doesNotMatch(h.note.textContent,/GBP→USD|not available|reference rate/);
 assert.match(h.detail.textContent,/illustrative regional pack sizes and USD price guides/);
 h.switchTo('UK');
 assert.equal(h.node.nodeValue,'$12.34 · Courgette · 100 g');
 assert.equal(h.note.hidden,true);
 assert.equal(h.detail.textContent,'Original region explanation');
});

test('legacy pages without regional pricing retain an explicitly labelled conversion fallback',()=>{
 const h=harness({native:false,text:'£10.00 · Courgette'});
 assert.equal(h.node.nodeValue,'≈$12.50 · Zucchini');
 assert.equal(h.fetches,1);
 assert.equal(h.control.disabled,true);
 assert.equal(h.classes.get('bb-us-legacy-pricing'),true);
 assert.match(h.note.textContent,/GBP→USD reference rate/);
 h.switchTo('UK');
 assert.equal(h.node.nodeValue,'£10.00 · Courgette');
 assert.equal(h.control.disabled,false);
 assert.equal(h.disabledControl.disabled,true);
});

test('subscription price page leaves authoritative checkout currency untouched',()=>{
 const h=harness({native:true,path:'/pricing-sandbox.html',text:'£4.99 monthly'});
 assert.equal(h.node.nodeValue,'£4.99 monthly');
 assert.equal(h.fetches,0);
 assert.match(h.note.textContent,/Final subscription charges and currency are set by Paddle/);
});
