/* Server-owned access across payment providers. An independently verified
 * membership survives an unrelated provider outage. If none verifies, any
 * unavailable provider keeps access fail-closed.
 */
import {isBillingEnabled,isLive,expectedPrice,entitlementForStatus} from './bb-billing.js';
import {readAppleEntitlement} from './bb-apple-subscriptions.js';
import {googlePlayBillingEnabled,liveGooglePlayBillingEnabled,readGooglePlayEntitlement} from './bb-google-play-subscriptions.js';
import {isAccountDeleting} from './bb-account-deletion.js';
import {testFlightBetaEnabled,readTestFlightBetaGrant} from './bb-testflight-beta.js';
export {testFlightBetaEnabled} from './bb-testflight-beta.js';
export const appleBillingEnabled=env=>env.APPLE_BILLING_ENABLED==='true';
export const paidBillingEnabled=env=>isBillingEnabled(env)||appleBillingEnabled(env)||googlePlayBillingEnabled(env)||testFlightBetaEnabled(env);
// This is only a feature/configuration gate. Every user still needs a verified
// personal entitlement. Sandbox never enables production household sharing.
export const livePaidBillingEnabled=env=>isLive(env)||(appleBillingEnabled(env)&&env.APPLE_ENVIRONMENT==='Production')||liveGooglePlayBillingEnabled(env);
const OWNER_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function paddleAccess(env,row,{productionOnly=false}={}){
 const price=row?expectedPrice(env,row.plan):null;
 return !!row&&!!price&&(!productionOnly||isLive(env))&&price===row.price_id&&entitlementForStatus(row.status);
}
export async function readPersonalPaidAccess(env,userId,{productionOnly=false,includeTestFlightBeta=false,includeOwnerHousehold=false,paddleRow}={}){
 // This optional sharing grant is server configuration, never a payment. Only
 // production household callers opt in after their identity/session gates.
 if(includeOwnerHousehold===true&&productionOnly===true&&env.BB_OWNER_HOUSEHOLD_ENABLED==='true'&&
    typeof env.BB_OWNER_USER_ID==='string'&&OWNER_UUID.test(env.BB_OWNER_USER_ID)&&userId===env.BB_OWNER_USER_ID&&
    (livePaidBillingEnabled(env)||testFlightBetaEnabled(env))&&env.BILLING_DB?.prepare){
  const premiumAccess=!await isAccountDeleting(env,userId);
  return {premiumAccess,provider:premiumAccess?'owner_household':null,paddleRow:paddleRow||null,apple:null,googlePlay:null};
 }
 let row=paddleRow,error;
 try{
 if(row===undefined&&isBillingEnabled(env))row=await env.BILLING_DB.prepare(
  'SELECT status,price_id,plan FROM bb_paid_entitlements WHERE user_id=? ORDER BY updated_at_ms DESC LIMIT 1'
 ).bind(userId).first();
 if(paddleAccess(env,row,{productionOnly}))return {premiumAccess:true,provider:'paddle',paddleRow:row,apple:null,googlePlay:null};
 // A later canceled/expired subscription must not hide another current web
 // subscription. Filter by the server's exact configured SKUs, never a client
 // plan, and retain the latest inactive row solely for management metadata.
 if(isBillingEnabled(env)&&(!productionOnly||isLive(env))){
  const candidate=await env.BILLING_DB.prepare(`SELECT * FROM bb_paid_entitlements
   WHERE user_id=? AND status IN ('active','trialing')
   AND ((plan='founder' AND price_id=?) OR (plan='standard' AND price_id=?))
   ORDER BY updated_at_ms DESC LIMIT 1`)
   .bind(userId,expectedPrice(env,'founder'),expectedPrice(env,'standard')).first();
  if(paddleAccess(env,candidate,{productionOnly}))return {premiumAccess:true,provider:'paddle',paddleRow:candidate,apple:null,googlePlay:null};
 }
 }catch(caught){error=caught;}
 if(!productionOnly||includeTestFlightBeta){
  try{
  const beta=await readTestFlightBetaGrant(env,userId);
  if(beta)return {...beta,paddleRow:row||null,apple:null,googlePlay:null};
  }catch(caught){error ||= caught;}
 }
 let apple=null,googlePlay=null;
 try{
  apple=await readAppleEntitlement(env,userId);
  if(apple?.premiumAccess&&(!productionOnly||apple.environment==='Production'))
   return {premiumAccess:true,provider:'apple',paddleRow:row||null,apple,googlePlay:null};
 }catch(caught){error ||= caught;}
 if(googlePlayBillingEnabled(env)){
  try{
   googlePlay=await readGooglePlayEntitlement(env,userId);
   if(googlePlay?.premiumAccess&&(!productionOnly||googlePlay.environment==='production'))
    return {premiumAccess:true,provider:'google_play',paddleRow:row||null,apple,googlePlay};
  }catch(caught){error ||= caught;}
 }
 if(error)throw error;
 return {premiumAccess:false,provider:null,paddleRow:row||null,apple,googlePlay};
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
  // Beta metadata is optional after the household owner has independently
  // verified. Its lookup cannot revoke another provider's household access.
  let sharedBeta;
  try{sharedBeta=await readTestFlightBetaGrant(env,householdOwnerId);}catch{}
  return {premiumAccess:true,provider:'household',householdOwnerId,apple:null,googlePlay:null,beta:sharedBeta?.beta||null,paddleRow:access?.paddleRow||null};
 }
 if(error)throw error;
 return {...access,householdOwnerId:null};
}
