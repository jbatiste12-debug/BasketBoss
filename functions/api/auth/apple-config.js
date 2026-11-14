import {json} from '../../../bb-server-lib/bb-billing.js';
import {appleSignInConfigured} from '../../../bb-server-lib/bb-apple-sign-in.js';
import {deletionConfigured,deletionReady} from '../../../bb-server-lib/bb-account-deletion.js';

// Only capability booleans are public. Keys, account data and Apple responses
// never cross this endpoint. A failed readiness check leaves email usable.
export async function onRequestGet({env}){
 try{
  const available=appleSignInConfigured(env)&&deletionConfigured(env)&&await deletionReady(env);
  return json({available,nativeOnly:true,deletionReady:available});
 }catch{return json({available:false,nativeOnly:true,deletionReady:false});}
}
