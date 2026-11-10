/* An optional introduction to the repeating week, available from Settings.
 * This guide only writes its own display marker; it never changes a meal,
 * pantry quantity, account, membership or shopping checkmark. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&!root.BBHowItWorks){root.BBHowItWorks=api.install(root);root.BBHowItWorks.start();}
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_how_it_works_v1';
 const steps=[
  ['Plan Your Meals','Start in Plan. Auto-fill your week, or choose recipes in Discover. Set the servings for everyone eating.','plan'],
  ['Confirm What’s At Home','In At home, use Add item or Edit to open a separate panel. For cupboard staples, choose Jars or bottles (0.5 for half a bottle) or Weight or volume (g/ml). Re-enter the amount after switching. Check the automatic Total needed. The panel says when your meals do not need the item. Use Extra stock buffer for backups, even with no meal requiring them. Buy in multiples of rounds the missing amount to your chosen pack. Confirm Add to Shop, or Done when nothing is missing; the list’s + / − controls still save immediately.','pantry'],
  ['Shop for the Gaps','Shop shows what’s missing and any extras you add. Confirm Weekly essentials once to update Shop, or use Add item to buy for an extra quantity. Tick actual purchases, then choose Finish shop to restock At home once. Remaining stock carries into future weeks. You can also review and confirm a receipt.','shop'],
  ['Cook & Confirm','Open your meal in Cook. When it’s finished, tap Confirm cooked & update pantry. Or open a day in Plan and use Day done for all planned food that day. Used ingredients leave At home; linked batch leftovers are not counted twice.','cook']
 ];
 const tools=[
  ['Hands-Free Voice Cook','Hear ingredients and steps. Say “Next step” or ask how much you need.','Premium','voice'],
  ['Shared Family List','See household extras during the week, including who added each item.','Premium','family'],
  ['Yellow sticker helper','Check estimated UK and island store windows, log a reduced price and put Use soon food first. Pantry-based Auto-fill favours it while keeping your dietary choices.','Premium','reduced']
 ];
 const icons={reduced:'<path d="M3 4h8l10 10-7 7L4 11V4Z"/><circle cx="8" cy="8" r="1"/>',cook:'<path d="M5 10h14v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-7ZM3 10h18M9 7h6v3M2 13h3m14 0h3M8 3v1m8-1v1"/>',plan:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h3m-3 3h7"/>',pantry:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M5 11h14M9 7v1m0 7v2"/>',shop:'<path d="m4 9 2 11h12l2-11H4Zm3 0 3-6m7 6-3-6M9 13v3m6-3v3"/>',scan:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3"/>',voice:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6"/>',family:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',filters:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>'};
 function install(win){
  const doc=win.document;
  const read=key=>{try{return win.localStorage.getItem(key);}catch{return null;}};
  const object=key=>{try{return JSON.parse(read(key)||'null');}catch{return null;}};
  let started=false,view=null;
  function write(value){try{const text=JSON.stringify(value);win.localStorage.setItem(KEY,text);return win.localStorage.getItem(KEY)===text;}catch{return false;}}
  const create=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  function icon(name){const node=create('span','bb-how-icon');node.setAttribute('aria-hidden','true');node.innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icons[name]+'</svg>';return node;}
  function blocked(automatic=false){
   if(!doc?.body||doc.visibilityState==='hidden'||win.BBAccountDeletion?.isDeleting?.()===true)return true;
   const lock=object('basketboss_account_deletion_v1');if(['pending','deleting','deleted'].includes(lock?.phase))return true;
   if(doc.documentElement?.classList?.contains('bb-native-starting')||doc.getElementById('bbNewOnboarding')||doc.getElementById('bbAccountDeletionDialog')?.open||doc.getElementById('cloud-panel')?.classList?.contains('open')||doc.querySelector('.cook-overlay'))return true;
   if(automatic&&doc.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]'))return true;
   for(const modal of doc.querySelectorAll('dialog[open],[aria-modal="true"]')){
    if(modal===view?.node||modal.closest?.('.bbui-settings-overlay'))continue;
    const rect=modal.getBoundingClientRect?.(),style=win.getComputedStyle?.(modal);
    if(rect?.width>0&&rect?.height>0&&style?.display!=='none'&&style?.visibility!=='hidden')return true;
   }
   return false;
  }
  function restore(current){
   for(const {node,inert}of current.background)if(node.isConnected!==false&&!inert)node.removeAttribute('inert');
   doc.body.style.overflow=current.overflow;
   doc.documentElement?.classList?.remove('bb-how-open');
   win.scrollTo?.(current.position.x,current.position.y);
   if(current.focus?.isConnected!==false)try{current.focus?.focus?.({preventScroll:true});}catch{current.focus?.focus?.();}
  }
  function close(){
   const current=view;if(!current)return false;view=null;
   doc.removeEventListener('keydown',current.trap,true);
   try{if(current.node.open)current.node.close();}catch{}
   current.node.remove();restore(current);return true;
  }
  function open(options={}){
   if(options.automatic===true)return false;
   if(view){view.close.focus?.({preventScroll:true});return true;}
   if(blocked(options.automatic===true))return false;
   const dialog=create('dialog','bb-how-dialog');dialog.id='bbHowItWorksDialog';dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','bbHowItWorksTitle');dialog.setAttribute('aria-describedby','bbHowItWorksIntro');
   const header=create('header','bb-how-header'),heading=create('div','bb-how-heading');
   heading.append(create('p','bb-how-eyebrow','Your week, made simpler'));
   const title=create('h2','', 'How BasketBoss Works ');title.id='bbHowItWorksTitle';title.append(create('span','bb-how-nutshell','(In a Nutshell)'));heading.append(title);
   const dismiss=create('button','bb-how-close','×');dismiss.type='button';dismiss.setAttribute('aria-label','Close How BasketBoss Works');dismiss.addEventListener('click',close);header.append(heading,dismiss);
   const content=create('div','bb-how-content'),intro=create('p','bb-how-intro','Start in Plan and follow the tabs along the bottom. You stay in control of what you buy and use.');intro.id='bbHowItWorksIntro';content.append(intro);
   const cycle=create('p','bb-how-cycle');cycle.setAttribute('aria-label','Repeating cycle: Plan, At home, Shop, Cook and repeat');
   ['Plan','At home','Shop','Cook'].forEach((name,index)=>{cycle.append(create('span','bb-how-cycle-label',name));const arrow=create('span','bb-how-arrow',index===3?'↻':'→');arrow.setAttribute('aria-hidden','true');cycle.append(arrow);});content.append(cycle);
   const list=create('ol','bb-how-steps');steps.forEach(([name,description,symbol],index)=>{
    const item=create('li','bb-how-step'),top=create('div','bb-how-step-top'),number=create('span','bb-how-number',String(index+1));number.setAttribute('aria-hidden','true');top.append(number,icon(symbol));item.append(top,create('h3','',name),create('p','',description));
    if(index===2)item.append(create('small','bb-how-step-note','Receipt scanning and the Yellow sticker helper are Premium tools.'));list.append(item);
   });content.append(list,create('p','bb-how-weekly','Next week, review leftovers and essentials in At home. Your remaining stock carries forward; then plan again.'));
   const bonus=create('section','bb-how-bonus');bonus.setAttribute('aria-labelledby','bbHowBonusTitle');const bonusTitle=create('h3','','When You Need Them');bonusTitle.id='bbHowBonusTitle';bonus.append(bonusTitle,create('p','bb-how-bonus-intro','A few extra tools for the busier weeks.'));
   const grid=create('div','bb-how-tools');tools.forEach(([name,description,badge,symbol])=>{const item=create('article','bb-how-tool'),top=create('div','bb-how-tool-top');top.append(icon(symbol),create('span','bb-how-badge',badge));item.append(top,create('h4','',name),create('p','',description));grid.append(item);});bonus.append(grid);content.append(bonus,create('p','bb-how-price-note','Prices are estimates and reviewed local prices, rather than live supermarket checkout totals.'));
   const footer=create('footer','bb-how-footer'),cta=create('button','bb-how-plan','Got it, let’s plan');cta.type='button';cta.addEventListener('click',()=>{close();try{win.BBHowItWorksHost?.openPlan?.();}catch{}});footer.append(cta);dialog.append(header,content,footer);
   const current={node:dialog,close:dismiss,focus:doc.activeElement,overflow:doc.body.style.overflow,position:{x:win.scrollX||0,y:win.scrollY||0},background:[],trap:null};
   current.trap=event=>{
    if(view!==current)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation?.();close();return;}
    if(event.key!=='Tab')return;
    const buttons=[...dialog.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);
    if(event.shiftKey&&(doc.activeElement===first||!dialog.contains(doc.activeElement))){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(doc.activeElement===last||!dialog.contains(doc.activeElement))){event.preventDefault();first?.focus();}
   };
   view=current;doc.body.append(dialog);
   try{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
   catch{try{dialog.setAttribute('open','');}catch{dialog.remove();view=null;return false;}}
   current.background=Array.from(doc.body.children).filter(node=>node!==dialog).map(node=>({node,inert:node.hasAttribute('inert')}));for(const {node}of current.background)node.setAttribute('inert','');
   doc.body.style.overflow='hidden';doc.documentElement?.classList?.add('bb-how-open');doc.addEventListener('keydown',current.trap,true);
   dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(view===current)close();});
   dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();});
   dismiss.focus?.({preventScroll:true});
   write({version:1,eligible:false,seen:true});
   return true;
  }
  // Existing setup callers may announce completion, but the optional guide
  // opens only through its Settings control or an explicit open() request.
  function setupFinished(){return false;}
  function start(){
   if(started||!doc)return;started=true;
   doc.addEventListener('click',event=>{const button=event.target.closest?.('#bbHowItWorksOpen,[data-bb-how-it-works]');if(!button)return;event.preventDefault();event.stopPropagation?.();open();});
   win.addEventListener?.('basketboss:account-deletion-started',close);win.addEventListener?.('basketboss:account-deletion-deleted',close);
  }
  return Object.freeze({open,close,start,setupFinished,isOpen:()=>!!view});
 }
 return Object.freeze({KEY,install});
});
