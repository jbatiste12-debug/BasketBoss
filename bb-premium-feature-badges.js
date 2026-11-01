/* Known Premium tools only. Presentation follows the existing verified state;
 * this module never grants access, replaces controls, or starts a purchase. */
(()=>{'use strict';
 const selector=[
  '.bb81-pro-filters','.bb81-trim-button','.bb-manual-batch-btn',
  '.bb-evening-pivot-open','.bbcv-toggle','#bb172ShopModeButton','#bb172StoreMode','.bb1745-go-button',
  '.bbm-begin','.bb-r6-begin','[data-bbhs-trigger]','[data-bb-receipt-entry]',
  '[data-ai-scan-btn]','[data-ai-meal-btn]','[data-open-tool="scan"]','[data-open-tool="meal"]',
  '#scanBtn','#generate','label[for="ai-photo-input"]','.bb18-locked-recipe[data-bb18-premium]'
 ].join(',');
 const watched=selector+',#bbpolUpgradePill,#bb175Compare,[data-bb-membership-label]';
 const badgeClass='bb-premium-feature-badge';
 let observer,pending=false;
 function showBadges(){
  const state=window.BasketBossMembershipUI?.state?.()||window.BasketBossVerifiedPremium?.state?.();
  return state==='free'||state==='signed_out';
 }
 function mark(badge,kind){
  if(!badge.classList.contains(badgeClass))badge.classList.add(badgeClass);
  if(badge.dataset.bbPremiumBadgeKind!==kind)badge.dataset.bbPremiumBadgeKind=kind;
  return badge;
 }
 function textNodes(node){
  return Array.from(node.childNodes||[]).flatMap(child=>child.nodeType===3?[child]:textNodes(child));
 }
 function wrapExistingWord(control){
  // Preserve the exact textContent used by the original renderers. An existing
  // accessible word stays accessible; only newly added badges are aria-hidden.
  if(!/Premium\s*$/.test(control.textContent||''))return null;
  const text=textNodes(control).reverse().find(node=>/Premium\s*$/.test(node.textContent||''));
  if(!text)return null;
  const match=text.textContent.match(/^(.*?)(Premium)(\s*)$/s);if(!match)return null;
  const badge=mark(document.createElement('span'),'word');badge.textContent=match[2];
  const after=document.createTextNode(match[3]);text.textContent=match[1];text.after(badge,after);
  return badge;
 }
 function decorate(control,show){
  let badge=control.querySelector('.'+badgeClass);
  const existing=control.matches('.bb81-pro-filters')?control.querySelector('.bb81-pro-filters-heading > span'):control.querySelector('.bb-receipt-entry-badge,.bb-premium-tag,.bb18-premium-crown');
  if(existing){
   for(const owned of control.querySelectorAll('[data-bb-premium-badge-kind="added"]'))if(owned!==existing)owned.remove();
   badge=mark(existing,'existing');if(badge.hidden!==!show)badge.hidden=!show;return;
  }
  if(!show){
   for(const owned of control.querySelectorAll('[data-bb-premium-badge-kind]')){
    if(owned.dataset.bbPremiumBadgeKind==='word')owned.replaceWith(document.createTextNode(owned.textContent));
    else if(owned.dataset.bbPremiumBadgeKind==='added')owned.remove();
   }
   return;
  }
  if(badge)return;
  badge=wrapExistingWord(control);if(badge)return;
  badge=mark(document.createElement('span'),'added');badge.textContent='Premium';badge.setAttribute('aria-hidden','true');
  // The shopping proxies keep their original final arrow in its original role.
  const arrow=control.matches('.bbm-begin,.bb-r6-begin')?control.lastElementChild:null;
  const detail=control.matches('.bbcs-action')?control.querySelector('small'):null;
  control.insertBefore(badge,detail||arrow||null);
 }
 function refresh(){
  pending=false;observer?.disconnect();
  try{
   const show=showBadges();
   for(const control of document.querySelectorAll(selector))decorate(control,show);
  }finally{if(observer&&document.body)observer.observe(document.body,{childList:true,subtree:true,characterData:true});}
 }
 function schedule(){if(pending)return;pending=true;queueMicrotask(refresh);}
 function relevant(records){
  return records.some(record=>{
   const target=record.target?.nodeType===1?record.target:record.target?.parentElement;
   if(target?.closest?.(watched))return true;
   return Array.from(record.addedNodes||[]).some(node=>node.nodeType===1&&(node.matches?.(watched)||node.querySelector?.(watched)));
  });
 }
 function start(){
  if(typeof MutationObserver==='function')observer=new MutationObserver(records=>{if(relevant(records))schedule();});
  refresh();
  document.addEventListener('basketboss:premium-verified',schedule);
  window.addEventListener('basketboss:session-changed',schedule);
  window.addEventListener('focus',schedule);
 }
 window.BasketBossPremiumFeatureBadges=Object.freeze({refresh});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
