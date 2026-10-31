import {Capacitor} from '@capacitor/core';
import {App} from '@capacitor/app';
import {Browser} from '@capacitor/browser';
import {Camera,CameraResultType,CameraSource} from '@capacitor/camera';
import {Haptics,ImpactStyle,NotificationType} from '@capacitor/haptics';
import {StatusBar,Style} from '@capacitor/status-bar';
import {SplashScreen} from '@capacitor/splash-screen';
import {PRODUCTION_ORIGIN,productionApiURL,nativePageURL,isCheckoutURL,installNativeFetch} from './routing.mjs';
import {installNativeMembership} from './membership.mjs';

if(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios'){
 document.documentElement.classList.add('bb-native-ios');
 const originalFetch=installNativeFetch();
 const readSession=()=>{try{return JSON.parse(localStorage.getItem('basketboss_cloud_session_v1')||'null');}catch{return null;}};
 const haptic=kind=>{
  const action=kind==='success'?()=>Haptics.notification({type:NotificationType.Success}):kind==='selection'?()=>Haptics.selectionStart().then(()=>Haptics.selectionChanged()).finally(()=>Haptics.selectionEnd()):()=>Haptics.impact({style:ImpactStyle.Light});
  return action().catch(()=>{});
 };
 async function openExternal(address){
  const url=new URL(address,location.href);
  if(url.protocol!=='https:'||isCheckoutURL(url.href))throw Error('This link is not available in the iOS app.');
  await Browser.open({url:url.href,presentationStyle:'popover'});
 }
 window.BBNative=Object.freeze({isNative:true,platform:'ios',apiOrigin:PRODUCTION_ORIGIN,apiURL:path=>productionApiURL(path)||path,haptic,openExternal});
 // Preserve method/body/authentication. No cookie transport or native HTTP
 // patch is enabled: WKWebView uses the server's narrow native-origin CORS.
 if(window.XMLHttpRequest){
  const open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,address,...rest){
   if(isCheckoutURL(String(address),location.href))throw Error('Purchases are not available in this iOS build.');
   return open.call(this,method,productionApiURL(String(address),location.href)||address,...rest);
  };
 }
 let takingPhoto=false;
 async function nativePhoto(input){
  if(takingPhoto||input.disabled)return;takingPhoto=true;
  try{
   const photo=await Camera.getPhoto({resultType:CameraResultType.Uri,source:CameraSource.Prompt,quality:85,width:2200,height:2200,correctOrientation:true,saveToGallery:false,promptLabelHeader:'Receipt photo',promptLabelPhoto:'Choose photo',promptLabelPicture:'Take photo',promptLabelCancel:'Cancel'});
   if(!photo.webPath||!input.isConnected)return;
   const response=await originalFetch(photo.webPath);if(!response.ok)throw Error('The photo could not be opened.');
   const blob=await response.blob();if(blob.size>12*1024*1024)throw Error('Choose a receipt photo under 12 MB.');
   const file=new File([blob],'receipt-'+Date.now()+'.'+(photo.format==='png'?'png':'jpg'),{type:blob.type||'image/jpeg'});
   const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
   input.dispatchEvent(new Event('change',{bubbles:true}));await haptic('selection');
  }catch(error){
   if(!/cancel/i.test(error?.message||'')){
    const status=document.querySelector('#bb-receipt-scanner .bb-receipt-status');
    const message='Unable to open the photo. Check Camera or Photos permission in iPhone Settings, then try again.';
    if(status)status.textContent=message;else window.alert(message);
   }
  }finally{takingPhoto=false;}
 }
 document.addEventListener('click',event=>{
  const file=event.target.closest?.('input[type=file][data-receipt-action=file]');
  if(file&&!file.disabled){event.preventDefault();event.stopImmediatePropagation();void nativePhoto(file);return;}
  const link=event.target.closest?.('a[href]');
  if(link){
   let address;try{address=new URL(link.getAttribute('href'),location.href);}catch{return;}
   const local=nativePageURL(address.href,location.href);
   if(local&&address.protocol==='https:'){event.preventDefault();event.stopImmediatePropagation();location.assign(local);return;}
   if(isCheckoutURL(address.href)){event.preventDefault();event.stopImmediatePropagation();location.assign('pricing-sandbox.html');return;}
   if(address.protocol==='https:'){
    event.preventDefault();event.stopImmediatePropagation();void openExternal(address.href).catch(()=>{});return;
   }
   if(address.protocol==='capacitor:'&&link.target==='_blank'){event.preventDefault();location.assign(address.href);return;}
  }
  if(event.target.closest?.('[data-bb-haptic],button[data-tab],nav.tabs button'))void haptic('selection');
 },true);
 document.addEventListener('basketboss:receipt-confirmed',()=>void haptic('success'));
 function ready(){
  installNativeMembership({apiURL:path=>PRODUCTION_ORIGIN+path,openExternal,readSession});
  void StatusBar.setStyle({style:Style.Dark}).catch(()=>{});
  void StatusBar.setOverlaysWebView({overlay:false}).catch(()=>{});
  // Content is already local. Wait for initial render, then dismiss launch art.
  requestAnimationFrame(()=>requestAnimationFrame(()=>void SplashScreen.hide().catch(()=>{})));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
 void App.addListener('appStateChange',({isActive})=>{if(isActive){window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('basketboss:native-resumed'));}});
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
