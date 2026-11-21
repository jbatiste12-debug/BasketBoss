import {Capacitor,SystemBars,SystemBarsStyle,registerPlugin} from '@capacitor/core';
import {App} from '@capacitor/app';
import {Browser} from '@capacitor/browser';
import {Haptics,ImpactStyle,NotificationType} from '@capacitor/haptics';
import {SplashScreen} from '@capacitor/splash-screen';
import {PRODUCTION_ORIGIN} from './routing.mjs';
import {androidApiURL,androidPageURL,androidMembershipURL,isAndroidBillingURL,installAndroidFetch,installAndroidXHR,installAndroidWindowOpen} from './android-routing.mjs';
import {installAndroidMembership} from './android-membership.mjs';
import {installAndroidGooglePlayPurchases} from './google-play-purchases.mjs';
import {installNativeStartup} from './startup.mjs';
import {watchNativeEntryReadiness} from './entry-readiness.mjs';

// This entry is bundled only into Android output. The iOS entry and its native
// Apple plugins are left intact. Email auth remains owned by BBAuthFlow.
export function installAndroidRuntime({window:win=globalThis.window,document:doc=globalThis.document,app=App,browser=Browser,haptics=Haptics,bars=SystemBars,splash=SplashScreen,registerNative=registerPlugin,installStartup=installNativeStartup,watchEntry=watchNativeEntryReadiness,installMembership=installAndroidMembership,installPurchases=installAndroidGooglePlayPurchases}={}){
 doc.documentElement.classList.add('bb-native-android');
 const originalFetch=installAndroidFetch({window:win});
 const deleting=()=>win.BBAccountDeletion?.isDeleting?.()===true;
 const readSession=()=>{try{return JSON.parse(win.localStorage.getItem('basketboss_cloud_session_v1')||'null');}catch{return null;}};
 const startup=installStartup({window:win,document:doc});
 const haptic=kind=>{
  const action=kind==='success'?()=>haptics.notification({type:NotificationType.Success}):kind==='selection'?()=>haptics.selectionStart().then(()=>haptics.selectionChanged()).finally(()=>haptics.selectionEnd()):()=>haptics.impact({style:ImpactStyle.Light});
  return Promise.resolve().then(action).catch(()=>{});
 };
 async function openExternal(address){
  if(deleting())return;
  const url=new URL(address,win.location.href);
  if(isAndroidBillingURL(url.href,win.location.href)){win.location.assign(androidMembershipURL(win.location.href));return;}
  const local=androidPageURL(url.href,win.location.href);if(local){win.location.assign(local);return;}
  if(url.protocol!=='https:'||url.username||url.password)throw Error('This link is not available in the Android app.');
  await browser.open({url:url.href});
 }
 const dismissKeyboard=()=>{doc.activeElement?.blur?.();};
 // The ordinary HTML chooser owns photo input. Its camera capture creates
 // app-private JPEG files; account deletion requires real native cleanup.
 const data=registerNative('BasketBossAndroid');
 const clearTemporaryData=async()=>{
  const result=await data.clearReceiptPhotos();
  if(result?.ok!==true)throw Object.assign(Error('Temporary receipt photos could not be cleared.'),{code:'BB_NATIVE_CLEANUP'});
  return result;
 };
 win.BBNative=Object.freeze({isNative:true,platform:'android',apiOrigin:PRODUCTION_ORIGIN,apiURL:path=>androidApiURL(path,win.location.href)||path,haptic,openExternal,dismissKeyboard,clearTemporaryData});
 win.BBNativeMembership=Object.freeze({open(){
  if(deleting()||doc.getElementById('bbAccountDeletionDialog')?.open===true||doc.documentElement.classList.contains('bb-native-starting'))return false;
  win.location.assign(androidMembershipURL(win.location.href));return true;
 }});
 installAndroidXHR({window:win});installAndroidWindowOpen({window:win,openExternal});
 doc.addEventListener('click',event=>{
  if(event.target.closest?.('#bb175Compare,#bbpolUpgradePill,button[data-bbob="premium"]')){
   event.preventDefault();event.stopImmediatePropagation();win.BBNativeMembership.open();return;
  }
  const link=event.target.closest?.('a[href]');
  if(link){
   let url;try{url=new URL(link.getAttribute('href'),win.location.href);}catch{return;}
   if(isAndroidBillingURL(url.href,win.location.href)){event.preventDefault();event.stopImmediatePropagation();win.BBNativeMembership.open();return;}
   const local=androidPageURL(url.href,win.location.href);
   if(local&&local!==url.href){event.preventDefault();event.stopImmediatePropagation();win.location.assign(local);return;}
   if(url.origin!=='https://localhost'&&url.protocol==='https:'){
    event.preventDefault();event.stopImmediatePropagation();void openExternal(url.href).catch(()=>{});return;
   }
  }
  if(event.target.closest?.('[data-bb-haptic],button[data-tab],nav.tabs button'))void haptic('selection');
 },true);
 doc.addEventListener('submit',event=>{
  const form=event.target,action=form.getAttribute?.('action'),submitAction=event.submitter?.getAttribute('formaction');
  const deletionDialog=doc.getElementById('bbAccountDeletionDialog');
  // The existing deletion controller owns its actionless form, including when
  // Account is opened from the membership page. Explicit payment actions still
  // pass through the same billing guard, even inside a dialog with this ID.
  if(form.tagName==='FORM'&&deletionDialog?.tagName==='DIALOG'&&form.parentElement===deletionDialog&&action===null&&(submitAction===null||submitAction===undefined))return;
  const target=submitAction||action||win.location.href;
  if(isAndroidBillingURL(target,win.location.href)){event.preventDefault();event.stopImmediatePropagation();win.BBNativeMembership.open();}
 },true);
 doc.addEventListener('basketboss:receipt-confirmed',()=>void haptic('success'));
 let membership,purchases;
 const prepareMembership=()=>{if(!membership){purchases=installPurchases({plugin:registerNative('BasketBossGooglePlay'),window:win,readSession,apiURL:path=>PRODUCTION_ORIGIN+path,fetch:originalFetch,isDeleting:deleting});membership=installMembership({window:win,document:doc,readSession,apiURL:path=>PRODUCTION_ORIGIN+path,fetch:originalFetch,purchases});}};
 const entry=watchEntry({window:win,document:doc,startup,prepareMembership});
 function ready(){entry.stop();prepareMembership();void bars.setStyle({style:SystemBarsStyle.Light}).catch(()=>{});void splash.hide({fadeOutDuration:0}).catch(()=>{});win.requestAnimationFrame(()=>startup.ready());}
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
 void app.addListener('appStateChange',({isActive})=>{if(isActive){win.dispatchEvent(new win.Event('focus'));win.dispatchEvent(new win.Event('basketboss:native-resumed'));}});
 let lastAuthURL=null;
 async function authLink(address,cold=false){
  let url;try{url=new URL(address);}catch{return;}
  if(url.protocol!=='basketboss:'||url.hostname!=='auth'||url.pathname!=='/callback'||url.username||url.password||url.port||address===lastAuthURL||deleting())return;
  lastAuthURL=address;
  try{
   const digest=await win.crypto.subtle.digest('SHA-256',new TextEncoder().encode(address)),fingerprint=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
   if(cold&&win.sessionStorage.getItem('basketboss_last_auth_launch_v1')===fingerprint)return;
   win.sessionStorage.setItem('basketboss_last_auth_launch_v1',fingerprint);
  }catch{/* The existing auth controller still validates and consumes the callback. */}
  if(deleting())return;
  const receive=()=>{if(!deleting())void win.BBAuthFlow?.handleCallbackURL?.(address);};
  if(win.BBAuthFlow)receive();else{
   const mount=()=>{if(win.BBAuthFlow)receive();else if(doc.getElementById('cloud-auth'))win.addEventListener('basketboss:auth-ready',receive,{once:true});else if(win.BBAuthCallbackBridge?.capture?.(address))win.location.assign(new URL('index.html?bb_auth_callback=1',win.location.href).href);};
   if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  }
 }
 void app.addListener('appUrlOpen',({url})=>void authLink(url));
 void app.getLaunchUrl().then(value=>{if(value?.url)void authLink(value.url,true);}).catch(()=>{});
 return {authLink,prepareMembership,get membership(){return membership;},get purchases(){return purchases;}};
}
if(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android')installAndroidRuntime();
