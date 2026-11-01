// A session-bound bridge. Capability checks never request microphone access.
// Native speech can use Apple's recognition service; nothing is sent to our API.
export function installNativeCookVoice({plugin,window:win=globalThis.window,isPremium=()=>false}={}){
 if(!plugin||!win)throw Error('Native Cook voice requires the native plugin.');
 let current=null,sequence=0,requestGeneration=0;
 const permitted=()=>isPremium()===true&&win.document?.hidden!==true;
 const remove=async handles=>{for(const handle of handles)try{await handle.remove();}catch{}};
 const failure=(code)=>Object.assign(Error(code),{code});
 async function cleanup(session){
  if(!session)return;
  if(current===session)current=null;
  session.active=false;
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
  const session={id:'cook-'+Date.now().toString(36)+'-'+(++sequence),active:true,handles:[]};current=session;
  const active=()=>request===requestGeneration&&current===session&&session.active&&permitted();
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
 async function speak(value){
  const text=String(value||'').trim(),session=current;
  if(!text||text.length>500||!session?.active||!permitted())return;
  await plugin.speak({sessionId:session.id,text});
 }
 const api=Object.freeze({
  async available(){try{return (await plugin.available())?.available===true;}catch{return false;}},
  start,stop,speak
 });
 win.document?.addEventListener?.('visibilitychange',()=>{if(win.document.hidden)void stop();});
 win.addEventListener?.('pagehide',()=>void stop());
 win.addEventListener?.('basketboss:session-changed',()=>{if(!permitted())void stop();});
 win.BBNativeCookVoice=api;return api;
}
