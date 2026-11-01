import {json,authenticatedUser} from '../../../bb-server-lib/bb-billing.js';
import {getVerifiedAppleConfig,ensureAppleSchema,appleConfigForUser} from '../../../bb-server-lib/bb-apple-subscriptions.js';
import {founderAvailability} from '../../../bb-server-lib/bb-apple-founder.js';
export async function onRequestGet({request,env}){
 try{
  let config=getVerifiedAppleConfig(env);
  if(!config)return json({available:false,productIds:[],reason:'apple_not_enabled'});
  await ensureAppleSchema(env);
  const user=request?.headers.get('Authorization')?await authenticatedUser(request,env):null;
  if(user)config=appleConfigForUser(config,user.id);
  const founder=await founderAvailability(env,user?.id||null,config.environment);
  const productIds=[config.products.monthly,config.products.annual];
  if(founder.enabled&&founder.available)productIds.push(config.products.founder);
  return json({available:true,productIds,environment:config.environment,subscriptionGroupId:config.groupId,
   founderAvailable:founder.enabled&&founder.available,founderRemaining:founder.remaining});
 }catch{return json({available:false,productIds:[],reason:'apple_not_ready'});}
}
