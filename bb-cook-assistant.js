/* A recipe-bound conversation transport. Questions and replies stay in memory;
 * verified membership, model choice and provider credentials are server-owned. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBCookAssistant=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_cloud_session_v1',MAX_BODY=65536,MAX_REPLY=16384;
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
  const history=value.history===undefined?[]:value.history;
  if(!Array.isArray(history)||history.length>6||history.some(h=>!record(h)||!['user','assistant'].includes(h.role)||!text(h.text,1200)))throw failure('BB_MENTOR_CONTEXT');
  if(value.mentorName!==undefined&&!validName(value.mentorName))throw failure('BB_MENTOR_CONTEXT');
  return {question:value.question.trim(),recipe:{id:r.id,title:r.title,servings:r.servings,ingredients:r.ingredients.map(i=>({name:i.name,quantity:i.quantity})),steps:[...r.steps],currentStep,phase:r.phase||'cook',region:r.region||'UK'},history:history.map(h=>({role:h.role,text:h.text})),...(value.mentorName===undefined?{}:{mentorName:value.mentorName.trim()})};
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
  BB_COOK_DAILY_LIMIT:'BB_MENTOR_LIMIT'
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
   let body;try{body=JSON.stringify(validate(value));const Encoder=win.TextEncoder||globalThis.TextEncoder;if(!Encoder||new Encoder().encode(body).byteLength>MAX_BODY)throw failure('BB_MENTOR_CONTEXT');}catch(error){return Promise.reject(error?.code?error:failure('BB_MENTOR_CONTEXT'));}
   const Controller=win.AbortController||globalThis.AbortController;if(!Controller)return Promise.reject(failure('BB_MENTOR_UNAVAILABLE'));
   const controller=new Controller(),cleanups=[];let reason=null,timer=null,pin=null;
   const stop=error=>{if(controller.signal.aborted)return;reason=error;controller.abort();};
   const check=()=>{if(controller.signal.aborted)throw reason||cancelled();if(deleting())throw failure('BB_MENTOR_DELETING');};
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
    const changed=()=>{if(read()?.user?.id!==pin.actor||deleting())stop(failure('BB_MENTOR_SESSION_CHANGED'));};
    for(const name of ['basketboss:session-changed','basketboss:account-deletion-started']){win.addEventListener?.(name,changed);cleanups.push(()=>win.removeEventListener?.(name,changed));}
    if(typeof win.fetch!=='function')throw failure('BB_MENTOR_UNAVAILABLE');
    const response=await win.fetch('/api/cook-assistant',{method:'POST',headers:{Authorization:'Bearer '+pin.token,'Content-Type':'application/json',Accept:'application/json'},body,signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
    check();if(!response?.ok){
     const definitive=({401:'BB_MENTOR_AUTH',403:'BB_MENTOR_PREMIUM_REQUIRED',409:'BB_MENTOR_DELETING',400:'BB_MENTOR_CONTEXT',413:'BB_MENTOR_CONTEXT'})[response?.status];
     if(definitive){try{Promise.resolve(response.body?.cancel?.()).catch(()=>{});}catch{}throw failure(definitive);}
     const code=await serviceCode(response,check,fn=>cleanups.push(fn));check();
     throw failure(code||(response?.status===429?'BB_MENTOR_LIMIT':'BB_MENTOR_UNAVAILABLE'));
    }
    if(!/^application\/json(?:;|$)/i.test(response.headers?.get?.('Content-Type')||'')||Number(response.headers?.get?.('Content-Length')||0)>MAX_REPLY)throw failure('BB_MENTOR_RESPONSE');
    let raw='',size=0;const reader=response.body?.getReader?.();
    if(reader){
     cleanups.push(()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}});
     const Decoder=win.TextDecoder||globalThis.TextDecoder;if(!Decoder)throw failure('BB_MENTOR_RESPONSE');const decoder=new Decoder('utf-8',{fatal:true});
     for(;;){const part=await reader.read();check();if(part.done)break;size+=part.value.byteLength;if(size>MAX_REPLY)throw failure('BB_MENTOR_RESPONSE');raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();
    }else{raw=await response.text();if(raw.length>MAX_REPLY)throw failure('BB_MENTOR_RESPONSE');}
    let result;try{result=JSON.parse(raw);}catch{throw failure('BB_MENTOR_RESPONSE');}
    check();const current=read();if(!usable(current)||current.user.id!==pin.actor||current.access_token!==pin.token)throw failure('BB_MENTOR_SESSION_CHANGED');
    if(!record(result)||Object.keys(result).some(k=>k!=='answer')||!text(result.answer,1000))throw failure('BB_MENTOR_RESPONSE');
    return {answer:result.answer.trim()};
   });
   const safe=task.catch(error=>{if(controller.signal.aborted)throw reason||cancelled();if(typeof error?.code==='string'&&error.code.startsWith('BB_MENTOR_'))throw error;throw failure('BB_MENTOR_UNAVAILABLE');});
   return Promise.race([safe,stopped]).finally(()=>{clear(timer);external?.removeEventListener?.('abort',abort);for(const cleanup of cleanups.reverse())try{cleanup();}catch{}});
  }
  return Object.freeze({ask});
 }
 return Object.freeze({create,validate});
});
