import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const index=read('index.html'),app=read('app.html'),meal=read('make-a-meal.js');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function namedFunction(source,name,next){
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction '+next+'(',start);
 assert.ok(start>=0&&end>start,'Function boundary '+name);
 return source.slice(start,end);
}

test('all app entrypoints load one synchronous shared visual library before their food renderers',()=>{
 assert.equal(index,app);
 for(const html of [index,app,read('make-a-meal.html')]){
  const scripts=[...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"[^>]*>/g)].filter(match=>match[2].startsWith('bb-food-visuals.js?'));
  assert.equal(scripts.length,1);assert.doesNotMatch(scripts[0][1],/\b(?:defer|async)\b/);
  assert.equal([...html.matchAll(/href="bb-food-visuals\.css\?/g)].length,1);
  assert.ok(html.indexOf(scripts[0][0])<html.indexOf('</head>'));
 }
});

test('custom uploaded tile photos retain priority and built-in artwork resolves the actual food identity',()=>{
 const calls=[],context=vm.createContext({window:{BBFoodVisuals:{html:(name,options)=>{calls.push({name,options});return '<span class="test-food-visual"></span>';}}},bb172Escape:escape});
 vm.runInContext(namedFunction(index,'bb172ImageMark','bb172TileHTML'),context);
 const uploaded='data:image/jpeg;base64,Zm9vZA==';
 const photo=vm.runInContext('bb172ImageMark('+JSON.stringify({name:'Cooked chicken',category:'fillings',image:uploaded})+')',context);
 assert.ok(photo.includes(uploaded));assert.equal(calls.length,0);
 assert.match(vm.runInContext('bb172ImageMark({name:"Cooked chicken",category:"fillings",emoji:"🍗"})',context),/test-food-visual/);
 assert.equal(calls[0].name,'Cooked chicken');assert.equal(calls[0].options.context,'lunch');
 vm.runInContext('bb172ImageMark({name:"Black pepper",category:"pantry",emoji:"🌶️"})',context);
 assert.equal(calls[1].name,'Black pepper');assert.equal(calls[1].options.context,'pantry');
});

test('Cook visual replacement preserves selected state, editable quantities and escaped selection identity',()=>{
 const calls=[],context=vm.createContext({window:{BBFoodVisuals:{html:(name,options)=>{calls.push({name,options});return '<span class="test-food-visual"></span>';}}},
  bbFoodEmoji:(name,preferred)=>preferred||'🥣',bbPhotoName:()=>{throw Error('Old photo resolver must not replace a shared visual');},
  uid:(name,location)=>location+'|'+name.toLowerCase(),inventory:{'cupboard|rice':{selected:true,qty:500,unit:'g'}},esc:escape});
 vm.runInContext(meal.split('\n').find(line=>line.startsWith('function bbFoodVisual('))+'\n'+meal.split('\n').find(line=>line.startsWith('function foodTile(')),context);
 const html=vm.runInContext('foodTile("🍚","Rice","cupboard")',context);
 assert.match(html,/data-food="Rice"/);assert.match(html,/aria-pressed="true"/);assert.match(html,/500 g/);assert.match(html,/test-food-visual/);
 assert.equal(calls[0].name,'Rice');assert.equal(calls[0].options.context,'cook');
 const custom=vm.runInContext('foodTile("✏️",\'Custom "food" <script>\',"fridge")',context);
 assert.match(custom,/data-food="Custom &quot;food&quot; &lt;script&gt;"/);assert.match(custom,/aria-pressed="false"/);
 assert.doesNotMatch(custom,/<script>/);
});

function lunchHarness(withVisuals=true){
 const nodes=[],controls=new Map(),calls=[],messages=[];
 class Node {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.handlers={};this._text='';this._html='';nodes.push(this);}
  append(...items){for(const item of items){this.children.push(item);item.parentNode=this;}}
  addEventListener(type,callback){this.handlers[type]=callback;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name];}
  set textContent(value){this._text=String(value);this.children=[];this._html='';}
  get textContent(){return this._text+this._html.replace(/<[^>]*>/g,'')+this.children.map(child=>child.textContent).join('');}
  set innerHTML(value){this._html=String(value);this.children=[];this._text='';}
  get innerHTML(){return this._html;}
  querySelector(selector){if(!controls.has(selector))controls.set(selector,new Node('control'));return controls.get(selector);}
  querySelectorAll(selector){return selector==='[data-bb172-lunch-mode]'?[...controls.values()].filter(node=>node.dataset.bb172LunchMode):[];}
 }
 const days=['Monday','Tuesday','Wednesday','Thursday','Friday'];
 for(const [selector,value] of [['#bb172ChipDay','Monday'],['#bb172LunchExtra',''],['#bb321LunchChildren','3']]){const node=new Node('input');node.value=value;controls.set(selector,node);}
 for(const mode of ['week','day']){const node=new Node('button');node.dataset.bb172LunchMode=mode;controls.set('mode:'+mode,node);}
 const heading={after(panel){controls.set('panel',panel);}};
 const school={querySelector:selector=>selector==='#bb172LunchChips'||selector==='label[for="bb321LunchSpeech"]'?null:selector==='.section-head'?heading:controls.get(selector)||null};
 const app={querySelector:selector=>selector==='#bb321SchoolLunchbox'?school:null};
 const window=withVisuals?{BBFoodVisuals:{html:(name,options)=>{calls.push({name,options});return '<span class="test-food-visual"></span>';}}}:{};
 const context=vm.createContext({window,document:{createElement:tag=>new Node(tag)},confirm:()=>true,bb172Msg:message=>messages.push(message),app});
 const libraryStart=index.indexOf('const BB321Lunch=(()=>{'),libraryEnd=index.indexOf('})();',libraryStart);
 const choices=index.slice(index.indexOf('const BB172_LUNCH_CHIPS='),index.indexOf('function bb172LunchChipPanel('));
 vm.runInContext(index.slice(libraryStart,libraryEnd+5)+'\n'+choices+'\n'+namedFunction(index,'bb172LunchChipPanel','bb172CoreRecipePool')+`
 let bb321LunchState=BB321Lunch.normaliseLunchbox({children:3});let writes=0,refreshes=0;
 function bb321StoreLunch(value){bb321LunchState=value;writes++;return true;}
 function bb172RefreshLunchbox(){refreshes++;}
 bb172LunchChipPanel(app);`,context);
 return {context,nodes,controls,calls,messages,days,chip:id=>nodes.find(node=>node.dataset.bb172Chip===id),state:()=>JSON.parse(vm.runInContext('JSON.stringify(bb321LunchState)',context)),requirements:()=>JSON.parse(vm.runInContext('JSON.stringify(BB321Lunch.lunchRequirements(bb321LunchState))',context))};
}

test('School Lunch artwork uses cooked ingredient names while original selection and child/day quantities remain correct',()=>{
 const h=lunchHarness();
 assert.ok(h.calls.some(call=>call.name==='Cooked chicken'&&call.options.context==='lunch'));
 assert.ok(h.calls.some(call=>call.name==='Bread slices'));
 assert.ok(!h.calls.some(call=>call.name==='Chicken'));
 for(const id of ['bread','cheddar','chicken']){const button=h.chip(id);button.handlers.click();assert.equal(button.getAttribute('aria-pressed'),'true');}
 h.chip('bread').handlers.click();assert.equal(h.chip('bread').getAttribute('aria-pressed'),'false');h.chip('bread').handlers.click();
 h.controls.get('#bb172AddLunchShop').handlers.click();
 assert.equal(vm.runInContext('writes',h.context),1);assert.equal(vm.runInContext('refreshes',h.context),1);
 for(const day of h.days)assert.equal(h.state().days[day].length,3);
 const requirements=h.requirements();
 assert.equal(requirements.find(item=>item.name==='Bread slices').qty,30);
 assert.equal(requirements.find(item=>item.name==='Cheddar cheese').qty,375);
 assert.equal(requirements.find(item=>item.name==='Cooked chicken').qty,600);
});

test('a missing visual script keeps the original lunch controls and saved-food flow available',()=>{
 const h=lunchHarness(false);assert.match(h.chip('bread').textContent,/Bread loaf/);
 h.chip('bread').handlers.click();h.controls.get('#bb172AddLunchShop').handlers.click();
 assert.equal(h.requirements().find(item=>item.name==='Bread slices').qty,30);assert.equal(vm.runInContext('writes',h.context),1);
});
