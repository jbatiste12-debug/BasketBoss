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
  speak:async options=>{calls.push(['speak',options]);return {spoken:true};},
  prepareSpeech:async options=>{calls.push(['prepareSpeech',options]);return {speechId:'speech-'+calls.length};},
  playAudio:async options=>{calls.push(['playAudio',options]);return {spoken:true};},
  cancelSpeech:async options=>{calls.push(['cancelSpeech',options]);return {cancelled:true};}

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
 const count=h.calls.length;await assert.rejects(()=>h.api.speak('x'.repeat(4001)),{code:'BB_VOICE_TEXT'});h.setPremium(false);await h.api.speak('Next step');
 assert.equal(h.calls.length,count);await h.api.stop();await h.api.speak('265 g');assert.equal(h.calls.at(-1)[0],'stop');
});

test('native narration preserves long displayed instructions while recognised commands stay bounded',async()=>{
 const h=fixture(),results=[];await h.api.start(value=>results.push(value));
 const instruction='Read the complete recipe instruction. '.repeat(35);
 assert.ok(instruction.length>500&&instruction.length<4000);
 await h.api.speak(instruction);
 assert.equal(h.calls.at(-1)[1].text,instruction.trim(),'all instruction text reaches speech without truncation');
 await h.api.speak('x'.repeat(4000));assert.equal(h.calls.at(-1)[1].text.length,4000);
 const count=h.calls.length;
 await assert.rejects(()=>h.api.speak('x'.repeat(4001)),{code:'BB_VOICE_TEXT'});
 assert.equal(h.calls.length,count,'an oversized instruction is rejected without queueing partial speech');
 h.emit('voiceResult',{sessionId:h.id(),text:'x'.repeat(501),isFinal:true});
 h.emit('voiceResult',{sessionId:h.id(),text:'Next step',isFinal:true});
 assert.deepEqual(results,['Next step'],'long narration does not enlarge the command boundary');
});

test('native recognition errors clean up a failed start without logging audio or transcripts',async()=>{
 const h=fixture();h.setStart(async()=>{throw Object.assign(Error('Permission denied'),{code:'BB_VOICE_MICROPHONE_PERMISSION'});});
 await assert.rejects(()=>h.api.start(()=>{}),{code:'BB_VOICE_MICROPHONE_PERMISSION'});assert.equal(h.listeners.size,0);
 const native=fs.readFileSync(new URL('../ios/App/App/BasketBossCookVoicePlugin.swift',import.meta.url),'utf8');
 assert.doesNotMatch(native,/print\(|NSLog\(|UserDefaults|write\(to:/);
 assert.match(native,/configuration\.urlCache = nil/);
 assert.match(native,/configuration\.httpShouldSetCookies = false/);
 const plist=fs.readFileSync(new URL('../ios/App/App/Info.plist',import.meta.url),'utf8');
 assert.match(plist,/NSMicrophoneUsageDescription/);assert.match(plist,/NSSpeechRecognitionUsageDescription/);
});

const clip='https://basketboss.co.uk/api/tts?clip='+'a'.repeat(64);

test('stream preparation holds output in the current Premium session and passes only validated clip credentials',async()=>{
 const h=fixture();assert.deepEqual(await h.api.prepareSpeech(),{spoken:false,cancelled:true});
 await h.api.start(()=>{});const ticket=await h.api.prepareSpeech();
 assert.match(ticket.speechId,/^speech-/);
 assert.deepEqual(await h.api.playAudio({url:clip,token:'current.jwt-value',...ticket}),{spoken:true});
 assert.deepEqual(h.calls.at(-1),['playAudio',{sessionId:h.id(),speechId:ticket.speechId,url:clip,token:'current.jwt-value'}]);
 for(const url of [clip.replace('basketboss.co.uk','evil.example'),clip.replace('https:','http:'),clip+'&extra=1',clip.replace('/api/tts','/api/other'),clip+'#fragment']){
  await assert.rejects(()=>h.api.playAudio({url,token:'current-token',...ticket}),{code:'BB_VOICE_AUDIO_URL'});
 }
 await assert.rejects(()=>h.api.playAudio({url:clip,token:'Bearer token\r\nInjected: header',...ticket}),{code:'BB_VOICE_AUDIO_URL'});
});

test('recoverable AI stream failure can fall back to native speech under the same held ticket',async()=>{
 const h=fixture();await h.api.start(()=>{});const ticket=await h.api.prepareSpeech();
 h.plugin.playAudio=async()=>{throw Object.assign(Error('offline'),{code:'BB_VOICE_AI_AUDIO'});};
 await assert.rejects(()=>h.api.playAudio({url:clip,token:'token',...ticket}),{code:'BB_VOICE_AI_AUDIO'});
 assert.deepEqual(await h.api.speak('First up, grab 250 grams of gnocchi.',ticket),{spoken:true});
 assert.deepEqual(h.calls.at(-1),['speak',{sessionId:h.id(),speechId:ticket.speechId,text:'First up, grab 250 grams of gnocchi.'}]);
});

test('late prepare and stream results cannot revive Stop or replace a newer utterance',async()=>{
 const h=fixture();await h.api.start(()=>{});let release;
 h.plugin.prepareSpeech=()=>new Promise(resolve=>{release=resolve;});
 const pending=h.api.prepareSpeech();await tick();await h.api.stop();release({speechId:'old-ticket'});
 assert.deepEqual(await pending,{spoken:false,cancelled:true});assert.equal(h.calls.at(-1)[0],'cancelSpeech');
 await h.api.start(()=>{});h.plugin.prepareSpeech=async()=>({speechId:'new-ticket'});const current=await h.api.prepareSpeech();
 const count=h.calls.length;
 assert.deepEqual(await h.api.playAudio({url:clip,token:'token',speechId:'old-ticket'}),{spoken:false,cancelled:true});
 assert.deepEqual(await h.api.speak('Obsolete fallback',{speechId:'old-ticket'}),{spoken:false,cancelled:true});assert.equal(h.calls.length,count);
 h.plugin.playAudio=()=>new Promise(resolve=>{release=resolve;});
 const playing=h.api.playAudio({url:clip,token:'token',...current});await tick();await h.api.cancelSpeech(current);release({spoken:true});
 assert.deepEqual(await playing,{spoken:false,cancelled:true});
});

test('superseded stream errors do not cause an obsolete offline fallback',async()=>{
 const h=fixture();await h.api.start(()=>{});let reject;
 const old=await h.api.prepareSpeech();h.plugin.playAudio=()=>new Promise((_,fail)=>{reject=fail;});
 const playing=h.api.playAudio({url:clip,token:'token',...old});await tick();
 const next=await h.api.prepareSpeech();reject(Error('late network error'));
 assert.deepEqual(await playing,{spoken:false,cancelled:true});
 assert.deepEqual(await h.api.speak('Obsolete',{speechId:old.speechId}),{spoken:false,cancelled:true});
 await h.api.speak('New fallback',next);assert.equal(h.calls.at(-1)[1].text,'New fallback');
});

test('native streaming uses public resource loading with bounded private transport and best British fallback',()=>{
 const native=fs.readFileSync(new URL('../ios/App/App/BasketBossCookVoicePlugin.swift',import.meta.url),'utf8');
 assert.match(native,/AVAssetResourceLoaderDelegate/);assert.match(native,/URLSessionDataDelegate/);
 assert.match(native,/request\.setValue\("Bearer " \+ token, forHTTPHeaderField: "Authorization"\)/);
 assert.match(native,/didReceive data: Data/);assert.match(native,/respond\(with: data\.subdata/);
 assert.match(native,/willPerformHTTPRedirection[\s\S]*completionHandler\(nil\)/);
 assert.match(native,/case \.premium: return 3; case \.enhanced: return 2/);
 assert.match(native,/\$0\.language\.lowercased\(\) == "en-gb"/);
 assert.match(native,/guard intent, spoken == nil, !speechHeld/);
 assert.doesNotMatch(native,/AVURLAssetHTTPHeaderFieldsKey|AVURLAssetHTTPHeaderFields|token=.*clip|write\(to:|UserDefaults|print\(|NSLog\(/);
});


test('native stream access denials propagate without being downgraded to offline errors',async()=>{
 for(const code of ['BB_TTS_AUTH','BB_TTS_PREMIUM_REQUIRED','BB_TTS_DELETING']){
  const h=fixture();await h.api.start(()=>{});const ticket=await h.api.prepareSpeech();
  h.plugin.playAudio=async()=>{throw Object.assign(Error('Access denied'),{code});};
  await assert.rejects(()=>h.api.playAudio({url:clip,token:'token',...ticket}),{code});
  assert.equal(h.calls.some(call=>call[0]==='speak'),false,'the bridge must not start installed speech after a definitive denial');
 }
});

test('native HTTP denial priority survives the player-observer race',()=>{
 const source=fs.readFileSync(new URL('../ios/App/App/BasketBossCookVoicePlugin.swift',import.meta.url),'utf8');
 assert.match(source,/case 401: code = "BB_TTS_AUTH"/);
 assert.match(source,/case 403: code = "BB_TTS_PREMIUM_REQUIRED"/);
 assert.match(source,/case 409: code = "BB_TTS_DELETING"/);
 assert.match(source,/failureLock\.lock\(\); accessFailure = code; failureLock\.unlock\(\)[\s\S]*onAccessDenied\(code\)[\s\S]*finish\(job, error: true\)/);
 assert.match(source,/let reason = code \?\? audioLoader\?\.accessFailureCode \?\? "BB_VOICE_AI_AUDIO"/);
 assert.match(source,/self\.active\(id\), self\.speechId == ticket, self\.playbackCall != nil/);
});
