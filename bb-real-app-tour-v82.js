/* BasketBoss UI-NEXT 7.12 — Nine-step REAL BasketBoss Tour.
   Does not write to localStorage, change meal plans, or touch shopping quantities.
   Replaces the old 16-step tour loader for this development candidate only.
*/
(()=>{'use strict';
const V='7.12';
const STEPS=[
 {title:'Your five BasketBoss tabs',body:'Plan, Discover, Kitchen, Shop and Cook are always your main routes.',target:['.shell .tabs']},
 {title:'Plan your week',body:'Your seven-day dinner plan and budget are together under Plan.',tab:'week',target:['.tab[data-tab="week"]']},
 {title:'Your grocery budget',body:'Enter a target beside the donut. Estimates reflect the chosen region (UK, Guernsey, Jersey or United States).',tab:'week',target:['#app .bbnext-plan-budget','#app .bbnext-plan-donut']},
 {title:'Smart Auto-Fill Pro',body:'Premium filters can favour quick meals, high protein, kid-friendly options and Cook Once, Eat Twice. Trim My Basket suggests estimated savings when budget gets tight.',tab:'week',target:['#app .bb81-pro-filters','#app .bbnext-plan-actions']},
 {title:'Dinner and dessert cards',body:'Tap a weekday to expand its dinner and dessert. Cook, replace or remove meals; your shopping list recalculates.',tab:'week',target:['#app .bbnext-day']},
 {title:'Discover — find your meals',body:'Browse 100 Free recipes or unlock all 500 with Premium. Swipe the featured meal only to browse. Add to week is on the recipe cards below; Premium recipes stay locked in Free.',tab:'discover',target:['.tab[data-tab="discover"]','#app .grid-recipes']},
 {title:'Kitchen — choose what you have',body:'Open Cupboard, Fridge and Freezer; edit your quantities in one PANTRY summary and confirm to reconcile Shopping.',tab:'shop',target:['.tab[data-tab="shop"]']},
 {title:'Shop — buy only what you need',body:'Confirm Kitchen quantities first: those foods reduce the current To buy list. In Live Shop, tick Bought, then use ••• for a standard pack, exact amount, different amount or Already have enough. Finish Shop saves only confirmed unused amounts to Kitchen for next week. Fresh food needs safe-storage confirmation.',tab:'shop-list',target:['.tab[data-tab="shop-list"]']},
 {title:'Cook and get more help',body:'Make a Meal confirms the ingredients you choose without changing Shopping. Settings → Tutorials holds the section guides and a replay of this tour.',target:['#bbuiOpenSettings','.tab[data-tab="cook"]']}
];
let current=-1,focused=null,card=null,previousFocus=null;
function visible(node){if(!node||!node.isConnected||node.closest('[hidden]'))return false;const s=getComputedStyle(node);return s.display!=='none'&&s.visibility!=='hidden'&&node.getClientRects().length>0;}
function target(selectors){for(const selector of selectors){try{const el=document.querySelector(selector);if(visible(el))return el;}catch(e){console.warn('Tour target not available',selector,e)}}return null;}
function clear(){if(focused){focused.classList.remove('bb82-tour-highlight');focused=null;}}
function close(){clear();current=-1;if(card){card.remove();card=null;}previousFocus?.focus?.({preventScroll:true});}
function show(i){
 if(i<0||i>=STEPS.length){close();return;}
 current=i;const s=STEPS[i];clear();
 // Navigate through the real app, instead of guessing at hidden route contents.
 if(s.tab){const tab=document.querySelector('.shell .tab[data-tab="'+s.tab+'"]');if(tab&&!tab.classList.contains('active'))tab.click();}
 const paint=()=>{
  if(!card||current!==i)return;
  const next=target(s.target)||target(['.shell .tabs','#bbuiOpenSettings']);
  if(next){focused=next;next.classList.add('bb82-tour-highlight');try{next.scrollIntoView({block:'center',behavior:'instant'});}catch(_){next.scrollIntoView({block:'center'});}}
  card.querySelector('#bb82TourCount').textContent='Step '+(i+1)+' of '+STEPS.length;
  card.querySelector('#bb82TourTitle').textContent=s.title;
  card.querySelector('#bb82TourText').textContent=s.body;
  card.querySelector('#bb82TourPrevious').disabled=i===0;
  card.querySelector('#bb82TourNext').textContent=i===STEPS.length-1?'Finish tour':'Next →';
  card.querySelector('#bb82TourCount').focus({preventScroll:true});
 };
 requestAnimationFrame(()=>requestAnimationFrame(paint));
}
function open(){
 if(card){show(0);return;}
 // Close existing Settings before spotlight starts; do not alter any saved settings.
 const oldClose=document.querySelector('.bbui-settings-overlay:not([hidden]) .bbui-settings-close');if(oldClose)oldClose.click();
 previousFocus=document.activeElement;
 card=document.createElement('aside');card.id='bb82TourCard';card.setAttribute('role','dialog');card.setAttribute('aria-modal','false');card.setAttribute('aria-label','REAL BasketBoss Tour, version '+V);
 card.innerHTML='<div class="bb82-tour-top"><span id="bb82TourCount" tabindex="-1"></span><button type="button" id="bb82TourClose" aria-label="Exit live tour">✕ Exit</button></div><h2 id="bb82TourTitle"></h2><p id="bb82TourText"></p><div class="bb82-tour-buttons"><button type="button" id="bb82TourPrevious">← Back</button><button type="button" id="bb82TourNext">Next →</button></div><small>REAL BASKETBOSS TOUR · UI-NEXT '+V+' · no changes saved</small>';
 document.body.append(card);
 card.querySelector('#bb82TourClose').onclick=close;
 card.querySelector('#bb82TourPrevious').onclick=()=>show(current-1);
 card.querySelector('#bb82TourNext').onclick=()=>current===STEPS.length-1?close():show(current+1);
 show(0);
}
function enhanceHub(){
 const pane=document.querySelector('#bbuiSettingsTutorials');if(!pane||pane.querySelector('#bb82TourTopics'))return;
 const links=pane.querySelector('.bbui-tutorial-help-links');if(!links)return;
 const section=document.createElement('section');section.id='bb82TourTopics';section.setAttribute('aria-label','Learn BasketBoss by using BasketBoss');
 section.innerHTML='<h3>Learn BasketBoss by using BasketBoss</h3><div class="bb82-tour-topics">'+[
 ['📅 Plan','Regional weekly estimates, Smart Auto-Fill Pro and Trim My Basket'],
 ['🔎 Discover','Browse and Add to week from recipe cards'],
 ['🥫 Kitchen','Confirm Cupboard, Fridge and Freezer quantities'],
 ['🛒 Shop','Kitchen deductions, Bought quantities and next-week leftovers'],
 ['🍳 Cook','Make a Meal and safe step-by-step cooking']
 ].map(x=>'<div class="bb82-tour-topic"><strong>'+x[0]+'</strong><span>'+x[1]+'</span></div>').join('')+'</div>';
 links.parentNode.insertBefore(section,links);
}
function init(){
 const style=document.createElement('style');style.id='bb82RealTourStyle';style.textContent=`
 .bb82-tour-highlight{outline:4px solid #e9b44b!important;outline-offset:5px!important;box-shadow:0 0 0 7px #194b3838!important;position:relative;z-index:20!important}
 #bb82TourCard{position:fixed;z-index:2147480000;bottom:calc(18px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);width:min(94vw,480px);max-height:52vh;overflow:auto;background:#fffdf9;color:#173c33;border:2px solid #2c7249;border-radius:17px;padding:17px;box-shadow:0 13px 50px #09231c72;font:14px/1.45 system-ui,sans-serif}
 #bb82TourCard .bb82-tour-top{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#2b7248;font-weight:850}
 #bb82TourCard h2{font-size:21px;margin:11px 0 7px;color:#173d30}#bb82TourCard p{font-size:14px;margin:0 0 14px}
 #bb82TourCard button{border:1px solid #b8d2be;border-radius:10px;background:#f0f7f0;color:#17462c;min-height:43px;padding:9px 12px;font-weight:800;cursor:pointer}
 #bb82TourCard .bb82-tour-buttons{display:flex;gap:8px}#bb82TourCard .bb82-tour-buttons button{flex:1}
 #bb82TourCard #bb82TourNext{background:#2c7249;color:white}#bb82TourCard button:disabled{opacity:.5}
 #bb82TourCard small{display:block;margin-top:11px;font-size:10px;color:#687d72}
 #bb82TourTopics{margin:12px 0 16px}#bb82TourTopics h3{color:#235239;font-size:17px;margin:0 0 9px}
 #bb82TourTopics .bb82-tour-topics{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
 #bb82TourTopics .bb82-tour-topic{background:#f4f9f4;border:1px solid #d5e7d7;border-radius:10px;padding:10px;display:grid;gap:4px}
 #bb82TourTopics .bb82-tour-topic strong{font-size:13px}#bb82TourTopics .bb82-tour-topic span{font-size:11px;color:#5d7867}
 @media(max-width:420px){#bb82TourCard{bottom:9px;padding:12px;max-height:55vh}#bb82TourCard h2{font-size:18px}}
 `;document.head.append(style);
 document.addEventListener('click',e=>{if(e.target.closest('#bb82StartLiveTour')){e.preventDefault();open();}},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&card)close();});
 enhanceHub();const observer=new MutationObserver(()=>{if(document.querySelector('#bbuiSettingsTutorials')&&!document.querySelector('#bb82TourTopics'))enhanceHub();});
 observer.observe(document.body,{childList:true,subtree:true});
 window.BBRealAppTour=Object.freeze({open,close,version:V,steps:STEPS.length});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
