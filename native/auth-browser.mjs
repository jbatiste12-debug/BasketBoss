/* Google OAuth browser transport only. Supabase's existing PKCE/getUser owner
 * verifies callbacks and remembers sessions; no browser event authenticates. */
export function installNativeAuthBrowser({window:win=globalThis.window,browser,isDeleting=()=>false}={}){
 if(win.BBNativeAuthBrowser)return win.BBNativeAuthBrowser;
 let owned=null,closing=null;
 const failure=(code,message)=>Object.assign(new Error(message),{code});
 const blocked=()=>isDeleting()===true||win.document?.getElementById?.('bbAccountDeletionDialog')?.open===true||win.document?.documentElement?.classList?.contains?.('bb-native-starting')===true;
 function authorize(address){
  let url,configured;try{url=new URL(address);configured=new URL(win.BASKETBOSS_CLOUD_CONFIG?.url);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
   !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)||url.origin!==configured.origin||
   url.pathname!=='/auth/v1/authorize'||url.searchParams.getAll('provider').length!==1||url.searchParams.get('provider')!=='google')return null;
  return url.href;
 }
 function callback(address){
  let url;try{url=new URL(address);}catch{return false;}
  if(url.protocol!=='basketboss:'||url.hostname!=='auth'||url.pathname!=='/callback'||url.username||url.password||url.port)return false;
  const query=url.searchParams,hash=new URLSearchParams(url.hash.slice(1));
  const values=key=>[...query.getAll(key),...hash.getAll(key)];
  const provider=values('bb_auth');
  return provider.length===1&&provider[0]==='google'&&['code','error','error_code'].some(key=>values(key).some(Boolean));
 }
 function bounded(promise,milliseconds,code,message){
  let timer;
  return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=win.setTimeout(()=>reject(failure(code,message)),milliseconds);})]).finally(()=>win.clearTimeout(timer));
 }
 function remove(operation){
  const listener=operation.listener;operation.listener=null;
  try{Promise.resolve(listener?.remove?.()).catch(()=>{});}catch{}
 }
 function release(operation){
  if(owned!==operation)return false;
  owned=null;remove(operation);return true;
 }
 async function close(){
  if(closing)return closing;
  const work=(async()=>{try{if(typeof browser?.close==='function')await bounded(browser.close(),1500,'BB_GOOGLE_BROWSER_CLOSE','Google sign-in browser could not close.');}catch{}})();
  closing=work;try{await work;}finally{if(closing===work)closing=null;}
 }
 function finished(operation){
  if(!release(operation))return;
  // Listener ownership prevents closing a help/legal browser from cancelling
  // a later sign-in. The auth owner decides what its pending action may cancel.
  try{win.BBAuthFlow?.cancelGoogleSignIn?.();}catch{}
 }
 async function open(address){
  const target=authorize(address);
  if(!target)throw failure('BB_GOOGLE_BROWSER_URL','Google sign-in returned an unexpected destination.');
  if(blocked())throw failure('BB_GOOGLE_BROWSER_UNAVAILABLE','Google sign-in is not available right now.');
  if(owned||closing)throw failure('BB_GOOGLE_BROWSER_BUSY','Google sign-in is already open.');
  if(typeof browser?.open!=='function'||typeof browser?.addListener!=='function')throw failure('BB_GOOGLE_BROWSER_UNAVAILABLE','Google sign-in browser is unavailable.');
  const operation={listener:null,completed:false};owned=operation;
  const launch=async()=>{
   const listener=await browser.addListener('browserFinished',()=>finished(operation));
   operation.listener=listener;
   if(owned!==operation){remove(operation);if(operation.completed)return;throw failure('BB_GOOGLE_BROWSER_CANCELLED','Google sign-in was cancelled.');}
   if(blocked())throw failure('BB_GOOGLE_BROWSER_UNAVAILABLE','Google sign-in is not available right now.');
   try{await browser.open({url:target,presentationStyle:'popover'});}
   catch(error){if(!operation.completed)throw error;}
   // A valid return can arrive while the native open promise is settling. It
   // completes this launch handoff; the separate auth owner still verifies it.
   if(operation.completed)return;
   if(owned!==operation)throw failure('BB_GOOGLE_BROWSER_CANCELLED','Google sign-in was cancelled.');
   if(blocked())throw failure('BB_GOOGLE_BROWSER_UNAVAILABLE','Google sign-in is not available right now.');
  };
  try{await bounded(launch(),10000,'BB_GOOGLE_BROWSER_TIMEOUT','Google sign-in browser took too long to open.');}
  catch(error){
   if(operation.completed)return;
   if(release(operation))void close();
   if(['BB_GOOGLE_BROWSER_CANCELLED','BB_GOOGLE_BROWSER_TIMEOUT','BB_GOOGLE_BROWSER_UNAVAILABLE'].includes(error?.code))throw error;
   throw failure('BB_GOOGLE_BROWSER_OPEN','Google sign-in browser could not open. Please try again.');
  }
 }
 async function complete(address){
  if(!callback(address)||!owned)return false;
  const operation=owned;operation.completed=true;release(operation);
  await close();return true;
 }
 async function cancel(){
  if(!owned)return;
  const operation=owned;release(operation);await close();
 }
 const api=Object.freeze({open,complete,cancel});win.BBNativeAuthBrowser=api;
 // Existing auth/deletion owners still decide verification and account state.
 win.addEventListener?.('basketboss:account-deletion-started',()=>{void cancel();});
 win.addEventListener?.('basketboss:account-deletion-deleted',()=>{void cancel();});
 win.addEventListener?.('pagehide',()=>{void cancel();});
 try{win.dispatchEvent?.(new win.Event('basketboss:auth-browser-ready'));}catch{}
 return api;
}
