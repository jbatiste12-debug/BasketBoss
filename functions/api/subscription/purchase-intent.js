import {json,requireSameOrigin} from '../../../bb-server-lib/bb-billing.js';
import {PurchaseIntentError,purchaseIntentsEnabled,purchaseIntentActor,startPurchaseIntent,reportPurchaseIntent,readPurchaseIntent} from '../../../bb-server-lib/bb-purchase-intents.js';

const LIMIT=4096;
function errorResponse(error){
 if(error instanceof PurchaseIntentError)return json({ok:false,code:error.code,error:error.message},error.status);
 return json({ok:false,code:'purchase_intent_unavailable',error:'Purchase coordination is temporarily unavailable. Restore and manage existing purchases remain available.'},503);
}
function enabledRequest(request,env){
 if(!requireSameOrigin(request))throw new PurchaseIntentError('origin_not_allowed','This request is not allowed.',403);
 if(!purchaseIntentsEnabled(env))throw new PurchaseIntentError('purchase_intents_disabled','New purchase coordination is disabled.',503);
}
async function bodyJSON(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))throw new PurchaseIntentError('invalid_request','Use an application/json request.',415);
 const announced=Number(request.headers.get('Content-Length'));
 if(Number.isFinite(announced)&&announced>LIMIT)throw new PurchaseIntentError('request_too_large','Purchase coordination request is too large.',413);
 const reader=request.body?.getReader();if(!reader)throw new PurchaseIntentError('invalid_request','A request body is required.',400);
 let size=0;const chunks=[];
 try{
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();throw new PurchaseIntentError('request_too_large','Purchase coordination request is too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body;
 }catch(error){if(error instanceof PurchaseIntentError)throw error;throw new PurchaseIntentError('invalid_request','Invalid purchase coordination request.',400);}
}
export async function onRequestPost({request,env}){
 try{
  enabledRequest(request,env);
  const body=await bodyJSON(request);
  if(!['start','report'].includes(body.action)||!body.reservation||typeof body.reservation!=='object'||Array.isArray(body.reservation))throw new PurchaseIntentError('invalid_request','A current purchase authorization is required.',400);
  const actor=await purchaseIntentActor(request,env);
  const input={id:body.reservation.id,capability:body.reservation.capability,version:body.reservation.version,generation:body.reservation.generation};
  const reservation=body.action==='start'?await startPurchaseIntent(env,actor,input):await reportPurchaseIntent(env,actor,{...input,outcome:body.outcome,cause:body.cause});
  return json({ok:true,reservation});
 }catch(error){return errorResponse(error);}
}
export async function onRequestGet({request,env}){
 try{
  enabledRequest(request,env);const actor=await purchaseIntentActor(request,env),url=new URL(request.url);
  const id=url.searchParams.get('id')??undefined,mode=url.searchParams.get('mode')??undefined;
  return json({ok:true,reservation:await readPurchaseIntent(env,actor,{id,mode})});
 }catch(error){return errorResponse(error);}
}
