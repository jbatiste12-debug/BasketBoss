/* Premium, recipe-scoped questions. Responses contain words only, never app
 * actions. No recipe, transcript, history or answer is stored by this route. */
import {json,authenticatedUser,isConfigured,requireSameOrigin} from '../../bb-server-lib/bb-billing.js';
import {readMemberPaidAccess,paidBillingEnabled} from '../../bb-server-lib/bb-paid-access.js';
import {isAccountDeleting} from '../../bb-server-lib/bb-account-deletion.js';
import {missLimits} from '../../bb-server-lib/bb-tts.js';
import {readCookingQuestion,consumeCookingAllowance,requestCookingAnswer} from '../../bb-server-lib/bb-cook-assistant.js';
import {cookingAnswerStreamResponse} from '../../bb-server-lib/bb-cook-stream.js';
import {cookServiceError,cookServiceCode,cookAuthorizationCode,logCookDiagnostic} from '../../bb-server-lib/bb-cook-service-error.js';

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
async function deleting(env,member){
 return await isAccountDeleting(env,member.user.id)||member.ownerId!==member.user.id&&await isAccountDeleting(env,member.ownerId);
}
export function createCookAssistantHandler({authorizeMember=authorize,perform=fetch,clock=Date.now}={}){
 return async function handle({request,env}){
  const diagnostic=/^Bearer [^\s]+$/.test(request.headers.get('Authorization')||'');
  const fail=(error,status,code,stage,responseCode=code)=>{
   if(diagnostic)logCookDiagnostic(stage,code,status);
   return json({error,code:responseCode},status);
  };
  if(request.method!=='POST')return fail('Method not allowed',405,'BB_COOK_METHOD_REJECTED','request');
  const limits=missLimits(env);
  const config=env.BB_PREMIUM_AI_ENABLED!=='true'?'BB_COOK_CONFIG_AI_DISABLED':!isConfigured(env)?'BB_COOK_CONFIG_BINDINGS_UNAVAILABLE':!limits?'BB_COOK_CONFIG_LIMITS_UNAVAILABLE':typeof env.OPENAI_API_KEY!=='string'||!env.OPENAI_API_KEY.trim()?'BB_COOK_CONFIG_PROVIDER_UNAVAILABLE':null;
  if(config)return fail('Cooking questions are temporarily unavailable',503,config,'config','BB_COOK_SERVICE_UNAVAILABLE');
  if(!requireSameOrigin(request,true))return fail('Origin not permitted',403,'BB_COOK_ORIGIN_REJECTED','request');
  const cancelled=()=>fail('Cooking question cancelled',499,'BB_COOK_REQUEST_CANCELLED','request');
  if(request.signal.aborted)return cancelled();
  let member;try{member=await authorizeMember(request,env);}catch{return fail('Membership verification is unavailable',503,'BB_COOK_MEMBERSHIP_UNAVAILABLE','authorization');}
  if(member?.error)return fail(member.error,member.status,cookAuthorizationCode(member.status),'authorization');
  if(!member?.user?.id||!member.ownerId)return fail('Verified Premium membership required',403,'BB_COOK_PREMIUM_REQUIRED','authorization');
  const parsed=await readCookingQuestion(request);if(parsed.error)return fail(parsed.error,parsed.status,'BB_COOK_REQUEST_INVALID','request');
  const pending=()=>fail('Account deletion is in progress',409,'BB_COOK_ACCOUNT_PENDING','account_state');
  let stage='account_state';
  try{
   if(await deleting(env,member))return pending();
   if(request.signal.aborted)return cancelled();
   stage='quota_database';
   const allowed=await consumeCookingAllowance(env,member,limits,clock());
   stage='account_state';
   if(await deleting(env,member))return pending();
   if(!allowed)return fail('Cooking questions have reached their daily limit. The recipe and voice commands are still available.',429,'BB_COOK_DAILY_LIMIT','quota');
   if(request.signal.aborted)return cancelled();
   stage='provider_request';
   if((request.headers.get('Accept')||'').split(',').some(type=>type.trim().toLowerCase()==='application/x-ndjson')){
    return cookingAnswerStreamResponse(parsed.value,env,{perform,signal:request.signal,clock,
     guard:async()=>{if(await deleting(env,member))throw cookServiceError('BB_COOK_ACCOUNT_PENDING');},
     diagnostic:code=>{if(diagnostic)logCookDiagnostic(code==='BB_COOK_ACCOUNT_PENDING'?'account_state':'provider_request',code,code==='BB_COOK_ACCOUNT_PENDING'?409:code==='BB_COOK_REQUEST_CANCELLED'?499:502);}});
   }
   const answer=await requestCookingAnswer(parsed.value,env,perform,request.signal);
   stage='account_state';
   if(await deleting(env,member))return pending();
   if(request.signal.aborted)return cancelled();
   return json({answer});
  }catch(error){
   if(request.signal.aborted)return cancelled();
   return fail('I could not answer just now. Please try again, or follow the recipe on screen.',502,cookServiceCode(error),stage);
  }
 };
}
export const onRequest=createCookAssistantHandler();
