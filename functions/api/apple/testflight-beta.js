import {json,authenticatedUser,isConfigured,requireSameOrigin} from '../../../bb-server-lib/bb-billing.js';
import {AppleBillingError} from '../../../bb-server-lib/bb-apple-subscriptions.js';
import {appleRequestJSON,appleErrorResponse} from '../../../bb-server-lib/bb-apple-http.js';
import {ensureDeletionSchema,isAccountDeleting} from '../../../bb-server-lib/bb-account-deletion.js';
import {isNewestVerifiedSession} from '../../../bb-server-lib/bb-premium-seat.js';
import {testFlightBetaEnabled,verifyTestFlightAppTransaction,persistTestFlightBetaGrant} from '../../../bb-server-lib/bb-testflight-beta.js';
export function createTestFlightBetaHandler({authenticate=authenticatedUser,newestSession=isNewestVerifiedSession,verify=verifyTestFlightAppTransaction,clock=Date.now}={}){
 return async function handle({request,env}){
  try{
   if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
   if(!testFlightBetaEnabled(env,clock()))return json({ok:false,code:'testflight_beta_ended',error:'The Beta Premium testing period has ended.'},410);
   if(!isConfigured(env))throw new AppleBillingError('testflight_beta_unavailable','Beta Premium is temporarily unavailable.');
   const url=new URL(request.url);
   if(url.protocol!=='https:'||!['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev'].includes(url.hostname)||
      env.CF_PAGES_BRANCH&&env.CF_PAGES_BRANCH!=='main')throw new AppleBillingError('testflight_beta_unavailable','Beta Premium is unavailable on this server.');
   if(!requireSameOrigin(request,true))throw new AppleBillingError('origin_not_allowed','This request is not allowed.',403);
   const user=await authenticate(request,env);
   if(!user)throw new AppleBillingError('authentication_required','Sign in with a confirmed email address.',401);
   await ensureDeletionSchema(env);
   const ready=async()=>{
    request.signal.throwIfAborted();
    if(await isAccountDeleting(env,user.id))throw new AppleBillingError('account_deletion_pending','Account deletion is in progress.',409);
    if(!await newestSession(request,env,user))throw new AppleBillingError('testflight_beta_newer_session','Sign in again on this device before activating Beta Premium.',403);
   };
   await ready();
   const body=await appleRequestJSON(request,80000);
   if(Object.keys(body).length!==1||typeof body.signedAppTransaction!=='string')throw new AppleBillingError('testflight_beta_invalid_request','Use the signed Apple app transaction from this beta installation.',400);
   const claims=await verify(env,body.signedAppTransaction,{now:clock()});
   await ready();
   const grant=await persistTestFlightBetaGrant(env,user.id,claims,{now:clock()});
   await ready();
   return json({ok:true,provider:'testflight_beta',premiumAccess:true,beta:grant.beta});
  }catch(error){
   if(request.signal.aborted)return json({ok:false,code:'testflight_beta_cancelled',error:'Beta activation cancelled.'},499);
   return appleErrorResponse(error);
  }
 };
}
const handle=createTestFlightBetaHandler();
export const onRequest=handle;
