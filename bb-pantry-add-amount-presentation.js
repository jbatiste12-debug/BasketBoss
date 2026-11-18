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
 function mount(target,deps={}){
  const dialog=target?.element||target,doc=deps.doc||dialog?.ownerDocument,win=deps.win||doc?.defaultView;
  if(!doc||!win||!dialog?.matches?.('#bbpi-current-editor')||!dialog.querySelector('.bbpi-amount-details'))return EMPTY;
  if(mounts.has(dialog))return mounts.get(dialog);
  const content=dialog.querySelector('.bbpi-editor-content');if(!content)return EMPTY;
  const amount=doc.createElement('details'),summary=doc.createElement('summary'),summaryCopy=doc.createElement('span'),summaryLabel=doc.createElement('span'),summaryHint=doc.createElement('span'),amountBody=doc.createElement('div'),none=doc.createElement('p'),helper=doc.createElement('p'),estimate=doc.createElement('span');
  amount.className='bbpa-amount';summaryCopy.className='bbpa-summary-copy';summaryLabel.textContent='Add amount (optional)';summaryHint.className='bbpa-summary-hint';summaryHint.textContent='Pack size or exact weight';summaryCopy.append(summaryLabel,summaryHint);summary.append(summaryCopy);amountBody.className='bbpa-amount-scroll';amount.append(summary,amountBody);
  none.className='bbpa-none-at-home';none.textContent='None at home';none.hidden=true;none.setAttribute('aria-live','polite');
  helper.className='bbpa-helper';helper.textContent="No amount needed. We'll check with you if a meal needs a lot.";
  estimate.className='bbpa-estimated';estimate.textContent='Estimated';estimate.hidden=true;
  dialog.classList.add('bbpa-add-food');
  // Move each live node once, including all of its original listeners.
  const originalOptional=[...content.querySelectorAll(OPTIONAL)].filter(node=>!node.parentElement?.closest(OPTIONAL));
  const ownedReadouts=[...content.children].filter(node=>node.matches('.bbpi-notice')&&!node.hasAttribute('role')&&!node.hasAttribute('aria-live'));
  const first=originalOptional.find(node=>node.parentElement===content)||ownedReadouts[0];
  if(first)first.before(amount);else content.append(amount);
  for(const node of [...originalOptional,...ownedReadouts])amountBody.append(node);
  const exact=amountBody.querySelector('.bbpi-amount-details'),more=amountBody.querySelector('.bbpi-more-options'),pack=amountBody.querySelector('.bbpi-stock-pack');
  if(exact){exact.open=false;const label=exact.querySelector(':scope>summary');if(label)label.textContent='Exact amount';}
  if(pack)amountBody.prepend(pack);
  const capacities=pack?.querySelector('.bbpi-stock-capacities'),capacityHelp=pack?.querySelector('.bbpi-stock-capacity-help');
  if(capacities&&capacityHelp)capacities.after(capacityHelp);
  if(exact)pack?pack.after(exact):amountBody.prepend(exact);
  const nameLabel=content.querySelector('.bbpi-name-label'),nameText=[...nameLabel?.childNodes||[]].find(node=>node.nodeType===3);
  if(nameText)nameText.nodeValue='Food';
  const title=dialog.querySelector('.bbpi-editor-heading h4');
  dialog.classList.toggle('bbpa-existing-item',!nameLabel);
  if(title){title.dataset.bbpaTitle=nameLabel?'Add food':title.textContent;title.setAttribute('aria-label',nameLabel?'Add food':title.textContent);}
  const region=content.querySelector('.bbpi-stock-levels'),readout=region?.querySelector('.bbpi-stock-amount'),choices=region?.querySelector('.bbpi-stock-choices');
  if(choices){const prompt=doc.createElement('p');prompt.className='bbpa-stock-label';prompt.textContent='How much do you have?';prompt.append(estimate);choices.before(prompt);choices.after(helper,none);}
  else content.insertBefore(none,amount);
  const explanation=region?.querySelector('.bbpi-stock-explanation'),message=region?.querySelector('.bbpi-stock-message'),pendingNote=region?.querySelector('.bbpi-stock-pending');
  for(const node of [pendingNote,readout,explanation,message])if(node)amountBody.append(node);
  for(const node of [...content.children].filter(node=>node.matches('.bbpi-notice')))amountBody.append(node);
  if(more)amountBody.append(more);
  const legacyToggle=region?.querySelector('.bbpi-stock-pack-toggle'),sparesLabel=amount.querySelector('.bbpi-stock-spares-label'),spares=sparesLabel?.querySelector('input'),done=dialog.querySelector('.bbpi-done');
  const quantity=dialog.querySelector('[data-bbpi-quantity]'),quantityLabel=quantity?.closest('.bbpi-quantity-label'),units=dialog.querySelector('.bbpi-unit-label select'),unitLabel=units?.closest('.bbpi-unit-label'),exactControls=exact?.querySelector('.bbpi-editor-controls'),optionsControls=more?.querySelector('.bbpi-options-controls');
  const counts=doc.createElement('section'),presets=doc.createElement('div');counts.className='bbpa-counts';counts.hidden=true;counts.setAttribute('aria-label','How many left?');presets.className='bbpa-count-presets';presets.setAttribute('role','group');presets.setAttribute('aria-label','How many left?');amount.before(counts);
  if(sparesLabel&&optionsControls)optionsControls.append(sparesLabel);
  if(sparesLabel){
   const leading=[...sparesLabel.childNodes].find(node=>node.nodeType===3);
   if(leading)leading.nodeValue='Extra unopened packs';
  }
  if(spares)spares.setAttribute('aria-label','Extra unopened packs');
  if(done)done.setAttribute('aria-label','Done');
  let destroyed=false,queued=false,lastErrors='',lastFocus=null,reviewRequired=false,countMode=null,presetStamp='',viewportFrame=null,minimumFrame=null,minimumKey='';
  const listeners=[];
  const listen=(node,type,handler,capture=false)=>{node.addEventListener(type,handler,capture);listeners.push(()=>node.removeEventListener(type,handler,capture));};
  const setHidden=(node,value)=>{if(node&&node.hidden!==value)node.hidden=value;};
  const setClass=(name,value)=>{if(dialog.classList.contains(name)!==value)dialog.classList.toggle(name,value);};
  if(spares){
   const stepper=doc.createElement('span');stepper.className='bbpa-spares-stepper';spares.before(stepper);stepper.append(spares);
   for(const [label,direction,copy]of [['−',-1,'Fewer extra unopened packs'],['+',1,'More extra unopened packs']]){
    const control=doc.createElement('button');control.type='button';control.className='bbpa-spares-step';control.textContent=label;control.setAttribute('aria-label',copy);
    listen(control,'click',()=>{if(spares.disabled)return;direction>0?spares.stepUp():spares.stepDown();spares.dispatchEvent(new win.Event('input',{bubbles:true}));});
    direction<0?stepper.prepend(control):stepper.append(control);
   }
  }
  const remove=dialog.querySelector('.bbpi-remove');if(remove&&more)more.append(remove);
  // A collapsed-sheet minimum keeps level buttons stationary. Expanded amount
  // content remains natural-height; the existing viewport maximum still wins.
  function lockHeight(){
   keyboardLayout();
   if(destroyed||!dialog.open||amount.open||dialog.classList.contains('bbpa-keyboard-open')||dialog.style.getPropertyValue('--bbpa-sheet-min-height'))return;
   const height=dialog.getBoundingClientRect().height;if(height>0)dialog.style.setProperty('--bbpa-sheet-min-height',Math.ceil(height)+'px');
  }
  function rememberMinimum(counted){
   const food=String(nameLabel?.querySelector('input')?.value||target?.row?.name||title?.textContent||'');
   const key=JSON.stringify([food,counted]);
   if(key!==minimumKey){minimumKey=key;dialog.style.removeProperty('--bbpa-sheet-min-height');}
   if(dialog.style.getPropertyValue('--bbpa-sheet-min-height')||minimumFrame!==null)return;
   minimumFrame=win.requestAnimationFrame(()=>{minimumFrame=null;lockHeight();});
  }
  function keyboardLayout(){
   if(destroyed)return;
   const viewport=win.visualViewport,height=Number(viewport?.height)||win.innerHeight;
   setClass('bbpa-keyboard-open',height<600||win.innerHeight-height>120);
   if(viewportFrame!==null)win.cancelAnimationFrame(viewportFrame);
   viewportFrame=win.requestAnimationFrame(()=>{
    viewportFrame=null;const field=doc.activeElement;if(!field||!content.contains(field)||!field.matches('input,select,textarea'))return;
    const area=content.getBoundingClientRect(),rect=field.getBoundingClientRect();
    if(rect.bottom>area.bottom-12)content.scrollTop+=rect.bottom-area.bottom+12;
    else if(rect.top<area.top+12)content.scrollTop-=area.top-rect.top+12;
   });
  }
  function countLayout(counted){
   if(countMode!==counted){
    countMode=counted;setClass('bbpa-counted',counted);
    if(counted){
     if(quantityLabel){const text=[...quantityLabel.childNodes].find(node=>node.nodeType===3);if(text)text.nodeValue='How many left?';counts.append(quantityLabel);quantityLabel.querySelector('.bbpi-stepper')?.before(presets);}
     if(quantity)quantity.placeholder='Optional';
     if(unitLabel&&optionsControls)optionsControls.prepend(unitLabel);
     summaryLabel.textContent='More options';summaryHint.textContent='Units and shopping preferences';
     if(more){more.open=true;setHidden(more.querySelector(':scope>summary'),true);}
    }else{
     if(quantityLabel&&exactControls){const text=[...quantityLabel.childNodes].find(node=>node.nodeType===3);if(text)text.nodeValue='At home';exactControls.prepend(quantityLabel);}
     if(quantity)quantity.placeholder='Amount';
     if(unitLabel&&exactControls)exactControls.append(unitLabel);
     summaryLabel.textContent='Add amount (optional)';summaryHint.textContent='Pack size or exact weight';
     if(more){more.open=false;setHidden(more.querySelector(':scope>summary'),false);}
    }
   }
   if(!counted)return;
   const food=String(nameLabel?.querySelector('input')?.value||target?.row?.name||title?.textContent||'');
   const values=/\beggs?\b/i.test(food)?[1,2,4,6,12]:[1,2,3,4],nextStamp=values.join(',');
   if(presetStamp!==nextStamp){
    presetStamp=nextStamp;presets.replaceChildren();
    for(const value of values){const button=doc.createElement('button');button.type='button';button.className='bbpa-count-preset';button.textContent=String(value);button.setAttribute('aria-label',String(value));
     listen(button,'click',()=>{if(!quantity||quantity.disabled)return;quantity.value=String(value);quantity.dispatchEvent(new win.Event('input',{bubbles:true}));});presets.append(button);}
   }
   for(const button of presets.children){const pressed=String(quantity?.value.trim()!==''&&Number(quantity.value)===Number(button.textContent));if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);}
  }
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
   const errorNodes=errors(),errorStamp=errorNodes.map(node=>node.textContent).join('\n');
   const newError=!!errorStamp&&errorStamp!==lastErrors;
   lastErrors=errorStamp;
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
   const raw=quantity?.value?.trim();
   const qualitative=!region||region.hidden;setClass('bbpa-qualitative',qualitative);
   const counted=!qualitative&&(region?.dataset.bbpiCounted==='true'||['each','tin','can','jar','pack','bag','bottle','loaf','slice','bulb','clove','whole','item','piece'].includes(units?.value));
   countLayout(counted);
   const pending=region?.dataset.bbpiPending||'';
   const out=!pending&&!qualitative&&region.querySelector('[data-bbpi-stock-level="out"]')?.getAttribute('aria-pressed')==='true';
   // A positive unopened-pack balance remains visible even when Out is active.
   const empty=out&&raw!==''&&raw!==undefined&&Number.isFinite(Number(raw))&&Number(raw)===0;
   const count=spares?.value?.trim(),unopened=out&&!empty&&count!==''&&Number.isInteger(Number(count))&&Number(count)>0;
   const outCopy=empty?'None at home':unopened?'Opened pack finished · '+count+' unopened '+(Number(count)===1?'pack':'packs')+' left':'';
   if(none.textContent!==outCopy)none.textContent=outCopy;
   setClass('bbpa-out-zero',empty);setClass('bbpa-out-balance',!!unopened);setHidden(none,!outCopy);setHidden(helper,!!outCopy);setHidden(amount,empty&&!reviewRequired);
   setHidden(counts,!counted||empty);setHidden(presets,!counted);setHidden(exact,counted);setHidden(pack,counted||qualitative);setHidden(capacityHelp,true);setHidden(sparesLabel,counted);
   for(const node of [pendingNote,readout,explanation,message])setHidden(node,true);
   const estimated=region?.dataset.bbpiEstimated==='true'||/\bestimat/i.test(explanation?.textContent||'');setHidden(estimate,!estimated);
   const help=estimated?(counted?'Suggested count — adjust if needed. Done confirms this number.':'Estimated pack amount — check the label.'):
    counted&&raw!==''?'Tap a number, or use − and +.':"No amount needed. We'll check with you if a meal needs a lot.";
   if(helper.textContent!==help)helper.textContent=help;
   rememberMinimum(counted);
   setClass('bbpa-amount-open',amount.open&&!amount.hidden);
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
   // A native summary toggles after focus. Do not pre-open it before its click.
   if(event.target.tagName!=='SUMMARY'&&amount.contains(event.target)){lastFocus=event.target;reveal(event.target,true);}
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
    if(!region?.dataset.bbpiPending){reviewRequired=false;amount.open=false;}
   }
   refresh();
  });
  listen(dialog,'input',schedule);listen(dialog,'change',schedule);
  if(win.visualViewport){listen(win.visualViewport,'resize',keyboardLayout);listen(win.visualViewport,'scroll',keyboardLayout);}
  listen(win,'resize',keyboardLayout);listen(dialog,'focusin',keyboardLayout);
  const observer=win.MutationObserver?new win.MutationObserver(schedule):null;
  observer?.observe(dialog,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-expanded','aria-pressed','aria-busy','class','hidden','open','disabled','data-bbpi-pending','data-bbpi-counted','data-bbpi-estimated']});
  const api={refresh,lockHeight,destroy(){if(destroyed)return;destroyed=true;observer?.disconnect();if(viewportFrame!==null)win.cancelAnimationFrame(viewportFrame);if(minimumFrame!==null)win.cancelAnimationFrame(minimumFrame);for(const remove of listeners)remove();mounts.delete(dialog);}};
  mounts.set(dialog,api);refresh();keyboardLayout();return api;
 }
 function install(win){
  if(!win?.document?.createElement||!win.MutationObserver)return EMPTY;
  if(installations.has(win))return installations.get(win);
  const doc=win.document,active=new Map();let destroyed=false,queued=false,observer=null;
  function refresh(){
   if(destroyed)return;queued=false;
   for(const [dialog,presenter]of active)if(!dialog.isConnected){presenter.destroy();active.delete(dialog);}
   for(const dialog of doc.querySelectorAll('#bbpi-current-editor'))if(dialog.querySelector('.bbpi-amount-details')&&!active.has(dialog))active.set(dialog,mount(dialog,{win,doc}));
  }
  function schedule(){if(destroyed||queued)return;queued=true;(win.queueMicrotask||((callback)=>Promise.resolve().then(callback)))(refresh);}
  function start(){if(destroyed||observer||!doc.body)return;observer=new win.MutationObserver(schedule);observer.observe(doc.body,{childList:true,subtree:true});refresh();}
  if(doc.body)start();else doc.addEventListener('DOMContentLoaded',start,{once:true});
  const api={refresh,destroy(){if(destroyed)return;destroyed=true;observer?.disconnect();doc.removeEventListener('DOMContentLoaded',start);for(const presenter of active.values())presenter.destroy();active.clear();installations.delete(win);}};
  installations.set(win,api);return api;
 }
 return {install,mount};
});
