/* A hosted HTTPS human check for the local iOS web view. No account, photo,
 * inventory, analytics or persistent storage is passed into this frame. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBNativeHumanCheck=api.create(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const ORIGIN='https://basketboss.co.uk',TYPE='basketboss-food-scan-check';
 function create(win){
  const native=()=>win?.location?.protocol==='capacitor:'&&win?.location?.hostname==='localhost';
  function mount(host,{onToken,onError,onExpire}={}){
   const notify=(fn,value)=>{try{if(typeof fn==='function')fn(value);}catch{}};
   if(!native()||!host?.appendChild||!win.document?.createElement||!win.crypto?.getRandomValues){notify(onError,'verification_unavailable');return null;}
   let frame=null,nonce=null,timer=null,phase='waiting',removed=false;
   const retry=win.document.createElement('button');retry.type='button';retry.textContent='Retry check';retry.hidden=true;retry.className='bb-native-human-check-retry';
   retry.style.cssText='min-height:44px;min-width:44px;padding:8px 14px;margin:6px 0;';
   const stopTimer=()=>{if(timer!==null){win.clearTimeout(timer);timer=null;}};
   const failed=kind=>{if(removed||phase==='failed')return;phase='failed';stopTimer();retry.hidden=false;if(kind==='expired')notify(onExpire);else notify(onError,'verification_unavailable');};
   function reset(){
    if(removed)return false;
    if(phase==='issued')notify(onExpire);
    stopTimer();nonce=null;phase='waiting';retry.hidden=true;
    frame?.remove();frame=null;
    const bytes=new Uint8Array(32);
    try{win.crypto.getRandomValues(bytes);}catch{failed('error');return false;}
    nonce=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
    frame=win.document.createElement('iframe');
    frame.title='Food-photo scan human check';frame.className='bb-native-human-check-frame';
    frame.setAttribute('sandbox','allow-scripts allow-same-origin');
    frame.setAttribute('referrerpolicy','no-referrer');
    frame.setAttribute('allow','camera \'none\'; microphone \'none\'; geolocation \'none\'');
    frame.style.cssText='display:block;width:100%;height:196px;border:0;background:#fffdf6;';
    const openedFrame=frame,openedNonce=nonce;
    frame.addEventListener('error',()=>{if(!removed&&frame===openedFrame&&phase==='waiting')failed('error');});
    frame.src=ORIGIN+'/api/food-scan-challenge?nonce='+nonce;
    host.appendChild(frame);host.appendChild(retry);
    timer=win.setTimeout(()=>{if(frame===openedFrame&&nonce===openedNonce)failed('error');},120000);
    return true;
   }
   function receive(event){
    if(removed||phase==='failed'||!frame||event.origin!==ORIGIN||event.source!==frame.contentWindow)return;
    const data=event.data;
    if(!data||typeof data!=='object'||Array.isArray(data)||data.type!==TYPE||data.nonce!==nonce)return;
    if(data.kind==='token'){
     if(phase!=='waiting'||typeof data.token!=='string'||data.token.length<10||data.token.length>2048||!/^[\x21-\x7e]+$/.test(data.token))return;
     phase='issued';stopTimer();retry.hidden=true;notify(onToken,data.token);return;
    }
    if(data.kind==='expired'||data.kind==='error')failed(data.kind);
   }
   function remove(){if(removed)return;removed=true;nonce=null;if(phase==='issued')notify(onExpire);phase='removed';stopTimer();win.removeEventListener('message',receive);frame?.remove();frame=null;retry.remove();}
   retry.addEventListener('click',()=>{notify(onExpire);reset();});
   win.addEventListener('message',receive);reset();
   return Object.freeze({reset,remove});
  }
  return Object.freeze({mount,isNative:native});
 }
 return Object.freeze({create});
});
