import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const voice=require('../bb-cook-voice.js');
const serving=require('../bb-serving-scale.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const decode=text=>text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");

// The real openCook controller renders into this small DOM. Parsing its actual
// markup keeps event handlers, checked state and replaced controls observable
// without adding a browser dependency to the portable suite.
function events(target={}){
 const listeners=new Map();
 return Object.assign(target,{
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
  removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
  fire(name,event={}){event.target??=this;event.currentTarget=this;event.preventDefault??=()=>{};for(const fn of listeners.get(name)||[])fn(event);this['on'+name]?.(event);}
 });
}
function documentFixture(){
 let doc;
 class Element{
  constructor(tag){events(this);Object.assign(this,{tagName:tag.toUpperCase(),children:[],parentNode:null,ownerDocument:doc,dataset:{},attributes:{},style:{},className:'',value:'',hidden:false,disabled:false,checked:false,open:false,scrollTop:0,_text:''});
   this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));on?classes.add(name):classes.delete(name);this.className=[...classes].join(' ');},contains:name=>this.className.split(/\s+/).includes(name)};
  }
  append(...nodes){for(let node of nodes){if(typeof node==='string'){const text=new Element('#text');text._text=node;node=text;}node.parentNode=this;this.children.push(node);}}
  before(node){const siblings=this.parentNode.children;node.parentNode=this.parentNode;siblings.splice(siblings.indexOf(this),0,node);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  set textContent(text){this.children.forEach(node=>node.parentNode=null);this.children=[];this._text=String(text);}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  set innerHTML(html){
   this.textContent='';const stack=[this];
   for(const part of String(html).matchAll(/<\/?[^>]+>|[^<]+/g)){
    const value=part[0];if(value.startsWith('</')){stack.pop();continue;}
    if(!value.startsWith('<')){stack.at(-1).append(decode(value));continue;}
    const tag=value.match(/^<([\w-]+)/)?.[1];if(!tag)continue;
    const node=new Element(tag);
    for(const attribute of value.slice(tag.length+1,-1).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(attribute[1],decode(attribute[2]??attribute[3]??attribute[4]??''));
    stack.at(-1).append(node);if(!['input','img','br','hr','meta','link'].includes(tag))stack.push(node);
   }
  }
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='id')this.id=String(value);if(name==='class')this.className=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);if(['checked','disabled','hidden','open'].includes(name))this[name]=true;if(name==='value')this.value=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];if(['checked','disabled','hidden','open'].includes(name))this[name]=false;}
  matches(selector){return selector.split(',').some(raw=>{const value=raw.trim();if(value.startsWith('#'))return this.id===value.slice(1);if(value.startsWith('.'))return this.classList.contains(value.slice(1));if(value.startsWith('[')){const [,name,expected]=value.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/)||[];return name in this.attributes&&(expected===undefined||this.attributes[name]===expected);}return this.tagName.toLowerCase()===value.replace(/:not\(:disabled\)$/,'')&&(!value.includes(':not')||!this.disabled);});}
  querySelectorAll(selector){const result=[];const visit=node=>{for(const child of node.children){if(child.matches(selector))result.push(child);visit(child);}};visit(this);return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){return this.matches(selector)?this:this.parentNode?.closest(selector)||null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  getClientRects(){return this.isConnected&&!this.hidden?[{}]:[];}
  getBoundingClientRect(){return {top:0};}
  focus(){doc.activeElement=this;}
  click(){if(!this.disabled)this.fire('click');}
 }
 doc=events({visibilityState:'visible',createElement:tag=>new Element(tag),getElementById:id=>doc.body.querySelector('#'+id)});
 doc.body=new Element('body');const root=new Element('div');root.id='modalRoot';doc.body.append(root);doc.activeElement=doc.body;
 return {doc,root};
}

function fixture(entry='index.html',assistant={ask:async()=>({answer:'Stir gently.'})},overrides={}){
 const source=fs.readFileSync(new URL('../'+entry,import.meta.url),'utf8');
 const start=source.indexOf('function openCook('),end=source.indexOf('\nfunction bbHomeOccurrence(',start);
 assert.ok(start>0&&end>start,'test must execute the real Cook controller');
 const {doc,root}=documentFixture(),intervals=new Map(),pantry=[],deductions=[],notifications=[];let nextInterval=0,voiceController,readVoice;
 const recipe={id:'test-stew',name:'Vegetable stew',servings:4,mins:15,ingredients:[['Onion','2 onions'],['Carrot','300 g'],['Stock','500 ml']],method:['Chop the onion for 2 minutes.','Simmer for 3 minutes.','Serve after 1 minute.']};
 Object.assign(recipe,overrides);
 const win=events({BBCookMethod:require('../bb-cook-method.js'),document:doc,AbortController,navigator:{onLine:true},setTimeout,clearTimeout,localStorage:{getItem:()=>null},BasketBossSession:{read:()=>({user:{id:'actor-one'}})},BBHome:{needsLegacyReview:()=>false,actor:()=> 'actor-one',cooked:event=>deductions.push(event)},BBCookPantry:{mount:options=>{pantry.push(options);return {dispose(){}};}}});
 win.BBCookVoice={mount(options){readVoice=options.context;voiceController=voice.mount({...options,window:win,document:doc,assistant,tts:{}});return voiceController;}};
 const context=vm.createContext({window:win,document:doc,crypto:{randomUUID:()=> 'cook-once'},BBServing:serving,BB307_NORMALIZED:[],state:{planned:[]},bb307Market:'UK',timerHandle:null,timer:0,
  getRecipe:()=>recipe,bb176AllowedRecipe:()=>true,bbFeedingForRecipe:()=>4,bbHomeOccurrence:()=>null,bbVerifiedPremiumFeature:()=>true,bbPremiumFeatureUpgrade(){throw Error('Unexpected upgrade');},
  DETAILED_METHODS:{},kitchenEquipment:()=>['Knife','Saucepan'],kitchenPrepHint:()=> 'Prepare safely.',bbUICookStepSeconds:text=>Number(text.match(/(\d+) minutes?/)?.[1]||5)*60,
  esc:text=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),notify:text=>notifications.push(text),requestAnimationFrame:fn=>fn(),
  setInterval:fn=>{intervals.set(++nextInterval,fn);return nextInterval;},clearInterval:id=>intervals.delete(id)});
 const measureStart=source.indexOf('function bbRecipeIngredientQuantity('),measureEnd=source.indexOf('const BB307_SOURCE_RECIPES=',measureStart);
 vm.runInContext(source.slice(measureStart,measureEnd),context);
 const methodStart=source.indexOf('function kitchenMethodFor(recipe){'),methodEnd=source.indexOf('\nconst DETAILED_METHODS=',methodStart);
 vm.runInContext(source.slice(methodStart,methodEnd),context);
 vm.runInContext(source.slice(start,end)+'\nopenCook("test-stew","Monday");',context);
 const get=id=>root.querySelector('#'+id),phase=()=>root.querySelector('.cook-panel')?.dataset.phase;
 return {doc,root,get,phase,context,recipe,pantry,deductions,notifications,intervals,voice:()=>readVoice(),dispose:()=>get('bbExit')?.click(),advance:()=>get('bbNext').click(),seconds:()=>vm.runInContext('timer',context),elapse(seconds){for(let i=0;i<seconds;i++)for(const callback of [...intervals.values()])callback();},check(selector,index=0,on=true){const node=root.querySelectorAll(selector)[index];node.checked=on;node.fire('change');},key(key,target=doc.body){let prevented=false;doc.fire('keydown',{key,target,preventDefault(){prevented=true;}});return prevented;},controller:()=>voiceController};
}

for(const entry of ['index.html','app.html'])test(entry+': Prep navigation preserves progress, checks and the running timer without completing the meal',()=>{
 const h=fixture(entry);try{
  h.check('[data-prep]',0);h.check('[data-prep]',2);h.check('[data-tool]',1);
  h.get('bbuiEquipment').open=true;h.get('bbuiEquipment').fire('toggle');h.get('bbStart').click();h.advance();h.advance();
  assert.equal(h.voice().stepIndex,2);h.get('bbTimerPanel').open=true;h.get('bbTimerPanel').fire('toggle');h.get('bbTimerToggle').click();h.elapse(10);
  const remaining=h.seconds();h.get('bbPhasePrep').click();assert.equal(h.phase(),'prep');assert.equal(h.get('bbPhasePrep').getAttribute('aria-current'),'step');
  assert.deepEqual(h.root.querySelectorAll('[data-prep]').map(node=>node.checked),[true,false,true]);assert.deepEqual(h.root.querySelectorAll('[data-tool]').map(node=>node.checked),[false,true]);assert.equal(h.get('bbuiEquipment').open,true);assert.match(h.get('bbStart').textContent,/Continue cooking/);
  h.elapse(5);h.get('bbStart').click();assert.equal(h.phase(),'cook');assert.equal(h.voice().stepIndex,2);assert.equal(h.get('bbInstruction').textContent,h.recipe.method[2]);assert.equal(h.seconds(),remaining-5);assert.equal(h.get('bbTime').textContent,'0:45');assert.equal(h.get('bbTimerPanel').open,true);assert.match(h.get('bbTimerToggle').textContent,/Pause/);
  assert.equal(h.pantry.length,0);assert.equal(h.deductions.length,0);
  h.get('bbPhasePrep').click();h.get('bbPhaseCook').click();assert.equal(h.voice().stepIndex,2);assert.equal(h.pantry.length,0);
  h.advance();assert.equal(h.phase(),'done');assert.equal(h.pantry.length,1,'only explicit Finish opens pantry review');assert.equal(h.deductions.length,0,'rendering Done does not deduct stock');assert.equal(h.intervals.size,0);
  assert.equal(h.get('bbPhasePrep').disabled,true);h.get('bbPhasePrep').click();assert.equal(h.phase(),'done');
 }finally{h.dispose();}
});

test('normalized prep order reaches the screen and mentor while each timer retains its source-card duration',()=>{
 const h=fixture('app.html',undefined,{name:'Salmon',ingredients:[['Salmon','2 fillets']],method:['Sear salmon for 3 minutes and set aside. Pat salmon dry before searing for 1 minute.','Simmer for 7 minutes.']});
 try{
  h.get('bbStart').click();assert.match(h.get('bbInstruction').textContent,/^Pat salmon dry/);
  assert.equal(h.voice().mentorRecipe.steps.length,2);assert.equal(h.voice().mentorRecipe.currentStep,0);
  assert.match(h.voice().mentorRecipe.steps[0],/^Pat salmon dry/);assert.equal(h.seconds(),180,'prep reorder must not replace the source cooking timer with one minute');
  h.get('bbTimerToggle').click();h.elapse(5);assert.equal(h.seconds(),175);h.get('bbReset').click();assert.equal(h.seconds(),180);
  h.advance();assert.equal(h.seconds(),420);assert.equal(h.voice().mentorRecipe.currentStep,1);
  h.get('bbBack').click();assert.equal(h.seconds(),180);assert.equal(h.voice().mentorRecipe.currentStep,0);assert.match(h.get('bbInstruction').textContent,/^Pat salmon dry/);
  assert.equal(h.deductions.length,0);
 }finally{h.dispose();}
});

test('an unusable imported card is rejected before Cook opens rather than shifting its step indices',()=>{
 const h=fixture('app.html',undefined,{method:['***','Cook for 3 minutes.']});
 try{assert.equal(h.phase(),undefined);assert.equal(h.get('bbStart'),null);assert.equal(h.notifications.length,1);assert.match(h.notifications[0],/needs cooking instructions/);assert.equal(h.doc.body.style.overflow,undefined);assert.equal(h.intervals.size,0);assert.equal(h.pantry.length,0);}
 finally{h.dispose();}
});

test('Back, keyboard and voice can return from the first cooking step to Prep, while text editing keeps arrow keys',()=>{
 const h=fixture();try{
  h.get('bbPhaseCook').click();assert.equal(h.voice().stepIndex,0);assert.equal(h.get('bbBack').disabled,false);assert.match(h.get('bbBack').textContent,/Prep/);h.get('bbBack').click();assert.equal(h.phase(),'prep');
  h.get('bbStart').click();const input=h.root.querySelector('.bbcv-question-input');h.key('ArrowLeft',input);assert.equal(h.phase(),'cook');assert.equal(h.key('ArrowLeft'),true);assert.equal(h.phase(),'prep');
  h.get('bbPhaseCook').click();assert.equal(h.voice().previous(),true);assert.equal(h.phase(),'prep');assert.equal(h.voice().next(),false);assert.equal(h.pantry.length,0);assert.equal(h.deductions.length,0);
 }finally{h.dispose();}
});

test('a timer finishing during Prep remains stopped at zero when resuming the same step',()=>{
 const h=fixture();try{
  h.get('bbStart').click();h.advance();h.get('bbTimerToggle').click();h.elapse(178);h.get('bbPhasePrep').click();h.elapse(3);
  assert.equal(h.phase(),'prep');assert.equal(h.seconds(),0);assert.equal(h.intervals.size,0);assert.equal(h.notifications.length,1);assert.equal(h.pantry.length,0);assert.equal(h.deductions.length,0);
  h.get('bbPhaseCook').click();assert.equal(h.voice().stepIndex,1);assert.equal(h.get('bbTime').textContent,'0:00');assert.match(h.get('bbTimerToggle').textContent,/Start/);h.get('bbTimerToggle').click();assert.equal(h.seconds(),180);assert.equal(h.intervals.size,1);
 }finally{h.dispose();}
});

test('real mentor refresh cancels a pending reply when Prep or a different cooking step replaces its context',async()=>{
 const requests=[];const h=fixture('index.html',{ask(payload,options){return new Promise(resolve=>requests.push({payload,signal:options.signal,resolve}));}});
 try{
  h.get('bbStart').click();const ask=()=>{h.root.querySelector('.bbcv-question-input').value='How should I stir?';h.root.querySelector('.bbcv-question-form').fire('submit');};
  ask();await tick();assert.equal(requests.length,1);assert.equal(requests[0].signal.aborted,false);
  h.get('bbPhasePrep').click();assert.equal(requests[0].signal.aborted,true,'actual phase repaint refreshes the real mentor and aborts the old question');requests[0].resolve({answer:'STALE COOK REPLY'});await tick();assert.doesNotMatch(h.root.querySelector('.bbcv-answer').textContent,/STALE/);
  ask();await tick();assert.equal(requests[1].payload.recipe.phase,'prep');h.get('bbPhaseCook').click();assert.equal(requests[1].signal.aborted,true);requests[1].resolve({answer:'STALE PREP REPLY'});await tick();assert.doesNotMatch(h.root.querySelector('.bbcv-answer').textContent,/STALE/);
  ask();await tick();h.advance();assert.equal(requests[2].signal.aborted,true);requests[2].resolve({answer:'STALE STEP REPLY'});await tick();assert.doesNotMatch(h.root.querySelector('.bbcv-answer').textContent,/STALE/);assert.equal(h.voice().stepIndex,1);assert.equal(h.pantry.length,0);assert.equal(h.deductions.length,0);
 }finally{h.dispose();}
});
