import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installNativeCookVoice} from '../native/cook-voice.mjs';

function fixture(){
 const listeners=new Map(),events=new Map(),calls=[],removed=[];let premium=true,startResult=async()=>({active:true});
 const document={hidden:false,addEventListener:(event,fn)=>events.set('document:'+event,fn)};
 const window={document,addEventListener:(event,fn)=>events.set(event,fn)};
 const plugin={
  available:async()=>{calls.push(['available']);return {available:true};},
  addListener:async(event,fn)=>{listeners.set(event,fn);return {remove:async()=>{removed.push(event);if(listeners.get(event)===fn)listeners.delete(event);}};},
  start:async options=>{calls.push(['start',options]);return startResult(options);},
  stop:async options=>{calls.push(['stop',options]);},
  speak:async options=>{calls.push(['speak',options]);}
 };
 const api=installNativeCookVoice({plugin,window,isPremium:()=>premium});
 return {api,window,plugin,calls,listeners,removed,emit:(event,value)=>listeners.get(event)?.(value),
  event:name=>events.get(name)?.(),setPremium:value=>{premium=value;},setStart:fn=>{startResult=fn;},
  id:()=>calls.filter(call=>call[0]==='start').at(-1)?.[1].sessionId};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('native capability checks are read-only and microphone start requires current verified Premium',async()=>{
 const h=fixture();assert.equal(h.calls.length,0);assert.equal(await h.api.available(),true);
 assert.deepEqual(h.calls,[['available']]);h.setPremium(false);
 await assert.rejects(()=>h.api.start(()=>{}),{code:'BB_VOICE_PREMIUM_REQUIRED'});
 assert.equal(h.calls.some(call=>call[0]==='start'),false);
 h.setPremium(true);h.window.document.hidden=true;
 await assert.rejects(()=>h.api.start(()=>{}),{code:'BB_VOICE_PREMIUM_REQUIRED'});
});

test('only bounded final transcripts from the active native session reach Cook',async()=>{
 const h=fixture(),results=[],statuses=[];
 await h.api.start(value=>results.push(value),value=>statuses.push(value));const sessionId=h.id();
 h.emit('voiceResult',{sessionId:'old',text:'Next step',isFinal:true});
 h.emit('voiceResult',{sessionId,text:'Next step',isFinal:false});
 h.emit('voiceResult',{sessionId,text:'x'.repeat(501),isFinal:true});
 h.emit('voiceResult',{sessionId,text:' How much cheddar? ',isFinal:true});
 h.emit('voiceStatus',{sessionId,state:'listening'});
 assert.deepEqual(results,['How much cheddar?']);assert.equal(statuses[0].state,'listening');
 await h.api.stop();h.emit('voiceResult',{sessionId,text:'Next step',isFinal:true});
 assert.equal(results.length,1);assert.equal(h.listeners.size,0);assert.deepEqual(h.removed.sort(),['voiceResult','voiceStatus']);
});

test('stopping during a pending native permission request cannot revive listening',async()=>{
 const h=fixture();let release;h.setStart(()=>new Promise(resolve=>{release=resolve;}));
 const pending=h.api.start(()=>{});await tick();const sessionId=h.id();
 await h.api.stop();release({active:true});await assert.rejects(()=>pending,{code:'BB_VOICE_STOPPED'});
 assert.ok(h.calls.some(call=>call[0]==='stop'&&call[1].sessionId===sessionId));assert.equal(h.listeners.size,0);
});

test('replacing a session rejects delayed callbacks from the previous recipe',async()=>{
 const h=fixture(),old=[],current=[];await h.api.start(value=>old.push(value));
 const previous=h.id(),callback=h.listeners.get('voiceResult');await h.api.start(value=>current.push(value));
 assert.notEqual(h.id(),previous);callback({sessionId:previous,text:'Next step',isFinal:true});
 h.emit('voiceResult',{sessionId:h.id(),text:'Next step',isFinal:true});
 assert.deepEqual(old,[]);assert.deepEqual(current,['Next step']);
});

test('Stop cancels a replacement waiting for the old native microphone to stop',async()=>{
 const h=fixture();await h.api.start(()=>{});let release;
 h.plugin.stop=options=>{h.calls.push(['stop',options]);return new Promise(resolve=>{release=resolve;});};
 const replacement=h.api.start(()=>{});await tick();assert.equal(typeof release,'function');
 await h.api.stop();
 const rejected=assert.rejects(()=>replacement,{code:'BB_VOICE_STOPPED'});release();await rejected;
 assert.equal(h.calls.filter(call=>call[0]==='start').length,1,'replacement must not reopen the microphone after Stop');
 assert.equal(h.listeners.size,0);
});

test('a later start wins while an obsolete replacement is waiting for microphone cleanup',async()=>{
 const h=fixture(),results=[];await h.api.start(()=>{});let release;
 h.plugin.stop=options=>{h.calls.push(['stop',options]);return new Promise(resolve=>{release=resolve;});};
 const obsolete=h.api.start(()=>results.push('obsolete'));await tick();
 await h.api.start(()=>results.push('current'));const currentId=h.id();
 const rejected=assert.rejects(()=>obsolete,{code:'BB_VOICE_STOPPED'});release();await rejected;
 h.emit('voiceResult',{sessionId:currentId,text:'Next step',isFinal:true});
 assert.equal(h.calls.filter(call=>call[0]==='start').length,2);assert.deepEqual(results,['current']);
});

test('backgrounding, navigation and entitlement loss release native listeners and recording',async()=>{
 for(const event of ['document:visibilitychange','pagehide','basketboss:session-changed']){
  const h=fixture();await h.api.start(()=>{});const id=h.id();
  if(event==='document:visibilitychange')h.window.document.hidden=true;
  if(event==='basketboss:session-changed')h.setPremium(false);
  h.event(event);await tick();
  assert.ok(h.calls.some(call=>call[0]==='stop'&&call[1].sessionId===id),event);assert.equal(h.listeners.size,0,event);
 }
});

test('speech responses stay within the active Premium Cook session',async()=>{
 const h=fixture();await h.api.speak('265 g');assert.equal(h.calls.length,0);
 await h.api.start(()=>{});await h.api.speak('265 g');
 assert.deepEqual(h.calls.at(-1),['speak',{sessionId:h.id(),text:'265 g'}]);
 const count=h.calls.length;await h.api.speak('x'.repeat(501));h.setPremium(false);await h.api.speak('Next step');
 assert.equal(h.calls.length,count);await h.api.stop();await h.api.speak('265 g');assert.equal(h.calls.at(-1)[0],'stop');
});

test('native recognition errors clean up a failed start without logging audio or transcripts',async()=>{
 const h=fixture();h.setStart(async()=>{throw Object.assign(Error('Permission denied'),{code:'BB_VOICE_MICROPHONE_PERMISSION'});});
 await assert.rejects(()=>h.api.start(()=>{}),{code:'BB_VOICE_MICROPHONE_PERMISSION'});assert.equal(h.listeners.size,0);
 const native=fs.readFileSync(new URL('../ios/App/App/BasketBossCookVoicePlugin.swift',import.meta.url),'utf8');
 assert.doesNotMatch(native,/print\(|NSLog\(|UserDefaults|URLSession|write\(to:/);
 const plist=fs.readFileSync(new URL('../ios/App/App/Info.plist',import.meta.url),'utf8');
 assert.match(plist,/NSMicrophoneUsageDescription/);assert.match(plist,/NSSpeechRecognitionUsageDescription/);
});
