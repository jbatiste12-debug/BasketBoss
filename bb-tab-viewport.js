/* Navigation owns scroll resets; ordinary rendering and quantity saves do not. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root?.document)api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_tab_navigation_v1',TTL=60000;
 const NAV='.shell nav.tabs,nav.bb-r6-cook-nav,nav[aria-label="Bottom navigation"]';
 const OVERLAYS='dialog[open],[role="dialog"][aria-modal="true"],.cook-overlay,#bb172Storefront,#bb172Onboarding,#bbNewOnboarding';
 const ALIASES={week:'week',plan:'week',discover:'discover',recipes:'discover',shop:'shop',kitchen:'shop','at home':'shop','shop-list':'shop-list',cook:'cook'};
 const NAV_ITEMS={plan:'week',discover:'discover',kitchen:'shop',shop:'shop-list',cook:'cook'};
 const LABELS={plan:'week',discover:'discover','at home':'shop',kitchen:'shop',shop:'shop-list',cook:'cook'};
 const normal=value=>typeof value==='string'?ALIASES[value.trim().toLowerCase()]||null:null;
 function install(win){
  if(win.BBTabViewport?.version===1)return win.BBTabViewport;
  const doc=win.document,html=doc.documentElement,raf=fn=>(win.requestAnimationFrame||win.setTimeout||setTimeout).call(win,fn),caf=id=>(win.cancelAnimationFrame||win.clearTimeout||clearTimeout).call(win,id);
  let destroyed=false,pending=null,serial=0,manual=0,frames=[],modeFrame=null,observer=null;
  const has=(node,name)=>node?.classList?.contains(name)||String(node?.className||'').split(/\s+/).includes(name);
  const locationURL=()=>{try{return new URL(win.location.href);}catch{return null;}};
  function view(){const saved=normal(doc.body?.dataset?.bbnextView);if(saved)return saved;const current=doc.querySelector('.tab.active,[data-bb-nav-current="true"]');const found=normal(current?.dataset?.tab)||NAV_ITEMS[current?.dataset?.bbNavItem];if(found)return found;return /(?:^|\/)make-a-meal\.html$/.test(locationURL()?.pathname||'')?'cook':null;}
  let lastView=view();
  function visible(node){
   if(!node||node.isConnected===false||node.hidden)return false;
   try{const style=win.getComputedStyle?.(node);if(style?.display==='none'||style?.visibility==='hidden')return false;if(node.getClientRects&&!Array.from(node.getClientRects()).some(rect=>rect.width>0&&rect.height>0))return false;}catch{return false;}
   return true;
  }
  function overlay(){
   let active=null,level=-Infinity;
   for(const node of doc.querySelectorAll(OVERLAYS)){
    if(!visible(node)||node.id==='bbToolStage'&&has(doc.body,'bb-photo-meal-page'))continue;
    let z=0;try{z=Number.parseInt(win.getComputedStyle?.(node)?.zIndex,10)||0;}catch{}
    if(!active||active.contains?.(node)||z>=level){active=node;level=z;}
   }
   return active;
  }
  function attribute(name,value){if(value===null){if(html.hasAttribute(name))html.removeAttribute(name);}else if(html.getAttribute(name)!==value)html.setAttribute(name,value);}
  function variable(name,value){if(html.style?.getPropertyValue?.(name)!==value)html.style?.setProperty?.(name,value);}
  function mode(requeue=true){
   if(destroyed)return;
   const current=view(),active=overlay();attribute('data-bb-tab-viewport',current?'document':null);attribute('data-bb-tab-scroll-lock',active?'overlay':null);
   const storefront=doc.getElementById('bb172Storefront'),foot=storefront?.querySelector('.bb172-storefront-bottom');let clearance=0;
   if(visible(storefront)&&visible(foot)){const height=foot.getBoundingClientRect?.().height;if(Number.isFinite(height)&&height>0)clearance=Math.ceil(Math.min(height,600)+16);}
   variable('--bb-tab-storefront-clearance',clearance+'px');
   let extra=0;
   if(!active)for(const bar of doc.querySelectorAll('[data-bb-tab-action-bar],.bb172-shop-status,.bb1745-list-launch')){
    if(!visible(bar)||bar.closest?.(NAV))continue;
    const rect=bar.getBoundingClientRect?.(),position=win.getComputedStyle?.(bar)?.position;
    if(rect&&['fixed','sticky'].includes(position)&&rect.top>Number(win.innerHeight||0)/2&&rect.bottom>=Number(win.innerHeight||0)-4)extra=Math.max(extra,Math.ceil(Math.min(rect.height,400)+16));
   }
   variable('--bb-tab-action-clearance',extra+'px');
   if(requeue&&!active&&pending&&!frames.length)queueFrames();
  }
  function scheduleMode(){if(destroyed||modeFrame!==null)return;modeFrame=raf(()=>{modeFrame=null;mode();});}
  function top(node){if(!node||node.isConnected===false)return;try{node.scrollTo?.({top:0,left:0,behavior:'instant'});}catch{}node.scrollTop=0;node.scrollLeft=0;}
  function main(){const app=doc.getElementById('app'),overview=doc.getElementById('bbReleaseShopOverview');if(has(doc.body,'bb-r6-shop-ready')&&!has(doc.body,'bb-weekly-basic-open')&&visible(overview))return overview;return visible(app)?app:doc.querySelector('main,.page');}
  function windowTop(){try{win.scrollTo({top:0,left:0,behavior:'instant'});}catch{try{win.scrollTo(0,0);}catch{}}top(doc.scrollingElement||doc.documentElement);}
  function perform(intent){
   frames=[];if(destroyed||pending!==intent||manual!==intent.manual)return;
   mode(false);
   if(intent.view&&view()!==intent.view)return;
   if(intent.kind==='panel'){
    const panel=intent.panel&&intent.panel.isConnected!==false?intent.panel:doc.querySelector(intent.selector);
    pending=null;if(visible(panel))top(panel);return;
   }
   // Keep a navigation reset pending until an active dialog closes. Never move
   // a keyboard-focused modal or the background its owner has locked.
   if(overlay())return;
   pending=null;windowTop();top(main());
  }
  function queueFrames(){
   const intent=pending;if(!intent||destroyed||frames.length)return;
   frames.push(raf(()=>{if(pending!==intent||manual!==intent.manual)return;frames.push(raf(()=>perform(intent)));}));
  }
  function reset(options={}){for(const frame of frames)caf(frame);frames=[];pending={kind:options.kind||'primary',view:normal(options.view)||null,panel:options.panel||null,selector:options.selector||null,manual,id:++serial};queueFrames();}
  function cancelManual(event){
   if(event?.isTrusted===false)return;
   if(event?.type==='keydown'&&(!['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)||event.target?.closest?.('input,textarea,select,[contenteditable="true"]')))return;
   manual++;pending=null;for(const frame of frames)caf(frame);frames=[];
  }
  function hrefView(control){try{const url=new URL(control.getAttribute('href'),win.location.href);return normal(url.searchParams.get('bbview'))||(/(?:^|\/)make-a-meal\.html$/.test(url.pathname)?'cook':null);}catch{return null;}}
  function primary(control){return normal(control.dataset?.tab)||hrefView(control)||NAV_ITEMS[control.dataset?.bbNavItem]||LABELS[(control.querySelector?.('.nav-label')?.textContent||control.textContent||'').trim().toLowerCase()]||null;}
  function remember(control,target){
   if(control.tagName!=='A'||!control.getAttribute('href'))return;
   try{const from=locationURL(),to=new URL(control.getAttribute('href'),win.location.href);if(!from||to.protocol!==from.protocol||to.hostname!==from.hostname||to.port!==from.port||!/(?:^|\/)(?:index|app|make-a-meal)\.html$/.test(to.pathname))return;if(to.pathname===from.pathname&&to.search===from.search)return;
    win.sessionStorage?.setItem(KEY,JSON.stringify({version:1,target:to.pathname+to.search,view:target,createdAt:Date.now()}));
   }catch{}
  }
  function click(event){
   scheduleMode();if(event.isTrusted===false||event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const control=event.target?.closest?.('button,a');if(!control||control.disabled||control.getAttribute?.('aria-disabled')==='true')return;
   if(control.closest?.(NAV)){
    const target=primary(control);if(!target||control.getAttribute?.('target')==='_blank')return;remember(control,target);reset({view:target});return;
   }
   // These are actual content tabs. Accordions, saved-tool disclosures, filters
   // and intentional section-jump links retain their existing scroll behavior.
   const selectors={bbPhasePrep:'.cook-panel',bbPhaseCook:'.cook-panel',bbuiSettingsTab:'.bbui-settings-panel',bbuiTutorialsTab:'.bbui-settings-panel'};
   const selector=selectors[control.id];if(selector)reset({kind:'panel',panel:control.closest(selector),selector});
  }
  function bodyChanged(){const next=view();if(next&&next!==lastView){lastView=next;reset({view:next});}mode();}
  function consumeMarker(){
   try{const raw=win.sessionStorage?.getItem(KEY);if(!raw)return;const marker=JSON.parse(raw),now=Date.now();if(marker?.version!==1||!Number.isFinite(marker.createdAt)||marker.createdAt>now+1000||now-marker.createdAt>TTL){win.sessionStorage.removeItem(KEY);return;}const here=locationURL();if(!here||marker.target!==here.pathname+here.search||!normal(marker.view))return;win.sessionStorage.removeItem(KEY);reset({view:marker.view});}catch{try{win.sessionStorage?.removeItem(KEY);}catch{}}
  }
  function start(){if(destroyed)return;lastView=view();mode();consumeMarker();if(win.MutationObserver&&doc.body){observer=new win.MutationObserver(bodyChanged);observer.observe(doc.body,{attributes:true,attributeFilter:['data-bbnext-view','class','style']});}}
  doc.addEventListener('click',click,true);doc.addEventListener('close',scheduleMode,true);
  const keyHandler=event=>{cancelManual(event);if(event.key==='Escape')scheduleMode();};
  // Keep references for teardown, including passive manual-scroll intent hooks.
  doc.addEventListener('keydown',keyHandler,true);
  win.addEventListener('wheel',cancelManual,{passive:true});win.addEventListener('touchmove',cancelManual,{passive:true});win.addEventListener('resize',scheduleMode,{passive:true});win.addEventListener('pageshow',consumeMarker);win.visualViewport?.addEventListener?.('resize',scheduleMode);
  const controller={version:1,activate(control){if(!control||!control.closest?.(NAV)||control.disabled||control.getAttribute?.('aria-disabled')==='true')return false;const target=primary(control);if(!target)return false;remember(control,target);control.click();reset({view:target});return true;},reset,refresh:scheduleMode,destroy(){if(destroyed)return;destroyed=true;observer?.disconnect();for(const frame of frames)caf(frame);if(modeFrame!==null)caf(modeFrame);frames=[];pending=null;doc.removeEventListener('click',click,true);doc.removeEventListener('close',scheduleMode,true);doc.removeEventListener('keydown',keyHandler,true);win.removeEventListener('wheel',cancelManual);win.removeEventListener('touchmove',cancelManual);win.removeEventListener('resize',scheduleMode);win.removeEventListener('pageshow',consumeMarker);win.visualViewport?.removeEventListener?.('resize',scheduleMode);}};
  win.BBTabViewport=controller;if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();return controller;
 }
 return Object.freeze({install});
});
