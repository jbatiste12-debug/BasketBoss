// A session-bound bridge. Capability checks never request microphone access.
// Recognition can use Apple's service. Opted-in questions are sent by the web
// controller; personalised speech bytes remain in memory for this session only.
export function installNativeCookVoice({plugin,window:win=globalThis.window,isPremium=()=>false}={}){
 if(!plugin||!win)throw Error('Native Cook voice requires the native plugin.');
 let current=null,sequence=0,requestGeneration=0,speechGeneration=0,speechOperation=null;
 const permitted=()=>isPremium()===true&&win.document?.hidden!==true;
 const actor=()=>{try{return win.BasketBossSession?.read?.()?.user?.id||JSON.parse(win.localStorage?.getItem('basketboss_cloud_session_v1')||'null')?.user?.id||null;}catch{return null;}};
 const remove=async handles=>{for(const handle of handles)try{await handle.remove();}catch{}};
 const failure=(code)=>Object.assign(Error(code),{code});
 async function cleanup(session){
  if(!session)return;
  if(current===session)current=null;
  session.active=false;speechGeneration++;speechOperation=null;
  if(!session.cleanup)session.cleanup=Promise.allSettled([plugin.stop({sessionId:session.id}),remove(session.handles)]);
  await session.cleanup;
 }
 async function stop(){
  // A Stop also cancels a replacement waiting for the previous native session
  // to release its microphone, even while current has temporarily been cleared.
  requestGeneration++;
  await cleanup(current);
 }
 async function start(onFinal,onStatus){
  if(!permitted())throw failure('BB_VOICE_PREMIUM_REQUIRED');
  const request=++requestGeneration;
  await cleanup(current);
  if(request!==requestGeneration)throw failure('BB_VOICE_STOPPED');
  if(!permitted())throw failure('BB_VOICE_PREMIUM_REQUIRED');
  const session={id:'cook-'+Date.now().toString(36)+'-'+(++sequence),actor:actor(),active:true,handles:[]};current=session;
  const active=()=>request===requestGeneration&&current===session&&session.active&&session.actor===actor()&&permitted();
  try{
   for(const [name,callback]of [
    ['voiceResult',event=>{if(!active()||event?.sessionId!==session.id||event?.isFinal!==true)return;const text=typeof event.text==='string'?event.text.trim():'';if(text&&text.length<=500)onFinal?.(text);}],
    ['voiceStatus',event=>{if(!active()||event?.sessionId!==session.id)return;const state=['listening','paused','stopped','error'].includes(event.state)?event.state:null;if(!state)return;onStatus?.({state,code:typeof event.code==='string'?event.code.slice(0,80):undefined});}]
   ]){
    const handle=await plugin.addListener(name,callback);
    if(!active()){await handle.remove();throw failure('BB_VOICE_STOPPED');}
    session.handles.push(handle);
   }
   const result=await plugin.start({sessionId:session.id});
   if(!active()){await plugin.stop({sessionId:session.id});throw failure('BB_VOICE_STOPPED');}
   if(result?.active!==true)throw failure('BB_VOICE_UNAVAILABLE');
  }catch(error){
   await cleanup(session);
   throw error;
  }
 }
 const cancelled=()=>({spoken:false,cancelled:true});
 const activeSpeech=(operation)=>operation&&speechOperation===operation&&current===operation.session&&operation.session.active&&operation.session.actor===actor()&&operation.generation===speechGeneration&&permitted();
 function trustedAudioURL(value){
  try{
   const url=new URL(value);
   if(url.protocol!=='https:'||url.hostname!=='basketboss.co.uk'||url.port||url.username||url.password||url.hash||url.pathname!=='/api/tts')return null;
   const entries=[...url.searchParams];
   return entries.length===1&&entries[0][0]==='clip'&&/^[a-f0-9]{64}$/.test(entries[0][1])?url.href:null;
  }catch{return null;}
 }
 async function prepareSpeech(){
  const session=current,generation=++speechGeneration;speechOperation=null;
  if(!session?.active||!permitted())return cancelled();
  const result=await plugin.prepareSpeech({sessionId:session.id});
  const speechId=result?.speechId;
  if(typeof speechId!=='string'||!speechId||speechId.length>80)return cancelled();
  if(current!==session||!session.active||session.actor!==actor()||!permitted()||generation!==speechGeneration){
   try{await plugin.cancelSpeech({sessionId:session.id,speechId});}catch{}
   return cancelled();
  }
  speechOperation={speechId,session,generation};
  return {speechId};
 }
 async function cancelSpeech({speechId}={}){
  const operation=speechOperation;
  if(!operation||operation.speechId!==speechId)return cancelled();
  speechGeneration++;speechOperation=null;
  try{await plugin.cancelSpeech({sessionId:operation.session.id,speechId});}catch{}
  return cancelled();
 }
 async function playAudio({url,token,speechId}={}){
  const operation=speechOperation;
  if(!activeSpeech(operation)||operation.speechId!==speechId)return cancelled();
  const address=trustedAudioURL(url);
  if(!address||typeof token!=='string'||!token||token.length>16384||!/^[A-Za-z0-9._~-]+$/.test(token))throw failure('BB_VOICE_AUDIO_URL');
  try{
   const result=await plugin.playAudio({sessionId:operation.session.id,speechId,url:address,token});
   if(!activeSpeech(operation))return cancelled();
   return result;
  }catch(error){if(!activeSpeech(operation))return cancelled();throw error;}
 }
 function validAudioData(base64){
  const maximum=2*1024*1024;
  if(typeof base64!=='string'||base64.length>Math.ceil(maximum/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))return false;
  const size=base64.length/4*3-(base64.endsWith('==')?2:base64.endsWith('=')?1:0);
  if(size<3||size>maximum)return false;
  try{
   // Decode only the prefix here; native code validates the complete bounded
   // data before constructing its in-memory player. Do not retain a JS copy.
   const decode=win.atob||globalThis.atob;if(typeof decode!=='function')return false;
   const head=decode(base64.slice(0,4));
   return head==='ID3'||head.charCodeAt(0)===255&&(head.charCodeAt(1)&224)===224;
  }catch{return false;}
 }
 async function playAudioData({base64,contentType,speechId}={}){
  const operation=speechOperation;
  if(!activeSpeech(operation)||operation.speechId!==speechId)return cancelled();
  if(contentType!=='audio/mpeg'||!validAudioData(base64)||typeof plugin.playAudioData!=='function')throw failure('BB_VOICE_AI_AUDIO');
  try{
   const result=await plugin.playAudioData({sessionId:operation.session.id,speechId,base64,contentType});
   if(!activeSpeech(operation))return cancelled();
   return result;
  }catch(error){if(!activeSpeech(operation))return cancelled();throw error;}
 }
 async function speak(value,{speechId}={}){
  const text=String(value||'').trim(),session=current;
  // Never truncate cooking or food-safety guidance.
  if(text.length>4000)throw failure('BB_VOICE_TEXT');
  if(!text||!session?.active||!permitted())return cancelled();
  const operation=speechOperation;
  if(speechId!==undefined&&(!activeSpeech(operation)||operation.speechId!==speechId))return cancelled();
  if(speechId===undefined){speechGeneration++;speechOperation=null;}
  const result=await plugin.speak({sessionId:session.id,text,...(speechId===undefined?{}:{speechId})});
  if(current!==session||!session.active||!permitted())return cancelled();
  return result;
 }
 const api=Object.freeze({
  async available(){try{return (await plugin.available())?.available===true;}catch{return false;}},
  start,stop,speak,prepareSpeech,playAudio,playAudioData,cancelSpeech
 });
 win.document?.addEventListener?.('visibilitychange',()=>{if(win.document.hidden)void stop();});
 win.addEventListener?.('pagehide',()=>void stop());
 win.addEventListener?.('basketboss:session-changed',()=>{if(!permitted()||current&&current.actor!==actor())void stop();});
 win.addEventListener?.('basketboss:account-deletion-started',()=>void stop());
 win.BBNativeCookVoice=api;return api;
}
