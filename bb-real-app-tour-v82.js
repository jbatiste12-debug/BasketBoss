/* BasketBoss app walkthrough — real controls, including receipt review.
   Does not write to localStorage, change meal plans, or touch shopping quantities.
   Uses the app's real controls without running a scan or saving an action.
*/
(()=>{'use strict';
const V='2026.11-ingredient-confirmation';
const STEPS=[
 {title:'Your five BasketBoss tabs',body:'Plan, Discover, At home, Shop and Cook are always your main routes. Small Premium badges identify optional paid tools while you use Free.',target:['.shell .tabs']},
 {title:'Plan your week',body:'Your seven-day dinner plan and budget are together under Plan. School lunchboxes also has Confirm school lunches for the week: review the combined ingredients, then Confirm lunches for the week after those lunches have been made or used. Tap Ingredients to avoid to open searchable food tiles for future Auto-fill. Your manually chosen meals stay in the plan.',tab:'week',target:['.tab[data-tab="week"]','#bbAvoidIngredientTab']},
 {title:'Your grocery budget',body:'Enter a target beside the donut. Estimates reflect the chosen region (UK, Guernsey, Jersey or United States).',tab:'week',target:['#app .bbnext-plan-budget','#app .bbnext-plan-donut']},
 {title:'Smart Auto-Fill',body:'Auto-fill My Week fills eligible empty days. To change just one dinner, use that day’s Auto-fill and review the replacement. Shop recalculates its ingredients; planning does not deduct pantry stock. Premium filters can favour quick meals, high protein, kid-friendly options and Cook Once, Eat Twice. Trim My Basket suggests estimated savings when budget gets tight.',tab:'week',target:['#app .bb81-pro-filters','#app .bbnext-plan-actions']},
 {title:'Dinner and dessert cards',body:'Tap a weekday to expand its meals. After using the food, tap Day done, check the visible ingredient amounts, then Confirm & update pantry. Any stock check stays in that panel. Meals already confirmed are skipped. With Premium, Evening Pivot below tonight’s Cook button checks for a quicker dinner already planned later this week that confirmed PANTRY amounts can cover. Review both meals and packaging use-by dates before Swap these two meals.',tab:'week',target:['#app .bbnext-day']},
 {title:'Discover — find your meals',body:'Browse 100 Free recipes; all 500 recipes with Premium are available to eligible signed-in members. Swipe the featured meal only to browse. Tap a card in the list to reveal its larger preview above. Recipe highlights show available dish classifications. Add to week is on the recipe cards below; Premium recipes stay locked in Free.',tab:'discover',target:['.tab[data-tab="discover"]','#app .grid-recipes']},
 {title:'At home — choose what you have',body:"Use Add food, a food thumbnail or Edit to open a separate panel. For cupboard staples, Track amount as Jars or bottles accepts half containers; Weight or volume uses g/ml. Re-enter the amount after switching. Check the automatic Total needed. The panel says when no planned meals need the item. Use Extra stock buffer for more stock, even without meal demand, and Buy in multiples of for full packs. Confirm Add to Shop, or Done if covered. The list’s + / − controls save immediately. Weekly essentials keeps Confirm & update Shop, Amend and Delete. Premium reduced food stays pinned Use soon; Move to Freezer clears urgency without changing stock.",tab:'shop',target:['.tab[data-tab="shop"]']},
 {title:'Shop — buy only what you need',body:'Shop follows At home quantities and keeps your essentials subcategories. Tick the displayed amount in one tap; use ••• for a different amount. The blue shopping summary compacts as you scroll. Add item opens shared extras; a person badge marks partner additions. Finish shop, then Finish & update At home adds the full recorded purchase once, including surplus. Stock left after cooking carries into future weeks. With Premium, open the amber Yellow stickers pill below your supermarket for estimated windows and recent regional reports. Bought reduced records this purchase’s price without changing your usual price.',tab:'shop-list',target:['.tab[data-tab="shop-list"]']},
 {title:'Scan a receipt after shopping',body:'In Shop, choose your region and supermarket, then tap Scan receipt · Premium at the top of your shopping list. Premium scanning needs internet access and your consent to send the photo to Google Gemini. Review names, amounts, food locations, currency and totals before Confirm receipt & add food. Check receipt status after an interrupted confirmation to avoid duplicate stock.',tab:'shop-list',target:['#bbReceiptToolbar','[data-bb-receipt-entry]','.tab[data-tab="shop-list"]']},
 {title:'Cook and get more help',body:'Cook uses your chosen ingredients for recipe matches or optional Premium AI tools. In step-by-step Cook, optional Premium Voice Cook stays available from Prep through Cook. It reads each scaled ingredient, then each full instruction. Say “Next ingredient”, “Ready”, “Start cooking”, “Next step”, “Repeat” or “How many onions?”. It can also start the visible timer. Turn on voice when you want it; Stop listening switches it off. Review the amounts, then tap Confirm cooked & update pantry to deduct ingredients once. Day done opens a clear ingredient-confirmation panel in Plan. Check any required stock review there before confirming. Device and browser support vary. Find full instructions in Plan → Settings → Guides.',target:['.bb173-make-meal-link','#bbuiOpenSettings']}
];
let current=-1,focused=null,card=null,previousFocus=null;
function visible(node){if(!node||!node.isConnected||node.closest('[hidden]'))return false;const s=getComputedStyle(node);return s.display!=='none'&&s.visibility!=='hidden'&&node.getClientRects().length>0;}
function blocked(allowSettings=false){
 if(document.documentElement.classList.contains('bb-native-starting')||document.getElementById('bbNewOnboarding')||window.BBAccountDeletion?.isDeleting?.())return true;
 if(visible(document.querySelector('#cloud-panel.open')))return true;
 return [...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')].some(node=>visible(node)&&!(allowSettings&&node.closest('.bbui-settings-overlay')));
}
function target(selectors){for(const selector of selectors){try{const el=document.querySelector(selector);if(visible(el))return el;}catch(e){console.warn('Tour target not available',selector,e)}}return null;}
function clear(){if(focused){focused.classList.remove('bb82-tour-highlight');focused=null;}}
function close(restoreFocus=true){clear();current=-1;if(card){card.remove();card=null;}if(restoreFocus)previousFocus?.focus?.({preventScroll:true});try{const url=new URL(location.href);url.searchParams.delete('bb_tour');url.searchParams.delete('bb_step');history.replaceState(history.state,'',url.pathname+url.search+url.hash);}catch{}}
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
function open(start=0){
 if(blocked(true))return false;
 if(card){show(start);return;}
 // Close existing Settings before spotlight starts; do not alter any saved settings.
 const oldClose=document.querySelector('.bbui-settings-overlay:not([hidden]) .bbui-settings-close');if(oldClose)oldClose.click();
 previousFocus=document.activeElement;
 card=document.createElement('aside');card.id='bb82TourCard';card.setAttribute('role','dialog');card.setAttribute('aria-modal','false');card.setAttribute('aria-label','BasketBoss app walkthrough');
 card.innerHTML='<div class="bb82-tour-top"><span id="bb82TourCount" tabindex="-1"></span><button type="button" id="bb82TourClose" aria-label="Exit live tour">✕ Exit</button></div><h2 id="bb82TourTitle"></h2><p id="bb82TourText"></p><div class="bb82-tour-buttons"><button type="button" id="bb82TourPrevious">← Back</button><button type="button" id="bb82TourNext">Next →</button></div><small>BasketBoss walkthrough · no changes saved</small>';
 document.body.append(card);
 card.querySelector('#bb82TourClose').onclick=close;
 card.querySelector('#bb82TourPrevious').onclick=()=>show(current-1);
 card.querySelector('#bb82TourNext').onclick=()=>current===STEPS.length-1?close():show(current+1);
 show(start);
 return true;
}
function enhanceHub(){
 const pane=document.querySelector('#bbuiSettingsTutorials');if(!pane||pane.querySelector('#bb82TourTopics'))return;
 const links=pane.querySelector('.bbui-tutorial-help-links');if(!links)return;
 const section=document.createElement('section');section.id='bb82TourTopics';section.setAttribute('aria-label','Learn BasketBoss by using BasketBoss');
 section.innerHTML='<h3>Learn BasketBoss by using BasketBoss</h3><div class="bb82-tour-topics">'+[
 ['📅 Plan','Regional weekly estimates, Smart Auto-Fill Pro and Trim My Basket'],
 ['🥕 Ingredients to avoid','Open the food picker in Plan to choose what future Auto-fill leaves out'],
 ['🌙 Tonight’s dinner · Premium','Review a quicker planned-meal swap, PANTRY amounts and packaging dates'],
 ['🔎 Discover','Browse and Add to week from recipe cards'],
 ['✅ Confirm ingredients','Day done → check the quantities → Confirm & update pantry, without leaving Plan'],
 ['🎒 School lunches','Confirm the week’s combined lunch ingredients; already confirmed lunches are skipped'],
 ['🥫 At home','Record food already owned; Shop buys only the remaining amount'],
 ['🛒 Shop','At home stock, shared additions with names and Bought quantities'],
 ['🧾 Receipts','Review a supermarket receipt before food is added to At home'],
 ['🏷️ Yellow stickers · Premium','Estimated UK and island store windows, reduced prices and Use soon food priority'],
 ['🍳 Cook','Ingredient ideas, optional AI meals and safe step-by-step cooking'],
 ['🎙 Voice Cook · Premium','A spoken guide through scaled ingredients and full recipe instructions, with optional voice commands'],
 ['📱 PWA & iPhone','The same five tabs, with separate local device storage']
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
 const params=new URLSearchParams(location.search);let requested=params.get('bb_tour')==='1';
 function requestedTour(){if(!requested||blocked()||!document.getElementById('app')?.firstElementChild)return;requested=false;const step=Number(params.get('bb_step'));open(Number.isInteger(step)&&step>=0&&step<STEPS.length?step:0);}
 function refresh(){if(document.querySelector('#bbuiSettingsTutorials')&&!document.querySelector('#bb82TourTopics'))enhanceHub();if(card&&blocked(true))close(false);requestedTour();}
 enhanceHub();const observer=new MutationObserver(refresh);
 observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-hidden']});
 const account=document.getElementById('cloud-panel');if(account)new MutationObserver(refresh).observe(account,{attributes:true,attributeFilter:['class','hidden']});
 window.BBRealAppTour=Object.freeze({open,close,version:V,steps:STEPS.length});
 window.addEventListener('basketboss:native-startup-ready',requestedTour);requestedTour();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
