/* Optional Premium Cook commands. The recipe controller supplies quantities and
 * actions; speech never creates recipes, timers or subscription permissions. */
(function(root,factory){
 'use strict';
 const common=typeof module==='object'&&module.exports;
 const api=factory(root,root?.BBCookSpeechText||(common?require('./bb-cook-speech-text.js'):null),root?.BBCookTTS||(common?require('./bb-cook-tts.js'):null),root?.BBCookAssistant||(common?require('./bb-cook-assistant.js'):null));
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBCookVoice=api;
})(typeof window==='undefined'?null:window,function(root,spoken,ttsLibrary,assistantLibrary){
 'use strict';
 const AI_SETUP_TIMEOUT_MS=45000;
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
  return quantity?{ok:true,message:spoken?spoken.answer({name,quantity}):name+': '+quantity+'.',ingredient:item}:{ok:false,message:'Check the recipe for that ingredient’s amount.'};
 }
 function narrationFor(context={}){
  const phase=context.phase;
  if(phase==='prep'){
   const ingredients=Array.isArray(context.ingredients)?context.ingredients:[],index=Number.isInteger(context.ingredientIndex)&&context.ingredientIndex>=0?context.ingredientIndex:0;
   if(context.prepComplete===true||index>=ingredients.length)return {key:'prep|ready',text:'That’s your ingredient list ready. When you’re ready to begin, say “start cooking”.',status:'Ingredients ready. Say “start cooking” when you’re ready.'};
   const ingredient=ingredients[index],name=String(ingredient?.name||'').trim(),quantity=String(ingredient?.quantity||'').trim();
   if(!name||!quantity)return {key:'prep|'+index+'|check',text:'Check the next ingredient and its amount on screen. Say “next ingredient” when you’re ready.',status:'Check the ingredient and amount on screen.'};
   const text=spoken?spoken.ingredient({name,quantity,index}):(index===0?'Let’s start with ':'Next, ')+name+': '+quantity+'. Say “next ingredient” when you’re ready.';
   return {key:'prep|'+index+'|'+name+'|'+quantity,text:text.length<=4000?text:null,status:text.length<=4000?'Reading ingredient '+(index+1)+' of '+ingredients.length+'.':'This ingredient entry is too long to read aloud. Check its complete amount on screen.'};
  }
  if(phase==='cook'&&typeof context.currentStep==='string'&&context.currentStep.trim()){
   const step=context.currentStep.trim(),index=Number.isInteger(context.stepIndex)&&context.stepIndex>=0?context.stepIndex:0,count=Number.isInteger(context.stepCount)&&context.stepCount>index?context.stepCount:null;
   const text=spoken?spoken.step({text:step,index,count}):'Step '+(index+1)+(count?' of '+count:'')+'. '+step+' Say “next step” when you’re ready.';
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
  let mentor=false;try{mentor=options.context?.()?.mentorEnabled===true;}catch{}
  return mentor?mountMentor(options):mountLegacy(options);
 }
 function mentorChunks(value){
  let text=String(value||'').trim();const chunks=[];
  while(text.length>1200){
   const prefix=text.slice(0,1201);let split=-1;
   for(const match of prefix.matchAll(/[.!?][\s]+/g))if(match.index>=450)split=match.index+1;
   if(split<0)split=prefix.lastIndexOf(' ',1200);
   if(split<1)split=1200;
   chunks.push(text.slice(0,split).trim());text=text.slice(split).trim();
  }
  if(text)chunks.push(text);return chunks;
 }
 function mentorNarration(context={}){
  if(context.phase==='prep'){
   const items=Array.isArray(context.ingredients)?context.ingredients:[],index=Number.isInteger(context.ingredientIndex)?context.ingredientIndex:0;
   if(context.prepComplete===true||index>=items.length)return 'Your ingredients are ready. Let’s start cooking when you are.';
   const item=items[index],phrase=spoken?.phrase?.(item);
   return phrase?(index===0?'Let’s get your ingredients ready. ':'Next, ')+phrase+'.':'Check this ingredient and its amount on screen.';
  }
  return typeof context.currentStep==='string'?(spoken?.plain?.(context.currentStep)||context.currentStep):'';
 }
 function mountMentor(options={}){
  const host=options.window||root,doc=options.document||host?.document,container=options.container;
  if(!doc||!container||typeof options.context!=='function')return null;
  const create=(tag,name,text)=>{const node=doc.createElement(tag);node.className=name;if(text!==undefined)node.textContent=text;return node;};
  const holder=create('section','bb-cook-voice is-mentor'),row=create('div','bbcv-row'),button=create('button','bbcv-toggle'),label=create('span','bbcv-label','Cook Mentor');
  const status=create('p','bbcv-status','Ask a question about this recipe.'),help=create('p','bbcv-help','Ask “What should it look like?” or “Can I use milk instead?”');
  const disclosure=create('p','bbcv-disclosure','AI cooking help. Your question and this recipe are sent to AI; spoken replies are AI-generated.');
  const exchange=create('div','bbcv-exchange'),question=create('p','bbcv-question'),answer=create('p','bbcv-answer');
  const form=create('form','bbcv-question-form'),input=create('input','bbcv-question-input'),send=create('button','bbcv-question-send','Ask');
  const controls=create('div','bbcv-mentor-controls'),interrupt=create('button','bbcv-interrupt','Ask a question'),retry=create('button','bbcv-retry','Retry voice');
  const nameRow=create('div','bbcv-name-row'),nameDisplay=create('span','bbcv-name-display'),nameEdit=create('button','bbcv-name-edit','Name your mentor');
  const nameForm=create('form','bbcv-name-form'),nameInput=create('input','bbcv-name-input'),nameSave=create('button','bbcv-name-save','Save name');
  button.type='button';button.setAttribute('aria-pressed','false');button.append(label);row.append(button,status);
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');answer.setAttribute('aria-live','polite');
  input.type='text';input.maxLength=600;input.value='';input.autocomplete='off';input.placeholder='Ask about this recipe…';input.setAttribute('aria-label','Question for your cooking mentor');
  nameEdit.type='button';nameInput.type='text';nameInput.maxLength=24;nameInput.autocomplete='off';nameInput.setAttribute('aria-label','Your cooking mentor’s name');nameSave.type='submit';nameForm.hidden=true;nameRow.append(nameDisplay,nameEdit);nameForm.append(nameInput,nameSave);
  send.type='submit';interrupt.type=retry.type='button';exchange.append(question,answer);form.append(input,send);controls.append(interrupt,retry);holder.append(row,nameRow,nameForm,help,disclosure,exchange,form,controls);container.append(holder);
  const tts=options.tts||ttsLibrary?.create?.({window:host}),assistant=options.assistant||assistantLibrary?.create?.({window:host});
  const native=()=>host.BBNativeCookVoice,Speech=()=>host.SpeechRecognition||host.webkitSpeechRecognition;
  const actor=()=>{try{return host.BasketBossSession?.read?.()?.user?.id||JSON.parse(host.localStorage?.getItem('basketboss_cloud_session_v1')||'null')?.user?.id||null;}catch{return null;}};
  const read=()=>{try{return options.context()||{};}catch{return {};}};
  const allowed=()=>{const c=read();return !disposed&&c.active===true&&c.premium===true&&doc.visibilityState!=='hidden'&&container.isConnected!==false;};
  const position=c=>[c.phase,c.stepIndex,c.ingredientIndex,c.currentStep].join('|');
  let disposed=false,wanted=false,starting=false,busy=false,mode='idle',backend=null,available=null,instance=null,restartTimer=null;
  const mentorNameValue=value=>{const name=String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');return name.length>=1&&name.length<=24&&/^[\p{L}\p{M}\p{Nd} .'’\-]+$/u.test(name)?name:null;};
  const nameKey=()=>{const id=actor();return typeof id==='string'&&id.length<=128?'basketboss_cook_mentor_name_v1:'+encodeURIComponent(id):null;};
  const readName=()=>{try{const key=nameKey();return key&&mentorNameValue(host.localStorage?.getItem(key))||'Chef Boss';}catch{return 'Chef Boss';}};
  let epoch=0,generation=0,job=null,history=[],currentActor=actor(),currentKey=null,currentPosition=null,lastHandled=null,lastSpeech='',lastAnswerPosition=null,retryVoice=false,mentorName=readName(),greetedTextKey=null,greetedVoiceKey=null,failureNotice='';
  const message=text=>{status.textContent=text;};
  function render(){
   const c=read();holder.hidden=c.active!==true;holder.classList.toggle('is-premium-locked',c.premium!==true);holder.classList.toggle('is-listening',wanted&&mode==='listening');holder.classList.toggle('is-thinking',mode==='thinking');
   label.textContent=c.premium!==true?'Cook Mentor · Premium':starting?'Opening microphone…':wanted?'Stop mentor voice':'Turn on mentor voice';
   button.disabled=c.premium===true&&starting;button.setAttribute('aria-pressed',String(wanted));
   help.textContent=c.premium===true?'Ask naturally about the recipe, or say “next step”.':'Practical cooking help, spoken naturally, with Premium.';
   form.hidden=disclosure.hidden=c.premium!==true;input.disabled=c.premium!==true;send.disabled=c.premium!==true||busy;
   nameRow.hidden=c.premium!==true;if(c.premium!==true)nameForm.hidden=true;nameDisplay.textContent='Your mentor: '+mentorName;
   exchange.hidden=!question.textContent&&!answer.textContent;question.hidden=!question.textContent;answer.hidden=!answer.textContent;
   interrupt.hidden=!busy;interrupt.textContent=wanted?'Ask a question':'Cancel question';retry.hidden=!retryVoice||!wanted||busy;
  }
  const current=value=>job===value&&value.generation===generation&&value.epoch===epoch&&!value.controller.signal.aborted&&allowed()&&actor()===value.actor&&String(read().key??'')===value.key&&position(read())===value.position;
  function cancelPending(){
   const old=job;job=null;generation++;try{old?.controller.abort();}catch{}
   if(old?.speechId)try{Promise.resolve(native()?.cancelSpeech?.({speechId:old.speechId})).catch(()=>{});}catch{}
   busy=false;
  }
  function clearRestart(){if(restartTimer!==null)host.clearTimeout(restartTimer);restartTimer=null;}
  function clearConversation(){history=[];question.textContent=answer.textContent='';lastSpeech='';lastAnswerPosition=null;retryVoice=false;greetedTextKey=greetedVoiceKey=null;}
  function stop(reason='Mentor voice is off. You can still type a cooking question.'){
   wanted=false;starting=false;epoch++;cancelPending();clearRestart();clearConversation();mode='idle';failureNotice='';
   const old=instance;instance=null;try{old?.abort();}catch{}try{Promise.resolve(native()?.stop()).catch(()=>{});}catch{}
   if(!disposed){message(reason);render();}
  }
  function accessFailure(error){
   if(!['BB_MENTOR_AUTH','BB_MENTOR_PREMIUM_REQUIRED','BB_MENTOR_DELETING','BB_MENTOR_SESSION_CHANGED','BB_TTS_AUTH','BB_TTS_PREMIUM_REQUIRED','BB_TTS_DELETING','BB_TTS_SESSION_CHANGED'].includes(error?.code))return false;
   stop(/DELETING/.test(error.code)?'Cooking help is off while account deletion is in progress.':'Check your signed-in Premium account, then reopen Cook.');
   try{Promise.resolve(host.BasketBossMembershipUI?.refresh?.()).catch(()=>{});}catch{}return true;
  }
  function holdBrowser(){const old=instance;instance=null;clearRestart();try{old?.abort();}catch{}}
  function finish(value){
   if(!current(value))return;job=null;busy=false;
   if(wanted){mode='listening';if(!retryVoice&&!value.failed&&!failureNotice)message('Listening. What would you like to know?');if(backend==='browser')beginBrowser(epoch);}
   else mode='idle';render();
  }
  function beginJob(nextMode){
   cancelPending();const Controller=host.AbortController||globalThis.AbortController;if(!Controller)throw Error('mentor_unavailable');
   const c=read(),value={controller:new Controller(),speechId:null,generation,epoch,actor:actor(),key:String(c.key??''),position:position(c)};job=value;busy=true;mode=nextMode;retryVoice=false;failureNotice='';
   if(wanted&&backend==='browser')holdBrowser();render();return value;
  }
  async function holdNative(value){
   if(!wanted||backend!=='native')return true;
   if(value.speechId)return true;
   if(typeof native()?.prepareSpeech!=='function')throw Error('mentor_audio_unavailable');
   const prepared=await native().prepareSpeech();
   if(!current(value)){
    if(prepared?.speechId)try{await native().cancelSpeech?.({speechId:prepared.speechId});}catch{}
    return false;
   }
   if(prepared?.cancelled||!prepared?.speechId)throw Error('mentor_audio_unavailable');value.speechId=prepared.speechId;return true;
  }
  async function playSpeech(text,value){
   const chunks=mentorChunks(spoken?.plain?.(text)||text);if(!chunks.length||text.length>4000)throw Error('mentor_audio_unavailable');
   lastSpeech=text;
   for(const chunk of chunks){
    if(!current(value)||!wanted)return;mode='preparing';message('Preparing your mentor’s voice…');render();
    if(backend==='native'){
     if(!await holdNative(value))return;
     if(typeof tts?.prepareMentor!=='function'||typeof native()?.playAudioData!=='function')throw Error('mentor_audio_unavailable');
     const audio=await tts.prepareMentor(chunk,{signal:value.controller.signal,timeoutMs:AI_SETUP_TIMEOUT_MS});if(!current(value)||!wanted)return;
     mode='speaking';message('Your cooking mentor is speaking.');render();
     const result=await native().playAudioData({...audio,speechId:value.speechId});if(!current(value))return;
     if(result?.spoken!==true)throw Error('mentor_audio_unavailable');value.speechId=null;
    }else{
     if(typeof tts?.playMentor!=='function')throw Error('mentor_audio_unavailable');
     mode='speaking';message('Your cooking mentor is speaking.');render();
     await tts.playMentor(chunk,{signal:value.controller.signal,timeoutMs:Math.min(360000,AI_SETUP_TIMEOUT_MS+speechTimeoutMs(chunk))});
    }
   }
  }
  async function voiceReply(text){
   if(!wanted||!allowed())return;let value;try{value=beginJob('preparing');await playSpeech(text,value);}
   catch(error){if(value&&current(value)&&error?.name!=='AbortError'&&!accessFailure(error))voiceUnavailable(value);}
   finally{if(value)finish(value);}
  }
  function voiceUnavailable(value){
   if(!current(value))return;
   if(value.speechId){try{Promise.resolve(native()?.cancelSpeech?.({speechId:value.speechId})).catch(()=>{});}catch{}value.speechId=null;}
   retryVoice=true;failureNotice='Natural mentor voice is unavailable. Read the reply below or retry voice.';message(failureNotice);render();
  }
  function questionFailure(error){
   return error?.code==='BB_MENTOR_LIMIT'?'Your cooking help allowance is used for now. Follow the recipe on screen.':
    error?.code==='BB_MENTOR_OFFLINE'?'You’re offline. Reconnect to ask your cooking mentor.':
    error?.code==='BB_MENTOR_CONTEXT'?'This recipe’s details could not be sent. Follow the complete recipe on screen.':
    'Your cooking mentor could not answer just now. Please try your question again.';
  }
  async function ask(raw){
   const c=read();if(c.premium!==true){try{c.upgrade?.();}catch{}return;}
   if(!allowed())return;const prompt=String(raw||'').trim();
   if(!prompt||prompt.length>600){message('Ask a cooking question of up to 600 characters.');return;}
   let value;try{
    value=beginJob('thinking');question.textContent=prompt;answer.textContent='';lastSpeech='';lastAnswerPosition=null;input.value='';message('Thinking about your recipe…');render();
    if(wanted&&backend==='native'&&!await holdNative(value))return;
    if(typeof assistant?.ask!=='function')throw Error('mentor_unavailable');
    const result=await assistant.ask({question:prompt,recipe:c.mentorRecipe,history:history.map(h=>({...h})),mentorName},{signal:value.controller.signal,timeoutMs:45000});
    if(!current(value))return;if(typeof result?.answer!=='string'||!result.answer.trim()||result.answer.length>1000)throw Error('mentor_response');
    const reply=result.answer.trim();history=[...history,{role:'user',text:prompt},{role:'assistant',text:reply}].slice(-6);answer.textContent=reply;lastAnswerPosition=value.position;message(wanted?'Preparing your mentor’s voice…':'Your cooking mentor’s reply.');render();
    if(wanted){try{await playSpeech(reply,value);}catch(error){if(current(value)&&error?.name!=='AbortError'&&!accessFailure(error))voiceUnavailable(value);}}
   }catch(error){if(value&&current(value)&&error?.name!=='AbortError'&&!accessFailure(error)){value.failed=true;failureNotice=questionFailure(error);message(failureNotice);}}
   finally{if(value){
    if(current(value)&&value.speechId){try{await native()?.cancelSpeech?.({speechId:value.speechId});}catch{}value.speechId=null;}
    finish(value);
   }}
  }
  function narrate(){
   const text=mentorNarration(read());if(text)void voiceReply(text);
  }
  function startCookingGreeting(){
   const c=read();if(!allowed()||c.phase!=='cook')return;
   const key=String(c.key??'')+'|cook',title=String(c.mentorRecipe?.title||'this recipe').trim();
   const greeting='Hi, ready to get cooking? I’m '+mentorName+'. Let’s make '+title+' together.';
   if(greetedTextKey!==key){greetedTextKey=key;question.textContent='';answer.textContent=greeting;message('Your cooking mentor is ready.');render();}
   if(wanted&&greetedVoiceKey!==key){greetedVoiceKey=key;const step=mentorNarration(c);void voiceReply(greeting+(step?' '+step:''));}
  }
  function handle(raw,session){
   if(session!==epoch||!wanted||busy||!allowed())return;
   const prompt=String(raw||'').trim(),key=normalize(prompt),now=Date.now();if(!prompt||prompt.length>600||lastHandled?.text===key&&now-lastHandled.at<1200)return;
   lastHandled={text:key,at:now};const command=parseCommand(prompt),c=read();
   if(!command||command.type==='quantity'){void ask(prompt);return;}
   if(command.type==='repeat'){if(answer.textContent&&lastAnswerPosition===position(c))void voiceReply(answer.textContent);else narrate();return;}
   const prep=c.phase==='prep',action=command.type==='next'?(prep?c.prepareNext:c.next):command.type==='nextIngredient'?(prep?c.prepareNext:null):command.type==='startCooking'?(prep?c.startCooking:null):command.type==='previous'?(!prep?c.previous:null):c.startTimer;
   const before=position(c);let ok=false;try{ok=typeof action==='function'&&action()===true;}catch{}refresh();
   if(!wanted||!allowed())return;
   if(command.type==='timer')void voiceReply(ok?'Your timer is running.':'The timer may already be running. Check it on screen.');
   else if(!ok)void voiceReply('That step isn’t available. The current instruction is on screen.');
   else if(before===position(read()))narrate();
  }
  function nativeStatus(value,session){
   if(session!==epoch||!wanted)return;const state=typeof value==='string'?value:value?.state;
   if(state==='error'){stop(errorMessages[value?.code]||'Voice recognition stopped. You can type your question below.');return;}
   if(state==='stopped'){stop();return;}
   if(state==='listening'&&!busy){mode='listening';message(failureNotice||'Listening. What would you like to know?');render();}
  }
  function beginBrowser(session){
   if(session!==epoch||!wanted||busy||!allowed()||instance)return;const Ctor=Speech();if(typeof Ctor!=='function')return;
   let recognition;try{recognition=new Ctor();}catch{stop('Voice recognition is unavailable. Type your question below.');return;}
   instance=recognition;const processed=new Set();recognition.continuous=true;recognition.interimResults=false;recognition.maxAlternatives=1;recognition.lang=read().lang||'en-GB';
   recognition.onstart=()=>{if(instance!==recognition||session!==epoch||!wanted||busy||!allowed())return;starting=false;mode='listening';message(failureNotice||'Listening. What would you like to know?');render();};
   recognition.onresult=event=>{if(instance!==recognition||session!==epoch||busy)return;for(let i=Number.isInteger(event.resultIndex)?event.resultIndex:0;i<(event.results?.length||0);i++){const result=event.results[i];if(result?.isFinal!==true||processed.has(i))continue;processed.add(i);handle(result[0]?.transcript||'',session);}};
   recognition.onerror=event=>{if(instance!==recognition||session!==epoch||busy||event?.error==='aborted'||event?.error==='no-speech')return;stop(errorMessages[event?.error]||'Voice recognition stopped. Type your question below.');};
   recognition.onend=()=>{if(instance!==recognition)return;instance=null;if(session!==epoch||!wanted||busy||!allowed())return;clearRestart();restartTimer=host.setTimeout(()=>{restartTimer=null;beginBrowser(session);},180);};
   try{recognition.start();}catch{instance=null;stop('The microphone could not start. Type your question below.');}
  }
  async function start(){
   const c=read();if(c.premium!==true){try{c.upgrade?.();}catch{}return;}if(!allowed()||starting)return;
   cancelPending();retryVoice=false;wanted=true;starting=true;epoch++;currentActor=actor();lastHandled=null;const session=epoch;mode='starting';message('Opening your microphone…');render();
   backend=native()?'native':'browser';try{available=backend==='native'?await native().available()===true:typeof Speech()==='function';}catch{available=false;}
   if(session!==epoch||!wanted||!allowed())return;
   if(!available){stop('Voice recognition is unavailable on this device. You can type a question below.');return;}
   try{
    if(backend==='native')await native().start(text=>handle(text,session),value=>nativeStatus(value,session));else beginBrowser(session);
    if(session!==epoch||!wanted||!allowed())return;starting=false;mode='listening';render();if(read().phase==='cook')startCookingGreeting();else narrate();
   }catch(error){if(session===epoch)stop(errorMessages[error?.code]||'The microphone could not start. Type your question below.');}
  }
  function resumeAfterInterrupt(){
   cancelPending();retryVoice=false;failureNotice='';
   if(wanted){mode='listening';message('Listening. Ask your cooking question.');if(backend==='browser')beginBrowser(epoch);}
   else{mode='idle';message('Type your cooking question below.');}render();input.focus?.();
  }
  function refresh(){
   if(disposed)return;const c=read(),key=String(c.key??''),nextPosition=position(c);
   if((wanted||job||history.length)&&(!allowed()||currentKey!==null&&key!==currentKey)){stop('Cook Mentor is ready for this recipe.');}
   else if(currentPosition!==null&&nextPosition!==currentPosition){cancelPending();retryVoice=false;lastAnswerPosition=null;currentPosition=nextPosition;if(wanted&&allowed())narrate();}
   currentKey=key;currentPosition=nextPosition;render();
  }
  const hidden=()=>{if(doc.visibilityState==='hidden')stop('Cook Mentor is off while the app is in the background.');};
  const leaving=()=>stop('Cook Mentor is off.');
  const accountChanged=()=>{const next=actor();if(!next||next!==currentActor){stop('Cook Mentor is off.');mentorName=readName();nameForm.hidden=true;nameInput.value='';}currentActor=next;refresh();};
  const submit=event=>{event?.preventDefault?.();if(!busy)void ask(input.value);};
  const saveName=event=>{event?.preventDefault?.();if(!allowed())return;const name=mentorNameValue(nameInput.value);if(!name){message('Use up to 24 letters, numbers, spaces, apostrophes, hyphens or full stops.');return;}cancelPending();clearConversation();mentorName=name;try{const key=nameKey();if(key)host.localStorage?.setItem?.(key,name);}catch{}nameForm.hidden=true;message(mentorName+' is ready to help.');if(wanted&&backend==='browser')beginBrowser(epoch);render();};
  button.addEventListener('click',()=>{if(wanted)stop();else void start();});form.addEventListener('submit',submit);send.addEventListener('click',submit);interrupt.addEventListener('click',resumeAfterInterrupt);retry.addEventListener('click',()=>{if(lastSpeech)void voiceReply(lastSpeech);});
  nameEdit.addEventListener('click',()=>{if(!allowed())return;nameInput.value=mentorName;nameForm.hidden=!nameForm.hidden;if(!nameForm.hidden)nameInput.focus?.();});nameForm.addEventListener('submit',saveName);nameSave.addEventListener('click',saveName);
  doc.addEventListener('visibilitychange',hidden);doc.addEventListener('basketboss:premium-verified',refresh);host.addEventListener?.('pagehide',leaving);host.addEventListener?.('basketboss:session-changed',accountChanged);host.addEventListener?.('basketboss:account-deletion-started',leaving);
  let observer=null;if(host.MutationObserver&&doc.body){observer=new host.MutationObserver(()=>{if(container.isConnected===false)dispose();else if(!allowed()&&(wanted||job||history.length))stop();});observer.observe(doc.body,{childList:true,subtree:true});}
  function dispose(){if(disposed)return;stop();disposed=true;observer?.disconnect();doc.removeEventListener('visibilitychange',hidden);doc.removeEventListener('basketboss:premium-verified',refresh);host.removeEventListener?.('pagehide',leaving);host.removeEventListener?.('basketboss:session-changed',accountChanged);host.removeEventListener?.('basketboss:account-deletion-started',leaving);holder.remove();}
  refresh();return Object.freeze({refresh,dispose,stop,startCookingGreeting});
 }
 function mountLegacy(options={}){
  const host=options.window||root,doc=options.document||host?.document,container=options.container;
  if(!doc||!container||typeof options.context!=='function')return null;
  const create=(tag,className,text)=>{const node=doc.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const holder=create('section','bb-cook-voice'),row=create('div','bbcv-row'),button=create('button','bbcv-toggle'),label=create('span','bbcv-label','Voice Cook');
  button.type='button';button.setAttribute('aria-pressed','false');
  const icon=create('span','bbcv-icon');icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" stroke-linecap="round"/></svg>';
  button.append(icon,label);
  const status=create('p','bbcv-status',''),help=create('p','bbcv-help','Say “Next step”, “Previous step”, “Start timer” or “How much cheddar?”');
  const disclosure=create('p','bbcv-disclosure','Uses an AI-generated voice online and your device voice as backup.');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');row.append(button,status);holder.append(row,help,disclosure);container.append(holder);
  let disposed=false,wanted=false,listening=false,starting=false,startPending=false,speaking=false,epoch=0,speechGeneration=0,instance=null,backend=null,available=null,currentKey=null,lastHandled=null,lastNarrated=null,spokenStatus='',voiceDisclosure='',restartTimer=null,speechTimer=null;
  const native=()=>host.BBNativeCookVoice;
  const tts=options.tts||ttsLibrary?.create?.({window:host});
  let output=null;
  const actor=()=>{try{return host.BasketBossSession?.read?.()?.user?.id||JSON.parse(host.localStorage?.getItem('basketboss_cloud_session_v1')||'null')?.user?.id||null;}catch{return null;}};
  let currentActor=actor();
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
   disclosure.hidden=context.premium!==true;
   disclosure.textContent=voiceDisclosure||'Uses an AI-generated voice online and your device voice as backup.';
  }
  async function capability(){
   if(native()){
    backend='native';try{available=await native().available()===true;}catch(_){available=false;}
   }else{backend='browser';available=typeof Speech()==='function';}
   if(!disposed){if(available===false)message('Voice recognition is not available on this device.');render();}
   return available;
  }
  function clearTimers(){if(restartTimer!==null)host.clearTimeout(restartTimer);if(speechTimer!==null)host.clearTimeout(speechTimer);restartTimer=speechTimer=null;}
  function cancelOutput(){
   const old=output;output=null;try{old?.controller?.abort();}catch(_){}
   if(old?.speechId)try{Promise.resolve(native()?.cancelSpeech?.({speechId:old.speechId})).catch(()=>{});}catch(_){}
  }
  function rejectedAccess(error){
   if(!['BB_TTS_AUTH','BB_TTS_PREMIUM_REQUIRED','BB_TTS_DELETING'].includes(error?.code))return false;
   stop(error.code==='BB_TTS_DELETING'?'Voice is off while account deletion is in progress.':'Check your signed-in Premium account, then reopen Cook to use voice.');
   try{Promise.resolve(host.BasketBossMembershipUI?.refresh?.()).catch(()=>{});}catch(_){}
   return true;
  }
  function stop(reason='Voice is off.'){ 
   wanted=false;listening=false;starting=false;startPending=false;speaking=false;spokenStatus='';voiceDisclosure='';lastNarrated=null;epoch++;speechGeneration++;clearTimers();
   cancelOutput();
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
   text=spoken?spoken.plain(text):text;
   const generation=++speechGeneration;cancelOutput();
   if(speechTimer!==null)host.clearTimeout(speechTimer);speechTimer=null;
   const Controller=host.AbortController||globalThis.AbortController;
   const job={controller:Controller?new Controller():null,speechId:null};output=job;
   const current=()=>session===epoch&&generation===speechGeneration&&wanted&&allowed()&&!job.controller?.signal.aborted;
   const release=()=>{if(output===job)output=null;};
   let offline=host.navigator?.onLine===false;
   const deviceDisclosure=()=>offline?'Device voice · AI voice unavailable while offline.':'Device voice · AI voice unavailable.';
   spokenStatus=statusText||text;message(spokenStatus);
   speaking=true;listening=false;render();
   if(backend==='native'){
    try{
     if(tts&&job.controller&&native()?.prepareSpeech&&native()?.playAudio){
      try{
       voiceDisclosure='AI voice · Preparing narration…';render();
       const prepared=await native().prepareSpeech();
       if(prepared?.cancelled||!current())return;
       job.speechId=prepared?.speechId;
       if(!job.speechId)throw Error('Native voice preparation unavailable');
       const clip=await tts.prepare(text,{signal:job.controller.signal,timeoutMs:AI_SETUP_TIMEOUT_MS});
       if(!current())return;
       voiceDisclosure='AI voice · AI-generated narration.';render();
       const result=await native().playAudio({...clip,speechId:job.speechId});
       if(result?.cancelled||!current())return;
       if(result?.spoken!==true)throw Error('AI audio unavailable');
       return;
      }catch(error){if(!current()||error?.name==='AbortError'||rejectedAccess(error))return;offline=error?.code==='BB_TTS_OFFLINE'||host.navigator?.onLine===false;}
     }
     if(current()){voiceDisclosure=deviceDisclosure();render();await native().speak(text,job.speechId?{speechId:job.speechId}:undefined);}
    }catch(_){
     if(current()){
      if(job.speechId)try{await native().cancelSpeech?.({speechId:job.speechId});}catch(_){}
      speaking=false;voiceDisclosure='Voice audio unavailable.';render();message('Read the recipe on screen if audio is unavailable.');
     }
    }finally{release();}
    return;
   }
   // Hold recognition while preparing and playing either voice. No microphone
   // audio or transcripts go to TTS; only this recipe-derived spoken response.
   const old=instance;instance=null;try{old?.abort();}catch(_){}
   if(tts&&job.controller&&(options.tts||typeof host.Audio==='function')){
    try{
     voiceDisclosure='AI voice · AI-generated narration.';render();
     await tts.play(text,{signal:job.controller.signal,timeoutMs:Math.min(360000,AI_SETUP_TIMEOUT_MS+speechTimeoutMs(text))});
     if(current()){speaking=false;release();beginBrowser(session);}
     return;
    }catch(error){if(!current()||error?.name==='AbortError'||rejectedAccess(error)){release();return;}offline=error?.code==='BB_TTS_OFFLINE'||host.navigator?.onLine===false;}
   }
   if(!current()){release();return;}
   if(!host.speechSynthesis||typeof host.SpeechSynthesisUtterance!=='function'){
    speaking=false;voiceDisclosure='Voice audio unavailable.';render();release();if(statusText)message('Spoken audio is unavailable. Follow the ingredient or step on screen.');beginBrowser(session);return;
   }
   voiceDisclosure=deviceDisclosure();render();
   const utterance=new host.SpeechSynthesisUtterance(text);utterance.lang='en-GB';utterance.rate=1;utterance.pitch=1;
   const voice=britishVoice(host.speechSynthesis);if(voice)utterance.voice=voice;
   let ended=false,watchdog=null;
   const finish=()=>{
    if(ended)return;ended=true;
    if(!current())return;
    if(watchdog!==null)host.clearTimeout(watchdog);
    if(speechTimer===watchdog)speechTimer=null;
    watchdog=null;speaking=false;release();beginBrowser(session);
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
   if(narration.text)void speak(narration.text,session,narration.status);else stop(narration.status);
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
   wanted=true;starting=true;startPending=true;currentActor=actor();epoch++;const session=epoch;lastHandled=null;lastNarrated=null;message('Opening the microphone…');render();
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
  function accountChanged(){const next=actor();if(!next||next!==currentActor)stop('Voice is off.');currentActor=next;refresh();}
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
