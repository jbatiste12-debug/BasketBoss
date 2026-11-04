import {json,authenticatedUser,isConfigured,requireSameOrigin} from '../../../bb-server-lib/bb-billing.js';
import {AppleBillingError} from '../../../bb-server-lib/bb-apple-subscriptions.js';
import {appleRequestJSON,appleErrorResponse} from '../../../bb-server-lib/bb-apple-http.js';
import {ensureDeletionSchema,isAccountDeleting} from '../../../bb-server-lib/bb-account-deletion.js';
import {isNewestVerifiedSession} from '../../../bb-server-lib/bb-premium-seat.js';
import {testFlightBetaEnabled,verifyTestFlightAppTransaction,persistTestFlightBetaGrant} from '../../../bb-server-lib/bb-testflight-beta.js';
const diagnosticStages=new Set(['configuration','origin','authentication','deletion','session','request','apple_verification','grant_write','confirmation']);
const diagnosticCodes=new Set(['testflight_beta_ended','testflight_beta_unavailable','origin_not_allowed','authentication_required','account_deletion_pending','testflight_beta_newer_session','testflight_beta_invalid_request','invalid_request','request_too_large','invalid_apple_transaction','testflight_beta_invalid_proof','testflight_beta_unverified','testflight_beta_account_mismatch','testflight_beta_cancelled']);
function logBetaFailure(stage,error,{cancelled=false}={}){
 const safeStage=diagnosticStages.has(stage)?stage:'configuration';
 const known=error instanceof AppleBillingError;
 const code=cancelled?'testflight_beta_cancelled':known&&diagnosticCodes.has(error.code)?error.code:'testflight_beta_unavailable';
 const status=cancelled?499:known&&Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:503;
 const reference='BB_BETA_'+safeStage.toUpperCase();
 // Only fixed stage/code values and an HTTP status are logged. Never include
 // exception messages, account identifiers, request data or Apple proofs.
 console.warn('BB_BETA_DIAGNOSTIC '+JSON.stringify({stage:safeStage,code,status,reference}));
 return reference;
}
export function createTestFlightBetaHandler({authenticate=authenticatedUser,newestSession=isNewestVerifiedSession,verify=verifyTestFlightAppTransaction,clock=Date.now}={}){
 return async function handle({request,env}){
  let stage='configuration';
  try{
   if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
   if(!testFlightBetaEnabled(env,clock()))return json({ok:false,code:'testflight_beta_ended',error:'The Beta Premium testing period has ended.'},410);
   if(!isConfigured(env))throw new AppleBillingError('testflight_beta_unavailable','Beta Premium is temporarily unavailable.');
   stage='origin';
   const url=new URL(request.url);
   if(url.protocol!=='https:'||!['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev'].includes(url.hostname)||
      env.CF_PAGES_BRANCH&&env.CF_PAGES_BRANCH!=='main')throw new AppleBillingError('testflight_beta_unavailable','Beta Premium is unavailable on this server.');
   if(!requireSameOrigin(request,true))throw new AppleBillingError('origin_not_allowed','This request is not allowed.',403);
   stage='authentication';
   const user=await authenticate(request,env);
   if(!user)throw new AppleBillingError('authentication_required','Sign in with a confirmed email address.',401);
   stage='deletion';
   await ensureDeletionSchema(env);
   const ready=async(finalCheck=false)=>{
    request.signal.throwIfAborted();
    stage=finalCheck?'confirmation':'deletion';
    if(await isAccountDeleting(env,user.id))throw new AppleBillingError('account_deletion_pending','Account deletion is in progress.',409);
    stage=finalCheck?'confirmation':'session';
    if(!await newestSession(request,env,user))throw new AppleBillingError('testflight_beta_newer_session','Sign in again on this device before activating Beta Premium.',403);
   };
   await ready();
   stage='request';
   const body=await appleRequestJSON(request,80000);
   if(Object.keys(body).length!==1||typeof body.signedAppTransaction!=='string')throw new AppleBillingError('testflight_beta_invalid_request','Use the signed Apple app transaction from this beta installation.',400);
   stage='apple_verification';
   const claims=await verify(env,body.signedAppTransaction,{now:clock()});
   await ready();
   stage='grant_write';
   const grant=await persistTestFlightBetaGrant(env,user.id,claims,{now:clock()});
   await ready(true);
   return json({ok:true,provider:'testflight_beta',premiumAccess:true,beta:grant.beta});
  }catch(error){
   const reference=logBetaFailure(stage,error,{cancelled:request.signal.aborted});
   if(request.signal.aborted)return json({ok:false,code:'testflight_beta_cancelled',error:'Beta activation cancelled.'},499);
   if(error instanceof AppleBillingError)return appleErrorResponse(error);
   return json({ok:false,code:'testflight_beta_unavailable',reference,error:'TestFlight Beta Premium could not be activated just now. Please try again. Reference: '+reference+'.'},503);
  }
 };
}
const handle=createTestFlightBetaHandler();
export const onRequest=handle;
