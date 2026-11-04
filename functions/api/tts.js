/* Premium Cook speech. The bucket is private; every clip read authenticates and
 * verifies membership before looking in the shared content-addressed cache. */
import {json,authenticatedUser,isConfigured,requireSameOrigin} from '../../bb-server-lib/bb-billing.js';
import {readMemberPaidAccess,paidBillingEnabled} from '../../bb-server-lib/bb-paid-access.js';
import {isAccountDeleting,digestDeletionActor} from '../../bb-server-lib/bb-account-deletion.js';
import {TTS_PROFILE,TTS_CONTENT_TYPE,TTS_AUDIO_LIMIT,validClip,clipId,clipKey,missLimits,limitedJSON,audioHeaders,byteRange,requestSpeech} from '../../bb-server-lib/bb-tts.js';
import {privateAudioResponse} from '../../bb-server-lib/bb-private-audio-stream.js';
import {cookServiceError,cookServiceCode,cookAuthorizationCode,logCookDiagnostic} from '../../bb-server-lib/bb-cook-service-error.js';
const LEASE_MS=120000;
async function authorize(request,env){
 const user=await authenticatedUser(request,env);if(!user)return {error:'Sign in with a verified account',status:401};
 if(await isAccountDeleting(env,user.id))return {error:'Account deletion is in progress',status:409};
 if(env.BB_OWNER_USER_ID&&user.id===env.BB_OWNER_USER_ID)return {user,ownerId:user.id};
 if(!paidBillingEnabled(env))return {error:'Verified Premium membership required',status:403};
 const access=await readMemberPaidAccess(request,env,user);if(!access.premiumAccess)return {error:'Verified Premium membership required',status:403};
 const ownerId=access.householdOwnerId||user.id;
 if(ownerId!==user.id&&await isAccountDeleting(env,ownerId))return {error:'Membership is temporarily unavailable',status:409};
 return {user,ownerId};
}
async function claimLease(env,id,token,member,now){
 const hashes=await Promise.all([digestDeletionActor(member.user.id),digestDeletionActor(member.ownerId)]);
 return !!await env.BILLING_DB.prepare(`INSERT INTO bb_tts_cache_leases(clip_id,lease_token,locked_until_ms)
  SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash IN (?,?))
  ON CONFLICT(clip_id) DO UPDATE SET lease_token=excluded.lease_token,locked_until_ms=excluded.locked_until_ms
  WHERE locked_until_ms<=? AND NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash IN (?,?))
  RETURNING lease_token`).bind(id,token,now+LEASE_MS,...hashes,now,...hashes).first();
}
async function releaseLease(env,id,token){await env.BILLING_DB.prepare('DELETE FROM bb_tts_cache_leases WHERE clip_id=? AND lease_token=?').bind(id,token).run();}
async function consumeMiss(env,member,limits,now){
 const day=new Date(now).toISOString().slice(0,10),hashes=await Promise.all([digestDeletionActor(member.user.id),digestDeletionActor(member.ownerId)]);
 const personal=await env.BILLING_DB.prepare(`INSERT INTO bb_ai_daily_usage(day_utc,actor,action,used)
  SELECT ?,?,'cook-tts',1 WHERE NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash IN (?,?))
  AND COALESCE((SELECT used FROM bb_ai_daily_usage WHERE day_utc=? AND actor='global' AND action='cook-tts'),0)<?
  ON CONFLICT(day_utc,actor,action) DO UPDATE SET used=used+1 WHERE used<?
  AND NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash IN (?,?))
  AND COALESCE((SELECT used FROM bb_ai_daily_usage WHERE day_utc=? AND actor='global' AND action='cook-tts'),0)<? RETURNING used`)
  .bind(day,'user:'+member.ownerId,...hashes,day,limits.global,limits.personal,...hashes,day,limits.global).first();
 if(!personal)return false;
 const global=await env.BILLING_DB.prepare(`INSERT INTO bb_ai_daily_usage(day_utc,actor,action,used) VALUES(?,'global','cook-tts',1)
  ON CONFLICT(day_utc,actor,action) DO UPDATE SET used=used+1 WHERE used<? RETURNING used`).bind(day,limits.global).first();
 if(!global){
  // Another clip may win the final global slot after our personal reservation.
  // Refund only an existing row; an account deletion can never be recreated.
  await env.BILLING_DB.prepare("UPDATE bb_ai_daily_usage SET used=used-1 WHERE day_utc=? AND actor=? AND action='cook-tts' AND used>0").bind(day,'user:'+member.ownerId).run();
  return false;
 }
 return true;
}
async function savedResponse(request,env,id){
 const bucket=env.BB_TTS_AUDIO,key=clipKey(id),range=request.headers.get('Range');
 if(range||request.method==='HEAD'){
  const head=await bucket.head(key);if(!head)return json({error:'Speech clip not found'},404);
  if(head.customMetadata?.profile!==TTS_PROFILE||head.httpMetadata?.contentType!==TTS_CONTENT_TYPE||!Number.isSafeInteger(head.size)||head.size<=0||head.size>TTS_AUDIO_LIMIT)return json({error:'Speech audio is unavailable'},503);
  const headers=audioHeaders(id,head.size);
  if(request.method==='HEAD')return new Response(null,{headers});
  const selected=byteRange(range,head.size);if(selected===false){headers.set('Content-Range','bytes */'+head.size);headers.delete('Content-Length');return new Response(null,{status:416,headers});}
  const value=await bucket.get(key,{range:{offset:selected.offset,length:selected.length}});if(!value?.body)return json({error:'Speech clip not found'},404);
  headers.set('Content-Length',String(selected.length));headers.set('Content-Range','bytes '+selected.offset+'-'+selected.end+'/'+head.size);
  return new Response(value.body,{status:206,headers});
 }
 const value=await bucket.get(key);if(!value)return json({error:'Speech clip not found'},404);
 if(value.customMetadata?.profile!==TTS_PROFILE||value.httpMetadata?.contentType!==TTS_CONTENT_TYPE||!Number.isSafeInteger(value.size)||value.size<=0||value.size>TTS_AUDIO_LIMIT||!value.body)return json({error:'Speech audio is unavailable'},503);
 return new Response(value.body,{headers:audioHeaders(id,value.size)});
}
const hasStorage=env=>!!env.BB_TTS_AUDIO?.get&&!!env.BB_TTS_AUDIO?.put&&!!env.BB_TTS_AUDIO?.head;
// Conversational replies may contain personal context. Keep their audio only
// in the live request; never hash, lease, read or persist it in the recipe cache.
async function mentorResponse(request,env,member,text,perform,now,fail,clock){
 const limits=missLimits(env);
 const config=!limits?'BB_COOK_CONFIG_LIMITS_UNAVAILABLE':typeof env.OPENAI_API_KEY!=='string'||!env.OPENAI_API_KEY.trim()?'BB_COOK_CONFIG_PROVIDER_UNAVAILABLE':null;
 if(config)return fail('Natural Cook Mentor voice is unavailable. Try again shortly.',503,config,'config','BB_COOK_SERVICE_UNAVAILABLE');
 let stage='quota_database';const controller=new AbortController(),signal=AbortSignal.any([request.signal,controller.signal]);
 try{
  request.signal.throwIfAborted();
  if(!await consumeMiss(env,member,limits,now))return fail('Natural Cook Mentor voice is temporarily limited. Try again later.',429,'BB_COOK_DAILY_LIMIT','quota');
  request.signal.throwIfAborted();
  stage='provider_request';
  const speech=await requestSpeech(text,env,perform,{mentor:true,signal});
  if((request.headers.get('Accept')||'').split(',').some(value=>/^audio\/mpeg\s*;\s*streaming=1$/i.test(value.trim()))){
   stage='provider_audio';
   return await privateAudioResponse(speech,{signal,clock,cancel:()=>controller.abort(),
    guard:async()=>{if(await isAccountDeleting(env,member.user.id)||member.ownerId!==member.user.id&&await isAccountDeleting(env,member.ownerId))throw cookServiceError('BB_COOK_ACCOUNT_PENDING');},
    diagnostic:code=>{fail('Natural Cook Mentor voice could not be prepared. Try again shortly.',code==='BB_COOK_ACCOUNT_PENDING'?409:502,code,code==='BB_COOK_ACCOUNT_PENDING'?'account_state':'provider_audio');}});
  }
  // Validate and finish the bounded MP3 before returning it, so no partial or
  // invalid private audio is ever handed to native playback.
  stage='provider_audio';
  const bytes=await new Response(speech).arrayBuffer();request.signal.throwIfAborted();
  if(!bytes.byteLength||bytes.byteLength>TTS_AUDIO_LIMIT)throw Error('tts_audio_invalid');
  stage='account_state';
  if(await isAccountDeleting(env,member.user.id)||member.ownerId!==member.user.id&&await isAccountDeleting(env,member.ownerId))return fail('Account deletion is in progress',409,'BB_COOK_ACCOUNT_PENDING','account_state');
  request.signal.throwIfAborted();
  return new Response(bytes,{headers:{'Content-Type':TTS_CONTENT_TYPE,'Content-Length':String(bytes.byteLength),'Cache-Control':'private, no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff','X-BB-TTS-Cache':'bypass'}});
 }catch(error){controller.abort();return fail('Natural Cook Mentor voice could not be prepared. Try again shortly.',cookServiceCode(error)==='BB_COOK_ACCOUNT_PENDING'?409:502,cookServiceCode(error),request.signal.aborted?'request':stage);}
}
export function createTTSHandler({authorizeMember=authorize,perform=fetch,clock=Date.now,randomId=()=>crypto.randomUUID(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 return async function handle(context){
  const {request,env}=context;
  const diagnostic=/^Bearer [^\s]+$/.test(request.headers.get('Authorization')||'');
  const fail=(error,status,code,stage,responseCode=code)=>{
   if(diagnostic)logCookDiagnostic(stage,code,status);
   return json({error,code:responseCode},status);
  };
  if(!['GET','HEAD','POST'].includes(request.method))return fail('Method not allowed',405,'BB_COOK_METHOD_REJECTED','request');
  const config=env.BB_TTS_ENABLED!=='true'?'BB_COOK_CONFIG_TTS_DISABLED':!isConfigured(env)?'BB_COOK_CONFIG_BINDINGS_UNAVAILABLE':null;
  if(config)return fail('AI Cook voice is unavailable',503,config,'config','BB_COOK_SERVICE_UNAVAILABLE');
  if(request.method==='POST'&&!requireSameOrigin(request,true))return fail('Origin not permitted',403,'BB_COOK_ORIGIN_REJECTED','request');
  const origin=request.headers.get('Origin');if(origin&&!requireSameOrigin(request))return fail('Origin not permitted',403,'BB_COOK_ORIGIN_REJECTED','request');
  let member;try{member=await authorizeMember(request,env);}catch{return fail('Membership verification is unavailable',503,'BB_COOK_MEMBERSHIP_UNAVAILABLE','authorization');}
  if(member?.error)return fail(member.error,member.status,cookAuthorizationCode(member.status),'authorization');
  if(!member?.user?.id||!member.ownerId)return fail('Verified Premium membership required',403,'BB_COOK_PREMIUM_REQUIRED','authorization');
  if(request.method!=='POST'){
   if(!hasStorage(env))return json({error:'AI Cook voice is unavailable'},503);
   const url=new URL(request.url),id=url.searchParams.get('clip');
   if(!validClip(id)||[...url.searchParams.keys()].some(key=>key!=='clip'))return json({error:'Invalid speech clip'},400);
   try{return await savedResponse(request,env,id);}catch{return json({error:'Speech audio is unavailable'},503);}
  }
  const parsed=await limitedJSON(request);if(parsed.error)return fail(parsed.error,parsed.status,'BB_COOK_REQUEST_INVALID','request');
  if(parsed.private)return mentorResponse(request,env,member,parsed.text,perform,clock(),fail,clock);
  if(!hasStorage(env))return json({error:'AI Cook voice is unavailable'},503);
  const id=await clipId(parsed.text),key=clipKey(id),prepared=cached=>json({clipId:id,url:'/api/tts?clip='+id,contentType:TTS_CONTENT_TYPE,cached});
  let token=null;
  try{
   const existing=await env.BB_TTS_AUDIO.head(key);
   if(existing){if(existing.customMetadata?.profile!==TTS_PROFILE||existing.httpMetadata?.contentType!==TTS_CONTENT_TYPE||existing.size<=0||existing.size>TTS_AUDIO_LIMIT)return json({error:'Speech audio is unavailable'},503);return parsed.prepare?prepared(true):savedResponse(new Request(request.url,{headers:request.headers}),env,id);}
   const limits=missLimits(env);if(!limits||typeof env.OPENAI_API_KEY!=='string'||!env.OPENAI_API_KEY.trim())return json({error:'AI Cook voice is unavailable'},503);
   token=randomId();
   if(!await claimLease(env,id,token,member,clock())){
    token=null;
    // A simultaneous request waits briefly for the one charged generation.
    for(let attempt=0;attempt<6;attempt++){await wait(250);if(await env.BB_TTS_AUDIO.head(key))return parsed.prepare?prepared(true):savedResponse(new Request(request.url,{headers:request.headers}),env,id);}
    return new Response(JSON.stringify({error:'This speech clip is being prepared. Try again shortly.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'2'}});
   }
   // Another worker may have completed the clip just before our lease claim.
   if(await env.BB_TTS_AUDIO.head(key))return parsed.prepare?prepared(true):savedResponse(new Request(request.url,{headers:request.headers}),env,id);
   if(!await consumeMiss(env,member,limits,clock()))return json({error:'New AI voice generation is temporarily limited. Your device voice is still available.'},429);
   const speech=await requestSpeech(parsed.text,env,perform);
   const persist=async stream=>{
    const bytes=await new Response(stream).arrayBuffer();
    if(!bytes.byteLength||bytes.byteLength>TTS_AUDIO_LIMIT)throw Error('tts_audio_invalid');
    const stored=await env.BB_TTS_AUDIO.put(key,bytes,{httpMetadata:{contentType:TTS_CONTENT_TYPE},customMetadata:{profile:TTS_PROFILE}});
    if(!stored)throw Error('tts_storage_unavailable');
   };
   if(parsed.prepare){await persist(speech);return prepared(false);}
   const [play,cache]=speech.tee(),claim=token;token=null;
   const stored=persist(cache).catch(()=>{}).finally(()=>releaseLease(env,id,claim).catch(()=>{}));
   if(typeof context.waitUntil==='function')context.waitUntil(stored);else await stored;
   return new Response(play,{headers:audioHeaders(id,undefined,'miss')});
  }catch{return json({error:'AI Cook voice could not be prepared. Your device voice is still available.'},502);}
  finally{if(token)await releaseLease(env,id,token).catch(()=>{});}
 };
}
export const onRequest=createTTSHandler();
