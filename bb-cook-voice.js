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
 const singular=Object.freeze({onions:'onion',carrots:'carrot',potatoes:'potato',tomatoes:'tomato',chillies:'chilli',berries:'berry',leaves:'leaf',loaves:'loaf',eggs:'egg',cloves:'clove',peppers:'pepper',mushrooms:'mushroom',peas:'pea',beans:'bean',chickpeas:'chickpea',lentils:'lentil',fillets:'fillet',breasts:'breast',thighs:'thigh',sausages:'sausage',prawns:'prawn',wraps:'wrap',noodles:'noodle',nuts:'nut',almonds:'almond',walnuts:'walnut',cashews:'cashew',pistachios:'pistachio',olives:'olive',capers:'caper',lemons:'lemon',limes:'lime',apples:'apple',pears:'pear',bananas:'banana',oranges:'orange',grapes:'grape',cherries:'cherry',strawberries:'strawberry',raspberries:'raspberry',blueberries:'blueberry',courgettes:'courgette',aubergines:'aubergine',shallots:'shallot',leeks:'leek',cucumbers:'cucumber',parsnips:'parsnip',scallops:'scallop',mussels:'mussel',anchovies:'anchovy',herbs:'herb',cheeses:'cheese'});
 const ingredientKey=value=>normalize(value).replace(/^the /,'').split(' ').map(word=>singular[word]||word).join(' ');
 function parseCommand(value){
  const text=normalize(value).replace(/^please /,'').replace(/ please$/,'');
  if(/^(?:ready|next ingredient|go to (?:the )?next ingredient)$/.test(text))return {type:'nextIngredient'};
  if(/^(?:next(?: step)?|go to (?:the )?next step)$/.test(text))return {type:'next'};
  if(/^(?:previous(?: step)?|back(?: one step| a step| step)?|go (?:back|to (?:the )?previous step))$/.test(text))return {type:'previous'};
  if(/^start (?:the )?timer$/.test(text))return {type:'timer'};
  if(/^(?:start cooking|begin cooking|lets (?:start|begin) cooking)$/.test(text))return {type:'startCooking'};
  if(/^(?:repeat(?: (?:that|this|the))?(?: step| ingredient| instruction)?|read (?:this |the )?(?:step|ingredient|instruction)|say that again)$/.test(text))return {type:'repeat'};
  const match=text.match(/^(?:how much|how many|what quantity of|what is the amount of) (.+?)(?: do i need| is needed)?$/);
  if(match)return {type:'quantity',name:match[1].replace(/^the /,'')};
  return null;
 }
 function ingredientAnswer(ingredients,query){
  const key=ingredientKey(query);
  if(!key||!Array.isArray(ingredients))return {ok:false,message:'Ask for an ingredient in this recipe.'};
  const found=ingredients.filter(item=>{
   if(!item||typeof item.name!=='string'||typeof item.quantity!=='string')return false;
   const name=ingredientKey(item.name),aliases=[name,...(Array.isArray(item.aliases)?item.aliases.map(ingredientKey):[])];
   if(/^(?:cheddar|mozzarella|parmesan|feta|halloumi|ricotta)(?: cheese)?$/.test(name))aliases.push('cheese',name.replace(/ cheese$/,''));
   return aliases.includes(key);
  });
  if(found.length>1)return {ok:false,message:'More than one ingredient matches. Say its full name.'};
  if(!found.length)return {ok:false,message:'I could not find that ingredient. Say its name from the recipe.'};
  const item=found[0],name=item.name.trim().slice(0,180),quantity=item.quantity.trim().slice(0,180);
  return quantity?{ok:true,message:name+': '+quantity+'.',ingredient:item}:{ok:false,message:'Check the recipe for that ingredient’s amount.'};
 }
 function narrationFor(context={}){
  const phase=context.phase;
  if(phase==='prep'){
   const ingredients=Array.isArray(context.ingredients)?context.ingredients:[],index=Number.isInteger(context.ingredientIndex)&&context.ingredientIndex>=0?context.ingredientIndex:0;
   if(context.prepComplete===true||index>=ingredients.length)return {key:'prep|ready',text:'That’s your ingredient list ready. When you’re ready to begin, say “start cooking”.',status:'Ingredients ready. Say “start cooking” when you’re ready.'};
   const ingredient=ingredients[index],name=String(ingredient?.name||'').trim(),quantity=String(ingredient?.quantity||'').trim();
   if(!name||!quantity)return {key:'prep|'+index+'|check',text:'Check the next ingredient and its amount on screen. Say “next ingredient” when you’re ready.',status:'Check the ingredient and amount on screen.'};
   const text=(index===0?'Let’s start with ':'Next, ')+name+': '+quantity+'. Say “next ingredient” when you’re ready.';
   return {key:'prep|'+index+'|'+name+'|'+quantity,text:text.length<=4000?text:null,status:text.length<=4000?'Reading ingredient '+(index+1)+' of '+ingredients.length+'.':'This ingredient entry is too long to read aloud. Check its complete amount on screen.'};
  }
  if(phase==='cook'&&typeof context.currentStep==='string'&&context.currentStep.trim()){
   const step=context.currentStep.trim(),index=Number.isInteger(context.stepIndex)&&context.stepIndex>=0?context.stepIndex:0,count=Number.isInteger(context.stepCount)&&context.stepCount>index?context.stepCount:null;
   const text='Step '+(index+1)+(count?' of '+count:'')+'. '+step+' Say “next step” when you’re ready.';
   return {key:'cook|'+index+'|'+step,text:text.length<=4000?text:null,status:text.length<=4000?'Reading step '+(index+1)+(count?' of '+count:'')+'.':'This instruction is too long to read aloud in one go. Follow the complete step on screen.'};
  }
  return null;
 }
 function speechTimeoutMs(text){const value=String(text||''),words=value.trim().split(/\s+/).filter(Boolean).length;return Math.min(360000,Math.max(15000,Math.ceil(Math.max(words/2.1*1000,value.length*55)+8000)));}
 function britishVoice(synthesis){
  try{
   const voices=(synthesis?.getVoices?.()||[]).filter(voice=>/^en[-_]GB$/i.test(voice.lang));
   // Prefer a natural voice before locality or a familiar name. A compact
   // default should not beat an available enhanced voice just by being local.
   const rank=voice=>(/premium/i.test(voice.name)?40:/enhanced|natural|neural/i.test(voice.name)?30:0)+(voice.localService===true?4:0)+(/serena|kate|martha|susan|hazel/i.test(voice.name)?2:0)+(voice.default?1:0);
   return voices.sort((a,b)=>rank(b)-rank(a))[0]||null;
  }catch(_){return null;}
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
  let disposed=false,wanted=false,listening=false,starting=false,startPending=false,speaking=false,epoch=0,speechGeneration=0,instance=null,backend=null,available=null,currentKey=null,lastHandled=null,lastNarrated=null,spokenStatus='',restartTimer=null,speechTimer=null;
  const native=()=>host.BBNativeCookVoice;
  const Speech=()=>host.SpeechRecognition||host.webkitSpeechRecognition;
  function read(){try{return options.context()||{};}catch(_){return {};}}
  const allowed=()=>{const value=read();return !disposed&&value.active===true&&value.premium===true&&doc.visibilityState!=='hidden'&&container.isConnected!==false;};
  const message=text=>{status.textContent=text;};
  const listeningPrompt=()=>read().phase==='prep'?'Listening. Say “next ingredient”, “repeat” or “start cooking”.':'Listening. Say “next step”, “repeat” or an ingredient’s name.';
  function render(){
   const context=read();holder.hidden=context.active!==true;
   button.setAttribute('aria-pressed',String(wanted));holder.classList.toggle('is-listening',wanted&&listening);holder.classList.toggle('is-premium-locked',context.premium!==true);
   label.textContent=context.premium!==true?'Voice Cook · Premium':starting?'Starting microphone…':wanted?'Stop listening':available===false?'Voice unavailable':'Turn on voice';
   button.disabled=context.premium===true&&(starting||available===false);
   help.textContent=context.premium!==true?'A spoken guide through prep, cooking steps and ingredient amounts.':context.phase==='prep'?'Say “next ingredient”, “repeat”, “start cooking” or an ingredient’s name.':'Say “next step”, “previous step”, “repeat”, “start timer” or “how much cheddar?”';
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
   wanted=false;listening=false;starting=false;startPending=false;speaking=false;spokenStatus='';lastNarrated=null;epoch++;speechGeneration++;clearTimers();
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
   listening=state==='listening';speaking=state==='paused';starting=false;
   if(state==='stopped'){stop('Voice stopped. Tap Turn on voice to listen again.');return;}
   if(state==='listening'){spokenStatus='';message(listeningPrompt());}
   else if(state==='paused')message(spokenStatus||'Reading the recipe…');
   render();
  }
  function beginBrowser(session){
   if(session!==epoch||!wanted||!allowed()||speaking)return;
   const Ctor=Speech();if(typeof Ctor!=='function'){fail('unavailable');return;}
   let recognition;try{recognition=new Ctor();}catch(_){fail('unavailable');return;}
   instance=recognition;const processed=new Set();recognition.continuous=true;recognition.interimResults=false;recognition.maxAlternatives=1;recognition.lang=read().lang||host.navigator?.language||'en-GB';
   recognition.onstart=()=>{if(instance!==recognition)return;if(session!==epoch||!wanted||!allowed()){try{recognition.abort();}catch(_){}return;}starting=false;startPending=false;listening=true;spokenStatus='';message(listeningPrompt());render();narrateCurrent(session);};
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
  async function speak(text,session,statusText){
   if(session!==epoch||!wanted||!allowed())return;
   spokenStatus=statusText||text;message(spokenStatus);
   if(backend==='native'){
    speaking=true;listening=false;render();
    try{await native().speak(text);}catch(_){if(session===epoch&&wanted){speaking=false;message('Read the recipe on screen if audio is unavailable.');}}return;
   }
   if(!host.speechSynthesis||typeof host.SpeechSynthesisUtterance!=='function'){if(statusText)message('Spoken audio is unavailable. Follow the ingredient or step on screen.');return;}
   const generation=++speechGeneration;
   if(speechTimer!==null)host.clearTimeout(speechTimer);speechTimer=null;
   speaking=true;listening=false;const old=instance;instance=null;try{old?.abort();}catch(_){}render();
   const utterance=new host.SpeechSynthesisUtterance(text);utterance.lang=read().lang||'en-GB';utterance.rate=1;utterance.pitch=1;
   const voice=britishVoice(host.speechSynthesis);if(voice)utterance.voice=voice;
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
    if(!ended&&current())speechTimer=watchdog=host.setTimeout(()=>{if(!current())return;try{host.speechSynthesis.cancel();}catch(_){}finish();},speechTimeoutMs(text));
   }catch(_){finish();}
  }
  function narrateCurrent(session,force=false){
   if(session!==epoch||!wanted||!allowed()||startPending)return false;
   const narration=narrationFor(read());if(!narration||!force&&lastNarrated===narration.key)return false;
   lastNarrated=narration.key;
   if(narration.text)void speak(narration.text,session,narration.status);else message(narration.status);
   return true;
  }
  function handle(transcript,session){
   if(session!==epoch||!wanted||!allowed()||speaking)return;
   const text=normalize(transcript),now=Date.now();
   if(!text||text.length>300||(lastHandled?.text===text&&now-lastHandled.at<1200))return;
   const context=read(),command=parseCommand(text);
   if(!command){const answer=ingredientAnswer(context.ingredients,text);if(answer.ok){lastHandled={text,at:now};void speak(answer.message,session);}else message('Say an ingredient’s name, “repeat”, or the next prep or cooking command.');return;}
   lastHandled={text,at:now};
   if(command.type==='repeat'){if(!narrateCurrent(session,true))message('The current recipe instruction is on screen.');return;}
   if(command.type==='quantity'){const answer=ingredientAnswer(context.ingredients,command.name);void speak(answer.message,session);return;}
   const prep=context.phase==='prep',guided=context.phase==='prep'||context.phase==='cook';
   const action=command.type==='next'?(prep?context.prepareNext:context.next):command.type==='nextIngredient'?(prep?context.prepareNext:null):command.type==='startCooking'?(prep?context.startCooking:null):command.type==='previous'?(!prep?context.previous:null):context.startTimer;
   const previousNarration=lastNarrated;
   let ok=false;try{ok=typeof action==='function'&&action()===true;}catch(_){}
   refresh();
   if(!wanted||!allowed())return;
   if(ok&&guided&&command.type!=='timer'&&(lastNarrated!==previousNarration||narrateCurrent(session)))return;
   const reply=ok?(command.type==='timer'?'Timer started.':command.type==='next'?'Next step.':'Previous step.'):(command.type==='timer'?'Use the displayed timer. It may already be running.':'That step is not available.');
   void speak(reply,session);
  }
  async function start(){
   const context=read();
   if(context.premium!==true){try{context.upgrade?.();}catch(_){}return;}
   if(!allowed()||starting)return;
   wanted=true;starting=true;startPending=true;epoch++;const session=epoch;lastHandled=null;lastNarrated=null;message('Opening the microphone…');render();
   if(available===null&&!await capability()){if(session===epoch)stop('Voice recognition is not available on this device.');return;}
   if(session!==epoch||!wanted||!allowed())return;
   if(backend==='native'){
    try{await native().start(text=>handle(text,session),value=>nativeStatus(value,session));if(session===epoch&&wanted){starting=false;startPending=false;render();narrateCurrent(session);}}
    catch(error){if(session===epoch)fail(error?.code);}
   }else beginBrowser(session);
  }
  function refresh(){
   if(disposed)return;
   const context=read(),key=context.key===undefined?null:String(context.key);
   if(wanted&&(!allowed()||(currentKey!==null&&key!==currentKey)))stop('Voice is off.');
   currentKey=key;render();if(wanted&&allowed()&&!startPending)narrateCurrent(epoch);
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
 return Object.freeze({normalize,ingredientKey,parseCommand,ingredientAnswer,narrationFor,speechTimeoutMs,mount});
});
