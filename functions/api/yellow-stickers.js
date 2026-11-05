/* Premium store-level aggregates; verified account reports go through a
 * service-only database RPC. No account identity is returned to shoppers. */
import {authenticatedUser,json,requireSameOrigin} from '../../bb-server-lib/bb-billing.js';
import {livePaidBillingEnabled,testFlightBetaEnabled,readMemberPaidAccess} from '../../bb-server-lib/bb-paid-access.js';
import {isAccountDeleting} from '../../bb-server-lib/bb-account-deletion.js';
import {seatGateEnabled,isNewestVerifiedSession} from '../../bb-server-lib/bb-premium-seat.js';

const SUPABASE='https://kbhyosxuvlcazyzzinqv.supabase.co';
const HOSTS=new Set(['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const YELLOW_STICKER_STORES=Object.freeze({UK:Object.freeze(['waitrose','marks-spencer','iceland','tesco','sainsburys','asda','morrisons','aldi','lidl']),Guernsey:Object.freeze(['waitrose','ci-coop','marks-spencer','alliance','morrisons-daily','iceland']),Jersey:Object.freeze(['waitrose','ci-coop','marks-spencer','alliance','morrisons-daily','iceland'])});
const REQUEST_ID=/^[A-Za-z0-9:_-]{4,160}$/;
const validScope=(region,store)=>Object.hasOwn(YELLOW_STICKER_STORES,region)&&YELLOW_STICKER_STORES[region].includes(store);
const serviceKey=env=>env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';
const error=(code,status,extra={})=>json({ok:false,error:code,...extra},status);
export function yellowStickerConfigured(request,env){const url=new URL(request.url);return url.protocol==='https:'&&HOSTS.has(url.hostname)&&(!env.CF_PAGES_BRANCH||env.CF_PAGES_BRANCH==='main')&&env.SUPABASE_URL===SUPABASE&&typeof serviceKey(env)==='string'&&serviceKey(env).length>30&&typeof env.SUPABASE_PUBLISHABLE_KEY==='string'&&env.SUPABASE_PUBLISHABLE_KEY.length>20&&!!env.BILLING_DB?.prepare&&!!env.BILLING_DB?.batch&&(livePaidBillingEnabled(env)||testFlightBetaEnabled(env));}
async function rpc(env,name,body){
 const key=serviceKey(env),response=await fetch(SUPABASE+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,...(/^sb_secret_/.test(key)?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body),cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(6500)});
 if(!response.ok)throw Error('yellow_sticker_unavailable');return response.json();
}
function aggregate(value,region,store){
 if(!value||value.ok!==true||value.region!==region||value.store!==store)return null;
 const now=Date.parse(value.serverNow);if(typeof value.serverNow!=='string'||value.serverNow.length>60||!Number.isFinite(now))return null;
 const at=key=>{const raw=value[key];if(raw===null)return null;const stamp=Date.parse(raw);if(typeof raw!=='string'||!Number.isFinite(stamp)||stamp>now+1000||stamp<=now-90*60000)throw Error('invalid_sighting_timestamp');return raw;};
 try{
  const lastSpottedAt=at('lastSpottedAt'),latestNotYetAt=at('latestNotYetAt'),expiry=value.expiresAt;
  if(lastSpottedAt?typeof expiry!=='string'||Date.parse(expiry)!==Date.parse(lastSpottedAt)+90*60000:expiry!==null)return null;
  if(!Number.isInteger(value.spottedReports)||value.spottedReports<0||value.spottedReports>10000000||!lastSpottedAt&&value.spottedReports!==0||lastSpottedAt&&value.spottedReports===0)return null;
  return {ok:true,region,store,lastSpottedAt,latestNotYetAt,serverNow:value.serverNow,expiresAt:expiry,spottedReports:value.spottedReports};
 }catch{return null;}
}
async function body(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return {error:error('yellow_sticker_json_required',415)};
 if(Number(request.headers.get('Content-Length')||0)>512)return {error:error('yellow_sticker_request_too_large',413)};
 const reader=request.body?.getReader();if(!reader)return {error:error('yellow_sticker_invalid_request',400)};
 const chunks=[];let length=0;
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>512){await reader.cancel();return {error:error('yellow_sticker_request_too_large',413)};}chunks.push(value);}
 const bytes=new Uint8Array(length);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
 try{
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length!==4||!['region','store','status','requestId'].every(key=>Object.hasOwn(value,key))||!validScope(value.region,value.store)||!['spotted','not_yet'].includes(value.status)||typeof value.requestId!=='string'||!REQUEST_ID.test(value.requestId))return {error:error('yellow_sticker_invalid_request',400)};
  return {value};
 }catch{return {error:error('yellow_sticker_invalid_request',400)};}
}
export async function onRequest({request,env}){
 if(!['GET','POST'].includes(request.method))return error('yellow_sticker_method_not_allowed',405);
 if(!yellowStickerConfigured(request,env))return error('yellow_sticker_unavailable',503);
 const sameOriginRead=request.method==='GET'&&!request.headers.get('Origin')&&request.headers.get('Sec-Fetch-Site')==='same-origin';
 if(!requireSameOrigin(request,true)&&!sameOriginRead)return error('yellow_sticker_origin_rejected',403);
 const auth=request.headers.get('Authorization')||'';
 if(!/^Bearer [^\s]+$/.test(auth)||auth.length>16000)return error('yellow_sticker_sign_in_required',401);
 let input;
 if(request.method==='GET'){
  const query=new URL(request.url).searchParams,region=query.get('region'),store=query.get('store');
  if([...query.keys()].some(key=>!['region','store'].includes(key))||query.getAll('region').length!==1||query.getAll('store').length!==1||!validScope(region,store))return error('yellow_sticker_invalid_request',400);
  input={region,store};
 }else{const parsed=await body(request);if(parsed.error)return parsed.error;input=parsed.value;}
 const user=await authenticatedUser(request,env);if(!user||!UUID.test(user.id))return error('yellow_sticker_sign_in_required',401);
 try{
  if(await isAccountDeleting(env,user.id))return error('account_deletion_pending',409);
  const access=env.BB_OWNER_USER_ID===user.id?{premiumAccess:true}:await readMemberPaidAccess(request,env,user);
  if(!access.premiumAccess)return error('yellow_sticker_premium_required',403);
  if(seatGateEnabled(env)&&!await isNewestVerifiedSession(request,env,user))return error('yellow_sticker_session_replaced',403);
  if(await isAccountDeleting(env,user.id))return error('account_deletion_pending',409);
  if(request.method==='GET'){
   const result=aggregate(await rpc(env,'bb_yellow_sticker_snapshot',{p_region:input.region,p_store:input.store}),input.region,input.store);
   return result?json(result):error('yellow_sticker_unavailable',503);
  }
  const raw=await rpc(env,'bb_yellow_sticker_report',{p_user:user.id,p_region:input.region,p_store:input.store,p_status:input.status,p_request_id:input.requestId});
  if(raw?.ok===false){
   if(raw.error==='yellow_sticker_cooldown'&&Number.isInteger(raw.retryAfterSeconds)&&raw.retryAfterSeconds>0&&raw.retryAfterSeconds<=300){const response=error(raw.error,429,{retryAfterSeconds:raw.retryAfterSeconds});response.headers.set('Retry-After',String(raw.retryAfterSeconds));return response;}
   if(raw.error==='yellow_sticker_request_conflict')return error(raw.error,409);
   if(raw.error==='yellow_sticker_sign_in_required')return error(raw.error,401);
   return error('yellow_sticker_unavailable',503);
  }
  const result=aggregate(raw,input.region,input.store);
  if(!result||typeof raw.duplicate!=='boolean')return error('yellow_sticker_unavailable',503);
  return json({...result,duplicate:raw.duplicate});
 }catch{return error('yellow_sticker_unavailable',503);}
}
