import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const voice=createRequire(import.meta.url)('../bb-cook-voice.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({premium=true,browser=false,available=true}={}){
 const events=()=>({handlers:new Map(),addEventListener(name,fn){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(fn);},removeEventListener(name,fn){this.handlers.get(name)?.delete(fn);},fire(name,event={}){for(const fn of this.handlers.get(name)||[])fn(event);}});
 class Node{
  constructor(tag){Object.assign(this,events());this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.className='';this.textContent='';this.attributes={};this.hidden=false;this.disabled=false;this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(' ').filter(Boolean));on?classes.add(name):classes.delete(name);this.className=[...classes].join(' ');}};}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  click(){if(!this.disabled)this.fire('click');}
 }
 const doc=Object.assign(events(),{visibilityState:'visible',createElement:tag=>new Node(tag)});doc.body=new Node('body');
 const container=new Node('div');doc.body.append(container);
 const calls=[],timers=new Map();let timerId=0,final,status;
 const host=Object.assign(events(),{document:doc,navigator:{language:'en-GB'},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),fetch(){throw Error('Voice must not send data to BasketBoss.');}});
 const context={key:'fajitas|Monday',stepKey:0,active:true,premium,ingredients:[{name:'Cheddar',quantity:'265 g'},{name:'Chicken breast',quantity:'665 g'}],next:()=>{calls.push('next');context.stepKey++;return true;},previous:()=>{calls.push('previous');return true;},startTimer:()=>{calls.push('timer');return true;},upgrade:()=>calls.push('upgrade')};
 const instances=[];
 if(browser){
  if(available)host.SpeechRecognition=class{
   constructor(){instances.push(this);calls.push('construct');}
   start(){calls.push('start');this.onstart?.();}
   abort(){calls.push('abort');this.onend?.();}
  };
 }else{
  host.BBNativeCookVoice={available:async()=>{calls.push('available');return available;},start:async(onFinal,onStatus)=>{calls.push('start');final=onFinal;status=onStatus;status({state:'listening'});},stop:async()=>{calls.push('stop');},speak:async text=>{calls.push(['speak',text]);}};
 }
 const controller=voice.mount({container,context:()=>context,window:host,document:doc});
 const find=name=>{let result;const visit=node=>{if(node.className.split(' ').includes(name))result=node;for(const child of node.children)visit(child);};visit(container);return result;};
 return {host,doc,container,context,calls,timers,controller,instances,find,button:()=>find('bbcv-toggle'),status:()=>find('bbcv-status').textContent,transcript:text=>final?.(text),nativeStatus:value=>status?.(value),runTimers(){const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();}};
}

test('only explicit Cook commands are recognized, including ingredient questions',()=>{
 for(const phrase of ['Next step','please next step','Go to the next step please'])assert.equal(voice.parseCommand(phrase)?.type,'next');
 for(const phrase of ['Previous step','Back one step','Go back'])assert.equal(voice.parseCommand(phrase)?.type,'previous');
 assert.equal(voice.parseCommand('Start the timer')?.type,'timer');
 assert.deepEqual(voice.parseCommand('How much cheddar do I need?'),{type:'quantity',name:'cheddar'});
 assert.deepEqual(voice.parseCommand('How many eggs?'),{type:'quantity',name:'eggs'});
 for(const phrase of ['restart the timer','the next step is to slice chicken','next step next step','finish dinner','buy cheddar'])assert.equal(voice.parseCommand(phrase),null,phrase);
});

test('ingredient answers read the supplied scaled quantity and reject ambiguous or similar names',()=>{
 const ingredients=[{name:'Cheddar',quantity:'265 g'},{name:'Chicken breast',quantity:'665 g'},{name:'Eggs',quantity:'2 eggs'}];
 assert.equal(voice.ingredientAnswer(ingredients,'cheddar').message,'Cheddar: 265 g.');
 assert.equal(voice.ingredientAnswer(ingredients,'egg').message,'Eggs: 2 eggs.');
 assert.equal(voice.ingredientAnswer(ingredients,'chard').ok,false);
 assert.equal(voice.ingredientAnswer([...ingredients,{name:'Parmesan',quantity:'30 g'}],'cheese').ok,false);
 assert.equal(voice.ingredientAnswer([{name:'Salt',quantity:'to taste'}],'salt').message,'Salt: to taste.');
});

test('Free voice entry opens the existing upgrade flow without native permissions or listening',async()=>{
 const h=fixture({premium:false});assert.equal(h.find('bbcv-label').textContent,'Voice Cook · Premium');
 h.button().click();await tick();assert.deepEqual(h.calls,['upgrade']);assert.equal(h.button().getAttribute('aria-pressed'),'false');
 h.controller.dispose();
});

test('Premium listening starts only on a tap, performs existing actions and speaks recipe quantities',async()=>{
 const h=fixture();assert.deepEqual(h.calls,[]);assert.equal(h.button().getAttribute('aria-pressed'),'false');
 h.button().click();await tick();assert.deepEqual(h.calls,['available','start']);assert.equal(h.button().getAttribute('aria-pressed'),'true');
 h.transcript('Next step');await tick();assert.equal(h.calls.filter(x=>x==='next').length,1);
 h.transcript('Start timer');await tick();assert.equal(h.calls.filter(x=>x==='timer').length,1);
 h.transcript('How much cheddar?');await tick();assert.ok(h.calls.some(x=>Array.isArray(x)&&x[1]==='Cheddar: 265 g.'));
 h.button().click();const count=h.calls.length;h.transcript('previous step');await tick();assert.equal(h.calls.length,count);
 assert.equal(h.button().getAttribute('aria-pressed'),'false');h.controller.dispose();
});

test('interim and repeated final browser results cannot advance the recipe twice',async()=>{
 const h=fixture({browser:true});h.button().click();await tick();const recognition=h.instances[0];
 assert.equal(recognition.interimResults,false);assert.equal(recognition.continuous,true);
 const result=(text,isFinal)=>{const item=[{transcript:text}];item.isFinal=isFinal;return item;};
 recognition.onresult({resultIndex:0,results:[result('Next step',false)]});assert.equal(h.calls.filter(x=>x==='next').length,0);
 recognition.onresult({resultIndex:0,results:[result('Next step',true)]});
 recognition.onresult({resultIndex:0,results:[result('Next step',true)]});
 recognition.onresult({resultIndex:1,results:[result('Next step',true),result('Next step',true)]});
 assert.equal(h.calls.filter(x=>x==='next').length,1);
 h.controller.dispose();
});

test('closing, hiding, account changes and verified Premium loss stop listening and stale callbacks',async()=>{
 for(const reason of ['hidden','account','premium','recipe','inactive','dispose']){
  const h=fixture();h.button().click();await tick();const before=h.calls.filter(x=>x==='next').length;
  if(reason==='hidden'){h.doc.visibilityState='hidden';h.doc.fire('visibilitychange');}
  if(reason==='account')h.host.fire('basketboss:session-changed');
  if(reason==='premium'){h.context.premium=false;h.doc.fire('basketboss:premium-verified');}
  if(reason==='recipe'){h.context.key='other|Monday';h.controller.refresh();}
  if(reason==='inactive'){h.context.active=false;h.controller.refresh();}
  if(reason==='dispose')h.controller.dispose();
  h.transcript('Next step');await tick();assert.equal(h.calls.filter(x=>x==='next').length,before,reason);assert.ok(h.calls.includes('stop'),reason);
  if(reason!=='dispose')h.controller.dispose();
 }
});

test('a quiet browser session can continue until the user stops, without restarting after backgrounding',async()=>{
 const h=fixture({browser:true});h.button().click();await tick();const first=h.instances[0];
 first.onerror({error:'no-speech'});first.onend();assert.equal(h.button().getAttribute('aria-pressed'),'true');h.runTimers();assert.equal(h.instances.length,2);
 h.doc.visibilityState='hidden';h.doc.fire('visibilitychange');h.runTimers();assert.equal(h.instances.length,2);assert.equal(h.button().getAttribute('aria-pressed'),'false');h.controller.dispose();
});

test('permission errors and unsupported devices leave a clear stopped state',async()=>{
 const denied=fixture();denied.button().click();await tick();denied.nativeStatus({state:'error',code:'denied'});
 assert.match(denied.status(),/not allowed/);assert.equal(denied.button().getAttribute('aria-pressed'),'false');denied.controller.dispose();
 for(const browser of [false,true]){
  const h=fixture({browser,available:false});h.button().click();await tick();assert.match(h.status(),/not available/);assert.equal(h.button().getAttribute('aria-pressed'),'false');assert.equal(h.button().disabled,true);assert.equal(h.calls.includes('start'),false);h.controller.dispose();
 }
});

test('a running or unavailable timer is never toggled into pause by the voice controller',async()=>{
 const h=fixture();h.context.startTimer=()=>false;h.button().click();await tick();h.transcript('Start timer');await tick();assert.ok(h.calls.some(x=>Array.isArray(x)&&/already be running/.test(x[1])));h.controller.dispose();
});
