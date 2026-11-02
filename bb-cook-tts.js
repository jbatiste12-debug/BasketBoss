/* Premium Cook audio transport. Recipe text is the only provider input; the
 * server owns voices, credentials, membership checks and the private cache. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBCookTTS=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_cloud_session_v1',MAX_TEXT=1200,MAX_AUDIO=2*1024*1024;
 const failure=code=>Object.assign(new Error(code),{code});
 const cancelled=()=>Object.assign(new Error('Speech cancelled'),{name:'AbortError',code:'BB_TTS_CANCELLED'});
 function create({window:win=globalThis.window}={}){
  if(!win)throw failure('BB_TTS_UNAVAILABLE');
  const later=win.setTimeout?.bind(win)||setTimeout,clear=win.clearTimeout?.bind(win)||clearTimeout;
  const read=()=>{try{return win.BasketBossSession?.read?.()||JSON.parse(win.localStorage?.getItem(KEY)||'null');}catch{return null;}};
  const blocked=()=>{
   if(win.BBAccountDeletion?.isDeleting?.()===true)return true;
   try{const value=JSON.parse(win.localStorage?.getItem('basketboss_account_deletion_v1')||'null');return ['pending','deleting','deleted'].includes(value?.phase);}catch{return true;}
  };
  const usable=value=>!!value?.user?.id&&typeof value.access_token==='string'&&value.access_token.length>0&&value.access_token.length<=16384&&Number(value.expires_at)*1000>Date.now()+5000;
  const validate=text=>{if(typeof text!=='string'||!text.trim()||text.length>MAX_TEXT)throw failure('BB_TTS_TEXT');return text.trim();};
  const origin=()=>{
   const location=win.location;
   if(location?.protocol==='capacitor:'||win.BBNative?.isNative===true)return 'https://basketboss.co.uk';
   try{return new URL(location?.href||'https://basketboss.co.uk/').origin;}catch{throw failure('BB_TTS_UNAVAILABLE');}
  };
  function operation(options,task){
   const Controller=win.AbortController||globalThis.AbortController;
   if(!Controller)return Promise.reject(failure('BB_TTS_UNAVAILABLE'));
   const controller=new Controller(),cleanups=[];let reason=null,timer=null;
   const stop=value=>{if(controller.signal.aborted)return;reason=value;controller.abort();};
   const check=()=>{if(controller.signal.aborted)throw reason||cancelled();if(blocked())throw failure('BB_TTS_SESSION_CHANGED');};
   const add=fn=>cleanups.push(fn),abort=()=>stop(cancelled());
   const external=options?.signal;
   if(external?.aborted)stop(cancelled());else external?.addEventListener?.('abort',abort,{once:true});
   const timeout=Number(options?.timeoutMs),wait=Number.isFinite(timeout)?Math.max(1000,Math.min(360000,timeout)):15000;
   const stopped=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(reason||cancelled()),{once:true}));
   timer=later(()=>stop(failure('BB_TTS_TIMEOUT')),wait);
   const promise=Promise.resolve().then(()=>{check();return task({signal:controller.signal,check,add,stop});});
   return Promise.race([promise,stopped]).finally(()=>{clear(timer);external?.removeEventListener?.('abort',abort);for(const fn of cleanups.reverse())try{fn();}catch{}});
  }
  async function session(scope){
   scope.check();if(win.navigator?.onLine===false)throw failure('BB_TTS_OFFLINE');
   const before=read();if(!before?.user?.id)throw failure('BB_TTS_AUTH');
   if(win.BasketBossSession?.ensureFresh)await win.BasketBossSession.ensureFresh();
   scope.check();const current=read();
   if(!usable(current)||current.user.id!==before.user.id)throw failure('BB_TTS_AUTH');
   const pin={actor:current.user.id,token:current.access_token};
   const changed=()=>{if(read()?.user?.id!==pin.actor||blocked())scope.stop(failure('BB_TTS_SESSION_CHANGED'));};
   win.addEventListener?.('basketboss:session-changed',changed);win.addEventListener?.('basketboss:account-deletion-started',changed);
   scope.add(()=>{win.removeEventListener?.('basketboss:session-changed',changed);win.removeEventListener?.('basketboss:account-deletion-started',changed);});
   return pin;
  }
  function assertPin(pin,scope){scope.check();const current=read();if(!usable(current)||current.user.id!==pin.actor||current.access_token!==pin.token)throw failure('BB_TTS_SESSION_CHANGED');}
  async function request(text,prepare,pin,scope){
   if(typeof win.fetch!=='function')throw failure('BB_TTS_UNAVAILABLE');
   const response=await win.fetch('/api/tts',{method:'POST',headers:{'Authorization':'Bearer '+pin.token,'Content-Type':'application/json','Accept':prepare?'application/json':'audio/mpeg'},body:JSON.stringify(prepare?{text,prepare:true}:{text}),signal:scope.signal,cache:'no-store',credentials:'omit',redirect:'error'});
   scope.check();if(!response?.ok)throw failure(({401:'BB_TTS_AUTH',403:'BB_TTS_PREMIUM_REQUIRED',409:'BB_TTS_DELETING'})[response?.status]||'BB_TTS_UNAVAILABLE');return response;
  }
  async function prepare(text,options={}){
   let prompt;try{prompt=validate(text);}catch(error){return Promise.reject(error);}
   return operation(options,async scope=>{
    const pin=await session(scope),response=await request(prompt,true,pin,scope);
    const type=response.headers?.get?.('Content-Type')||'';if(!/^application\/json(?:;|$)/i.test(type))throw failure('BB_TTS_RESPONSE');
    const value=await response.json();assertPin(pin,scope);
    if(!/^[a-f0-9]{64}$/.test(value?.clipId||'')||value.url!=='/api/tts?clip='+value.clipId||value.contentType!=='audio/mpeg')throw failure('BB_TTS_RESPONSE');
    return {url:origin()+value.url,token:pin.token,clipId:value.clipId,contentType:value.contentType};
   });
  }
  function audio(scope){
   const value=typeof win.Audio==='function'?new win.Audio():win.document?.createElement?.('audio');
   if(!value?.play)throw failure('BB_TTS_AUDIO');value.preload='auto';value.playsInline=true;
   scope.add(()=>{try{value.pause();value.removeAttribute?.('src');value.load?.();}catch{}});return value;
  }
  function objectURL(value,scope){
   const urls=win.URL||globalThis.URL;if(typeof urls?.createObjectURL!=='function')throw failure('BB_TTS_AUDIO');
   const url=urls.createObjectURL(value);scope.add(()=>urls.revokeObjectURL(url));return url;
  }
  function completed(player,scope){
   let finish,fail;const promise=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
   const ended=()=>finish(),error=()=>fail(failure('BB_TTS_AUDIO'));
   player.addEventListener('ended',ended);player.addEventListener('error',error);
   scope.add(()=>{player.removeEventListener('ended',ended);player.removeEventListener('error',error);});
   return {promise,fail};
  }
  function reader(response,scope){
   const value=response.body?.getReader?.();if(value)scope.add(()=>{try{Promise.resolve(value.cancel()).catch(()=>{});}catch{}});return value;
  }
  async function buffered(response,player,pin,scope){
   const source=reader(response,scope),chunks=[];let size=0;
   if(source){while(true){const item=await source.read();scope.check();if(item.done)break;size+=item.value.byteLength;if(size>MAX_AUDIO)throw failure('BB_TTS_AUDIO');chunks.push(item.value);}}
   else{const data=await response.arrayBuffer();scope.check();size=data.byteLength;if(size>MAX_AUDIO)throw failure('BB_TTS_AUDIO');chunks.push(data);}
   if(!size)throw failure('BB_TTS_AUDIO');assertPin(pin,scope);
   const BlobType=win.Blob||globalThis.Blob;if(!BlobType)throw failure('BB_TTS_AUDIO');
   const done=completed(player,scope);player.src=objectURL(new BlobType(chunks,{type:'audio/mpeg'}),scope);
   try{await player.play();}catch{throw failure('BB_TTS_AUDIO');}await done.promise;
  }
  async function progressive(response,player,pin,scope,Source){
   const media=new Source(),done=completed(player,scope),source=reader(response,scope);let size=0,buffer=null,playing=false;
   if(!source)throw failure('BB_TTS_AUDIO');
   scope.add(()=>{try{if(media.readyState==='open'){if(buffer?.updating)buffer.abort();if(buffer)media.removeSourceBuffer(buffer);}}catch{}});
   const append=data=>new Promise((resolve,reject)=>{
    scope.check();const update=()=>{cleanup();resolve();},error=()=>{cleanup();reject(failure('BB_TTS_AUDIO'));};
    const cleanup=()=>{buffer.removeEventListener('updateend',update);buffer.removeEventListener('error',error);};
    buffer.addEventListener('updateend',update,{once:true});buffer.addEventListener('error',error,{once:true});scope.add(cleanup);
    try{buffer.appendBuffer(data);}catch{cleanup();reject(failure('BB_TTS_AUDIO'));}
   });
   const opened=async()=>{
    try{
     assertPin(pin,scope);buffer=media.addSourceBuffer('audio/mpeg');
     while(true){
      const item=await source.read();scope.check();if(item.done)break;
      size+=item.value.byteLength;if(size>MAX_AUDIO)throw failure('BB_TTS_AUDIO');await append(item.value);scope.check();
      if(!playing){assertPin(pin,scope);playing=true;Promise.resolve(player.play()).catch(()=>done.fail(failure('BB_TTS_AUDIO')));}
     }
     if(!size)throw failure('BB_TTS_AUDIO');if(media.readyState==='open')media.endOfStream();
    }catch(error){done.fail(error);}
   };
   media.addEventListener('sourceopen',opened,{once:true});scope.add(()=>media.removeEventListener('sourceopen',opened));
   player.src=objectURL(media,scope);await done.promise;
  }
  async function play(text,options={}){
   let prompt;try{prompt=validate(text);}catch(error){return Promise.reject(error);}
   return operation(options,async scope=>{
    const pin=await session(scope),response=await request(prompt,false,pin,scope);
    const type=(response.headers?.get?.('Content-Type')||'').split(';')[0].trim().toLowerCase(),length=Number(response.headers?.get?.('Content-Length')||0);
    if(type!=='audio/mpeg'||length>MAX_AUDIO)throw failure('BB_TTS_RESPONSE');assertPin(pin,scope);
    const player=audio(scope),Source=win.MediaSource;
    if(response.body?.getReader&&typeof Source==='function'&&Source.isTypeSupported?.('audio/mpeg'))await progressive(response,player,pin,scope,Source);
    else await buffered(response,player,pin,scope);
    scope.check();return {played:true};
   });
  }
  return Object.freeze({prepare,play});
 }
 return Object.freeze({create,MAX_TEXT});
});
