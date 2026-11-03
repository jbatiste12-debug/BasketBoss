/* Premium, recipe-scoped questions. Responses contain words only, never app
 * actions. No recipe, transcript, history or answer is stored by this route. */
import {json,authenticatedUser,isConfigured,requireSameOrigin} from '../../bb-server-lib/bb-billing.js';
import {readMemberPaidAccess,paidBillingEnabled} from '../../bb-server-lib/bb-paid-access.js';
import {isAccountDeleting} from '../../bb-server-lib/bb-account-deletion.js';
import {missLimits} from '../../bb-server-lib/bb-tts.js';
import {readCookingQuestion,consumeCookingAllowance,requestCookingAnswer} from '../../bb-server-lib/bb-cook-assistant.js';

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
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const limits=missLimits(env);
  if(env.BB_PREMIUM_AI_ENABLED!=='true'||!isConfigured(env)||!limits||typeof env.OPENAI_API_KEY!=='string'||!env.OPENAI_API_KEY.trim())return json({error:'Cooking questions are temporarily unavailable'},503);
  if(!requireSameOrigin(request,true))return json({error:'Origin not permitted'},403);
  if(request.signal.aborted)return json({error:'Cooking question cancelled'},499);
  let member;try{member=await authorizeMember(request,env);}catch{return json({error:'Membership verification is unavailable'},503);}
  if(member?.error)return json({error:member.error},member.status);
  if(!member?.user?.id||!member.ownerId)return json({error:'Verified Premium membership required'},403);
  const parsed=await readCookingQuestion(request);if(parsed.error)return json({error:parsed.error},parsed.status);
  try{
   if(await deleting(env,member))return json({error:'Account deletion is in progress'},409);
   if(request.signal.aborted)return json({error:'Cooking question cancelled'},499);
   const allowed=await consumeCookingAllowance(env,member,limits,clock());
   if(await deleting(env,member))return json({error:'Account deletion is in progress'},409);
   if(!allowed)return json({error:'Cooking questions have reached their daily limit. The recipe and voice commands are still available.'},429);
   if(request.signal.aborted)return json({error:'Cooking question cancelled'},499);
   const answer=await requestCookingAnswer(parsed.value,env,perform,request.signal);
   if(await deleting(env,member))return json({error:'Account deletion is in progress'},409);
   if(request.signal.aborted)return json({error:'Cooking question cancelled'},499);
   return json({answer});
  }catch{
   if(request.signal.aborted)return json({error:'Cooking question cancelled'},499);
   return json({error:'I could not answer just now. Please try again, or follow the recipe on screen.'},502);
  }
 };
}
export const onRequest=createCookAssistantHandler();
