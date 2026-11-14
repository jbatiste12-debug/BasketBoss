import {json} from '../../../bb-server-lib/bb-billing.js';
import {appleSignInConfigured} from '../../../bb-server-lib/bb-apple-sign-in.js';
import {deletionConfigured,deletionReady} from '../../../bb-server-lib/bb-account-deletion.js';

// Only capability booleans are public. Keys, account data and Apple responses
// never cross this endpoint. A failed readiness check leaves email usable.
export async function onRequestGet({env}){
 const checks={appleConfiguration:false,accountDeletionConfiguration:false,accountDeletionChecked:false,accountDeletionReady:false};
 try{
  checks.appleConfiguration=appleSignInConfigured(env);
  checks.accountDeletionConfiguration=deletionConfigured(env);
  if(checks.appleConfiguration&&checks.accountDeletionConfiguration){
   checks.accountDeletionChecked=true;
   checks.accountDeletionReady=await deletionReady(env);
  }
 }catch{/* Only capability booleans are suitable for public diagnostics. */}
 const available=checks.appleConfiguration&&checks.accountDeletionConfiguration&&checks.accountDeletionReady;
 return json({available,nativeOnly:true,deletionReady:available,checks});
}
