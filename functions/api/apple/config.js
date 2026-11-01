import {json,authenticatedUser} from '../../../bb-server-lib/bb-billing.js';
import {getVerifiedAppleConfig,ensureAppleSchema,appleConfigForUser} from '../../../bb-server-lib/bb-apple-subscriptions.js';
export async function onRequestGet({request,env}){
 try{
  let config=getVerifiedAppleConfig(env);
  if(!config)return json({available:false,productIds:[],reason:'apple_not_enabled'});
  await ensureAppleSchema(env);
  const user=request?.headers.get('Authorization')?await authenticatedUser(request,env):null;
  if(user)config=appleConfigForUser(config,user.id);
  const productIds=[config.products.monthly,config.products.annual];
  return json({available:true,productIds,environment:config.environment,subscriptionGroupId:config.groupId});
 }catch{return json({available:false,productIds:[],reason:'apple_not_ready'});}
}
