import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-cook-studio.js',import.meta.url),'utf8');
function harness(initial=[]){
 let ingredients=initial;
 const observers=[],frames=[],visuals=[];
 const element=()=>({handlers:{},attributes:{},classList:{values:new Set(),add(value){this.values.add(value);}},style:{setProperty(key,value){this[key]=value;}},isConnected:true,innerHTML:'',textContent:'',focuses:0,scrolls:[],clicks:0,
  addEventListener(type,listener){this.handlers[type]=listener;},setAttribute(key,value){this.attributes[key]=value;},focus(){this.focuses++;},scrollIntoView(options){this.scrolls.push(options);},click(){this.clicks++;}});
 const strip=element(),count=element(),summary=element(),confirm=element(),review=element(),workspace=element(),hub=element(),first={open:false,querySelector:()=>summary};
 hub.querySelector=selector=>selector==='[data-bbcs-ingredients]'?strip:selector==='[data-bbcs-count]'?count:null;
 workspace.querySelector=selector=>selector==='details.bb82-ingredient-location'?first:null;
 const document={body:element(),getElementById:id=>id==='bb5MealReview'?review:id==='bb5GenerateFromReview'?confirm:null};
 const window={document,requestAnimationFrame:callback=>frames.push(callback),matchMedia:()=>({matches:true}),MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(target,options){this.target=target;this.options=options;}},
  BBFoodVisuals:{html(name,options){visuals.push({name,options});return '<span class="test-art"></span>';}},
  fetch(){throw Error('Presentation must not send requests');}};
 Object.defineProperty(window,'localStorage',{get(){throw Error('Presentation must not read or write stored state');}});
 vm.runInNewContext(source,{window});
 const args={hub,workspace,getIngredients:()=>ingredients};
 const controller=window.BBCookStudio.mount(args);
 const click=attribute=>hub.handlers.click({target:{closest:selector=>selector===attribute?{}:null}});
 return {window,hub,workspace,review,confirm,summary,strip,count,first,visuals,observers,controller,args,click,setIngredients:items=>{ingredients=items;},flush(){while(frames.length)frames.shift()();}};
}

test('approved AI actions retain the real scanner label and meal trigger without bypassing membership or creating requests',()=>{
 const h=harness();
 assert.match(h.hub.innerHTML,/<label[^>]*data-ai-scan-btn[^>]*for="ai-photo-input"[^>]*role="button"/);
 assert.match(h.hub.innerHTML,/<button[^>]*data-ai-meal-btn[^>]*data-open-tool="meal"/);
 assert.match(h.hub.innerHTML,/Scan my food/);assert.match(h.hub.innerHTML,/Create a meal/);
 assert.match(h.hub.innerHTML,/AI tools require Premium and an internet connection/);
 assert.doesNotMatch(h.hub.innerHTML,/href="[^"]*(?:checkout|stripe|paddle|pricing)|AI ready|scans remaining/);
 assert.equal(h.count.textContent,'None selected');
});

test('ingredient view reflects current unsaved choices and preparation states without changing names, quantities or confirmation',()=>{
 const selected=[{name:'Cooked chicken',qty:300,unit:'g',loc:'fridge'},{name:'Pasta',qty:null,unit:'g',loc:'cupboard'}];
 const before=JSON.stringify(selected),h=harness(selected);
 assert.equal(h.count.textContent,'2 selected');
 assert.deepEqual(h.visuals.map(call=>call.name),['Cooked chicken','Pasta']);
 assert.equal(h.visuals[0].options.context,'cook');assert.equal(JSON.stringify(selected),before);
 h.setIngredients([{name:'Frozen chicken',qty:500,unit:'g',loc:'freezer'}]);
 h.observers[0].callback();h.observers[0].callback();h.flush();
 assert.equal(h.count.textContent,'1 selected');assert.match(h.strip.innerHTML,/Frozen chicken/);assert.doesNotMatch(h.strip.innerHTML,/Cooked chicken/);
 assert.equal(h.visuals.at(-1).name,'Frozen chicken');
 assert.equal(h.observers[0].target,h.workspace);assert.equal(h.observers[0].options.attributes,undefined);
});

test('custom food names remain escaped and the compact preview never drops the complete selection count',()=>{
 const h=harness([{name:'Custom "food" <img onerror=alert(1)>'},...Array.from({length:5},(_,n)=>({name:'Food '+n}))]);
 assert.equal(h.count.textContent,'6 selected');
 assert.match(h.strip.innerHTML,/Custom &quot;food&quot; &lt;img onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(h.strip.innerHTML,/<img|Food 3|Food 4/);
 assert.equal(h.strip.style['--bbcs-columns'],'5');
});

test('Edit and local finder move focus to original controls without clicking confirm or saving data',()=>{
 const h=harness([{name:'Rice',qty:500,unit:'g'}]);
 h.click('[data-bbcs-edit]');assert.equal(h.first.open,true);assert.equal(h.summary.focuses,1);assert.equal(h.workspace.scrolls.length,1);
 h.click('[data-bbcs-find]');assert.equal(h.review.scrolls.length,1);assert.equal(h.confirm.focuses,1);assert.equal(h.confirm.clicks,0);
 assert.equal(h.review.scrolls[0].behavior,'auto');
 const empty=harness();empty.click('[data-bbcs-find]');assert.equal(empty.workspace.scrolls.length,1);assert.equal(empty.summary.focuses,1);assert.equal(empty.confirm.focuses,0);
});

test('mounting twice does not duplicate observers, listeners or the existing entrypoint',()=>{
 const h=harness([{name:'Milk'}]);const listener=h.hub.handlers.click;
 assert.equal(h.window.BBCookStudio.mount(h.args),h.controller);
 assert.equal(h.observers.length,1);assert.equal(h.hub.handlers.click,listener);
 h.setIngredients([{name:'Milk'},{name:'Bread'}]);h.workspace.handlers.input();h.flush();assert.equal(h.count.textContent,'2 selected');
});
