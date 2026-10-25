/* BasketBoss 2026-10-25 / six mobile regressions repair.
   No changes to localStorage, pantry calculations, paid access or checkout.
   Lives alongside the original handlers and reads the rendered canonical list. */
(() => {
  'use strict';
  const isMobile = () => matchMedia('(max-width:720px)').matches;
  const body = document.body;
  const doc = document;
  const isCook = !!doc.querySelector('.bb-r6-cook-nav');
  if(isCook) body.classList.add('bb-r6-cook-page');
  const navTo = view => {
    const target=doc.querySelector('.shell nav.tabs [data-tab="'+view+'"]');
    if(target) target.click();
  };

  function restoreRequestedView() {
    if(isCook) return;
    const params = new URLSearchParams(location.search);
    const view=params.get('bbview');
    if(!['week','discover','shop','shop-list'].includes(view))return;
    requestAnimationFrame(()=>{
      navTo(view);
      const url=new URL(location.href); url.searchParams.delete('bbview');
      history.replaceState(history.state,'',url.pathname+url.search+url.hash);
    });
  }
  function moveMarketSetting() {
    if(isCook)return;
    const card=doc.getElementById('bb17RegionCard');
    const section=doc.getElementById('bbuiLinksSection');
    if(!card || !section)return;
    // Move the EXISTING selector and event listeners — never duplicate its state.
    if(card.parentElement!==section)section.prepend(card);
    const old=[...section.querySelectorAll('button')].find(b=>b.textContent.includes('Change shopping region'));
    if(old)old.remove();
    const oldLabel=section.querySelector('.bb-r6-market-helper');
    if(!oldLabel){
      const helper=doc.createElement('p');helper.className='bb-r6-market-helper';
      helper.textContent='Shopping region affects indicative grocery estimates. Change it here at any time.';
      section.insertBefore(helper,card);
    }
  }
  function quickSettings(){
    if(isCook)return;
    if(doc.getElementById('bbR6QuickSettings'))return;
    const settings=doc.getElementById('bbuiOpenSettings');
    if(!settings)return;
    const button=doc.createElement('button');button.id='bbR6QuickSettings';button.type='button';
    button.textContent='⚙';button.setAttribute('aria-label','Open Settings');
    button.addEventListener('click',()=>settings.click());doc.body.append(button);
  }

  let overview=null;
  let scheduled=false;
  function safeText(s){return String(s||'').replace(/\s+/g,' ').trim();}
  function node(tag,cls,text){const el=doc.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
  function createOverview() {
    if(isCook)return;
    const app=doc.getElementById('app');if(!app)return;
    overview=doc.getElementById('bbReleaseShopOverview');
    if(!overview){overview=node('section');overview.id='bbReleaseShopOverview';overview.hidden=true;
      overview.setAttribute('aria-label','Shopping list overview');app.before(overview);}
  }
  function updateOverview(){
    scheduled=false;
    enhancePlan();
    if(isCook||!isMobile()){
      body.classList.remove('bb-r6-shop-ready');if(overview)overview.hidden=true;return;
    }
    if(!overview)createOverview();if(!overview)return;
    if(body.dataset.bbnextView!=='shop-list'){
      body.classList.remove('bb-r6-shop-ready');overview.hidden=true;return;
    }
    // If Shop has no rows, still show a visible snapshot and a Plan CTA.
    const original=doc.getElementById('bb321Printable');
    const rows=original?[...original.querySelectorAll('[data-bb321-tick]')]:[];
    const pending=rows.filter(b=>!b.checked);
    const checked=rows.length-pending.length;
    const pct=rows.length?Math.round(checked/rows.length*100):0;
    const totals=[doc.querySelector('.bb321-shop-total'),doc.getElementById('statSpend'),doc.getElementById('headerTotal')];
    const estimate=safeText(totals.find(n=>n && /[£$€]/.test(n.textContent))?.textContent)||'—';
    overview.replaceChildren();
    const hero=node('div','bb-r6-hero');
    const eyebrow=node('div','bb-r6-eyebrow','✦ BASKETBOSS · YOUR SHOP');
    const title=node('h2',null,'Your shopping snapshot');
    const summary=node('p',null,rows.length?'Know what you need before heading for the aisles.':'Your basket fills up when you plan meals or add essentials.');
    const metrics=node('div','bb-r6-stats');
    for(const [value,label] of [[pending.length,'Still to buy'],[checked,'Already bought'],[estimate,'Estimated total']]){
      const item=node('div','bb-r6-stat');item.append(node('strong',null,String(value)),node('span',null,label));metrics.append(item);
    }
    const track=node('div','bb-r6-track');track.setAttribute('role','progressbar');
    track.setAttribute('aria-label','Shopping progress');track.setAttribute('aria-valuenow',String(pct));
    track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
    const fill=node('span');fill.style.width=pct+'%';track.append(fill);
    hero.append(eyebrow,title,summary,metrics,track,node('p','bb-r6-progress',rows.length?pct+'% complete · '+rows.length+' items':'No items in the basket yet'));
    const list=node('section','bb-r6-list');list.append(node('h3',null,'Coming up in your basket'));
    list.append(node('p',null,pending.length?'A preview of what’s still to buy.':rows.length?'Everything is ticked off.':'Build your list from Plan and Kitchen; nothing has been deleted.'));
    if(pending.length){const ul=node('ul');for(const b of pending.slice(0,4)){
      const row=b.closest('.bb321-buy-row')||b.closest('label')||b.parentElement;
      const name=safeText(row?.querySelector('.bb321-shop-name')?.textContent||b.getAttribute('aria-label')||'Shopping item');
      const quantity=safeText(row?.querySelector('.bb321-shop-quantity strong')?.textContent||'');
      const li=node('li');li.append(node('strong',null,name),node('small',null,quantity));ul.append(li);
    }list.append(ul);if(pending.length>4)list.append(node('p',null,'Plus '+(pending.length-4)+' more items.'));}
    const begin=node('button','bb-r6-begin');begin.type='button';
    begin.append(node('span',null,'Begin shop'),node('span',null,'→'));
    begin.disabled=!rows.length;
    begin.addEventListener('click',()=>{
      const launch=doc.getElementById('bb172ShopModeButton')||doc.querySelector('.bb1745-go-button');
      if(launch){launch.click();}
      else { const hint=overview.querySelector('.bb-r6-shop-launch-error')||node('p','bb-r6-shop-launch-error');
        hint.textContent='Shop Mode is unavailable on this build. Your list remains saved; reopen the Shop tab.';overview.append(hint);}
    });
    const secondary=node('div','bb-r6-secondary');
    const plan=node('button',null,'Plan meals');plan.type='button';plan.addEventListener('click',()=>navTo('week'));
    const kitchen=node('button',null,'Check kitchen');kitchen.type='button';kitchen.addEventListener('click',()=>navTo('shop'));
    secondary.append(plan,kitchen);overview.append(hero,list,begin,secondary);
    overview.hidden=false;
    body.classList.add('bb-r6-shop-ready');
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(updateOverview);}


  // v1767 Plan polish: DOM decoration only; use the original budget form,
  // region selector, saved target and Premium click handlers without rewiring them.
  let editingBudget = false;
  function enhancePlan(){
    if(isCook || !isMobile())return;
    const app=doc.getElementById('app');
    if(!app || !app.classList.contains('bbnext-plan'))return;
    const panel=app.querySelector('.bbnext-plan-budget');
    if(panel && !panel.dataset.bbR7Enhanced){
      panel.dataset.bbR7Enhanced='true';
      panel.classList.add('bb-r7-budget');
      // The duplicated decorative basket is intentionally hidden via CSS.
      const donut=panel.querySelector('.bbnext-plan-donut');
      if(donut){
        const amount=Math.max(0,Math.min(100,Number(donut.getAttribute('aria-valuenow'))||0));
        const ring=doc.createElementNS('http://www.w3.org/2000/svg','svg');
        ring.setAttribute('viewBox','0 0 120 120');ring.setAttribute('class','bb-r7-ring');
        ring.setAttribute('aria-hidden','true');ring.setAttribute('focusable','false');
        const track=doc.createElementNS('http://www.w3.org/2000/svg','circle');
        track.setAttribute('cx','60');track.setAttribute('cy','60');track.setAttribute('r','51');track.setAttribute('class','bb-r7-ring-track');
        const fill=doc.createElementNS('http://www.w3.org/2000/svg','circle');
        fill.setAttribute('cx','60');fill.setAttribute('cy','60');fill.setAttribute('r','51');fill.setAttribute('class','bb-r7-ring-fill');
        const distance=2*Math.PI*51;
        fill.style.strokeDasharray=String(distance);
        fill.style.strokeDashoffset=String(distance*(1-amount/100));
        ring.append(track,fill);donut.prepend(ring);
        if(donut.classList.contains('bb77-budget-over'))ring.classList.add('bb-r7-over');
        else if(amount>=85)ring.classList.add('bb-r7-close');
      }
      const text=panel.querySelector('.bbnext-plan-budget-text');
      const form=text?.querySelector('.bb77-budget-form');
      const originalLine=text?.querySelector('.bbnext-plan-budget-line');
      const input=form?.querySelector('#bb77BudgetTarget');
      if(form && input && originalLine){
        // Move the *same form* and handlers, never clone inputs or touch localStorage.
        panel.append(form);
        const hasTarget=!originalLine.textContent.includes('Set your weekly target') && Number(input.value)>0;
        if(hasTarget){
          const summary=node('button','bb-r7-budget-pill');summary.type='button';
          summary.textContent='Target: '+originalLine.textContent.replace(/\s*weekly target\s*$/i,'')+'  ·  Edit';
          summary.setAttribute('aria-label','Edit saved weekly grocery budget');
          summary.setAttribute('aria-expanded',String(editingBudget));
          panel.append(summary);
          const toggle=open=>{
            editingBudget=open;
            form.hidden=!open;summary.hidden=open;summary.setAttribute('aria-expanded',String(open));
            if(open){input.focus();input.select();}
          };
          summary.addEventListener('click',()=>toggle(true));
          form.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();toggle(false);}});
          form.addEventListener('submit',()=>{
            const val=Number(input.value);
            if(Number.isFinite(val)&&val>=1&&val<=10000)editingBudget=false;
          },{capture:true});
          form.hidden=!editingBudget;summary.hidden=editingBudget;
        }else{editingBudget=false;form.hidden=false;}
      }
    }
    const pro=app.querySelector('.bb81-pro-filters');
    if(pro && !pro.dataset.bbR7Enhanced){
      pro.dataset.bbR7Enhanced='true';
      const note=pro.querySelector('.bb81-pro-filter-note');
      if(note){
        note.textContent='Batch Mode: four cooked dinners, Mon/Wed double portions and Tue/Thu leftovers; cool and refrigerate food safely.';
      }
    }
  }
  function boot(){
    if(isCook)return;
    moveMarketSetting();quickSettings();createOverview();restoreRequestedView();
    const app=doc.getElementById('app');
    if(app)new MutationObserver(schedule).observe(app,{childList:true});
    // View changes aren't guaranteed to mutate #app if the list is empty.
    new MutationObserver(schedule).observe(body,{attributes:true,attributeFilter:['data-bbnext-view']});
    doc.querySelectorAll('.shell nav.tabs [data-tab]').forEach(button=>button.addEventListener('click',schedule));
    addEventListener('resize',schedule,{passive:true});
    schedule();
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
