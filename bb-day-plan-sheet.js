/* Presentation only: the original day <details> and every planning control
   keep their owner, identity and handlers. No account, plan or stock writes. */
(()=>{'use strict';
 const win=window,doc=document;if(win.BBPlanDaySheet)return;
 const DAYS=new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
 const ingredientChoices=new Map();let desiredDay=null,active=null,queued=false,banner=null,bannerObserver=null,activationTimer=null,activationPending=false;
 const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const rows=()=>[...doc.querySelectorAll('#app.bbnext-plan .bbnext-day[data-bbnext-day]')];
 function anotherModal(){return !!doc.querySelector('dialog[open],#cloud-panel.open,#modalRoot > *,.bbui-settings-overlay:not([hidden])');}
 function isFront(){return !!active&&!anotherModal();}
 function clearActive(){
  if(active){active.classList.remove('bbdps-active');const content=active.querySelector(':scope>.bbnext-day-content');content?.removeAttribute('role');content?.removeAttribute('aria-modal');content?.removeAttribute('aria-labelledby');}
  active=null;doc.documentElement.classList.remove('bb-day-plan-sheet-open');
 }
 function close(row=active){
  if(!row||row!==active)return;
  desiredDay=null;win.clearTimeout?.(activationTimer);activationPending=false;row.open=false;clearActive();
  if(!anotherModal())row.querySelector(':scope>summary')?.focus?.({preventScroll:true});
 }
 function ingredientDisclosure(row,content){
  const ingredients=content.querySelector(':scope>.bbnext-meal-ingredients');if(!ingredients)return;
  const details=make('details','bbdps-ingredients'),summary=make('summary');
  const count=Number(ingredients.dataset.bbIngredientCount),known=Number.isInteger(count)&&count>0;
  summary.textContent=known?'Ingredients ('+count+')':'Ingredients';
  const key=row.dataset.bbnextDay+'|'+(row.querySelector('.bbnext-day-description>strong')?.textContent||'');
  details.open=ingredientChoices.get(key)===true;
  details.addEventListener('toggle',()=>{if(details.isConnected)ingredientChoices.set(key,details.open);});
  ingredients.before(details);details.append(summary,ingredients);
 }
 function prepare(row){
  const content=row.querySelector(':scope>.bbnext-day-content');if(!content)return null;
  const day=row.dataset.bbnextDay;if(!DAYS.has(day))return null;
  let header=content.querySelector(':scope>.bbdps-header');
  if(!header){
   header=make('header','bbdps-header');
   const grabber=make('span','bbdps-grabber');grabber.setAttribute('aria-hidden','true');
   const title=make('h2','bbdps-title',day+' plan');title.id='bbDayPlanTitle-'+day;
   const dismiss=make('button','bbdps-close','×');dismiss.type='button';dismiss.setAttribute('aria-label','Close '+day+' plan');
   dismiss.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();close(row);});
   header.append(grabber,title,dismiss);content.prepend(header);
  }
  if(!row.querySelector(':scope>.bbdps-backdrop')){
   const backdrop=make('button','bbdps-backdrop');backdrop.type='button';backdrop.tabIndex=-1;backdrop.setAttribute('aria-label','Close '+day+' plan');
   backdrop.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(isFront())close(row);});row.append(backdrop);
  }
  ingredientDisclosure(row,content);return content;
 }
 function measure(){
  if(!active)return;
  const view=win.visualViewport,height=Number(view?.height)||win.innerHeight,offset=Number(view?.offsetTop)||0;
  const inset=Math.max(0,win.innerHeight-height-offset);
  let clearance=16;
  if(banner&&!banner.hidden&&banner.getClientRects().length&&!anotherModal())clearance=Math.max(clearance,Math.ceil(banner.getBoundingClientRect().bottom-offset+12));
  const style=doc.documentElement.style;
  for(const [name,value]of [['--bbdps-viewport-height',height+'px'],['--bbdps-bottom-inset',inset+'px'],['--bbdps-top-clearance',clearance+'px']])if(style.getPropertyValue(name)!==value)style.setProperty(name,value);
 }
 function watchBanner(){
  const next=doc.getElementById('bbFunnelNudge');if(next===banner)return;
  bannerObserver?.disconnect();banner=next;
  if(banner){bannerObserver=new MutationObserver(schedule);bannerObserver.observe(banner,{attributes:true,attributeFilter:['hidden','class'],childList:true,subtree:true});}
 }
 function refresh(){
  queued=false;watchBanner();
  if(doc.body.dataset.bbnextView!=='week'){desiredDay=null;win.clearTimeout?.(activationTimer);activationPending=false;clearActive();return;}
  if(activationPending)return;
  const row=desiredDay?rows().find(item=>item.dataset.bbnextDay===desiredDay&&item.open):null;
  if(!row){clearActive();return;}
  const content=prepare(row);if(!content)return;
  const changed=active!==row;if(changed)clearActive();
  active=row;row.classList.add('bbdps-active');doc.documentElement.classList.add('bb-day-plan-sheet-open');
  content.setAttribute('role','dialog');content.setAttribute('aria-modal','true');content.setAttribute('aria-labelledby','bbDayPlanTitle-'+row.dataset.bbnextDay);
  measure();
  if(changed&&!content.contains(doc.activeElement)&&isFront())content.querySelector('.bbdps-close')?.focus?.({preventScroll:true});
 }
 function schedule(){if(queued)return;queued=true;win.requestAnimationFrame(refresh);}
 function summaryClicked(event){
  if(event.defaultPrevented||!(event.target instanceof Element))return;
  if(event.target.closest('button,input,select,textarea,a,[contenteditable="true"]'))return;
  const summary=event.target.closest('summary.bbnext-day-toggle'),row=summary?.closest('#app.bbnext-plan .bbnext-day[data-bbnext-day]');
  if(!row||!DAYS.has(row.dataset.bbnextDay))return;
  win.clearTimeout?.(activationTimer);activationPending=false;
  const activate=()=>{
   // The badge's existing double-tap gesture has a 320 ms window. Keep its
   // physical second tap reachable before this presentation covers the row.
   if(event.target.closest('.bbnext-day-badge,.bbnext-day-label')&&typeof win.setTimeout==='function'){
    activationPending=true;activationTimer=win.setTimeout(()=>{activationPending=false;schedule();},330);
   }else schedule();
  };
  // A previously expanded day can be presented without closing or reopening
  // its saved native disclosure state. Other open days stay untouched.
  if(row.open&&row!==active){event.preventDefault();desiredDay=row.dataset.bbnextDay;activate();return;}
  desiredDay=row.open?null:row.dataset.bbnextDay;if(desiredDay)activate();else schedule();
 }
 function keydown(event){
  if(!isFront())return;
  const content=active.querySelector(':scope>.bbnext-day-content');
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key!=='Tab'||banner?.contains(event.target))return;
  const controls=[...content.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]')].filter(node=>!node.hidden&&node.getClientRects().length);
  const first=controls[0],last=controls.at(-1);if(!first)return;
  if(event.shiftKey&&(doc.activeElement===first||!content.contains(doc.activeElement))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(doc.activeElement===last||!content.contains(doc.activeElement))){event.preventDefault();first.focus();}
 }
 function start(){
  doc.addEventListener('click',summaryClicked,true);doc.addEventListener('keydown',keydown,true);
  doc.addEventListener('toggle',event=>{if(event.target===active&&!active.open){desiredDay=null;clearActive();}else if(event.target?.classList?.contains('bbnext-day')&&event.target.dataset.bbnextDay===desiredDay)schedule();},true);
  const observer=new MutationObserver(schedule);observer.observe(doc.body,{childList:true,subtree:true});
  new MutationObserver(schedule).observe(doc.body,{attributes:true,attributeFilter:['data-bbnext-view']});
  win.addEventListener('resize',measure);win.visualViewport?.addEventListener('resize',measure);win.visualViewport?.addEventListener('scroll',measure);refresh();
 }
 win.BBPlanDaySheet=Object.freeze({refresh});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
