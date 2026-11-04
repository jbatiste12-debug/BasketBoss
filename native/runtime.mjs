import {Capacitor,registerPlugin} from '@capacitor/core';
import {App} from '@capacitor/app';
import {Browser} from '@capacitor/browser';
import {Camera,CameraResultType,CameraSource} from '@capacitor/camera';
import {Haptics,ImpactStyle,NotificationType} from '@capacitor/haptics';
import {StatusBar,Style} from '@capacitor/status-bar';
import {SplashScreen} from '@capacitor/splash-screen';
import {PRODUCTION_ORIGIN,productionApiURL,nativePageURL,nativeMembershipURL,isNativeBillingURL,installNativeFetch,installNativeXHR,installNativeWindowOpen} from './routing.mjs';
import {installNativeMembership} from './membership.mjs';
import {installNativeApplePurchases} from './apple-purchases.mjs';
import {installNativeStartup} from './startup.mjs';
import {watchNativeEntryReadiness} from './entry-readiness.mjs';
import {installNativeCookVoice} from './cook-voice.mjs';

if(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios'){
 document.documentElement.classList.add('bb-native-ios');
 const originalFetch=installNativeFetch();
 const nativeData=registerPlugin('BasketBossNavigation');
 const startup=installNativeStartup({finishNative:()=>nativeData.finishStartup()});
 const dismissKeyboard=()=>nativeData.dismissKeyboard();
 const clearTemporaryData=async()=>{
  const result=await nativeData.clearReceiptPhotos();
  if(result?.ok!==true)throw Object.assign(Error('Temporary receipt photos could not be cleared.'),{code:'BB_NATIVE_CLEANUP'});
  return result;
 };
 const deleting=()=>window.BBAccountDeletion?.isDeleting?.()===true;
 const readSession=()=>{try{return JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');}catch{return null;}};
 const haptic=kind=>{
  const action=kind==='success'?()=>Haptics.notification({type:NotificationType.Success}):kind==='selection'?()=>Haptics.selectionStart().then(()=>Haptics.selectionChanged()).finally(()=>Haptics.selectionEnd()):()=>Haptics.impact({style:ImpactStyle.Light});
  return action().catch(()=>{});
 };
 async function openExternal(address){
  const url=new URL(address,location.href);
  if(isNativeBillingURL(url.href,location.href)){location.assign(nativeMembershipURL(location.href));return;}
  const local=nativePageURL(url.href,location.href);
  if(local){location.assign(local);return;}
  if(url.protocol!=='https:')throw Error('This link is not available in the iOS app.');
  await Browser.open({url:url.href,presentationStyle:'popover'});
 }
 window.BBNative=Object.freeze({isNative:true,platform:'ios',apiOrigin:PRODUCTION_ORIGIN,apiURL:path=>productionApiURL(path)||path,haptic,openExternal,clearTemporaryData,dismissKeyboard});
 const cookVoice=installNativeCookVoice({plugin:registerPlugin('BasketBossCookVoice'),window,isPremium:()=>window.BasketBossVerifiedPremium?.isActive?.()===true});
 // Preserve method/body/authentication. No cookie transport or native HTTP
 // patch is enabled: WKWebView uses the server's narrow native-origin CORS.
 installNativeXHR();
 installNativeWindowOpen({openExternal});
 let takingPhoto=false;
 async function nativePhoto(input){
  if(takingPhoto||input.disabled||deleting())return;takingPhoto=true;let cleared=false;
  try{
   const photo=await Camera.getPhoto({resultType:CameraResultType.Uri,source:CameraSource.Prompt,quality:85,width:2200,height:2200,correctOrientation:true,saveToGallery:false,promptLabelHeader:'Receipt photo',promptLabelPhoto:'Choose photo',promptLabelPicture:'Take photo',promptLabelCancel:'Cancel'});
   if(deleting()||!photo.webPath||!input.isConnected)return;
   const response=await originalFetch(photo.webPath);if(!response.ok)throw Error('The photo could not be opened.');
   const blob=await response.blob();if(blob.size>12*1024*1024)throw Error('Choose a receipt photo under 12 MB.');
   if(deleting()||!input.isConnected)return;
   const file=new File([blob],'receipt-'+Date.now()+'.'+(photo.format==='png'?'png':'jpg'),{type:blob.type||'image/jpeg'});
   await clearTemporaryData();cleared=true;
   if(deleting()||!input.isConnected)return;
   const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
   input.dispatchEvent(new Event('change',{bubbles:true}));await haptic('selection');
  }catch(error){
   if(!deleting()&&!/cancel/i.test(error?.message||'')){
    const status=document.querySelector('#bb-receipt-scanner .bb-receipt-status');
    const message=error?.code==='BB_NATIVE_CLEANUP'?'Temporary receipt photos could not be cleared. Please try again.':'Unable to open the photo. Check Camera or Photos permission in iPhone Settings, then try again.';
    if(status)status.textContent=message;else window.alert(message);
   }
  }finally{
   if(!cleared)try{await clearTemporaryData();}catch{ /* Account deletion retries and reports cleanup failures separately. */ }
   takingPhoto=false;
  }
 }
 document.addEventListener('click',event=>{
  const file=event.target.closest?.('input[type=file][data-receipt-action=file]');
  if(file&&!file.disabled){event.preventDefault();event.stopImmediatePropagation();void nativePhoto(file);return;}
  if(event.target.closest?.('#bb175Compare,button[data-bbob="premium"]')){event.preventDefault();event.stopImmediatePropagation();location.assign(nativeMembershipURL(location.href));return;}
  const link=event.target.closest?.('a[href]');
  if(link){
   let address;try{address=new URL(link.getAttribute('href'),location.href);}catch{return;}
   if(isNativeBillingURL(address.href,location.href)){event.preventDefault();event.stopImmediatePropagation();location.assign(nativeMembershipURL(location.href));return;}
   const local=nativePageURL(address.href,location.href);
   if(local&&local!==address.href){event.preventDefault();event.stopImmediatePropagation();location.assign(local);return;}
   if(address.protocol==='https:'){
    event.preventDefault();event.stopImmediatePropagation();void openExternal(address.href).catch(()=>{});return;
   }
   if(address.protocol==='capacitor:'&&link.target==='_blank'){event.preventDefault();location.assign(address.href);return;}
  }
  if(event.target.closest?.('[data-bb-haptic],button[data-tab],nav.tabs button'))void haptic('selection');
 },true);
 document.addEventListener('submit',event=>{
  const form=event.target;
  const target=event.submitter?.getAttribute('formaction')||form.getAttribute?.('action')||location.href;
  if(isNativeBillingURL(target,location.href)){event.preventDefault();event.stopImmediatePropagation();location.assign(nativeMembershipURL(location.href));}
 },true);
 document.addEventListener('basketboss:receipt-confirmed',()=>void haptic('success'));
 let membership,purchases;
 function prepareMembership(){
  if(!purchases)purchases=installNativeApplePurchases({plugin:registerPlugin('BasketBossPurchases'),apiURL:path=>PRODUCTION_ORIGIN+path,readSession,fetch:originalFetch,window,isDeleting:deleting});
  if(!membership)membership=installNativeMembership({apiURL:path=>PRODUCTION_ORIGIN+path,readSession,purchases});
 }
 // Refresh the same authenticated account's paid catalogue after the server has
 // acknowledged an Apple transaction. This never sets a local Premium tier.
 window.addEventListener('basketboss:apple-membership-updated',()=>window.dispatchEvent(new Event('basketboss:session-changed')));
 const earlyEntry=watchNativeEntryReadiness({startup,prepareMembership});
 function ready(){
  earlyEntry.stop();prepareMembership();
  void StatusBar.setStyle({style:Style.Light}).catch(()=>{});
  void StatusBar.setOverlaysWebView({overlay:false}).catch(()=>{});
  // UIKit already animates while WKWebView initializes. Dismiss both layers
  // when real app controls are present, without waiting for a second intro.
  void SplashScreen.hide({fadeOutDuration:0}).catch(()=>{});
  requestAnimationFrame(()=>startup.ready());
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
 void App.addListener('appStateChange',({isActive})=>{if(isActive){window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('basketboss:native-resumed'));}else{void cookVoice.stop();}});
 void App.addListener('appUrlOpen',({url})=>{
  let link;try{link=new URL(url);}catch{return;}
  // Do not trust tokens in incoming URLs. Email/password auth remains the
  // existing verified Supabase flow; confirmation links just reopen sign-in.
  if(link.protocol==='basketboss:'&&link.hostname==='auth'&&link.pathname==='/callback'){
   document.getElementById('cloud-open')?.click();
   const message=document.getElementById('cloud-message');if(message)message.textContent='If your email is confirmed, sign in to continue.';
  }
 });
}
