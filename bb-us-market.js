/* BasketBoss | Four separate shopping markets | US presentation.
   Native regional grocery guides own prices and currency; this module only adapts names/units.
   Older pages without that model retain their explicitly labelled GBP-to-USD preview.
*/
(()=>{
 'use strict';
 const MARKET_KEY='basketboss_321_v7_market';
 const FX_KEY='bb_us_fx_gbp_usd_v1';
 const IS_PRICE_PAGE=/pricing-sandbox\.html$/.test(location.pathname);
 const MAP=[
  [/\bminced beef\b/gi,'ground beef'],
  [/\bbeef mince\b/gi,'ground beef'],
  [/\bfrozen mince\b/gi,'frozen ground meat'],
  [/\bcourgettes\b/gi,'zucchinis'],[/\bcourgette\b/gi,'zucchini'],
  [/\baubergines\b/gi,'eggplants'],[/\baubergine\b/gi,'eggplant'],
  [/\bcoriander leaves\b/gi,'cilantro'],[/\bfresh coriander\b/gi,'fresh cilantro'],
  [/\bspring onions\b/gi,'scallions'],[/\bspring onion\b/gi,'scallion'],
  [/\bsoured cream\b/gi,'sour cream'],
  [/\bsweetcorn\b/gi,'corn'],[/\bicing sugar\b/gi,'powdered sugar'],
  [/\btinned\b/gi,'canned'],[/\btin of\b/gi,'can of'],
  [/\bchilli powder\b/gi,'chili powder'],[/\bchilli flakes\b/gi,'red pepper flakes'],
  [/\bpeppers\b/gi,'bell peppers'],
  [/\bbiscuits\b/gi,'cookies'],[/\bcrisps\b/gi,'potato chips'],
  [/\bfrozen chips\b/gi,'frozen fries'],[/\bchips\b/gi,'fries'],
  [/\bdouble cream\b/gi,'heavy cream'],[/\bsingle cream\b/gi,'light cream'],
  [/\bplain flour\b/gi,'all-purpose flour'],[/\bself-raising flour\b/gi,'self-rising flour']
 ];
 const sources=new WeakMap();let scheduled=false;let current='';let fx=null;
 try{const prior=JSON.parse(localStorage.getItem(FX_KEY)||'null');if(prior&&Number.isFinite(prior.rate)&&prior.rate>0&&/^\d{4}-\d{2}-\d{2}$/.test(prior.date))fx=prior;}catch{}
 function market(){try{return ['UK','Jersey','Guernsey','US'].includes(localStorage.getItem(MARKET_KEY))?localStorage.getItem(MARKET_KEY):'Jersey';}catch{return 'Jersey';}}
 function isUS(){return market()==='US';}
 function nativeRegionalPrices(){return !!window.BBPriceV19?.regionalMarkets?.US;}
 function titleCaseReplace(match,replacement){if(match===match.toUpperCase())return replacement.toUpperCase();if(match[0]===match[0].toUpperCase())return replacement[0].toUpperCase()+replacement.slice(1);return replacement;}
 function foodNames(s){let text=s;for(const [re,v] of MAP)text=text.replace(re,m=>titleCaseReplace(m,typeof v==='function'?v(m):v));return text;}
 function measures(s){return s.replace(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|litres?|liters?|l)\b|\b(\d{2,3})\s*°\s*C\b/gi,(all,quantity,unit,temp)=>{
  if(temp){const n=Number(temp);return `${Math.round(n*9/5+32)}°F`;}
  const n=Number(quantity),u=unit.toLowerCase();
  if(u==='kg')return `${(n*2.20462262).toFixed(1)} lb`;
  if(u==='g')return n>=850?`${(n/453.59237).toFixed(1)} lb`:`${(n/28.349523125).toFixed(1)} oz`;
  const oz=u==='ml'?n*0.0338140227:n*33.8140227;
  return `${oz.toFixed(1)} fl oz`;
 });}
 function approximateCost(s){return s.replace(/£\s*([\d,]+(?:\.\d{1,2})?)/g,(_,number)=>{
  if(!fx)return 'USD estimate unavailable';
  const n=Number(number.replaceAll(',',''));
  return Number.isFinite(n)?'≈'+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n*fx.rate):'USD estimate unavailable';
 });}
 function ignore(el){return !el||el.closest('script,style,noscript,textarea,pre,code,option,[contenteditable],#bbIntroTrialDialog,#bbPremiumDialog,#bbPremiumUpgradeDialog,.bbpremium-modal,.bbp-modal,.premium-upgrade-modal,.test-info,.test-ribbon')||el.closest('input,select');}
 function localizeText(node){const parent=node.parentElement;if(ignore(parent))return;
  // Do not touch the Paddle price page: it uses authoritative Paddle.PricePreview values.
  if(IS_PRICE_PAGE)return;
  const live=node.nodeValue;
  let info=sources.get(node);
  if(!info||live!==info.last){info={base:live,last:live};sources.set(node,info);}
  const translated=measures(foodNames(info.base));
  const out=isUS()?(nativeRegionalPrices()?translated:approximateCost(translated)):info.base;
  if(out!==live){node.nodeValue=out;info.last=out;}
 }
 function textWalk(root){if(!root)return;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node,count=0;while((node=walker.nextNode())&&count<20000){count++;if(node.nodeValue&&node.nodeValue.trim())localizeText(node);}}
 function banner(){const root=document.getElementById('bb17RegionCard')||document.querySelector('.shell > header.top')||document.querySelector('.app-shell main')||document.querySelector('main');if(!root)return;
  let el=document.getElementById('bbUSMarketNote');if(!el){el=document.createElement('aside');el.id='bbUSMarketNote';el.className='bb-us-market-note';el.setAttribute('role','note');root.insertAdjacentElement('afterend',el);}
  const oldDetail=document.querySelector('#bb17RegionCard .bb17-price-details span');
  if(oldDetail){if(!oldDetail.dataset.bbOriginalExplanation)oldDetail.dataset.bbOriginalExplanation=oldDetail.textContent;oldDetail.textContent=isUS()?(nativeRegionalPrices()?'US shopping figures use illustrative regional pack sizes and USD price guides. They are not live or verified supermarket quotes. Confirm allergies and food safety.':'US shopping figures use indicative UK basket calculations converted to USD reference amounts. Not verified American retailer quotes. Confirm allergies and food safety.'):oldDetail.dataset.bbOriginalExplanation;}
  if(!isUS()){el.hidden=true;return;}el.hidden=false;
  const date=fx?fx.date:'not available';
  el.textContent=IS_PRICE_PAGE?'United States selected · Final subscription charges and currency are set by Paddle and the customer billing address. Confirm USD at checkout.':nativeRegionalPrices()?'🇺🇸 United States · American food names and cooking units. Grocery estimates use illustrative US pack sizes and USD price guides, not live or verified supermarket quotes. You can set a USD budget and save your own local prices.':'🇺🇸 US mode · American food names and converted cooking units. Grocery costs are NOT US supermarket prices: UK-based illustrative estimates converted at an indicative GBP→USD reference rate (date: '+date+'). Budget editing and custom UK price estimates are not available in US preview.';
 }
 function offers(){ // Existing intro/upsell prices are GBP; never pass them off as binding US charges.
  for(const host of document.querySelectorAll('#bbIntroTrialDialog,#bbPremiumDialog,#bbPremiumUpgradeDialog,.bbpremium-modal,.bbp-modal')){
   host.querySelectorAll('.bbtrial-price,.bb-price,.bb-premium-price,.bbpremium-price').forEach(el=>{
    if(!el.dataset.bbOriginalPrice)el.dataset.bbOriginalPrice=el.textContent;
    el.textContent=isUS()?'US$ · see checkout':el.dataset.bbOriginalPrice;
   });
   const description=host.querySelector('#bbPremiumDescription');
   if(description){
    if(!description.dataset.bbOriginalDescription)description.dataset.bbOriginalDescription=description.textContent;
    description.textContent=isUS()?'Founding Member trial is seven days, then GBP £1.99 per month for up to 25 eligible members. Standard Premium is GBP £4.99/month with no trial. Verify local currency, taxes and final amount at checkout. No real payments are enabled yet.':description.dataset.bbOriginalDescription;
   }
   host.querySelectorAll('a[aria-label]').forEach(a=>{
    if(!a.dataset.bbOriginalAria)a.dataset.bbOriginalAria=a.getAttribute('aria-label');
    a.setAttribute('aria-label',isUS()?a.dataset.bbOriginalAria.replace(/£[\d.]+/g,'US dollar price confirmed at checkout'):a.dataset.bbOriginalAria);
   });
  }
 }
 function budgetControls(){if(IS_PRICE_PAGE)return;document.documentElement.classList.toggle('bb-us-mode',isUS());document.documentElement.classList.toggle('bb-us-legacy-pricing',isUS()&&!nativeRegionalPrices());
  // Legacy pages store GBP; native regional pages accept their own USD values.
  document.querySelectorAll('.bb172-budget-entry input,.bb172-budget-entry button,.bb15-price-editor input,.bb15-price-editor select,.bb15-price-editor button,#bb172GenerateDinners').forEach(e=>{
   if(isUS()&&!nativeRegionalPrices()){if(!e.hasAttribute('data-bb-us-original-disabled'))e.setAttribute('data-bb-us-original-disabled',e.disabled?'yes':'no');e.disabled=true;}
   else if(e.hasAttribute('data-bb-us-original-disabled')){e.disabled=e.getAttribute('data-bb-us-original-disabled')==='yes';e.removeAttribute('data-bb-us-original-disabled');}
  });
 }
 function render(){scheduled=false;const now=market();if(now!==current)current=now;document.documentElement.setAttribute('data-bb-market',now);textWalk(document.body);budgetControls();offers();banner();}
 function queue(){if(scheduled)return;scheduled=true;requestAnimationFrame(render);}
 async function updateFx(){if(!isUS()||IS_PRICE_PAGE||nativeRegionalPrices())return;
  // Read-only reference quote; no food, account or payment information is sent to the rate provider.
  try{const response=await fetch('https://api.frankfurter.dev/v2/rate/gbp/usd',{mode:'cors',credentials:'omit',cache:'no-store'});if(!response.ok)throw Error('FX unavailable');const data=await response.json();
   if(data.base!=='GBP'||data.quote!=='USD'||!Number.isFinite(Number(data.rate))||Number(data.rate)<=0||!/^\d{4}-\d{2}-\d{2}$/.test(data.date))throw Error('Invalid FX response');
   fx={rate:Number(data.rate),date:data.date};try{localStorage.setItem(FX_KEY,JSON.stringify(fx));}catch{}queue();
  }catch{queue();}
 }
 function update(){queue();if(isUS())updateFx();}
 function mount(){
  const select=document.getElementById('bb307Island');
  const button=document.getElementById('bb307SaveMarket');
  const message=document.getElementById('bb307RegionSaveStatus');
  function pendingState(){
   if(!select||!button)return;
   const changed=select.value!==market();
   button.disabled=!changed;
   button.textContent=changed?'Save region':'Saved ✓';
   if(message)message.textContent=changed?'Not saved yet':'Saved on this device';
  }
  if(select){
   if(!Array.from(select.options).some(o=>o.value==='US'))select.add(new Option('🇺🇸 United States','US'));
   select.value=market();
   select.addEventListener('change',pendingState);
  }
  if(button&&select){button.addEventListener('click',()=>{
    const chosen=select.value;
    if(!['UK','Jersey','Guernsey','US'].includes(chosen))return;
    if(chosen===market()){pendingState();return;}
    const ok=typeof window.bb307SwitchIsland==='function'&&window.bb307SwitchIsland(chosen);
    if(!ok||market()!==chosen){
     // If browser storage is blocked we cannot promise a persistent preference.
     if(message)message.textContent='Could not save on this device. Check browser storage settings.';
     button.disabled=false;
     return;
    }
    pendingState();
    if(message)message.textContent='Saved! BasketBoss will remember '+({UK:'United Kingdom',Jersey:'Jersey',Guernsey:'Guernsey',US:'United States'}[chosen])+' on this device.';
  });}
  window.addEventListener('basketboss:market-changed',update);
  window.addEventListener('storage',e=>{if(e.key===MARKET_KEY){if(select)select.value=market();pendingState();update();}});
  const observer=new MutationObserver(mutations=>{if(mutations.some(m=>!m.target.closest?.('#bbUSMarketNote')))queue();});observer.observe(document.body,{childList:true,characterData:true,subtree:true});update();
  window.BasketBossMarket=Object.freeze({get:market,isUS,usFoodNames:foodNames,usMeasurements:measures});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
