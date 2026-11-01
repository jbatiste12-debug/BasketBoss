/* Optional Premium Cook commands. The recipe controller supplies quantities and
 * actions; speech never creates recipes, timers or subscription permissions. */
(function(root,factory){
 'use strict';
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBCookVoice=api;
})(typeof window==='undefined'?null:window,function(root){
 'use strict';
 const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
 function parseCommand(value){
  const text=normalize(value).replace(/^please /,'').replace(/ please$/,'');
  if(/^(?:next(?: step)?|go to (?:the )?next step)$/.test(text))return {type:'next'};
  if(/^(?:previous(?: step)?|back(?: one step| a step| step)?|go (?:back|to (?:the )?previous step))$/.test(text))return {type:'previous'};
  if(/^start (?:the )?timer$/.test(text))return {type:'timer'};
  const match=text.match(/^(?:how much|how many|what quantity of|what is the amount of) (.+?)(?: do i need| is needed)?$/);
  if(match)return {type:'quantity',name:match[1].replace(/^the /,'')};
  return null;
 }
 function ingredientAnswer(ingredients,query){
  const key=normalize(query).replace(/^the /,'');
  if(!key||!Array.isArray(ingredients))return {ok:false,message:'Ask for an ingredient in this recipe.'};
  const found=ingredients.filter(item=>{
   if(!item||typeof item.name!=='string'||typeof item.quantity!=='string')return false;
   const name=normalize(item.name),aliases=[name,...(Array.isArray(item.aliases)?item.aliases.map(normalize):[])];
   if(/^(?:cheddar|mozzarella|parmesan|feta|halloumi|ricotta)(?: cheese)?$/.test(name))aliases.push('cheese',name.replace(/ cheese$/,''));
   if(name.endsWith('s')&&!name.endsWith('ss'))aliases.push(name.slice(0,-1));
   return aliases.includes(key);
  });
  if(found.length>1)return {ok:false,message:'More than one ingredient matches. Say its full name.'};
  if(!found.length)return {ok:false,message:'I could not find that ingredient. Say its name from the recipe.'};
  const item=found[0],name=item.name.trim().slice(0,180),quantity=item.quantity.trim().slice(0,180);
  return quantity?{ok:true,message:name+': '+quantity+'.',ingredient:item}:{ok:false,message:'Check the recipe for that ingredient’s amount.'};
 }
 const errorMessages={
  'not-allowed':'Microphone access was not allowed. Check your device permissions, then try again.',
  'service-not-allowed':'Speech recognition is not available with these device permissions.',
  'audio-capture':'The microphone could not be opened. Check access and try again.',
  network:'Speech recognition could not connect. Check your connection and try again.',
  'language-not-supported':'Speech recognition is not available for this language on your device.',
  denied:'Microphone or speech access was not allowed. Check your device permissions, then try again.',
  restricted:'Speech recognition is restricted on this device.',
  unavailable:'Voice recognition is not available on this device.',
  BB_VOICE_SPEECH_PERMISSION:'Speech Recognition access is off. Enable BasketBoss in iPhone Settings → Privacy & Security → Speech Recognition, then tap Turn on voice.',
  BB_VOICE_MICROPHONE_PERMISSION:'Microphone access is off. Enable Microphone for BasketBoss in iPhone Settings, then tap Turn on voice.',
  BB_VOICE_MICROPHONE_UNAVAILABLE:'The microphone could not start. Check microphone access and other apps using audio, then tap Turn on voice.',
  BB_VOICE_UNAVAILABLE:'Speech recognition is unavailable on this device right now. Check your connection, then tap Turn on voice to try again.',
  BB_VOICE_INTERRUPTED:'Voice was interrupted. Tap Turn on voice when you are ready to continue.',
  BB_VOICE_RECOGNITION:'Speech recognition stopped. Tap Turn on voice to try again.',
  BB_VOICE_AUDIO:'Voice audio could not start. Check your device audio, then tap Turn on voice to try again.',
  BB_VOICE_STOPPED:'Voice is off. Tap Turn on voice to listen again.',
  BB_VOICE_PREMIUM_REQUIRED:'Verified Premium access is required for Voice Cook. Check your account, then reopen Cook.',
  BB_VOICE_SESSION:'Reopen Cook before starting a new voice session.'
 };
 function mount(options={}){
  const host=options.window||root,doc=options.document||host?.document,container=options.container;
  if(!doc||!container||typeof options.context!=='function')return null;
  const create=(tag,className,text)=>{const node=doc.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const holder=create('section','bb-cook-voice'),row=create('div','bbcv-row'),button=create('button','bbcv-toggle'),label=create('span','bbcv-label','Voice Cook');
  button.type='button';button.setAttribute('aria-pressed','false');
  const icon=create('span','bbcv-icon');icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" stroke-linecap="round"/></svg>';
  button.append(icon,label);
  const status=create('p','bbcv-status',''),help=create('p','bbcv-help','Say “Next step”, “Previous step”, “Start timer” or “How much cheddar?”');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');row.append(button,status);holder.append(row,help);container.append(holder);
  let disposed=false,wanted=false,listening=false,starting=false,speaking=false,epoch=0,speechGeneration=0,instance=null,backend=null,available=null,currentKey=null,lastHandled=null,restartTimer=null,speechTimer=null;
  const native=()=>host.BBNativeCookVoice;
  const Speech=()=>host.SpeechRecognition||host.webkitSpeechRecognition;
  function read(){try{return options.context()||{};}catch(_){return {};}}
  const allowed=()=>{const value=read();return !disposed&&value.active===true&&value.premium===true&&doc.visibilityState!=='hidden'&&container.isConnected!==false;};
  const message=text=>{status.textContent=text;};
  function render(){
   const context=read();holder.hidden=context.active!==true;
   button.setAttribute('aria-pressed',String(wanted));holder.classList.toggle('is-listening',wanted&&listening);holder.classList.toggle('is-premium-locked',context.premium!==true);
   label.textContent=context.premium!==true?'Voice Cook · Premium':starting?'Starting microphone…':wanted?'Stop listening':available===false?'Voice unavailable':'Turn on voice';
   button.disabled=context.premium===true&&(starting||available===false);
   help.textContent=context.premium===true?'Say “Next step”, “Previous step”, “Start timer” or “How much cheddar?”':'Premium voice controls for steps, timers and ingredient amounts.';
  }
  async function capability(){
   if(native()){
    backend='native';try{available=await native().available()===true;}catch(_){available=false;}
   }else{backend='browser';available=typeof Speech()==='function';}
   if(!disposed){if(available===false)message('Voice recognition is not available on this device.');render();}
   return available;
  }
  function clearTimers(){if(restartTimer!==null)host.clearTimeout(restartTimer);if(speechTimer!==null)host.clearTimeout(speechTimer);restartTimer=speechTimer=null;}
  function stop(reason='Voice is off.'){ 
   wanted=false;listening=false;starting=false;speaking=false;epoch++;speechGeneration++;clearTimers();
   const old=instance;instance=null;try{old?.abort();}catch(_){}
   try{Promise.resolve(native()?.stop()).catch(()=>{});}catch(_){}
   try{host.speechSynthesis?.cancel();}catch(_){}
   if(!disposed){message(reason);render();}
  }
  function fail(code){stop(errorMessages[code]||'Voice recognition stopped. Tap Turn on voice to try again.');}
  function nativeStatus(value,session){
   if(session!==epoch||!wanted)return;
   const state=typeof value==='string'?value:value?.state;
   if(state==='error'){fail(value?.code);return;}
   listening=state==='listening';starting=false;
   if(state==='stopped'){stop('Voice stopped. Tap Turn on voice to listen again.');return;}
   if(state==='listening')message('Listening. Say a Cook command.');
   else if(state==='paused')message('Reading the recipe amount…');
   render();
  }
  function beginBrowser(session){
   if(session!==epoch||!wanted||!allowed()||speaking)return;
   const Ctor=Speech();if(typeof Ctor!=='function'){fail('unavailable');return;}
   let recognition;try{recognition=new Ctor();}catch(_){fail('unavailable');return;}
   instance=recognition;const processed=new Set();recognition.continuous=true;recognition.interimResults=false;recognition.maxAlternatives=1;recognition.lang=read().lang||host.navigator?.language||'en-GB';
   recognition.onstart=()=>{if(instance!==recognition)return;if(session!==epoch||!wanted||!allowed()){try{recognition.abort();}catch(_){}return;}starting=false;listening=true;message('Listening. Say a Cook command.');render();};
   recognition.onresult=event=>{
    if(instance!==recognition||session!==epoch||!wanted||!allowed()||speaking)return;
    for(let i=Number.isInteger(event.resultIndex)?event.resultIndex:0;i<(event.results?.length||0);i++){
     const result=event.results[i];if(result?.isFinal!==true||processed.has(i))continue;
     processed.add(i);handle(String(result[0]?.transcript||''),session);
    }
   };
   recognition.onerror=event=>{if(instance!==recognition||session!==epoch||!wanted||speaking)return;if(event?.error==='aborted')return;if(event?.error==='no-speech'){message('Listening for a Cook command…');return;}fail(event?.error);};
   recognition.onend=()=>{
    if(instance!==recognition)return;instance=null;if(session!==epoch||!wanted||!allowed()||speaking)return;
    listening=false;render();restartTimer=host.setTimeout(()=>{restartTimer=null;beginBrowser(session);},180);
   };
   try{recognition.start();}catch(_){fail('audio-capture');}
  }
  async function speak(text,session){
   if(session!==epoch||!wanted||!allowed())return;
   message(text);
   if(backend==='native'){
    try{await native().speak(text);}catch(_){if(session===epoch&&wanted)message(text+' Read from the screen if audio is unavailable.');}return;
   }
   if(!host.speechSynthesis||typeof host.SpeechSynthesisUtterance!=='function')return;
   const generation=++speechGeneration;
   if(speechTimer!==null)host.clearTimeout(speechTimer);speechTimer=null;
   speaking=true;listening=false;const old=instance;instance=null;try{old?.abort();}catch(_){}render();
   const utterance=new host.SpeechSynthesisUtterance(text);utterance.lang=read().lang||host.navigator?.language||'en-GB';
   let ended=false,watchdog=null;
   const current=()=>session===epoch&&generation===speechGeneration;
   const finish=()=>{
    if(ended)return;ended=true;
    // A cancelled utterance may finish after a new listening session starts.
    // Only this session's current utterance owns its watchdog and speech state.
    if(!current())return;
    if(watchdog!==null)host.clearTimeout(watchdog);
    if(speechTimer===watchdog)speechTimer=null;
    watchdog=null;speaking=false;
    if(wanted&&allowed())beginBrowser(session);
   };
   utterance.onend=finish;utterance.onerror=finish;
   try{
    host.speechSynthesis.cancel();host.speechSynthesis.speak(utterance);
    if(!ended&&current())speechTimer=watchdog=host.setTimeout(()=>{if(!current())return;try{host.speechSynthesis.cancel();}catch(_){}finish();},15000);
   }catch(_){finish();}
  }
  function handle(transcript,session){
   if(session!==epoch||!wanted||!allowed())return;
   const text=normalize(transcript),now=Date.now();
   if(!text||text.length>300||(lastHandled?.text===text&&now-lastHandled.at<1200))return;
   const command=parseCommand(text);if(!command){message('Try “Next step”, “Start timer” or “How much” and an ingredient name.');return;}
   lastHandled={text,at:now};
   const context=read();
   if(command.type==='quantity'){const answer=ingredientAnswer(context.ingredients,command.name);void speak(answer.message,session);return;}
   const action=command.type==='next'?context.next:command.type==='previous'?context.previous:context.startTimer;
   let ok=false;try{ok=typeof action==='function'&&action()===true;}catch(_){}
   refresh();
   if(!wanted||!allowed())return;
   const reply=ok?(command.type==='timer'?'Timer started.':command.type==='next'?'Next step.':'Previous step.'):(command.type==='timer'?'Use the displayed timer. It may already be running.':'That step is not available.');
   void speak(reply,session);
  }
  async function start(){
   const context=read();
   if(context.premium!==true){try{context.upgrade?.();}catch(_){}return;}
   if(!allowed()||starting)return;
   wanted=true;starting=true;epoch++;const session=epoch;lastHandled=null;message('Opening the microphone…');render();
   if(available===null&&!await capability()){if(session===epoch)stop('Voice recognition is not available on this device.');return;}
   if(session!==epoch||!wanted||!allowed())return;
   if(backend==='native'){
    try{await native().start(text=>handle(text,session),value=>nativeStatus(value,session));if(session===epoch&&wanted){starting=false;render();}}
    catch(error){if(session===epoch)fail(error?.code);}
   }else beginBrowser(session);
  }
  function refresh(){
   if(disposed)return;
   const context=read(),key=context.key===undefined?null:String(context.key);
   if(wanted&&(!allowed()||(currentKey!==null&&key!==currentKey)))stop('Voice is off.');
   currentKey=key;render();
  }
  function pageHidden(){if(doc.visibilityState==='hidden')stop('Voice is off while the app is in the background.');}
  function leaving(){stop('Voice is off.');}
  function accountChanged(){stop('Voice is off.');refresh();}
  button.addEventListener('click',()=>{if(wanted)stop();else void start();});
  doc.addEventListener('visibilitychange',pageHidden);doc.addEventListener('basketboss:premium-verified',refresh);
  host.addEventListener?.('pagehide',leaving);host.addEventListener?.('basketboss:session-changed',accountChanged);host.addEventListener?.('basketboss:account-deletion-started',leaving);
  let observer=null;
  if(host.MutationObserver&&doc.body){observer=new host.MutationObserver(()=>{if(container.isConnected===false)dispose();else if(wanted&&!allowed())stop('Voice is off.');});observer.observe(doc.body,{childList:true,subtree:true});}
  function dispose(){if(disposed)return;stop();disposed=true;observer?.disconnect();doc.removeEventListener('visibilitychange',pageHidden);doc.removeEventListener('basketboss:premium-verified',refresh);host.removeEventListener?.('pagehide',leaving);host.removeEventListener?.('basketboss:session-changed',accountChanged);host.removeEventListener?.('basketboss:account-deletion-started',leaving);holder.remove();}
  refresh();
  return Object.freeze({refresh,dispose,stop});
 }
 return Object.freeze({normalize,parseCommand,ingredientAnswer,mount});
});
