import {json,authenticatedUser} from '../../../bb-server-lib/bb-billing.js';
import {getVerifiedGooglePlayConfig,assertGooglePlayAccountReady} from '../../../bb-server-lib/bb-google-play-subscriptions.js';
export async function onRequestGet({request,env}){
 try{
  // License testing only in this revision. Live checkout needs a reviewed
  // cross-provider purchase reservation and cancellation design first. No
  // environment flag overrides this fence; production readers remain separate.
  if(env.GOOGLE_PLAY_BILLING_MODE==='live')return json({available:false,provider:'google_play',productIds:[],plans:[],reason:'google_play_live_checkout_not_ready'});
  const config=getVerifiedGooglePlayConfig(env);
  if(!config)return json({available:false,provider:'google_play',productIds:[],plans:[],reason:'google_play_not_enabled'});
  const user=await authenticatedUser(request,env);
  if(!user)return json({available:false,provider:'google_play',productIds:[],plans:[],reason:'authentication_required'});
  await assertGooglePlayAccountReady(env,config,user.id);
  return json({available:true,provider:'google_play',packageName:config.packageName,productId:config.productId,productIds:[config.productId],plans:config.plans,mode:config.mode});
 }catch{return json({available:false,provider:'google_play',productIds:[],plans:[],reason:'google_play_not_ready'});}
}
