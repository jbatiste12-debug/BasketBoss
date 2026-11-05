import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-plan-drag.js',import.meta.url),'utf8');
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const flush=()=>new Promise(resolve=>setImmediate(resolve));

// A small event/DOM model keeps these tests independent of native host builds.
// Pointer/touch events run before the browser's synthetic click and summary toggle.
function fixture({touch=false}={}){
 let doc,time=1000,nextTimer=0,hit=null;
 const timers=new Map(),frames=new Map(),completed=[],moves=[],announcements=[];
 const listeners=new Map(),windowListeners=new Map();
 const listen=(map,type,fn)=>{const list=map.get(type)||[];list.push(fn);map.set(type,list);};
 class Element{
  constructor(tag){this.tagName=tag.toLowerCase();this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.style={};this._className='';this._text='';this.events=new Map();this.disabled=false;this.open=false;this.ownerDocument=doc;}
  get className(){return this._className;}
  set className(value){this._className=String(value);}
  get classList(){const node=this;return {contains:name=>node.className.split(/\s+/).includes(name),add(...names){node.className=[...new Set([...node.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove(...names){node.className=node.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');}};}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='open')this.open=true;}
  getAttribute(name){return this.attributes[name]??null;}
  matches(selector){return selector.split(',').some(part=>{
   let rule=part.trim();
   if(rule.includes(':not(:disabled)')){if(this.disabled)return false;rule=rule.replace(':not(:disabled)','');}
   const tag=rule.match(/^[a-z][\w-]*/i)?.[0];if(tag&&this.tagName!==tag.toLowerCase())return false;
   for(const id of rule.matchAll(/#([\w-]+)/g))if(this.id!==id[1])return false;
   for(const cls of rule.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(cls[1]))return false;
   for(const attr of rule.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)){
    const key=attr[1],actual=key.startsWith('data-')?this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]:key==='open'?(this.open?'':undefined):this.attributes[key];
    if(actual===undefined||attr[2]!==undefined&&String(actual)!==attr[2])return false;
   }
   return true;
  });}
  closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
  querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,fn){listen(this.events,type,fn);}
  fire(type,event={}){for(const fn of this.events.get(type)||[])fn(event);}
  focus(){doc.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
  getBoundingClientRect(){return {top:0,left:0,right:300,bottom:100,width:300,height:100};}
  get offsetWidth(){return 250;}
  get offsetHeight(){return 70;}
  setPointerCapture(){}
  hasPointerCapture(){return false;}
 }
 doc={visibilityState:'visible',createElement:tag=>new Element(tag),addEventListener:(type,fn)=>listen(listeners,type,fn),removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(value=>value!==fn));},querySelectorAll:selector=>doc.body.querySelectorAll(selector),getElementById:id=>[doc.body,...doc.body.querySelectorAll('*')].find(node=>node.id===id)||null,elementFromPoint:()=>hit,documentElement:{style:{scrollBehavior:''}}};
 doc.body=new Element('body');const app=new Element('div');app.id='app';app.className='bbnext-plan';doc.body.append(app);
 const rows=Object.fromEntries(DAYS.map(day=>{
  const row=new Element('details');row.className='bbnext-day';row.dataset.bbnextDay=day;
  const summary=new Element('summary');summary.className='bbnext-day-toggle';
  const badge=new Element('span');badge.className='bbnext-day-label';badge.dataset.bbPlanHandle=day;badge.textContent=day.slice(0,3);
  const title=new Element('strong');title.textContent=day+' dinner';summary.append(badge,title);
  const content=new Element('div');content.className='bbnext-day-content';
  const move=new Element('button');move.dataset.bbPlanMoveDay=day;move.textContent='Move dinner';content.append(move);
  row.append(summary,content);app.append(row);return [day,{row,summary,badge,title,content,move}];
 }));
 hit=rows.Monday.badge;
 const state={fingerprint:'plan-one',days:DAYS.map(day=>({day,recipeId:'recipe-'+day,name:day+' dinner',blocked:false}))};
 const win={document:doc,BBDayDone:{quickComplete(day){completed.push(day);}},BBPlanMoveHost:{snapshot:()=>state,move(request){moves.push(request);return Promise.resolve({ok:true,message:'Dinner moved.'});},notify:message=>announcements.push(message)},addEventListener:(type,fn)=>listen(windowListeners,type,fn),scrollBy(){}};
 if(touch)win.ontouchstart=null;
 class ClockDate extends Date{static now(){return time;}}
 vm.runInNewContext(source,{window:win,document:doc,innerWidth:400,innerHeight:800,Date:ClockDate,setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{const id=++nextTimer;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),getComputedStyle:()=>({visibility:'visible',display:'block',position:'static'})});
 function advance(ms){time+=ms;for(const [id,timer]of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}}
 function fire(type,target,extra={}){
  const event={type,target,button:0,isPrimary:true,pointerId:1,pointerType:'mouse',clientX:80,clientY:80,detail:1,cancelable:true,prevented:false,stopped:false,immediate:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=this.immediate=true;},...extra};
  for(const fn of [...listeners.get(type)||[]]){fn(event);if(event.immediate)break;}
  if(!event.stopped)target?.fire(type,event);
  if(type==='click'&&!event.prevented){const summary=target?.closest('summary');if(summary)summary.parentNode.open=!summary.parentNode.open;}
  return event;
 }
 function tap(day='Monday',extra={}){const target=typeof day==='string'?rows[day].badge:day;fire('pointerdown',target,extra);advance(20);fire('pointerup',target,extra);return fire('click',target,extra);}
 function touchStart(target=rows.Monday.badge){const point={identifier:4,clientX:80,clientY:80};fire('touchstart',target,{touches:[point],changedTouches:[point]});return point;}
 return {win,doc,rows,completed,moves,announcements,advance,fire,tap,touchStart,setHit:target=>{hit=target;},state};
}

test('one badge tap keeps the normal day expansion and never completes food',()=>{
 const h=fixture(),event=h.tap();assert.equal(event.prevented,false);assert.equal(h.rows.Monday.row.open,true);assert.deepEqual(h.completed,[]);
 h.advance(500);h.tap(h.rows.Monday.title);assert.equal(h.rows.Monday.row.open,false);assert.deepEqual(h.completed,[]);
});

test('two quick taps on the same day badge request completion once and keep the day expanded',()=>{
 const h=fixture();h.tap();h.advance(100);const second=h.tap();
 assert.deepEqual(h.completed,['Monday']);assert.equal(second.prevented,true);assert.equal(second.immediate,true);assert.equal(h.rows.Monday.row.open,true);
 h.advance(30);h.tap();assert.deepEqual(h.completed,['Monday'],'a third tap starts a fresh pair');
});

test('badge-only double taps never bind recipe text or interactive controls',()=>{
 const h=fixture();
 for(const target of [h.rows.Monday.title,h.rows.Monday.move]){h.tap(target);h.advance(60);h.tap(target);h.advance(500);}
 const control=h.doc.createElement('button');h.rows.Monday.badge.append(control);h.tap(control);h.advance(60);h.tap(control);
 assert.deepEqual(h.completed,[]);
});

test('different days, slow taps and keyboard summary activation never form a completion pair',()=>{
 const h=fixture();h.tap('Monday');h.advance(50);h.tap('Tuesday');assert.deepEqual(h.completed,[]);
 h.advance(500);h.tap('Monday');h.advance(350);h.tap('Monday');assert.deepEqual(h.completed,[]);
 h.advance(500);h.fire('click',h.rows.Monday.badge,{detail:0});h.advance(50);h.fire('click',h.rows.Monday.badge,{detail:0});assert.deepEqual(h.completed,[]);
});

test('moving beyond the tap tolerance cancels a possible completion pair',()=>{
 const h=fixture();h.tap();h.advance(50);
 h.fire('pointerdown',h.rows.Monday.badge);h.fire('pointermove',h.rows.Monday.badge,{clientX:110});h.fire('pointerup',h.rows.Monday.badge,{clientX:110});h.fire('click',h.rows.Monday.badge,{clientX:110});
 h.advance(50);h.tap();assert.deepEqual(h.completed,[]);
});

test('holding a day badge then releasing cannot count as a double tap',()=>{
 const h=fixture();h.tap();h.advance(50);h.fire('pointerdown',h.rows.Monday.badge);h.advance(451);
 assert.equal(h.rows.Monday.row.classList.contains('bb-plan-drag-source'),true);
 h.fire('pointerup',h.rows.Monday.badge);const click=h.fire('click',h.rows.Monday.badge);
 assert.equal(click.prevented,true);assert.deepEqual(h.completed,[]);assert.deepEqual(h.moves,[]);
 h.advance(30);h.tap();assert.deepEqual(h.completed,[]);
});

test('a held drag uses the existing guarded move host and cannot complete food',async()=>{
 const h=fixture();h.fire('pointerdown',h.rows.Monday.badge);h.advance(451);h.setHit(h.rows.Tuesday.badge);
 h.fire('pointermove',h.rows.Monday.badge,{clientX:100,clientY:180});h.fire('pointerup',h.rows.Monday.badge,{clientX:100,clientY:180});h.fire('click',h.rows.Tuesday.badge,{clientX:100,clientY:180});await flush();
 assert.equal(h.moves.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.moves[0])),{from:'Monday',to:'Tuesday',expected:'plan-one',recipeId:'recipe-Monday'});assert.deepEqual(h.completed,[]);
});

test('touch holds are suppressed before Safari synthesizes the badge click',()=>{
 const h=fixture({touch:true}),point=h.touchStart();h.advance(451);
 h.fire('touchend',h.rows.Monday.badge,{touches:[],changedTouches:[point]});const click=h.fire('click',h.rows.Monday.badge);
 assert.equal(click.prevented,true);assert.deepEqual(h.completed,[]);
 h.advance(30);h.tap();assert.deepEqual(h.completed,[]);
});

test('keyboard users retain the existing Move dinner dialog and guarded swap',async()=>{
 const h=fixture();h.fire('click',h.rows.Monday.move,{detail:0});
 const dialog=h.doc.querySelectorAll('dialog')[0];assert.ok(dialog);assert.equal(dialog.getAttribute('aria-modal'),'true');
 const choose=dialog.querySelector('button:not(:disabled)');assert.match(choose.textContent,/Swap with Tuesday/);
 choose.fire('click');await flush();assert.equal(h.moves.length,1);assert.equal(h.moves[0].to,'Tuesday');assert.deepEqual(h.completed,[]);
});

test('an intervening meal-title tap or cancelled pointer gesture breaks a badge pair',()=>{
 const h=fixture();h.tap();h.advance(40);h.tap(h.rows.Monday.title);h.advance(40);h.tap();assert.deepEqual(h.completed,[]);
 h.advance(500);h.tap();h.advance(40);h.fire('pointerdown',h.rows.Monday.badge);h.fire('pointercancel',h.rows.Monday.badge);h.advance(40);h.tap();assert.deepEqual(h.completed,[]);
});

test('two ordinary touch taps use the same badge completion path after their synthetic clicks',()=>{
 const h=fixture({touch:true});
 function tap(){const point=h.touchStart();h.advance(20);h.fire('touchend',h.rows.Monday.badge,{touches:[],changedTouches:[point]});return h.fire('click',h.rows.Monday.badge);}
 const first=tap();h.advance(80);const second=tap();assert.equal(first.prevented,false);assert.equal(second.prevented,true);assert.deepEqual(h.completed,['Monday']);
});

test('a day without a dinner handle can still confirm its lunch or dessert through the badge',()=>{
 const h=fixture();delete h.rows.Monday.badge.dataset.bbPlanHandle;h.state.days[0].recipeId=null;
 h.tap();h.advance(80);h.tap();assert.deepEqual(h.completed,['Monday']);assert.deepEqual(h.moves,[]);
});
