/* Membership presentation only. The existing server and purchase flows remain
 * authoritative; this module never creates a checkout or changes an entitlement. */
(()=>{'use strict';
 const native=()=>window.BBNative?.isNative===true||window.location.protocol==='capacitor:';
 const labels={signed_out:'FREE · Upgrade to Premium',free:'FREE · Upgrade to Premium',premium:'PREMIUM',checking:'Checking membership…'};
 const rows=[
  ['Recipe collection','100 recipes','All 500 recipes'],
  ['Weekly meal planning','Basic weekly plan','Smart Auto-Fill and advanced filters'],
  ['Shopping list','Included, without a limit','Included, plus Trim My Basket'],
  ['Advanced shopping trips','1 per week with a Free account','Unlimited'],
  ['Pantry','Add and manage ingredients','Included, plus eligible AI receipt tools'],
  ['Ingredients to avoid','Preferences for future Auto-Fill','Preferences for future Auto-Fill'],
  ['Yellow sticker & reduced-food tools','—','UK, Guernsey & Jersey: store reports, reduced prices and Use soon priority'],
  ['Leftover Magic','—','Included'],
  ['Batch cooking','—','Included'],
  ['Evening Pivot','—','Included'],
  ['Voice Cook','—','Where supported by your device'],
  ['AI photo scans','—','Up to 5 per day*'],
  ['AI meal ideas','—','Up to 10 per day*']
 ];
 let nativeState=window.BasketBossNativeMembershipState||'checking',dialog,upgradeLink,checkButton,dialogStatus,returnFocus;
 const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 function state(){
  const value=native()?nativeState:window.BasketBossVerifiedPremium?.state?.();
  return ['free','premium','checking','signed_out'].includes(value)?value:'unavailable';
 }
 const label=()=>labels[state()]||'Check membership';
 function comparison(parent){
  if(parent.dataset.bbComparisonReady==='true')return;
  parent.dataset.bbComparisonReady='true';parent.classList.add('bb-membership-comparison');
  const wrap=element('div',undefined,'bb-membership-table-wrap'),table=element('table');
  const caption=element('caption','What is included in Free and Premium?');
  const head=element('thead'),headRow=element('tr');
  for(const title of ['Features','Free','Premium']){const cell=element('th',title);cell.setAttribute('scope','col');headRow.append(cell);}
  head.append(headRow);const body=element('tbody');
  for(const row of rows){const line=element('tr');row.forEach((value,index)=>{const cell=element(index?'td':'th',value);if(!index)cell.setAttribute('scope','row');line.append(cell);});body.append(line);}
  table.append(caption,head,body);wrap.append(table);
  const note=element('p','Free advanced shopping trips require sign-in and reset on Monday at 00:00 UTC. You can reopen an unfinished trip without using another allowance. *AI tools depend on availability and daily usage limits. Voice Cook needs device support. Ingredient preferences apply to future Auto-Fill; they do not change existing meals or replace allergy checks.','bb-membership-compare-note');
  parent.append(wrap,note);
 }
 function update(){
  const value=state(),text=label();
  for(const node of document.querySelectorAll('#bb175Compare,#bbpolUpgradePill,[data-bb-membership-label]')){
   if(node.textContent!==text)node.textContent=text;
   if(node.getAttribute('aria-label')!==text)node.setAttribute('aria-label',text);
   node.dataset.membershipState=value;
   if(node.id==='bbpolUpgradePill')node.hidden=false;
  }
  for(const mount of document.querySelectorAll('[data-bb-membership-comparison]')){comparison(mount);mount.hidden=value==='premium';}
  if(dialogStatus){dialogStatus.textContent=value==='free'?'Your verified account has Free access. Choose Premium when you are ready.':value==='premium'?'Your Premium membership is already active.':value==='checking'?'Checking your membership…':value==='signed_out'?'You are using Free access. Sign in to check an existing membership or choose a Premium plan.':'Check your membership before choosing an upgrade.';upgradeLink.hidden=value!=='free'&&value!=='signed_out';checkButton.hidden=value==='free'||value==='premium';checkButton.textContent=value==='checking'?'Checking membership…':value==='signed_out'?'Sign in':'Check membership';checkButton.disabled=value==='checking';}
 }
 function settings(){
  const button=document.getElementById('bbuiOpenSettings');
  if(button){button.click();document.getElementById('bbMembershipSettings')?.scrollIntoView?.({block:'start',behavior:'smooth'});return;}
  document.getElementById('cloud-open')?.click();
 }
 function makeDialog(){
  if(dialog)return;
  dialog=element('dialog',undefined,'bb-membership-compare-dialog');dialog.id='bbMembershipCompare';dialog.setAttribute('aria-labelledby','bbMembershipCompareHeading');
  const section=element('section',undefined,'bb-membership-compare-body');
  const close=element('button','×','bb-membership-compare-close');close.type='button';close.setAttribute('aria-label','Close membership comparison');close.addEventListener('click',dismiss);
  const eyebrow=element('p','BASKETBOSS MEMBERSHIP','bb-membership-compare-eyebrow');
  const title=element('h2','Free or Premium?');title.id='bbMembershipCompareHeading';
  const intro=element('p','Keep the everyday essentials free, or unlock the complete kitchen toolkit.');
  const table=element('div');comparison(table);
  dialogStatus=element('p',undefined,'bb-membership-compare-status');dialogStatus.setAttribute('role','status');
  const actions=element('div',undefined,'bb-membership-compare-actions');
  upgradeLink=element('a','View Premium monthly plans','bb-membership-compare-upgrade');upgradeLink.href='pricing-sandbox.html#monthly';
  checkButton=element('button','Check membership');checkButton.type='button';checkButton.addEventListener('click',()=>{const session=window.BasketBossVerifiedPremium?.state?.();if(session==='signed_out'){dismiss();document.getElementById('cloud-open')?.click();}else void window.BasketBossVerifiedPremium?.refresh?.(true);});
  const keep=element('button','Back to app');keep.type='button';keep.addEventListener('click',dismiss);
  actions.append(upgradeLink,checkButton,keep);
  const price=element('p','Web plan prices, any eligible Founding Member offer, trial dates and renewal terms are confirmed in the existing secure checkout.','bb-membership-compare-note');
  section.append(close,eyebrow,title,intro,table,dialogStatus,actions,price);dialog.append(section);document.body.append(dialog);
  dialog.addEventListener('click',event=>{if(event.target===dialog)dismiss();});
  dialog.addEventListener('close',()=>returnFocus?.focus?.({preventScroll:true}));
 }
 function dismiss(){if(dialog?.open)dialog.close();else dialog?.removeAttribute('open');returnFocus?.focus?.({preventScroll:true});}
 function open(){
  if(native()){window.location.assign(new URL('pricing-sandbox.html',window.location.href).href);return;}
  if(state()==='premium'){settings();return;}
  returnFocus=document.activeElement;makeDialog();update();
  if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
  if(state()!=='free')void window.BasketBossVerifiedPremium?.refresh?.(true);
 }
 window.BasketBossMembershipUI=Object.freeze({open,label,state,refresh:update,setNativeState(value){nativeState=value;update();}});
 function start(){
  update();
  // App renderers can attach the original toolbar after this module starts.
  // React only to added matching elements; text writes cannot restart a loop.
  if(typeof MutationObserver==='function'){
   const selector='#bb175Compare,#bbpolUpgradePill,[data-bb-membership-comparison]';
   const observer=new MutationObserver(records=>{if(records.some(record=>Array.from(record.addedNodes||[]).some(node=>node.nodeType===1&&(node.matches?.(selector)||node.querySelector?.(selector)))))update();});
   observer.observe(document.body,{childList:true,subtree:true});
  }
  document.addEventListener('basketboss:premium-verified',update);
  window.addEventListener('basketboss:session-changed',update);
  window.addEventListener('focus',update);
  document.addEventListener('click',event=>{if(event.target.closest?.('#bb175Compare')){event.preventDefault();event.stopImmediatePropagation();open();}},true);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
