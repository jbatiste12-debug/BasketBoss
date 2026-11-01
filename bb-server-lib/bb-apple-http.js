import {json,authenticatedUser,requireSameOrigin} from './bb-billing.js';
import {AppleBillingError,getVerifiedAppleConfig,assertAppleAccountReady} from './bb-apple-subscriptions.js';
export function appleErrorResponse(error){
 if(error instanceof AppleBillingError)return json({ok:false,code:error.code,error:error.message},error.status);
 return json({ok:false,code:'apple_unavailable',error:'Apple subscriptions are temporarily unavailable. Please try again.'},503);
}
export async function appleAuthenticatedRequest(request,env){
 if(!requireSameOrigin(request))throw new AppleBillingError('origin_not_allowed','This request is not allowed.',403);
 const config=getVerifiedAppleConfig(env);
 if(!config)throw new AppleBillingError('apple_disabled','Apple subscriptions are not available.',503);
 const user=await authenticatedUser(request,env);
 if(!user)throw new AppleBillingError('authentication_required','Sign in with a confirmed email address.',401);
 await assertAppleAccountReady(env,config,user.id);
 return {config,user};
}
export async function appleRequestJSON(request,limit=80000){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))throw new AppleBillingError('invalid_request','Use an application/json request.',415);
 const announced=Number(request.headers.get('Content-Length'));
 if(Number.isFinite(announced)&&announced>limit)throw new AppleBillingError('request_too_large','The signed transaction is too large.',413);
 const reader=request.body?.getReader();if(!reader)throw new AppleBillingError('invalid_request','A request body is required.',400);
 let size=0;const chunks=[];
 try{
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new AppleBillingError('request_too_large','The signed transaction is too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('invalid_object');return result;
 }catch(error){if(error instanceof AppleBillingError)throw error;throw new AppleBillingError('invalid_request','Invalid JSON request.',400);}
}
