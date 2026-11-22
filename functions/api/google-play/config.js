import {assertPurchaseIntentReady} from '../../../bb-server-lib/bb-purchase-intents.js';
import {json,authenticatedUser} from '../../../bb-server-lib/bb-billing.js';
import {getVerifiedGooglePlayConfig,assertGooglePlayAccountReady,liveGooglePlayCheckoutEnabled} from '../../../bb-server-lib/bb-google-play-subscriptions.js';
export async function onRequestGet({request,env}){
 try{
  const config=getVerifiedGooglePlayConfig(env);
  if(!config)return json({available:false,restoreAvailable:false,provider:'google_play',productIds:[],plans:[],reason:'google_play_not_enabled'});
  const user=await authenticatedUser(request,env);
  if(!user)return json({available:false,restoreAvailable:false,provider:'google_play',productIds:[],plans:[],reason:'authentication_required'});
  await assertGooglePlayAccountReady(env,config,user.id);
  // Disabling new sales never disables verification of existing purchases.
  // Only a configured, authenticated and account-ready caller sees this data.
  let available=config.mode!=='live'||liveGooglePlayCheckoutEnabled(env);
  if(available&&env.BB_PURCHASE_INTENTS_ENABLED==='true'){try{await assertPurchaseIntentReady(env);}catch{available=false;}}
  return json({available,restoreAvailable:true,provider:'google_play',packageName:config.packageName,productId:config.productId,productIds:[config.productId],plans:config.plans,mode:config.mode,
   ...(available?{}:{reason:'google_play_live_checkout_not_ready'})});
 }catch{return json({available:false,restoreAvailable:false,provider:'google_play',productIds:[],plans:[],reason:'google_play_not_ready'});}
}
