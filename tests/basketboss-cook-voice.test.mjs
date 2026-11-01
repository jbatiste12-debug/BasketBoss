import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const voice=createRequire(import.meta.url)('../bb-cook-voice.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({premium=true,browser=false,available=true,nativeStartError=null,synthesis=false}={}){
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
 const instances=[],utterances=[];
 if(synthesis){host.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};host.speechSynthesis={cancel:()=>calls.push('cancelSpeech'),speak:utterance=>{utterances.push(utterance);calls.push(['speak',utterance.text]);}};}
 if(browser){
  if(available)host.SpeechRecognition=class{
   constructor(){instances.push(this);calls.push('construct');}
   start(){calls.push('start');this.onstart?.();}
   abort(){calls.push('abort');this.onend?.();}
  };
 }else{
  host.BBNativeCookVoice={available:async()=>{calls.push('available');return available;},start:async(onFinal,onStatus)=>{calls.push('start');if(nativeStartError)throw Object.assign(Error('provider-message-not-for-ui'),{code:nativeStartError});final=onFinal;status=onStatus;status({state:'listening'});},stop:async()=>{calls.push('stop');},speak:async text=>{calls.push(['speak',text]);status?.({state:'paused'});status?.({state:'listening'});}};
 }
 const controller=voice.mount({container,context:()=>context,window:host,document:doc});
 const find=name=>{let result;const visit=node=>{if(node.className.split(' ').includes(name))result=node;for(const child of node.children)visit(child);};visit(container);return result;};
 return {host,doc,container,context,calls,timers,controller,instances,utterances,find,button:()=>find('bbcv-toggle'),status:()=>find('bbcv-status').textContent,transcript:text=>final?.(text),nativeStatus:value=>status?.(value),runTimers(){const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();}};
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

test('ingredient queries normalize known food plurals symmetrically without loose substring matches',()=>{
 for(const [single,plural]of [['Onion','onions'],['Carrot','carrots'],['Potato','potatoes'],['Tomato','tomatoes'],['Chickpea','chickpeas']]){
  assert.equal(voice.ingredientAnswer([{name:single,quantity:'2'}],plural).ok,true,plural);
  assert.equal(voice.ingredientAnswer([{name:plural,quantity:'2'}],single).ok,true,single);
 }
 assert.equal(voice.ingredientAnswer([{name:'Chicken breast',quantity:'665 g'}],'chickpeas').ok,false);
 assert.equal(voice.ingredientAnswer([{name:'Onion',quantity:'1'},{name:'Onions',quantity:'2'}],'onions').ok,false,'ambiguous declarations still require a full name');
});

test('guided commands distinguish prep progression, repeat and starting the actual Cook view',()=>{
 assert.deepEqual(voice.parseCommand('next ingredient'),{type:'nextIngredient'});
 for(const phrase of ['Ready','Ready please','Please ready'])assert.deepEqual(voice.parseCommand(phrase),{type:'nextIngredient'});
 assert.deepEqual(voice.parseCommand('Please start cooking'),{type:'startCooking'});
 for(const phrase of ['repeat','repeat ingredient','repeat step','read this step','say that again'])assert.deepEqual(voice.parseCommand(phrase),{type:'repeat'},phrase);
 for(const phrase of ['onions','I already have the onions','cooking starts soon'])assert.equal(voice.parseCommand(phrase),null,phrase);
});

test('Prep narration starts only after opt-in and checks ingredients only after an explicit next command',async()=>{
 const h=fixture();h.context.phase='prep';h.context.ingredientIndex=0;h.context.ingredients=[{name:'Onion',quantity:'2 onions'},{name:'Cheddar',quantity:'265 g'}];
 const checked=[];h.context.prepareNext=()=>{checked.push(h.context.ingredientIndex);h.context.ingredientIndex++;h.controller.refresh();return true;};
 h.controller.refresh();assert.equal(h.find('bb-cook-voice').hidden,false);assert.deepEqual(h.calls,[]);assert.deepEqual(checked,[]);
 h.button().click();await tick();const spoken=()=>h.calls.filter(call=>Array.isArray(call)&&call[0]==='speak').map(call=>call[1]);
 assert.equal(spoken().length,1);assert.match(spoken()[0],/Onion: 2 onions/);assert.match(spoken()[0],/next ingredient/);assert.deepEqual(checked,[]);
 h.transcript('onions');await tick();assert.equal(spoken().at(-1),'Onion: 2 onions.');assert.deepEqual(checked,[],'asking about stock does not mark an ingredient ready');
 h.transcript('How many onions?');await tick();assert.equal(spoken().at(-1),'Onion: 2 onions.');assert.deepEqual(checked,[]);
 h.transcript('Next ingredient');await tick();assert.deepEqual(checked,[0]);assert.match(spoken().at(-1),/Cheddar: 265 g/);
 const before=spoken().length;h.controller.refresh();h.controller.refresh();assert.equal(spoken().length,before,'an unrelated repaint does not repeat the ingredient');
 h.transcript('Repeat ingredient');await tick();assert.match(spoken().at(-1),/Cheddar: 265 g/);assert.deepEqual(checked,[0]);
 h.controller.dispose();
});

test('one listening session follows Prep into real instructions and narrates changed steps once',async()=>{
 const h=fixture(),steps=['Heat the pan. Add 10 ml oil and the sliced onion.','Add 265 g cheddar, then stir until melted.'];
 h.context.phase='prep';h.context.ingredientIndex=0;
 h.context.startCooking=()=>{h.calls.push('startCooking');h.context.phase='cook';h.context.stepIndex=0;h.context.stepCount=steps.length;h.context.currentStep=steps[0];h.controller.refresh();return true;};
 h.context.next=()=>{h.calls.push('next');h.context.stepIndex++;h.context.currentStep=steps[h.context.stepIndex];h.controller.refresh();return true;};
 h.context.previous=()=>{h.calls.push('previous');h.context.stepIndex--;h.context.currentStep=steps[h.context.stepIndex];h.controller.refresh();return true;};
 const spoken=()=>h.calls.filter(call=>Array.isArray(call)&&call[0]==='speak').map(call=>call[1]);
 h.button().click();await tick();h.transcript('Start cooking');await tick();
 assert.equal(h.calls.filter(call=>call==='start').length,1,'moving phases keeps the explicitly opened session');assert.match(spoken().at(-1),/Step 1 of 2/);assert.ok(spoken().at(-1).includes(steps[0]));
 let before=spoken().length;h.controller.refresh();assert.equal(spoken().length,before);
 h.transcript('Next step');await tick();assert.equal(spoken().length,before+1);assert.ok(spoken().at(-1).includes(steps[1]));assert.notEqual(spoken().at(-1),'Next step.');
 h.transcript('Previous step');await tick();assert.ok(spoken().at(-1).includes(steps[0]));
 h.transcript('Repeat step');await tick();assert.ok(spoken().at(-1).includes(steps[0]));
 before=spoken().length;h.context.stepIndex=1;h.context.currentStep=steps[1];h.controller.refresh();assert.equal(spoken().length,before+1,'a manual step change reads its actual instruction');h.controller.refresh();assert.equal(spoken().length,before+1);
 h.context.active=false;h.context.phase='done';h.controller.refresh();h.transcript('Next step');await tick();assert.equal(h.button().getAttribute('aria-pressed'),'false');h.controller.dispose();
});

test('full instructions have a length-based reading window and no silent text truncation',async()=>{
 const step=Array.from({length:100},()=> 'Stir gently, keeping the pan over a low heat.').join(' ');
 assert.ok(voice.speechTimeoutMs(step)>15000);assert.ok(voice.speechTimeoutMs(step)<=360000);
 const tooLong=voice.narrationFor({phase:'cook',stepIndex:1,stepCount:3,currentStep:step});assert.equal(tooLong.text,null);assert.match(tooLong.status,/complete step on screen/);
 const full='Add 265 g cheddar. '+Array.from({length:35},()=> 'Stir gently until the sauce is smooth.').join(' ');
 const h=fixture({browser:true,synthesis:true});h.context.phase='cook';h.context.stepIndex=0;h.context.stepCount=2;h.context.currentStep=full;
 const uk={lang:'en-GB',name:'Kate (Enhanced)',localService:true},other={lang:'en-US',name:'Other',localService:true};h.host.speechSynthesis.getVoices=()=>[other,uk];
 h.button().click();await tick();assert.equal(h.utterances.length,1);assert.ok(h.utterances[0].text.includes(full));assert.equal(h.utterances[0].voice,uk);assert.equal(h.utterances[0].rate,1);assert.equal(h.utterances[0].pitch,1);assert.equal(h.utterances[0].lang,'en-GB');
 assert.match(h.status(),/Reading step 1 of 2/);assert.ok(h.status().length<100,'spoken instructions do not expand the compact control');h.controller.dispose();
});

test('natural British voice quality wins over a compact local default or familiar name',async()=>{
 const compact={lang:'en-GB',name:'Kate',localService:true,default:true};
 const enhanced={lang:'en-GB',name:'Daniel (Enhanced)',localService:true};
 const natural={lang:'en-GB',name:'English UK (Natural)',localService:false};
 const premium={lang:'en-GB',name:'Serena (Premium)',localService:true};
 const otherLanguage={lang:'en-US',name:'Premium',localService:true};
 for(const [offered,expected]of[
  [[compact,enhanced,otherLanguage],enhanced],
  [[compact,natural,otherLanguage],natural],
  [[compact,enhanced,premium,otherLanguage],premium]
 ]){
  const h=fixture({browser:true,synthesis:true});
  h.context.phase='cook';h.context.stepIndex=0;h.context.currentStep='Stir gently until smooth.';
  h.host.speechSynthesis.getVoices=()=>offered;
  h.button().click();await tick();
  assert.equal(h.utterances[0].voice,expected,'prefer the best available natural British voice');
  assert.equal(h.utterances[0].rate,1,'use a normal speaking pace');
  assert.equal(h.utterances[0].pitch,1,'preserve the real voice pitch');
  assert.ok(h.utterances[0].text.includes(h.context.currentStep),'recipe wording is preserved');
  h.controller.dispose();
 }
});

test('voice selection safely falls back to the platform when no British voice is listed yet',async()=>{
 const h=fixture({browser:true,synthesis:true});
 h.context.phase='cook';h.context.stepIndex=0;h.context.currentStep='Add the sliced onion.';
 h.host.speechSynthesis.getVoices=()=>[];
 h.button().click();await tick();assert.equal(h.utterances[0].voice,undefined);assert.equal(h.utterances[0].lang,'en-GB');
 h.controller.dispose();
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

test('native start failures show fixed permission or recovery instructions and never restart automatically',async()=>{
 const cases=[
  ['BB_VOICE_SPEECH_PERMISSION',/Settings.*Speech Recognition/],
  ['BB_VOICE_MICROPHONE_PERMISSION',/Microphone.*Settings/],
  ['BB_VOICE_MICROPHONE_UNAVAILABLE',/microphone could not start/],
  ['BB_VOICE_UNAVAILABLE',/Speech recognition is unavailable/],
  ['BB_VOICE_INTERRUPTED',/Voice was interrupted/],
  ['BB_VOICE_RECOGNITION',/Speech recognition stopped/],
  ['BB_VOICE_AUDIO',/Voice audio could not start/],
  ['BB_VOICE_STOPPED',/Voice is off/]
 ];
 for(const [code,message]of cases){
  const h=fixture({nativeStartError:code});h.button().click();await tick();
  assert.match(h.status(),message,code);assert.doesNotMatch(h.status(),/provider-message-not-for-ui/);
  assert.equal(h.button().getAttribute('aria-pressed'),'false',code);assert.equal(h.find('bbcv-label').textContent,'Turn on voice',code);assert.equal(h.button().disabled,false,code);
  h.runTimers();await tick();assert.equal(h.calls.filter(call=>call==='start').length,1,code+' must require another explicit tap');
  h.controller.dispose();
 }
});

test('a late old utterance cannot clear the new utterance watchdog, resume recognition or accept commands during speech',async()=>{
 const h=fixture({browser:true,synthesis:true});
 const result=text=>{const value=[{transcript:text}];value.isFinal=true;return value;};
 h.button().click();await tick();h.instances[0].onresult({resultIndex:0,results:[result('How much cheddar?')]});
 const oldUtterance=h.utterances[0],oldWatchdog=[...h.timers.values()][0];assert.ok(oldWatchdog);
 h.button().click();h.button().click();await tick();
 const recognition=h.instances[1];recognition.onresult({resultIndex:0,results:[result('How much chicken breast?')]});
 const currentUtterance=h.utterances[1],currentTimers=[...h.timers.entries()];assert.equal(currentTimers.length,1);
 const cancelCount=h.calls.filter(call=>call==='cancelSpeech').length;
 oldUtterance.onend();oldUtterance.onerror();oldWatchdog();
 assert.deepEqual([...h.timers.entries()],currentTimers,'old completion keeps the new utterance watchdog');
 assert.equal(h.calls.filter(call=>call==='cancelSpeech').length,cancelCount,'old watchdog cannot cancel the new response');
 assert.equal(h.instances.length,2,'old completion cannot restart recognition');
 recognition.onresult({resultIndex:1,results:[result('How much chicken breast?'),result('Next step')]});
 assert.equal(h.calls.filter(call=>call==='next').length,0,'the new response still owns speaking state');
 currentUtterance.onend();assert.equal(h.timers.size,0);assert.equal(h.instances.length,3,'only the current response may resume recognition');
 h.instances[2].onresult({resultIndex:0,results:[result('Next step')]});assert.equal(h.calls.filter(call=>call==='next').length,1);
 h.controller.dispose();
});

test('an old browser recognizer cannot control or interrupt the replacement after spoken feedback',async()=>{
 const h=fixture({browser:true,synthesis:true});
 const result=text=>{const value=[{transcript:text}];value.isFinal=true;return value;};
 h.button().click();await tick();const old=h.instances[0];
 old.onresult({resultIndex:0,results:[result('How much cheddar?')]});h.utterances[0].onend();
 const current=h.instances[1];assert.ok(current);assert.equal(h.button().getAttribute('aria-pressed'),'true');
 current.onerror({error:'no-speech'});const status=h.status();
 old.onstart();assert.equal(h.status(),status,'old start cannot replace the current status');
 old.onresult({resultIndex:1,results:[result('How much cheddar?'),result('Next step')]});
 assert.equal(h.calls.filter(call=>call==='next').length,0,'old final result cannot advance the recipe');
 old.onerror({error:'audio-capture'});assert.equal(h.status(),status,'old error cannot stop the current recognizer');
 old.onend();assert.equal(h.timers.size,0,'old end cannot schedule an additional recognizer');
 assert.equal(h.instances.length,2);assert.equal(h.button().getAttribute('aria-pressed'),'true');
 current.onresult({resultIndex:0,results:[result('Next step')]});assert.equal(h.calls.filter(call=>call==='next').length,1,'the current recognizer retains ownership');
 h.controller.dispose();
});
