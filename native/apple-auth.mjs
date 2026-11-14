// Apple proves identity; the existing Supabase auth/session owner verifies and
// persists the resulting BasketBoss session. Credentials stay in memory only.
export function installNativeAppleAuth({plugin,window:win=globalThis.window,isAvailable=()=>true,isDeleting=()=>false}={}){
 const codes=new Set(['BB_APPLE_CANCELLED','BB_APPLE_BUSY','BB_APPLE_UNAVAILABLE','BB_APPLE_INVALID_CREDENTIAL','BB_APPLE_AUTH_FAILED']);
 const failure=code=>Object.assign(Error(code==='BB_APPLE_CANCELLED'?'Apple sign-in was cancelled.':'Apple sign-in could not complete.'),{code:codes.has(code)?code:'BB_APPLE_AUTH_FAILED'});
 let current=null;
 const allowed=()=>!isDeleting()&&win.BBAccountDeletion?.isDeleting?.()!==true;
 async function available(){
  if(!allowed()||!isAvailable()||typeof plugin?.available!=='function')return false;
  try{return (await plugin.available())?.available===true;}catch{return false;}
 }
 async function cancel(){
  const operation=current;if(!operation)return;
  operation.cancelled=true;current=null;
  try{await plugin.cancel();}catch{/* Native deadline also releases the operation. */}
 }
 async function signIn(){
  if(current)throw failure('BB_APPLE_BUSY');
  if(!allowed())throw failure('BB_APPLE_UNAVAILABLE');
  const operation={cancelled:false};current=operation;
  try{
   if(!await available())throw failure('BB_APPLE_UNAVAILABLE');
   if(current!==operation||operation.cancelled||!allowed())throw failure('BB_APPLE_CANCELLED');
   const result=await plugin.signIn();
   if(current!==operation||operation.cancelled||!allowed())throw failure('BB_APPLE_CANCELLED');
   if(typeof result?.identityToken!=='string'||result.identityToken.length>16384||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.identityToken)||
      typeof result.nonce!=='string'||!/^[a-f0-9]{64}$/.test(result.nonce))throw failure('BB_APPLE_INVALID_CREDENTIAL');
   const credential={identityToken:result.identityToken,nonce:result.nonce};
   // Account deletion uses a fresh authorization code for server-side Apple
   // token revocation. Normal sign-in ignores it; no bridge state retains it.
   if(result.authorizationCode!==undefined){
    if(typeof result.authorizationCode!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(result.authorizationCode))throw failure('BB_APPLE_INVALID_CREDENTIAL');
    credential.authorizationCode=result.authorizationCode;
   }
   return credential;
  }catch(error){throw failure(codes.has(error?.code)?error.code:'BB_APPLE_AUTH_FAILED');}
  finally{if(current===operation)current=null;}
 }
 const api=Object.freeze({available,signIn,cancel});
 win.addEventListener?.('pagehide',()=>void cancel());
 win.addEventListener?.('basketboss:session-changed',()=>void cancel());
 win.addEventListener?.('basketboss:account-deletion-started',()=>void cancel());
 win.BBNativeAppleAuth=api;return api;
}
