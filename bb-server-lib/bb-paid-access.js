/* Server-owned access across payment providers. A valid web membership wins
 * before Apple is consulted, so an Apple outage cannot revoke web access.
 * Apple performs its own pinned-signature, expiry and fresh-status checks.
 */
import {isBillingEnabled,isLive,expectedPrice,entitlementForStatus} from './bb-billing.js';
import {readAppleEntitlement} from './bb-apple-subscriptions.js';
import {testFlightBetaEnabled,readTestFlightBetaGrant} from './bb-testflight-beta.js';
export {testFlightBetaEnabled} from './bb-testflight-beta.js';
export const appleBillingEnabled=env=>env.APPLE_BILLING_ENABLED==='true';
export const paidBillingEnabled=env=>isBillingEnabled(env)||appleBillingEnabled(env)||testFlightBetaEnabled(env);
// This is only a feature/configuration gate. Every user still needs a verified
// personal entitlement. Sandbox never enables production household sharing.
export const livePaidBillingEnabled=env=>isLive(env)||(appleBillingEnabled(env)&&env.APPLE_ENVIRONMENT==='Production');
export function paddleAccess(env,row,{productionOnly=false}={}){
 const price=row?expectedPrice(env,row.plan):null;
 return !!row&&!!price&&(!productionOnly||isLive(env))&&price===row.price_id&&entitlementForStatus(row.status);
}
export async function readPersonalPaidAccess(env,userId,{productionOnly=false,includeTestFlightBeta=false,paddleRow}={}){
 let row=paddleRow;
 if(row===undefined&&isBillingEnabled(env))row=await env.BILLING_DB.prepare(
  'SELECT status,price_id,plan FROM bb_paid_entitlements WHERE user_id=? ORDER BY updated_at_ms DESC LIMIT 1'
 ).bind(userId).first();
 if(paddleAccess(env,row,{productionOnly}))return {premiumAccess:true,provider:'paddle',paddleRow:row,apple:null};
 // A later canceled/expired subscription must not hide another current web
 // subscription. Filter by the server's exact configured SKUs, never a client
 // plan, and retain the latest inactive row solely for management metadata.
 if(isBillingEnabled(env)&&(!productionOnly||isLive(env))){
  const candidate=await env.BILLING_DB.prepare(`SELECT * FROM bb_paid_entitlements
   WHERE user_id=? AND status IN ('active','trialing')
   AND ((plan='founder' AND price_id=?) OR (plan='standard' AND price_id=?))
   ORDER BY updated_at_ms DESC LIMIT 1`)
   .bind(userId,expectedPrice(env,'founder'),expectedPrice(env,'standard')).first();
  if(paddleAccess(env,candidate,{productionOnly}))return {premiumAccess:true,provider:'paddle',paddleRow:candidate,apple:null};
 }
 if(!productionOnly||includeTestFlightBeta){
  const beta=await readTestFlightBetaGrant(env,userId);
  if(beta)return {...beta,paddleRow:row||null,apple:null};
 }
 const apple=await readAppleEntitlement(env,userId);
 const premiumAccess=!!apple?.premiumAccess&&(!productionOnly||apple.environment==='Production');
 return {premiumAccess,provider:premiumAccess?'apple':null,paddleRow:row||null,apple};
}
// A valid household web membership also survives an unrelated Apple outage.
// Errors remain fail-closed if no independently verified access is available.
export async function readMemberPaidAccess(request,env,user,options={}){
 let access,error;
 try{access=await readPersonalPaidAccess(env,user.id,options);}
 catch(caught){error=caught;}
 if(access?.premiumAccess)return {...access,householdOwnerId:null};
 const {sharedHouseholdPremiumOwner}=await import('./bb-household-premium.js');
 const householdOwnerId=await sharedHouseholdPremiumOwner(request,env,user);
 if(householdOwnerId){
  const sharedBeta=await readTestFlightBetaGrant(env,householdOwnerId);
  return {premiumAccess:true,provider:'household',householdOwnerId,apple:null,beta:sharedBeta?.beta||null,paddleRow:access?.paddleRow||null};
 }
 if(error)throw error;
 return {...access,householdOwnerId:null};
}
