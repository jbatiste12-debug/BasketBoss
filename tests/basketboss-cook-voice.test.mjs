import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const voice=createRequire(import.meta.url)('../bb-cook-voice.js');
const speechText=createRequire(import.meta.url)('../bb-cook-speech-text.js');
const assertInstruction=(spoken,original)=>{
 const expected=speechText.plain(original).toLowerCase();
 assert.ok(spoken.toLowerCase().includes(expected),'the entire instruction is read, with spoken units');
 assert.deepEqual(expected.match(/\d+(?:\.\d+)?/g)||[],original.match(/\d+(?:\.\d+)?/g)||[],'all instruction quantities remain unchanged');
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({premium=true,browser=false,available=true,nativeStartError=null,synthesis=false,nativeAI=false,tts=null,actorId=null}={}){
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
 const sessionData={user:{id:actorId},access_token:'current-test-token'};if(actorId)host.BasketBossSession={read:()=>sessionData};
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
  host.BBNativeCookVoice={available:async()=>{calls.push('available');return available;},start:async(onFinal,onStatus)=>{calls.push('start');if(nativeStartError)throw Object.assign(Error('provider-message-not-for-ui'),{code:nativeStartError});final=onFinal;status=onStatus;status({state:'listening'});},stop:async()=>{calls.push('stop');},speak:async(text,options)=>{calls.push(options?['speak',text,options]:['speak',text]);status?.({state:'paused'});status?.({state:'listening'});}};
 }
 if(nativeAI){let speechId=0;Object.assign(host.BBNativeCookVoice,{
  prepareSpeech:async()=>{const id='speech-'+(++speechId);calls.push(['prepareSpeech',id]);status?.({state:'paused'});return {speechId:id};},
  playAudio:async clip=>{calls.push(['playAudio',clip]);status?.({state:'listening'});return {spoken:true};},
  cancelSpeech:async value=>{calls.push(['cancelNativeSpeech',value]);}
 });}
 const controller=voice.mount({container,context:()=>context,window:host,document:doc,tts});
 const find=name=>{let result;const visit=node=>{if(node.className.split(' ').includes(name))result=node;for(const child of node.children)visit(child);};visit(container);return result;};
 return {host,doc,container,context,calls,timers,controller,sessionData,instances,utterances,find,button:()=>find('bbcv-toggle'),status:()=>find('bbcv-status').textContent,transcript:text=>final?.(text),nativeStatus:value=>status?.(value),runTimers(){const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();}};
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
 assert.equal(voice.ingredientAnswer(ingredients,'cheddar').message,'You’ll need 265 grams of cheddar.');
 assert.equal(voice.ingredientAnswer(ingredients,'egg').message,'You’ll need 2 eggs.');
 assert.equal(voice.ingredientAnswer(ingredients,'chard').ok,false);
 assert.equal(voice.ingredientAnswer([...ingredients,{name:'Parmesan',quantity:'30 g'}],'cheese').ok,false);
 assert.equal(voice.ingredientAnswer([{name:'Salt',quantity:'to taste'}],'salt').message,'You’ll need salt, to taste.');
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
 assert.equal(spoken().length,1);assert.match(spoken()[0],/grab 2 onions/);assert.match(spoken()[0],/next ingredient/);assert.deepEqual(checked,[]);
 h.transcript('onions');await tick();assert.equal(spoken().at(-1),'You’ll need 2 onions.');assert.deepEqual(checked,[],'asking about stock does not mark an ingredient ready');
 h.transcript('How many onions?');await tick();assert.equal(spoken().at(-1),'You’ll need 2 onions.');assert.deepEqual(checked,[]);
 h.transcript('Next ingredient');await tick();assert.deepEqual(checked,[0]);assert.match(spoken().at(-1),/265 grams of cheddar/);
 const before=spoken().length;h.controller.refresh();h.controller.refresh();assert.equal(spoken().length,before,'an unrelated repaint does not repeat the ingredient');
 h.transcript('Repeat ingredient');await tick();assert.match(spoken().at(-1),/265 grams of cheddar/);assert.deepEqual(checked,[0]);
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
 assert.equal(h.calls.filter(call=>call==='start').length,1,'moving phases keeps the explicitly opened session');assert.match(spoken().at(-1),/Step 1 of 2/);assertInstruction(spoken().at(-1),steps[0]);
 let before=spoken().length;h.controller.refresh();assert.equal(spoken().length,before);
 h.transcript('Next step');await tick();assert.equal(spoken().length,before+1);assertInstruction(spoken().at(-1),steps[1]);assert.notEqual(spoken().at(-1),'Next step.');
 h.transcript('Previous step');await tick();assertInstruction(spoken().at(-1),steps[0]);
 h.transcript('Repeat step');await tick();assertInstruction(spoken().at(-1),steps[0]);
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
 h.button().click();await tick();assert.equal(h.utterances.length,1);assertInstruction(h.utterances[0].text,full);assert.equal(h.utterances[0].voice,uk);assert.equal(h.utterances[0].rate,1);assert.equal(h.utterances[0].pitch,1);assert.equal(h.utterances[0].lang,'en-GB');
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
  assertInstruction(h.utterances[0].text,h.context.currentStep);
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
 h.transcript('How much cheddar?');await tick();assert.ok(h.calls.some(x=>Array.isArray(x)&&x[1]==='You’ll need 265 grams of cheddar.'));
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


const deferredSpeech=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const clip={url:'https://basketboss.co.uk/api/tts?clip='+'a'.repeat(64),token:'test-token'};
test('native AI holds recognition through preparation and streams only the natural recipe response',async()=>{
 const ready=deferredSpeech(),prompts=[];
 const h=fixture({nativeAI:true,actorId:'account-a',tts:{prepare:(text,options)=>{prompts.push({text,options});return ready.promise;}}});
 h.context.phase='prep';h.context.ingredientIndex=0;h.button().click();await tick();
 assert.equal(prompts.length,1);assert.match(prompts[0].text,/First up, grab 265 grams of cheddar/);
 assert.equal(h.calls.some(call=>Array.isArray(call)&&call[0]==='speak'),false);
 h.transcript('Next step');assert.equal(h.calls.includes('next'),false,'the AI fetch keeps the microphone command gate paused');
 ready.resolve(clip);await tick();
 const played=h.calls.find(call=>Array.isArray(call)&&call[0]==='playAudio');assert.equal(played[1].speechId,'speech-1');assert.equal(played[1].token,'test-token');
 assert.equal(h.calls.some(call=>Array.isArray(call)&&call[0]==='speak'),false);assert.equal(h.button().getAttribute('aria-pressed'),'true');h.controller.dispose();
});
test('temporary AI errors use the full installed voice fallback with the same held speech ticket',async()=>{
 for(const code of ['BB_TTS_OFFLINE','BB_TTS_UNAVAILABLE','BB_TTS_TIMEOUT','BB_TTS_TEXT']){
  const h=fixture({nativeAI:true,tts:{prepare:async()=>{throw Object.assign(Error(code),{code});}}});
  h.context.phase='cook';h.context.currentStep='Cook for 10 min, until the chicken reaches 75°C.';h.context.stepIndex=0;
  h.button().click();await tick();
  const fallback=h.calls.find(call=>Array.isArray(call)&&call[0]==='speak');assert.ok(fallback,code);assert.match(fallback[1],/10 minutes/);assert.match(fallback[1],/75 degrees Celsius/);assert.equal(fallback[2].speechId,'speech-1');
  assert.equal(h.button().getAttribute('aria-pressed'),'true');h.controller.dispose();
 }
});
test('confirmed auth, membership and deletion rejections stop voice without a paid offline fallback',async()=>{
 for(const code of ['BB_TTS_AUTH','BB_TTS_PREMIUM_REQUIRED','BB_TTS_DELETING']){
  const h=fixture({nativeAI:true,tts:{prepare:async()=>{throw Object.assign(Error(code),{code});}}});h.context.phase='prep';h.button().click();await tick();
  assert.equal(h.calls.some(call=>Array.isArray(call)&&['speak','playAudio'].includes(call[0])),false,code);assert.equal(h.button().getAttribute('aria-pressed'),'false');h.controller.dispose();
 }
});
test('Stop, leaving Cook, account switching and a superseding step discard pending AI and never speak stale audio',async()=>{
 for(const action of ['stop','hide','account','dispose','step']){
  const ready=deferredSpeech(),requests=[];
  const h=fixture({nativeAI:true,actorId:'account-a',tts:{prepare:(text,options)=>{requests.push({text,options});return requests.length===1?ready.promise:Promise.reject(Error('offline'));}}});
  h.context.phase='cook';h.context.stepIndex=0;h.context.currentStep='Add 250 g gnocchi.';h.button().click();await tick();assert.equal(requests.length,1);
  if(action==='stop')h.button().click();
  if(action==='hide'){h.doc.visibilityState='hidden';h.doc.fire('visibilitychange');}
  if(action==='account'){h.sessionData.user.id='account-b';h.host.fire('basketboss:session-changed');}
  if(action==='dispose')h.controller.dispose();
  if(action==='step'){h.context.stepIndex=1;h.context.currentStep='Add 100 ml water.';h.controller.refresh();await tick();}
  assert.equal(requests[0].options.signal.aborted,true,action);ready.resolve(clip);await tick();
  assert.equal(h.calls.some(call=>Array.isArray(call)&&call[0]==='playAudio'),false,action);
  const fallbacks=h.calls.filter(call=>Array.isArray(call)&&call[0]==='speak');
  if(action==='step'){assert.equal(fallbacks.length,1);assert.match(fallbacks[0][1],/100 millilitres/);assert.doesNotMatch(fallbacks[0][1],/250 grams/);}else assert.equal(fallbacks.length,0,action);
  h.controller.dispose();
 }
});
test('same-account token rotation can complete AI preparation without stopping the Cook voice session',async()=>{
 const ready=deferredSpeech(),h=fixture({nativeAI:true,actorId:'account-a',tts:{prepare:()=>ready.promise}});
 h.context.phase='prep';h.button().click();await tick();h.sessionData.access_token='renewed-test-token';h.host.fire('basketboss:session-changed');
 assert.equal(h.button().getAttribute('aria-pressed'),'true');ready.resolve(clip);await tick();assert.ok(h.calls.some(call=>Array.isArray(call)&&call[0]==='playAudio'));h.controller.dispose();
});
test('browser AI pauses recognition until playback ends and ignores commands during audio preparation',async()=>{
 const played=deferredSpeech(),requests=[],h=fixture({browser:true,synthesis:true,tts:{play:(text,options)=>{requests.push({text,options});return played.promise;}}});
 h.context.phase='cook';h.context.currentStep='Add 100 ml water.';h.context.stepIndex=0;h.button().click();await tick();
 assert.equal(requests.length,1);assert.match(requests[0].text,/100 millilitres/);assert.equal(h.utterances.length,0);assert.equal(h.instances.length,1);
 const result=[{transcript:'Next step'}];result.isFinal=true;h.instances[0].onresult({resultIndex:0,results:[result]});assert.equal(h.calls.includes('next'),false);
 played.resolve({played:true});await tick();assert.equal(h.instances.length,2);assert.equal(h.utterances.length,0);h.controller.dispose();
});
test('browser temporary AI failure falls back to its best British voice and cancellation never queues fallback',async()=>{
 const h=fixture({browser:true,synthesis:true,tts:{play:async()=>{throw Error('offline');}}});h.context.phase='prep';h.button().click();await tick();assert.equal(h.utterances.length,1);assert.match(h.utterances[0].text,/grams of cheddar/);h.controller.dispose();
 const waiting=deferredSpeech(),cancelled=fixture({browser:true,synthesis:true,tts:{play:()=>waiting.promise}});cancelled.context.phase='prep';cancelled.button().click();await tick();cancelled.button().click();waiting.reject(Error('late failure'));await tick();assert.equal(cancelled.utterances.length,0);assert.equal(cancelled.button().getAttribute('aria-pressed'),'false');cancelled.controller.dispose();
});
