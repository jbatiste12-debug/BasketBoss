/* BasketBoss v17.5.13 Cloudflare preview-only identity-verified QA switch.
 * This is for visual/functional testing ONLY. It is not a production entitlement.
 */
(function(){
 'use strict';
 if(location.hostname!=='basketboss-v17513-qa.basketboss-v1749-qa.pages.dev')return;
 const KEY='basketboss_v17513_cloudflare_owner_qa_view_v1';
 let verified=false;
 function view(){try{return localStorage.getItem(KEY)==='premium'?'premium':'free'}catch(_){return 'free'}}
 // IMPORTANT: localStorage by itself does not grant a Premium test view.
 function isPremium(){return verified&&view()==='premium'}
 function change(mode){
  if(!verified||!['free','premium'].includes(mode))return;
  try{localStorage.setItem(KEY,mode)}catch(_){return}
  // Full reload ensures open cooking dialogs, planners and galleries are recalculated.
  location.reload();
 }
 window.BasketBossCloudflareQA=Object.freeze({isPremium,getMode:view});
 const css=document.createElement('style');
 css.id='bb-cloudflare-qa-style';
 css.textContent='#bb-cloudflare-qa-bar{box-sizing:border-box;max-width:1100px;margin:8px auto 12px;padding:9px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:#fff7df;color:#3d3423;border:1px solid #d7be76;border-radius:15px;box-shadow:0 2px 9px #0001;font:600 12px/1.4 system-ui,-apple-system,sans-serif}#bb-cloudflare-qa-bar *{box-sizing:border-box}#bb-cloudflare-qa-bar .bbqa-buttons{display:flex;gap:6px}#bb-cloudflare-qa-bar button{min-height:44px;border-radius:10px;padding:8px 14px;border:1px solid #b4bea6;background:#fff;color:#1b4f38;font:800 12px system-ui;cursor:pointer}#bb-cloudflare-qa-bar button[aria-pressed=true]{background:#216444;color:white;border-color:#216444}#bb-cloudflare-qa-bar button:focus-visible{outline:3px solid #216444;outline-offset:2px}@media(max-width:430px){#bb-cloudflare-qa-bar{margin:6px 10px 10px;padding:8px}#bb-cloudflare-qa-bar .bbqa-buttons{width:100%}#bb-cloudflare-qa-bar button{flex:1}}';
 document.head.append(css);
 function mount(){
  if(document.getElementById('bb-cloudflare-qa-bar'))return;
  const header=document.querySelector('.shell > header.top,.shell > header.topbar,.bb17513-meal-topbar,header.topbar');
  if(!header)return;
  const bar=document.createElement('section');bar.id='bb-cloudflare-qa-bar';
  bar.setAttribute('aria-label','Owner-only QA membership comparison');
  const label=document.createElement('strong');label.textContent='🧪 OWNER QA · NO PAYMENT';
  const sub=document.createElement('span');sub.textContent='Compare 100 free recipes with the full Premium catalogue';
  const group=document.createElement('div');group.className='bbqa-buttons';group.setAttribute('role','group');group.setAttribute('aria-label','Test membership mode');
  for(const mode of ['free','premium']){
   const btn=document.createElement('button');btn.type='button';btn.textContent=mode==='free'?'Free':'Premium';
   btn.setAttribute('aria-pressed',String(view()===mode));btn.addEventListener('click',()=>change(mode));group.append(btn);
  }
  bar.append(label,sub,group);header.insertAdjacentElement('afterend',bar);
 }
 async function start(){
  // This endpoint verifies the signed Cloudflare Access JWT, application AUD and
  // the configured owner email. We never trust the browser-supplied email.
  try{
   const res=await fetch('/api/qa-premium',{credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}});
   if(!res.ok)return;
   const data=await res.json();
   if(data&&data.enabled===true){
    verified=true;
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
    // Existing render() lives in the main application closure.
    document.dispatchEvent(new Event('basketboss:cloudflare-qa-ready'));
    // Make a Meal demo may read this local test state, but Paddle is unchanged.
    const demo=window.BasketBossPremiumDemo;
    if(demo&&typeof demo==='object'){
      try{demo.isPremium=function(){return isPremium()}}catch(_){/* optional demo */}
    }
   }
  }catch(_){/* Fail closed on network, config or Access failures */}
 }
 start();
})();
