import {json,authenticatedUser,requireSameOrigin} from './bb-billing.js';
import {PurchaseIntentError} from './bb-purchase-intents.js';
import {GooglePlayBillingError,getVerifiedGooglePlayConfig,assertGooglePlayAccountReady} from './bb-google-play-subscriptions.js';
export function googlePlayErrorResponse(error){
 if(error instanceof GooglePlayBillingError||error instanceof PurchaseIntentError)return json({ok:false,code:error.code,error:error.message},error.status);
 return json({ok:false,code:'google_play_unavailable',error:'Google Play subscriptions are temporarily unavailable. Please try again.'},503);
}
export async function googlePlayAuthenticatedRequest(request,env){
 if(!requireSameOrigin(request))throw new GooglePlayBillingError('origin_not_allowed','This request is not allowed.',403);
 const config=getVerifiedGooglePlayConfig(env);
 if(!config)throw new GooglePlayBillingError('google_play_disabled','Google Play subscriptions are not available.',503);
 const user=await authenticatedUser(request,env);
 if(!user)throw new GooglePlayBillingError('authentication_required','Sign in with a confirmed email address.',401);
 await assertGooglePlayAccountReady(env,config,user.id);
 return {config,user};
}
export async function googlePlayRequestJSON(request,limit=16000){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))throw new GooglePlayBillingError('invalid_request','Use an application/json request.',415);
 const announced=Number(request.headers.get('Content-Length'));
 if(Number.isFinite(announced)&&announced>limit)throw new GooglePlayBillingError('request_too_large','The request is too large.',413);
 const reader=request.body?.getReader();if(!reader)throw new GooglePlayBillingError('invalid_request','A request body is required.',400);
 let size=0;const chunks=[];
 try{
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new GooglePlayBillingError('request_too_large','The request is too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body;
 }catch(error){if(error instanceof GooglePlayBillingError)throw error;throw new GooglePlayBillingError('invalid_request','Invalid JSON request.',400);}
}
