/* Onboarding-only presentation handoff. Existing purchase and entitlement
 * handlers stay authoritative. No checkout event is treated as proof of access. */
(()=>{'use strict';
 const scriptURL=document.currentScript?.src;
 const KEY='bb_onboarding_four_step_v1',SETUP='bb_onboarding_fresh_once_20261028_v1';
 let timer=null,checking=false,redirecting=false,notice;
 const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}};
 function context(){
   const flow=read(KEY),setup=read(SETUP),session=read('basketboss_cloud_session_v1');
   return flow?.version===1&&flow.checkoutActor&&setup?.started===true&&setup.complete!==true&&setup.step===10&&session?.user?.id===flow.checkoutActor&&typeof session.access_token==='string'&&Number(session.expires_at)*1000>Date.now()+5000;
 }
 const blocked=()=>window.BBAccountDeletion?.isDeleting?.()===true||document.getElementById('bbAccountDeletionDialog')?.open===true||document.documentElement.classList.contains('bb-native-starting');
 const destination=()=>window.BBNative?.isNative===true?'index.html':'/app';
 function returnToPlan(){if(!context()||blocked()||redirecting)return;redirecting=true;clearInterval(timer);window.location.assign(destination());}
 function verified(){if(context()&&!blocked()&&window.BasketBossVerifiedPremium?.isActive?.()===true)returnToPlan();}
 async function check(){
   if(checking||document.hidden||blocked()||!context()){if(!context())clearInterval(timer);return;}
   checking=true;
   try{await window.BasketBossVerifiedPremium?.refresh?.(true);verified();}finally{checking=false;}
 }
 function start(){
   if(!context())return;
   notice=document.createElement('aside');notice.className='bb-onboarding-checkout-return';notice.setAttribute('aria-label','Your weekly plan');
   Object.assign(notice.style,{maxWidth:'620px',margin:'16px auto',padding:'16px',border:'1px solid #d9e2d6',borderRadius:'16px',background:'#f7f7f0',color:'#204f40',font:'14px/1.5 system-ui,sans-serif'});
   const copy=document.createElement('p');copy.textContent='Your setup is saved. Once Premium access is verified, we’ll take you to your plan. You can also return without subscribing.';copy.style.margin='0 0 10px';
   const back=document.createElement('button');back.type='button';back.textContent='Return to my plan';
   Object.assign(back.style,{minHeight:'44px',padding:'10px 16px',border:'0',borderRadius:'12px',background:'#204f40',color:'#fff',font:'600 14px system-ui,sans-serif'});
   back.addEventListener('click',returnToPlan);notice.append(copy,back);(document.querySelector('main')||document.body).prepend(notice);
   document.addEventListener('basketboss:premium-verified',verified);
   window.addEventListener('focus',()=>{void check();});
   window.addEventListener('basketboss:native-startup-ready',()=>{void check();});
   document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check();});
   if(!window.BasketBossVerifiedPremium&&scriptURL){
     const verifier=document.createElement('script');verifier.src=new URL('bb-verified-premium-ui.js',scriptURL).href;
     verifier.addEventListener('load',()=>{void check();},{once:true});document.head.append(verifier);
   }else void check();
   // Refresh the EXISTING current-identity verifier during this UI handoff only.
   // Stop after two minutes; no purchase retries or entitlement writes occur.
   let ticks=0;timer=setInterval(()=>{if(++ticks>=24)clearInterval(timer);void check();},5000);
   window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
