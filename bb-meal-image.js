/* Meal pictures are requested after the validated recipe is visible. Never
 * persist a ticket/image or replace a missing picture with unrelated stock art. */
(function(root){
 'use strict';
 const MAX_BASE64=5600000,active=new Set(),perHost=new WeakMap();
 const allowed=new Set(['image/png','image/jpeg','image/webp']);
 function validImage(value){
  const mime=value?.mimeType,data=value?.dataBase64;
  if(!allowed.has(mime)||typeof data!=='string'||data.length<64||data.length>MAX_BASE64||data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))return false;
  try{const head=root.atob(data.slice(0,64));return mime==='image/png'?head.startsWith('\x89PNG\r\n\x1a\n'):mime==='image/jpeg'?head.charCodeAt(0)===255&&head.charCodeAt(1)===216&&head.charCodeAt(2)===255:head.startsWith('RIFF')&&head.slice(8,12)==='WEBP';}catch{return false;}
 }
 function attach(host,options={}){
  perHost.get(host)?.cancel();
  const doc=host.ownerDocument||root.document;
  const getToken=typeof options.getToken==='function'?options.getToken:()=>null;
  let token;try{token=getToken();}catch{}
  const controller=new root.AbortController();let disposed=false,objectURL=null,timer=null,watcher=null;
  const current=()=>{try{return !disposed&&host.isConnected!==false&&root.BBAccountDeletion?.isDeleting?.()!==true&&getToken()===token&&(!options.isCurrent||options.isCurrent());}catch{return false;}};
  const figure=doc.createElement('figure');figure.className='bbmi-figure';
  const status=doc.createElement('figcaption');status.className='bbmi-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const placeholder=doc.createElement('div');placeholder.className='bbmi-loading';placeholder.setAttribute('aria-hidden','true');
  const star=doc.createElement('span');star.textContent='✦';placeholder.append(star);
  status.textContent='Creating a picture of your meal…';figure.append(placeholder,status);
  host.classList.add('bb-meal-image');host.replaceChildren(figure);
  const release=()=>{if(objectURL){root.URL.revokeObjectURL(objectURL);objectURL=null;}};
  function stopTimers(){if(timer!==null)root.clearTimeout(timer);if(watcher!==null)root.clearInterval(watcher);timer=null;watcher=null;}
  function cancel(){if(disposed)return;disposed=true;controller.abort();stopTimers();release();active.delete(handle);host.replaceChildren();host.hidden=true;}
  const handle={cancel,done:null,checkCurrent:()=>{if(!current())cancel();}};perHost.set(host,handle);active.add(handle);
  const fail=()=>{
   if(!current()){cancel();return;}
   stopTimers();release();host.classList.add('bb-meal-image--unavailable');placeholder.remove();
   status.textContent='Your recipe is ready. A meal picture couldn’t be created this time.';
  };
  if(typeof options.ticket!=='string'||options.ticket.length<100||options.ticket.length>64000||typeof token!=='string'||!token||!current()){
   cancel();handle.done=Promise.resolve({ok:false,reason:'unavailable'});return handle;
  }
  host.hidden=false;
  timer=root.setTimeout(()=>controller.abort(),45000);
  watcher=root.setInterval(()=>{if(!current())cancel();},250);
  handle.done=(async()=>{
   try{
    const response=await (options.fetch||root.fetch.bind(root))('/api/bb173/meal-image',{
     method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
     body:JSON.stringify({ticket:options.ticket,...(options.turnstileToken?{turnstileToken:options.turnstileToken}:{})}),
     credentials:'same-origin',cache:'no-store',signal:controller.signal
    });
    if(!current()){cancel();return {ok:false,reason:'stale'};}
    if(!response.ok||!/application\/json/i.test(response.headers.get('content-type')||''))throw Error('image_unavailable');
    const payload=await response.json();
    if(!current()){cancel();return {ok:false,reason:'stale'};}
    if(payload?.ok!==true||payload.aiGenerated!==true||payload.illustrative!==true||!validImage(payload.mealImage))throw Error('image_unavailable');
    const output=payload.mealImage,binary=root.atob(output.dataBase64),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    objectURL=root.URL.createObjectURL(new root.Blob([bytes],{type:output.mimeType}));
    const image=doc.createElement('img');image.className='bbmi-photo';image.alt='AI illustration of '+String(options.recipe?.title||'your meal').slice(0,160);image.decoding='async';
    const imageReady=new Promise((resolve,reject)=>{
     image.addEventListener('load',()=>{if(image.naturalWidth>0&&image.naturalHeight>0&&image.naturalWidth*image.naturalHeight<=16000000)resolve();else reject(Error('image_size'));},{once:true});
     image.addEventListener('error',()=>reject(Error('image_decode')),{once:true});
     controller.signal.addEventListener('abort',()=>reject(Error('image_abort')),{once:true});
    });
    image.src=objectURL;figure.insertBefore(image,placeholder);await imageReady;
    if(!current()){cancel();return {ok:false,reason:'stale'};}
    placeholder.remove();host.classList.add('bb-meal-image--ready');stopTimers();
    status.textContent='AI illustration of this recipe · serving suggestion';
    return {ok:true};
   }catch{
    if(!current()){cancel();return {ok:false,reason:'stale'};}
    figure.querySelector('.bbmi-photo')?.remove();fail();return {ok:false,reason:'unavailable'};
   }
  })();
  return handle;
 }
 function cancelAll(){for(const handle of [...active])handle.cancel();}
 function checkCurrent(){for(const handle of [...active])handle.checkCurrent();}
 for(const name of ['basketboss:session-changed','basketboss:account-deletion-started','basketboss:account-deletion-deleted','pagehide'])root.addEventListener?.(name,cancelAll);
 root.addEventListener?.('storage',event=>{if(event.key==='basketboss_cloud_session_v1'||event.key===null)cancelAll();});
 root.addEventListener?.('focus',checkCurrent);
 root.document?.addEventListener?.('visibilitychange',checkCurrent);
 root.BBMealImage=Object.freeze({attach,cancelAll});
 if(typeof module==='object'&&module.exports)module.exports={attach,cancelAll,validImage};
})(typeof window==='undefined'?globalThis:window);
