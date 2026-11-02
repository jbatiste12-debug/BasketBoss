/* Shared five-tab navigation. Preserve every original target and click handler. */
(()=>{'use strict';
 const vectors={
  plan:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  discover:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  kitchen:'<path d="m3 10 2 10h14l2-10H3Zm5 0V7a4 4 0 0 1 8 0v3m-7 4v3m6-3v3"/>',
  shop:'<path d="M10 5h11M10 12h11M10 19h11M3 5l1 1 2-3m-3 9 1 1 2-3m-3 9 1 1 2-3"/>',
  cook:'<path d="M5 10h14v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-7ZM3 10h18M9 7h6v3M2 13h3m14 0h3M8 3v1m8-1v1"/>'
 };
 const selector='.shell nav.tabs,nav.bb-r6-cook-nav,nav[aria-label="Bottom navigation"]';
 const watched=new WeakSet();let scheduled=false;
 function nameOf(item){return (item.querySelector('.nav-label')?.textContent||item.textContent||'').trim().toLocaleLowerCase('en-GB').replace(/^at home$/,'kitchen');}
 function refresh(){
  scheduled=false;
  for(const nav of document.querySelectorAll(selector)){
   const items=Array.from(nav.children).filter(item=>/^(BUTTON|A)$/.test(item.tagName));
   const names=items.map(nameOf);
   if(items.length!==5||names.some(name=>!Object.hasOwn(vectors,name))||new Set(names).size!==5)continue;
   if(!nav.id)nav.id='bbPrimaryNavigation';
   nav.setAttribute('data-bb-navigation','polished');
   const shopOverview=document.body.classList.contains('bb-qa-shop-nav-active');
   const current=shopOverview&&names.includes('shop')?items[names.indexOf('shop')]:
    items.find(item=>item.getAttribute('aria-current')==='page')||
    items.find(item=>item.classList.contains('active'))||
    items.find(item=>item.getAttribute('aria-selected')==='true');
   items.forEach((item,index)=>{
    const name=names[index];
    if(item.getAttribute('data-bb-nav-item')!==name)item.setAttribute('data-bb-nav-item',name);
    const active=String(item===current);
    if(item.getAttribute('data-bb-nav-current')!==active)item.setAttribute('data-bb-nav-current',active);
    let icon=item.querySelector('.nav-icon');
    if(!icon){
     icon=document.createElement('span');icon.className='nav-icon';icon.setAttribute('aria-hidden','true');
     const old=item.querySelector('svg');if(old)old.remove();item.prepend(icon);
    }
    if(icon.getAttribute('data-bb-nav-vector')!==name||!icon.querySelector('svg')){
     icon.setAttribute('data-bb-nav-vector',name);icon.setAttribute('aria-hidden','true');
     icon.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+vectors[name]+'</svg>';
    }
    // The standalone Cook page uses a plain label span; decorate it in place.
    const label=Array.from(item.children).find(node=>node!==icon&&node.tagName==='SPAN');
    if(name==='kitchen'&&label&&label.textContent!=='At home'){label.textContent='At home';item.setAttribute('aria-label','At home');}
    if(label&&!label.classList.contains('nav-label'))label.classList.add('nav-label');
   });
   if(!watched.has(nav)){
    watched.add(nav);
    new MutationObserver(schedule).observe(nav,{attributes:true,attributeFilter:['class','aria-current','aria-selected'],childList:true,subtree:true});
   }
  }
 }
 function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(refresh);}
 function start(){
  refresh();
  if(document.body)new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 window.addEventListener('pageshow',schedule);
 window.addEventListener('basketboss:native-startup-ready',schedule);
 window.BBNavigationPolish=Object.freeze({refresh});
})();
