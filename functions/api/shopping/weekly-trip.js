/* Authenticated usage allowance, separate from purchases and the Free list. */
import {authenticatedUser,isConfigured,json,requireSameOrigin} from '../../../bb-server-lib/bb-billing.js';
import {readMemberPaidAccess} from '../../../bb-server-lib/bb-paid-access.js';
import {isAccountDeleting} from '../../../bb-server-lib/bb-account-deletion.js';
import {isNewestVerifiedSession,seatGateEnabled} from '../../../bb-server-lib/bb-premium-seat.js';
import {readWeeklyShop,startWeeklyShop,weeklyShopPeriod,WeeklyShopError} from '../../../bb-server-lib/bb-weekly-shop.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error=(code,status,extra={})=>json({ok:false,error:code,...extra},status);
async function sessionBody(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))throw new WeeklyShopError('weekly_shop_json_required',415);
 if(Number(request.headers.get('Content-Length')||0)>512)throw new WeeklyShopError('weekly_shop_request_too_large',413);
 const reader=request.body?.getReader();if(!reader)throw new WeeklyShopError('weekly_shop_invalid_request',400);
 const chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();throw new WeeklyShopError('weekly_shop_request_too_large',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.byteLength;}
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new WeeklyShopError('weekly_shop_invalid_request',400);}
 if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length!==1||typeof body.sessionId!=='string'||!UUID.test(body.sessionId))throw new WeeklyShopError('weekly_shop_invalid_request',400);
 return body.sessionId.toLowerCase();
}
export async function onRequest({request,env}){
 if(!['GET','POST'].includes(request.method))return error('weekly_shop_method_not_allowed',405);
 const sameOriginRead=request.method==='GET'&&!request.headers.get('Origin')&&request.headers.get('Sec-Fetch-Site')==='same-origin';
 if(!requireSameOrigin(request,true)&&!sameOriginRead)return error('weekly_shop_origin_rejected',403);
 if(!isConfigured(env))return error('weekly_shop_unavailable',503);
 const bearer=request.headers.get('Authorization')||'';
 if(!/^Bearer [^\s]+$/.test(bearer)||bearer.length>16000)return error('weekly_shop_sign_in_required',401);
 let sessionId;
 try{if(request.method==='POST')sessionId=await sessionBody(request);}catch(caught){return error(caught.code||'weekly_shop_invalid_request',caught.status||400);}
 const user=await authenticatedUser(request,env);
 if(!user||!UUID.test(user.id))return error('weekly_shop_sign_in_required',401);
 try{
  if(await isAccountDeleting(env,user.id))return error('account_deletion_pending',409);
  // An entitlement outage must not turn a paid member into Free or spend the
  // member's allowance. Every successful result uses the server's live verdict.
  const owner=!!env.BB_OWNER_USER_ID&&user.id===env.BB_OWNER_USER_ID;
  const access=owner?{premiumAccess:true}:await readMemberPaidAccess(request,env,user);
  if(await isAccountDeleting(env,user.id))return error('account_deletion_pending',409);
  if(access.premiumAccess){
   if(seatGateEnabled(env)&&!await isNewestVerifiedSession(request,env,user))return error('weekly_shop_newer_session_exists',403);
   return json({ok:true,premium:true,unlimited:true,...weeklyShopPeriod(),used:false,sessionId:sessionId||null,...(request.method==='POST'?{allowed:true}:{} )});
  }
  const result=request.method==='POST'?await startWeeklyShop(env,user.id,sessionId):await readWeeklyShop(env,user.id);
  return json({ok:true,premium:false,unlimited:false,...result});
 }catch(caught){
  if(caught instanceof WeeklyShopError)return error(caught.code,caught.status,caught.status===429?weeklyShopPeriod():{});
  return error('weekly_shop_unavailable',503);
 }
}
