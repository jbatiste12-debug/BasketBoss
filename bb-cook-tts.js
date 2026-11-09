/* Premium Cook audio transport. The server owns voices, credentials and
 * membership checks. Conversational audio stays in memory and bypasses caches. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBCookTTS=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_cloud_session_v1',MAX_TEXT=1200,MAX_AUDIO=2*1024*1024;
 const failure=code=>Object.assign(new Error(code),{code});
 const cancelled=()=>Object.assign(new Error('Speech cancelled'),{name:'AbortError',code:'BB_TTS_CANCELLED'});
 // Error bodies are untrusted. Read only a small JSON envelope and retain
 // allowlisted categories, never the provider's text or arbitrary codes.
 const serviceCodes=Object.freeze({
  BB_COOK_PROVIDER_ACCESS:'BB_TTS_SERVICE_ACCESS',
  BB_COOK_PROVIDER_LIMIT:'BB_TTS_SERVICE_LIMIT',
  BB_COOK_PROVIDER_UNAVAILABLE:'BB_TTS_SERVICE_UNAVAILABLE',
  BB_COOK_PROVIDER_RESPONSE:'BB_TTS_SERVICE_RESPONSE',
  BB_COOK_PROVIDER_REJECTED:'BB_TTS_SERVICE_RESPONSE',
  BB_COOK_SERVICE_FAILURE:'BB_TTS_SERVICE_UNAVAILABLE',
  BB_COOK_SERVICE_UNAVAILABLE:'BB_TTS_SERVICE_UNAVAILABLE',
  BB_COOK_DAILY_LIMIT:'BB_TTS_LIMIT'
 });
 async function serviceCode(response,check,add){
  let reader;
  try{
   if(!/^application\/json(?:;|$)/i.test(response.headers?.get?.('Content-Type')||'')||Number(response.headers?.get?.('Content-Length')||0)>2048)return null;
   reader=response.body?.getReader?.();if(!reader)return null;
   const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};
   add(cancel);const chunks=[];let size=0;
   for(;;){const part=await reader.read();check();if(part.done)break;size+=part.value.byteLength;if(size>2048)return null;chunks.push(part.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   return Object.hasOwn(serviceCodes,value?.code)?serviceCodes[value.code]:null;
  }catch{return null;}
  finally{try{Promise.resolve(reader?reader.cancel():response.body?.cancel?.()).catch(()=>{});}catch{}}
 }
 function create({window:win=globalThis.window}={}){
  if(!win)throw failure('BB_TTS_UNAVAILABLE');
  const later=win.setTimeout?.bind(win)||setTimeout,clear=win.clearTimeout?.bind(win)||clearTimeout,preparedAudio=new WeakMap();
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
   const controller=new Controller(),cleanups=[];let reason=null,timer=null,began=false;
   const stop=value=>{if(controller.signal.aborted)return;reason=value;controller.abort();};
   const check=()=>{if(controller.signal.aborted)throw reason||cancelled();if(blocked())throw failure('BB_TTS_SESSION_CHANGED');};
   const started=()=>{check();if(began)return;began=true;options?.onStart?.();check();};
   const add=fn=>cleanups.push(fn),abort=()=>stop(cancelled());
   const external=options?.signal;
   if(external?.aborted)stop(cancelled());else external?.addEventListener?.('abort',abort,{once:true});
   const timeout=Number(options?.timeoutMs),wait=Number.isFinite(timeout)?Math.max(1000,Math.min(360000,timeout)):15000;
   const stopped=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(reason||cancelled()),{once:true}));
   timer=later(()=>stop(failure('BB_TTS_TIMEOUT')),wait);
   const promise=Promise.resolve().then(()=>{check();return task({signal:controller.signal,check,add,stop,started});});
   return Promise.race([promise,stopped]).finally(()=>{clear(timer);external?.removeEventListener?.('abort',abort);for(const fn of cleanups.reverse())try{fn();}catch{}});
  }
  async function session(scope){
   scope.check();if(win.navigator?.onLine===false)throw failure('BB_TTS_OFFLINE');
   const before=read();if(!before?.user?.id)throw failure('BB_TTS_AUTH');
   if(win.BasketBossSession?.ensureFresh)await win.BasketBossSession.ensureFresh();
   scope.check();const current=read();
   if(!usable(current)||current.user.id!==before.user.id)throw failure('BB_TTS_AUTH');
   const pin={actor:current.user.id,token:current.access_token};
   const changed=()=>{const value=read();if(value?.user?.id!==pin.actor||value?.access_token!==pin.token||blocked())scope.stop(failure('BB_TTS_SESSION_CHANGED'));};
   win.addEventListener?.('basketboss:session-changed',changed);win.addEventListener?.('basketboss:account-deletion-started',changed);
   scope.add(()=>{win.removeEventListener?.('basketboss:session-changed',changed);win.removeEventListener?.('basketboss:account-deletion-started',changed);});
   return pin;
  }
  function assertPin(pin,scope){scope.check();const current=read();if(!usable(current)||current.user.id!==pin.actor||current.access_token!==pin.token)throw failure('BB_TTS_SESSION_CHANGED');}
  async function request(text,prepare,pin,scope,privateAudio=false,streamPrivate=false){
   if(typeof win.fetch!=='function')throw failure('BB_TTS_UNAVAILABLE');
   const body=privateAudio?{text,private:true}:prepare?{text,prepare:true}:{text};
   const response=await win.fetch('/api/tts',{method:'POST',headers:{'Authorization':'Bearer '+pin.token,'Content-Type':'application/json','Accept':prepare?'application/json':privateAudio&&streamPrivate?'audio/mpeg; streaming=1':'audio/mpeg'},body:JSON.stringify(body),signal:scope.signal,cache:'no-store',credentials:'omit',redirect:'error'});
   try{scope.check();}catch(error){try{await response?.body?.cancel?.();}catch{}throw error;}
   if(!response?.ok){
    const definitive=({401:'BB_TTS_AUTH',403:'BB_TTS_PREMIUM_REQUIRED',409:'BB_TTS_DELETING'})[response?.status];
    if(definitive){try{Promise.resolve(response.body?.cancel?.()).catch(()=>{});}catch{}throw failure(definitive);}
    const code=await serviceCode(response,scope.check,scope.add);scope.check();
    throw failure(code||'BB_TTS_UNAVAILABLE');
   }return response;
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
  function audioResponse(response){
   const type=(response.headers?.get?.('Content-Type')||'').split(';')[0].trim().toLowerCase(),length=Number(response.headers?.get?.('Content-Length')||0);
   if(type!=='audio/mpeg'||!Number.isSafeInteger(length)||length<0||length>MAX_AUDIO)throw failure('BB_TTS_RESPONSE');
  }
  const validMP3=bytes=>bytes[0]===73&&bytes[1]===68&&bytes[2]===51||bytes[0]===255&&(bytes[1]&224)===224;
  async function mentorBytes(response,pin,scope){
   audioResponse(response);
   const source=reader(response,scope),chunks=[];let size=0;
   if(source){while(true){const item=await source.read();scope.check();if(item.done)break;size+=item.value.byteLength;if(size>MAX_AUDIO)throw failure('BB_TTS_AUDIO');chunks.push(item.value);}}
   else{const data=await response.arrayBuffer();scope.check();size=data.byteLength;if(size>MAX_AUDIO)throw failure('BB_TTS_AUDIO');chunks.push(new Uint8Array(data));}
   if(size<3)throw failure('BB_TTS_AUDIO');
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   if(!validMP3(bytes))throw failure('BB_TTS_AUDIO');
   assertPin(pin,scope);return bytes;
  }
  async function privateBytes(text,scope){
   const pin=await session(scope),response=await request(text,false,pin,scope,true);
   return {pin,bytes:await mentorBytes(response,pin,scope)};
  }
  function base64(bytes){
   const encode=win.btoa?.bind(win)||globalThis.btoa?.bind(globalThis);if(!encode)throw failure('BB_TTS_AUDIO');
   let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
   return encode(binary);
  }
  // Keep prepared private clips local to this transport instance. Neither the
  // session pin nor the bytes are exposed through a URL or persistent cache.
  async function prepareMentor(text,options={}){
   let prompt;try{prompt=validate(text);}catch(error){return Promise.reject(error);}
   return operation({...options,timeoutMs:options.timeoutMs??45000},async scope=>{
    const {pin,bytes}=await privateBytes(prompt,scope),encoded=base64(bytes);assertPin(pin,scope);
    const value=Object.freeze({base64:encoded,contentType:'audio/mpeg'});preparedAudio.set(value,{pin,bytes});return value;
   });
  }
  async function playBytes(bytes,pin,scope){
   assertPin(pin,scope);
   const BlobType=win.Blob||globalThis.Blob;if(!BlobType)throw failure('BB_TTS_AUDIO');
   const player=audio(scope),done=completed(player,scope);player.src=objectURL(new BlobType([bytes],{type:'audio/mpeg'}),scope);
   assertPin(pin,scope);try{await player.play();}catch{throw failure('BB_TTS_AUDIO');}assertPin(pin,scope);scope.started();await done.promise;
   assertPin(pin,scope);return {played:true};
  }
  async function playPreparedMentor(value,options={}){
   const prepared=value&&typeof value==='object'?preparedAudio.get(value):null;
   if(!prepared)throw failure('BB_TTS_AUDIO');
   // A clip is consumed once. A cancelled/obsolete queue cannot replay it later.
   preparedAudio.delete(value);
   return operation({...options,timeoutMs:options.timeoutMs??120000},async scope=>{
    assertPin(prepared.pin,scope);const pin=await session(scope);
    if(pin.actor!==prepared.pin.actor||pin.token!==prepared.pin.token)throw failure('BB_TTS_SESSION_CHANGED');
    return playBytes(prepared.bytes,pin,scope);
   });
  }
  // Validate the small MP3 prefix before creating a player, then expose a
  // bounded reader. We do not wait for the complete sentence's audio bytes.
  async function mentorStream(response,pin,scope){
   audioResponse(response);assertPin(pin,scope);
   const source=response.body.getReader(),pending=[],prefix=[];let size=0,cancelled=false;
   const cancel=()=>{if(cancelled)return;cancelled=true;try{return Promise.resolve(source.cancel()).catch(()=>{});}catch{}};
   scope.add(cancel);
   const readPart=async()=>{
    const part=await source.read();assertPin(pin,scope);
    if(!part.done){size+=part.value.byteLength;if(size>MAX_AUDIO)throw failure('BB_TTS_AUDIO');}
    return part;
   };
   while(prefix.length<3){
    const part=await readPart();if(part.done)throw failure('BB_TTS_AUDIO');pending.push(part.value);
    for(let i=0;i<part.value.byteLength&&prefix.length<3;i++)prefix.push(part.value[i]);
   }
   if(!validMP3(prefix))throw failure('BB_TTS_AUDIO');
   return {body:{getReader:()=>({read:async()=>{assertPin(pin,scope);return pending.length?{done:false,value:pending.shift()}:readPart();},cancel})}};
  }
  async function playMentor(text,options={}){
   let prompt;try{prompt=validate(text);}catch(error){return Promise.reject(error);}
   const words=prompt.split(/\s+/).length,timeoutMs=Math.min(360000,45000+Math.max(15000,Math.ceil(Math.max(words/2.1*1000,prompt.length*55)+8000)));
   return operation({...options,timeoutMs:options.timeoutMs??timeoutMs},async scope=>{
    const Source=win.MediaSource,canStream=typeof Source==='function'&&Source.isTypeSupported?.('audio/mpeg')===true;
    const pin=await session(scope),response=await request(prompt,false,pin,scope,true,canStream);
    if(response.body?.getReader&&canStream){
     const stream=await mentorStream(response,pin,scope);assertPin(pin,scope);
     await progressive(stream,audio(scope),pin,scope,Source);assertPin(pin,scope);return {played:true};
    }
    return playBytes(await mentorBytes(response,pin,scope),pin,scope);
   });
  }
  async function buffered(response,player,pin,scope){
   const source=reader(response,scope),chunks=[];let size=0;
   if(source){while(true){const item=await source.read();scope.check();if(item.done)break;size+=item.value.byteLength;if(size>MAX_AUDIO)throw failure('BB_TTS_AUDIO');chunks.push(item.value);}}
   else{const data=await response.arrayBuffer();scope.check();size=data.byteLength;if(size>MAX_AUDIO)throw failure('BB_TTS_AUDIO');chunks.push(data);}
   if(!size)throw failure('BB_TTS_AUDIO');assertPin(pin,scope);
   const BlobType=win.Blob||globalThis.Blob;if(!BlobType)throw failure('BB_TTS_AUDIO');
   const done=completed(player,scope);player.src=objectURL(new BlobType(chunks,{type:'audio/mpeg'}),scope);
   try{await player.play();}catch{throw failure('BB_TTS_AUDIO');}assertPin(pin,scope);scope.started();await done.promise;
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
      if(!playing){assertPin(pin,scope);playing=true;Promise.resolve(player.play()).then(()=>{assertPin(pin,scope);scope.started();}).catch(error=>done.fail(error?.code?error:failure('BB_TTS_AUDIO')));}
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
  return Object.freeze({prepare,play,prepareMentor,playMentor,playPreparedMentor});
 }
 return Object.freeze({create,MAX_TEXT});
});
