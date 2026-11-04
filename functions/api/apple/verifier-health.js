// Public, read-only SDK initialisation readiness. This never verifies a proof,
// checks an account or grants access. Only a fixed reference may leave errors.
import {json} from '../../../bb-server-lib/bb-billing.js';
import {AppleBillingError,getAppleAppTransactionVerifier} from '../../../bb-server-lib/bb-apple-subscriptions.js';
const HOSTS=new Set(['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev']);
const REFERENCE=/\b(BB_BETA_APPLE_(?:MODULE|ROOTS|CONSTRUCTOR)_(?:GLOBAL_CONTEXT|BUFFER_COMPAT|MISSING_EXPORT|NODE_CRYPTO|ROOT_INTEGRITY|UNKNOWN))(?=\.|\s|$)/;
function safeReference(error){
 if(error instanceof AppleBillingError&&error.code==='testflight_beta_unavailable'){
  try{const match=REFERENCE.exec(error.message);if(match)return match[1];}catch{}
 }
 return 'BB_BETA_APPLE_MODULE_UNKNOWN';
}
export function createAppleVerifierHealthHandler({initialize=getAppleAppTransactionVerifier,setTimeout:schedule=setTimeout,clearTimeout:cancel=clearTimeout}={}){
 return async function handle({request,env={}}){
  let url;try{url=new URL(request.url);}catch{return json({ready:false},404);}
  if(url.protocol!=='https:'||url.port!==''||!HOSTS.has(url.hostname)||env.CF_PAGES_BRANCH!==undefined&&env.CF_PAGES_BRANCH!=='main')return json({ready:false},404);
  if(request.method!=='GET')return json({ready:false},405);
  let timer;
  try{
   const verifier=await Promise.race([Promise.resolve().then(()=>initialize()),new Promise((_,reject)=>{timer=schedule(()=>reject(Error('initialization_timeout')),5000);})]);
   if(typeof verifier?.verifyAndDecodeAppTransaction!=='function')throw Error('initialization_incomplete');
   return json({ready:true});
  }catch(error){return json({ready:false,code:'testflight_beta_unavailable',reference:safeReference(error)},503);}
  finally{if(timer!==undefined)cancel(timer);}
 };
}
export const onRequest=createAppleVerifierHealthHandler();
