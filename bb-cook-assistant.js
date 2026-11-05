/* A recipe-bound conversation transport. Questions and replies stay in memory;
 * verified membership, model choice and provider credentials are server-owned. */
(function(root,factory){
 'use strict';const api=factory(typeof module==='object'&&module.exports?require('./bb-cook-method.js'):root?.BBCookMethod);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBCookAssistant=api;
})(typeof window==='undefined'?null:window,function(method){
 'use strict';
 const KEY='basketboss_cloud_session_v1',MAX_BODY=65536,MAX_REPLY=16384,MAX_STREAM_BYTES=65536,MAX_STREAM_FRAME=4096,MAX_STREAM_EVENTS=1024;
 const failure=code=>Object.assign(new Error(code),{code});
 const cancelled=()=>Object.assign(new Error('Cooking question cancelled'),{name:'AbortError',code:'BB_MENTOR_CANCELLED'});
 const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
 const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const validName=value=>typeof value==='string'&&value.length>=1&&value.length<=24&&/^[\p{L}\p{M}\p{Nd} .'’\-]+$/u.test(value)&&value.trim().length>0;
 function validate(value){
  if(!record(value)||!text(value.question,600)||!record(value.recipe))throw failure('BB_MENTOR_CONTEXT');
  const r=value.recipe;
  if(!text(r.id,120)||!text(r.title,180)||!Number.isInteger(r.servings)||r.servings<1||r.servings>24||
   !Array.isArray(r.ingredients)||!r.ingredients.length||r.ingredients.length>40||r.ingredients.some(i=>!record(i)||!text(i.name,160)||!text(i.quantity,120))||
   !Array.isArray(r.steps)||!r.steps.length||r.steps.length>40||r.steps.some(s=>!text(s,1600))||
   !['prep','cook'].includes(r.phase||'cook')||!['UK','US','GG','JE'].includes(r.region||'UK'))throw failure('BB_MENTOR_CONTEXT');
  const currentStep=r.phase==='prep'&&r.currentStep==null?0:r.currentStep;
  if(!Number.isInteger(currentStep)||currentStep<0||currentStep>=r.steps.length)throw failure('BB_MENTOR_CONTEXT');
  // Clean each existing card in place. Splitting/filtering this array would
  // move currentStep onto a different instruction from the visible Cook card.
  const steps=r.steps.map(step=>method?.normalizeStep(step,r)??step);
  if(steps.some(step=>!text(step,1600)))throw failure('BB_MENTOR_CONTEXT');
  const history=value.history===undefined?[]:value.history;
  if(!Array.isArray(history)||history.length>6||history.some(h=>!record(h)||!['user','assistant'].includes(h.role)||!text(h.text,1200)))throw failure('BB_MENTOR_CONTEXT');
  if(value.mentorName!==undefined&&!validName(value.mentorName))throw failure('BB_MENTOR_CONTEXT');
  return {question:value.question.trim(),recipe:{id:r.id,title:r.title,servings:r.servings,ingredients:r.ingredients.map(i=>({name:i.name,quantity:i.quantity})),steps,currentStep,phase:r.phase||'cook',region:r.region||'UK'},history:history.map(h=>({role:h.role,text:h.text})),...(value.mentorName===undefined?{}:{mentorName:value.mentorName.trim()})};
 }
 // Keep recent, completed turns whole. The recipe and its exact ingredient
 // quantities remain untouched; old conversation is the expendable context.
 function recentHistory(history){
  const pairs=[];let size=0;
  for(let i=history.length-1;i>0&&pairs.length<2;i--){
   if(history[i].role!=='assistant'||history[i-1].role!=='user')continue;
   const pair=[history[i-1],history[i]],length=pair[0].text.length+pair[1].text.length;
   if(size+length>1800)break;
   pairs.unshift(pair);size+=length;i--;
  }
  return pairs.flat();
 }
 // Error bodies are untrusted. Read only a small JSON envelope and retain
 // allowlisted categories, never the provider's text or arbitrary codes.
 const serviceCodes=Object.freeze({
  BB_COOK_PROVIDER_ACCESS:'BB_MENTOR_SERVICE_ACCESS',
  BB_COOK_PROVIDER_LIMIT:'BB_MENTOR_SERVICE_LIMIT',
  BB_COOK_PROVIDER_UNAVAILABLE:'BB_MENTOR_SERVICE_UNAVAILABLE',
  BB_COOK_PROVIDER_RESPONSE:'BB_MENTOR_SERVICE_RESPONSE',
  BB_COOK_PROVIDER_REJECTED:'BB_MENTOR_SERVICE_RESPONSE',
  BB_COOK_SERVICE_FAILURE:'BB_MENTOR_SERVICE_UNAVAILABLE',
  BB_COOK_SERVICE_UNAVAILABLE:'BB_MENTOR_SERVICE_UNAVAILABLE',
  BB_COOK_DAILY_LIMIT:'BB_MENTOR_LIMIT',
  BB_COOK_ACCOUNT_PENDING:'BB_MENTOR_DELETING',
  BB_COOK_REQUEST_CANCELLED:'BB_MENTOR_CANCELLED'
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
  if(!win)throw failure('BB_MENTOR_UNAVAILABLE');
  const read=()=>{try{return win.BasketBossSession?.read?.()||JSON.parse(win.localStorage?.getItem(KEY)||'null');}catch{return null;}};
  const deleting=()=>{if(win.BBAccountDeletion?.isDeleting?.()===true)return true;try{return ['pending','deleting','deleted'].includes(JSON.parse(win.localStorage?.getItem('basketboss_account_deletion_v1')||'null')?.phase);}catch{return true;}};
  const usable=s=>!!s?.user?.id&&typeof s.access_token==='string'&&s.access_token.length>0&&s.access_token.length<=16384&&Number(s.expires_at)*1000>Date.now()+5000;
  const later=win.setTimeout?.bind(win)||setTimeout,clear=win.clearTimeout?.bind(win)||clearTimeout;
  function ask(value,options={}){
   const streaming=typeof options.onDelta==='function';
   let body;try{const input=validate(value);if(streaming)input.history=recentHistory(input.history);body=JSON.stringify(input);const Encoder=win.TextEncoder||globalThis.TextEncoder;if(!Encoder||new Encoder().encode(body).byteLength>MAX_BODY)throw failure('BB_MENTOR_CONTEXT');}catch(error){return Promise.reject(error?.code?error:failure('BB_MENTOR_CONTEXT'));}
   const Controller=win.AbortController||globalThis.AbortController;if(!Controller)return Promise.reject(failure('BB_MENTOR_UNAVAILABLE'));
   const controller=new Controller(),cleanups=[];let reason=null,timer=null,pin=null;
   const stop=error=>{if(controller.signal.aborted)return;reason=error;controller.abort();};
   const check=()=>{if(controller.signal.aborted)throw reason||cancelled();if(deleting()){const error=failure('BB_MENTOR_DELETING');if(pin)stop(error);throw error;}if(pin){const current=read();if(!usable(current)||current.user.id!==pin.actor||current.access_token!==pin.token){stop(failure('BB_MENTOR_SESSION_CHANGED'));throw reason;}}};
   const deliver=(delta,answer)=>{check();options.onDelta(delta,answer);check();};
   const external=options.signal,abort=()=>stop(cancelled());
   const stopped=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(reason||cancelled()),{once:true}));
   if(external?.aborted)stop(cancelled());else external?.addEventListener?.('abort',abort,{once:true});
   const timeout=Number(options.timeoutMs);timer=later(()=>stop(failure('BB_MENTOR_TIMEOUT')),Number.isFinite(timeout)?Math.max(1000,Math.min(60000,timeout)):45000);
   const task=Promise.resolve().then(async()=>{
    check();if(win.navigator?.onLine===false)throw failure('BB_MENTOR_OFFLINE');
    const before=read();if(!before?.user?.id)throw failure('BB_MENTOR_AUTH');
    if(win.BasketBossSession?.ensureFresh)await win.BasketBossSession.ensureFresh();
    check();const session=read();if(!usable(session)||session.user.id!==before.user.id)throw failure('BB_MENTOR_AUTH');
    pin={actor:session.user.id,token:session.access_token};
    const changed=()=>{const current=read();if(!usable(current)||current.user.id!==pin.actor||current.access_token!==pin.token||deleting())stop(failure('BB_MENTOR_SESSION_CHANGED'));};
    for(const name of ['basketboss:session-changed','basketboss:account-deletion-started']){win.addEventListener?.(name,changed);cleanups.push(()=>win.removeEventListener?.(name,changed));}
    if(typeof win.fetch!=='function')throw failure('BB_MENTOR_UNAVAILABLE');
    const response=await win.fetch('/api/cook-assistant',{method:'POST',headers:{Authorization:'Bearer '+pin.token,'Content-Type':'application/json',Accept:streaming?'application/x-ndjson':'application/json'},body,signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
    cleanups.push(()=>{try{Promise.resolve(response?.body?.cancel?.()).catch(()=>{});}catch{}});
    check();if(!response?.ok){
     const definitive=({401:'BB_MENTOR_AUTH',403:'BB_MENTOR_PREMIUM_REQUIRED',409:'BB_MENTOR_DELETING',400:'BB_MENTOR_CONTEXT',413:'BB_MENTOR_CONTEXT'})[response?.status];
     if(definitive){try{Promise.resolve(response.body?.cancel?.()).catch(()=>{});}catch{}throw failure(definitive);}
     const code=await serviceCode(response,check,fn=>cleanups.push(fn));check();
     throw failure(code||(response?.status===429?'BB_MENTOR_LIMIT':'BB_MENTOR_UNAVAILABLE'));
    }
    const contentType=response.headers?.get?.('Content-Type')||'';
    if(streaming&&/^application\/x-ndjson(?:;|$)/i.test(contentType)){
     if(Number(response.headers?.get?.('Content-Length')||0)>MAX_STREAM_BYTES)throw failure('BB_MENTOR_RESPONSE');
     const reader=response.body?.getReader?.(),Decoder=win.TextDecoder||globalThis.TextDecoder,Encoder=win.TextEncoder||globalThis.TextEncoder;
     if(!reader||!Decoder||!Encoder)throw failure('BB_MENTOR_RESPONSE');
     cleanups.push(()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}});
     const decoder=new Decoder('utf-8',{fatal:true}),encoder=new Encoder();let pending='',answer='',size=0,events=0,done=false;
     const frame=line=>{
      if(!line.trim())return;
      if(done||encoder.encode(line).byteLength>MAX_STREAM_FRAME||++events>MAX_STREAM_EVENTS)throw failure('BB_MENTOR_RESPONSE');
      let event;try{event=JSON.parse(line);}catch{throw failure('BB_MENTOR_RESPONSE');}
      if(!record(event))throw failure('BB_MENTOR_RESPONSE');
      if(event.type==='delta'){
       if(Object.keys(event).some(k=>!['type','text'].includes(k))||typeof event.text!=='string'||!event.text.length||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(event.text)||answer.length+event.text.length>1000)throw failure('BB_MENTOR_RESPONSE');
       answer+=event.text;deliver(event.text,answer);
      }else if(event.type==='done'){
       if(Object.keys(event).some(k=>k!=='type')||!text(answer,1000))throw failure('BB_MENTOR_RESPONSE');done=true;
      }else if(event.type==='error'){
       if(Object.keys(event).some(k=>!['type','code'].includes(k))||typeof event.code!=='string')throw failure('BB_MENTOR_RESPONSE');
       throw failure(Object.hasOwn(serviceCodes,event.code)?serviceCodes[event.code]:'BB_MENTOR_UNAVAILABLE');
      }else throw failure('BB_MENTOR_RESPONSE');
     };
     try{
      for(;;){
       const part=await reader.read();check();
       if(part.done)pending+=decoder.decode();
       else{size+=part.value.byteLength;if(size>MAX_STREAM_BYTES)throw failure('BB_MENTOR_RESPONSE');pending+=decoder.decode(part.value,{stream:true});}
       let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);frame(line);}
       if(encoder.encode(pending).byteLength>MAX_STREAM_FRAME)throw failure('BB_MENTOR_RESPONSE');
       if(part.done){if(pending){const line=pending;pending='';frame(line);}if(!done)throw failure('BB_MENTOR_RESPONSE');}
       if(done){if(pending.trim())throw failure('BB_MENTOR_RESPONSE');check();return {answer:answer.trim()};}
      }
     }catch(error){if(typeof error?.code==='string'&&error.code.startsWith('BB_MENTOR_'))throw error;throw failure('BB_MENTOR_RESPONSE');}
    }
    if(!/^application\/json(?:;|$)/i.test(contentType)||Number(response.headers?.get?.('Content-Length')||0)>MAX_REPLY)throw failure('BB_MENTOR_RESPONSE');
    let raw='',size=0;const reader=response.body?.getReader?.();
    if(reader){
     cleanups.push(()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}});
     const Decoder=win.TextDecoder||globalThis.TextDecoder;if(!Decoder)throw failure('BB_MENTOR_RESPONSE');const decoder=new Decoder('utf-8',{fatal:true});
     for(;;){const part=await reader.read();check();if(part.done)break;size+=part.value.byteLength;if(size>MAX_REPLY)throw failure('BB_MENTOR_RESPONSE');raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();
    }else{raw=await response.text();if(raw.length>MAX_REPLY)throw failure('BB_MENTOR_RESPONSE');}
    let result;try{result=JSON.parse(raw);}catch{throw failure('BB_MENTOR_RESPONSE');}
    check();const current=read();if(!usable(current)||current.user.id!==pin.actor||current.access_token!==pin.token)throw failure('BB_MENTOR_SESSION_CHANGED');
    if(!record(result)||Object.keys(result).some(k=>k!=='answer')||!text(result.answer,1000))throw failure('BB_MENTOR_RESPONSE');
    const answer=result.answer.trim();if(streaming)deliver(answer,answer);return {answer};
   });
   const safe=task.catch(error=>{if(controller.signal.aborted)throw reason||cancelled();if(typeof error?.code==='string'&&error.code.startsWith('BB_MENTOR_'))throw error;throw failure('BB_MENTOR_UNAVAILABLE');});
   return Promise.race([safe,stopped]).finally(()=>{clear(timer);external?.removeEventListener?.('abort',abort);for(const cleanup of cleanups.reverse())try{cleanup();}catch{}});
  }
  return Object.freeze({ask});
 }
 return Object.freeze({create,validate});
});
