/* NEW checkout protection only. A recoverable billing failure is not Premium,
 * but it is also not evidence that another provider may safely charge. Never
 * use this helper to grant/revoke access, restore, manage, or cancel a purchase.
 */
import {isBillingEnabled,isLive,expectedPrice,paddleApi} from './bb-billing.js';
import {readAppleEntitlement} from './bb-apple-subscriptions.js';
import {PurchaseIntentError,purchaseIntentsStrict} from './bb-purchase-intents.js';
const SUB=/^sub_[a-z0-9]{26}$/,CUSTOMER=/^ctm_[a-z0-9]{26}$/;
const unavailable=()=>{throw new PurchaseIntentError('purchase_state_unavailable','Existing subscription billing could not be verified. Restore and manage existing purchases remain available.',503);};
const blocked=(provider,reason='existing_subscription')=>({provider,reason,error:provider==='apple'?'Resolve or cancel your existing Apple subscription before starting another subscription.':'Resolve or cancel your existing web subscription before starting another subscription.'});
export async function readResumableCheckoutBlock(env,userId,{mode='live'}={}){
 if(!purchaseIntentsStrict(env))return null;
 // Force current signed Apple status for every known account-owned lineage;
 // latest inactive metadata alone can hide an older billing-retry subscription.
 const apple=await readAppleEntitlement(env,userId,{forCheckout:true});
 if(apple&&(apple.environment==='Sandbox'?'test':'live')===mode){
  if(apple.premiumAccess)return blocked('apple','already_premium');
  if(apple.status==='billing_retry')return blocked('apple');
 }
 if(!isBillingEnabled(env)||(isLive(env)?'live':'test')!==mode)return null;
 // These rows were linked by the signed webhook and immutable server claim.
 // Query all configured recoverable subscriptions, not just the latest row.
 const rows=(await env.BILLING_DB.prepare(`SELECT paddle_subscription_id,paddle_customer_id,price_id,plan
  FROM bb_paid_entitlements WHERE user_id=? AND status IN ('past_due','paused')
  AND ((plan='founder' AND price_id=?) OR (plan='standard' AND price_id=?))
  ORDER BY updated_at_ms DESC LIMIT 21`).bind(userId,expectedPrice(env,'founder'),expectedPrice(env,'standard')).all()).results||[];
 if(rows.length>20)unavailable();
 for(const row of rows){
  if(!SUB.test(row.paddle_subscription_id||'')||!CUSTOMER.test(row.paddle_customer_id||'')||expectedPrice(env,row.plan)!==row.price_id)unavailable();
  let current;try{current=await paddleApi(env,'/subscriptions/'+row.paddle_subscription_id);}catch{unavailable();}
  if(current?.id!==row.paddle_subscription_id||current.customer_id!==row.paddle_customer_id||!Array.isArray(current.items)||current.items.length!==1||current.items[0]?.price?.id!==row.price_id||current.items[0]?.quantity!==1)unavailable();
  if(['active','trialing'].includes(current.status))return blocked('paddle','already_premium');
  if(['past_due','paused'].includes(current.status))return blocked('paddle');
  if(current.status!=='canceled')unavailable();
 }
 return null;
}
