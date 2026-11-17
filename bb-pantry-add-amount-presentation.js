/* Add food presentation only. The existing controls own every draft and save. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&!root.BBPantryAddAmountPresentation){root.BBPantryAddAmountPresentation=Object.freeze(api);api.install(root);}
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const mounts=new WeakMap(),installations=new WeakMap();
 const EMPTY=Object.freeze({refresh(){},destroy(){}});
 const OPTIONAL='.bbpi-stock-pack,.bbpi-amount-details,.bbpi-more-options,.bbpi-scan-products,.bbpi-readout,.bbpi-rounding-note';
 const NEEDS_REVIEW=/Choose (?:a confirmed|the size|a stock level|what remains)|Confirm the pack size|Use a whole number|Open Edit amount|could not be applied|Pack size changed/i;
 function mount(target,deps={}){
  const dialog=target?.element||target,doc=deps.doc||dialog?.ownerDocument,win=deps.win||doc?.defaultView;
  if(!doc||!win||!dialog?.matches?.('#bbpi-current-editor')||!dialog.querySelector('.bbpi-name-label'))return EMPTY;
  if(mounts.has(dialog))return mounts.get(dialog);
  const content=dialog.querySelector('.bbpi-editor-content');if(!content)return EMPTY;
  const amount=doc.createElement('details'),summary=doc.createElement('summary'),summaryCopy=doc.createElement('span'),summaryLabel=doc.createElement('span'),summaryHint=doc.createElement('span'),none=doc.createElement('p');
  amount.className='bbpa-amount';summaryCopy.className='bbpa-summary-copy';summaryLabel.textContent='Add amount (optional)';summaryHint.className='bbpa-summary-hint';summaryHint.textContent='Pack size or exact weight';summaryCopy.append(summaryLabel,summaryHint);summary.append(summaryCopy);amount.append(summary);
  none.className='bbpa-none-at-home';none.textContent='None at home';none.hidden=true;none.setAttribute('aria-live','polite');
  dialog.classList.add('bbpa-add-food');
  // Move each live node once, including all of its original listeners.
  const originalOptional=[...content.querySelectorAll(OPTIONAL)].filter(node=>!node.parentElement?.closest(OPTIONAL));
  const ownedReadouts=[...content.children].filter(node=>node.matches('.bbpi-notice')&&!node.hasAttribute('role')&&!node.hasAttribute('aria-live'));
  const first=originalOptional.find(node=>node.parentElement===content)||ownedReadouts[0];
  if(first)first.before(amount);else content.append(amount);
  for(const node of [...originalOptional,...ownedReadouts])amount.append(node);
  const nameLabel=content.querySelector('.bbpi-name-label'),nameText=[...nameLabel.childNodes].find(node=>node.nodeType===3);
  if(nameText)nameText.nodeValue='Food';
  const title=dialog.querySelector('.bbpi-editor-heading h4');if(title)title.setAttribute('aria-label','Add food');
  const region=content.querySelector('.bbpi-stock-levels'),readout=region?.querySelector('.bbpi-stock-amount'),choices=region?.querySelector('.bbpi-stock-choices');
  if(choices){const prompt=doc.createElement('p');prompt.className='bbpa-stock-label';prompt.textContent='How much do you have?';choices.before(prompt);}
  if(readout)readout.after(none);else content.insertBefore(none,amount);
  const legacyToggle=region?.querySelector('.bbpi-stock-pack-toggle'),sparesLabel=amount.querySelector('.bbpi-stock-spares-label'),spares=sparesLabel?.querySelector('input'),done=dialog.querySelector('.bbpi-done');
  if(sparesLabel){
   const leading=[...sparesLabel.childNodes].find(node=>node.nodeType===3);
   if(leading)leading.nodeValue='Extra unopened packs';
  }
  if(spares)spares.setAttribute('aria-label','Extra unopened packs');
  if(done)done.setAttribute('aria-label','Done');
  let destroyed=false,queued=false,lastExpanded=legacyToggle?.getAttribute('aria-expanded')==='true',lastErrors='',lastFocus=null,reviewRequired=false;
  const listeners=[];
  const listen=(node,type,handler,capture=false)=>{node.addEventListener(type,handler,capture);listeners.push(()=>node.removeEventListener(type,handler,capture));};
  const setHidden=(node,value)=>{if(node&&node.hidden!==value)node.hidden=value;};
  const setClass=(name,value)=>{if(dialog.classList.contains(name)!==value)dialog.classList.toggle(name,value);};
  function reveal(field,review=false){
   if(destroyed)return;if(review)reviewRequired=true;
   setHidden(amount,false);if(!amount.open)amount.open=true;
   if(field?.closest?.('.bbpi-stock-pack')&&legacyToggle?.getAttribute('aria-expanded')==='false')legacyToggle.click();
   for(let node=field?.parentElement;node&&node!==dialog;node=node.parentElement)if(node.tagName==='DETAILS'&&!node.open)node.open=true;
  }
  function errors(){return [...dialog.querySelectorAll('.bbpi-notice.is-error')].filter(node=>node.textContent.trim());}
  function errorField(message){
   // These are the existing handler's displayed errors, not another validator.
   const selector=/same-size full spare|include these spares/i.test(message)?'.bbpi-stock-spares':
    /Pack size changed/i.test(message)?'.bbpi-stock-capacity,.bbpi-amount-details>summary':
    /container size and its unit/i.test(message)?'.bbpi-pack input':
    /positive pack size|Exact amount/i.test(message)?'[data-bbpi-buy-quantity]':
    /extra stock buffer|whole container counts/i.test(message)?'[data-bbpi-buffer]':
    /food name/i.test(message)?'.bbpi-name-label input':null;
   return selector?dialog.querySelector(selector):null;
  }
  function refresh(){
   if(destroyed)return;queued=false;
   const expanded=legacyToggle?.getAttribute('aria-expanded')==='true';
   const errorNodes=errors(),errorStamp=errorNodes.map(node=>node.textContent).join('\n');
   const newError=!!errorStamp&&errorStamp!==lastErrors;
   if(expanded&&!lastExpanded)reveal(null,true);
   lastExpanded=expanded;lastErrors=errorStamp;
   if(newError){
    // The original handler has already chosen the error and opened its native
    // inner disclosures. Reveal the outer disclosure without rerunning it.
    reveal(doc.activeElement,true);
    for(const details of amount.querySelectorAll('details'))if(!details.open)details.open=true;
    if(!amount.contains(doc.activeElement)){
     const invalid=amount.querySelector('input:invalid,select:invalid,textarea:invalid');
     const field=invalid||errorField(errorStamp)||(lastFocus&&amount.contains(lastFocus)?lastFocus:null)||amount.querySelector('[data-bbpi-quantity]');
     if(field){reveal(field,true);field.focus({preventScroll:true});}
    }
   }
   const quantity=dialog.querySelector('[data-bbpi-quantity]'),raw=quantity?.value?.trim();
   const qualitative=!region||region.hidden;setClass('bbpa-qualitative',qualitative);
   const out=!qualitative&&region.querySelector('[data-bbpi-stock-level="out"]')?.getAttribute('aria-pressed')==='true';
   // A positive unopened-pack balance remains visible even when Out is active.
   const empty=out&&raw!==''&&raw!==undefined&&Number.isFinite(Number(raw))&&Number(raw)===0;
   setClass('bbpa-out-zero',empty);setClass('bbpa-out-balance',out&&!empty);setHidden(none,!empty);setHidden(amount,empty&&!reviewRequired);
   const busy=!!done&&(done.disabled||done.getAttribute('aria-busy')==='true');
   setClass('bbpa-done-busy',busy);
   if(done){const label=busy?done.textContent.trim()||'Done':'Done';if(done.getAttribute('aria-label')!==label)done.setAttribute('aria-label',label);}
  }
  function schedule(){if(destroyed||queued)return;queued=true;(win.queueMicrotask||((callback)=>Promise.resolve().then(callback)))(refresh);}
  listen(amount,'toggle',()=>{
   if(amount.open){
    // The legacy toggle only opens its UI and lazily paints size choices.
    if(legacyToggle?.getAttribute('aria-expanded')==='false')legacyToggle.click();
   }else reviewRequired=false;
   schedule();
  });
  listen(dialog,'focusin',event=>{
   if(event.target!==summary&&amount.contains(event.target)){lastFocus=event.target;reveal(event.target,true);}
  },true);
  listen(dialog,'invalid',event=>{if(amount.contains(event.target))reveal(event.target,true);},true);
  listen(dialog,'click',event=>{
   if(event.target.closest?.('.bbpi-done')){
    const invalid=amount.querySelector('input:invalid,select:invalid,textarea:invalid');
    if(invalid)reveal(invalid,true);
    else if(errors().length)reveal(null,true);
   }
  },true);
  listen(dialog,'click',event=>{
   const choice=event.target.closest?.('.bbpi-stock-choice,.bbpi-stock-portion');
   if(choice?.getAttribute('data-bbpi-stock-level')==='out'&&!errors().length){
    const raw=dialog.querySelector('[data-bbpi-quantity]')?.value?.trim();
    if(raw!==''&&raw!==undefined&&Number(raw)===0)reviewRequired=false;
   }
   const message=region?.querySelector('.bbpi-stock-message')?.textContent||'';
   if(choice&&legacyToggle?.getAttribute('aria-expanded')==='true'&&NEEDS_REVIEW.test(message)){
    const field=/Use a whole number/i.test(message)?spares:null;reveal(field,true);
    if(field&&doc.activeElement!==field)field.focus({preventScroll:true});
   }
   refresh();
  });
  listen(dialog,'input',schedule);listen(dialog,'change',schedule);
  const observer=win.MutationObserver?new win.MutationObserver(schedule):null;
  observer?.observe(dialog,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-expanded','aria-pressed','aria-busy','class','hidden','open','disabled']});
  const api={refresh,destroy(){if(destroyed)return;destroyed=true;observer?.disconnect();for(const remove of listeners)remove();mounts.delete(dialog);}};
  mounts.set(dialog,api);refresh();return api;
 }
 function install(win){
  if(!win?.document?.createElement||!win.MutationObserver)return EMPTY;
  if(installations.has(win))return installations.get(win);
  const doc=win.document,active=new Map();let destroyed=false,queued=false,observer=null;
  function refresh(){
   if(destroyed)return;queued=false;
   for(const [dialog,presenter]of active)if(!dialog.isConnected){presenter.destroy();active.delete(dialog);}
   for(const dialog of doc.querySelectorAll('#bbpi-current-editor'))if(dialog.querySelector('.bbpi-name-label')&&!active.has(dialog))active.set(dialog,mount(dialog,{win,doc}));
  }
  function schedule(){if(destroyed||queued)return;queued=true;(win.queueMicrotask||((callback)=>Promise.resolve().then(callback)))(refresh);}
  function start(){if(destroyed||observer||!doc.body)return;observer=new win.MutationObserver(schedule);observer.observe(doc.body,{childList:true,subtree:true});refresh();}
  if(doc.body)start();else doc.addEventListener('DOMContentLoaded',start,{once:true});
  const api={refresh,destroy(){if(destroyed)return;destroyed=true;observer?.disconnect();doc.removeEventListener('DOMContentLoaded',start);for(const presenter of active.values())presenter.destroy();active.clear();installations.delete(win);}};
  installations.set(win,api);return api;
 }
 return {install,mount};
});
