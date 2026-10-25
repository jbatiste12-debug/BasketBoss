/* BasketBoss mobile Shop snapshot. Presentation-only: reads the existing DOM,
 * never creates a second shopping state or writes to localStorage.
 * The original In-Store Mode remains the sole interactive checklist owner. */
(() => {
  'use strict';
  const mobile = () => window.matchMedia('(max-width:720px)').matches;
  const findNav = value => document.querySelector('.shell .tabs .tab[data-tab="' + value + '"]');
  const viewIsShop = () => document.body.dataset.bbnextView === 'shop-list';
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  let scheduled = false;
  let lastKey = '';

  function buildSnapshot(app) {
    if (!mobile() || !viewIsShop()) {
      app.classList.remove('bbmobile-shop-overview');
      document.getElementById('bbMobileShopPreview')?.remove();
      lastKey = '';
      return;
    }
    // All quantities and checked states come from the original rendered checklist.
    const originals = [...app.querySelectorAll('#bb321Printable [data-bb321-tick]')];
    const pending = originals.filter(box => !box.checked);
    const checked = originals.length - pending.length;
    const estimate = clean(app.querySelector('.bb321-shop-total')?.textContent || 'Estimate not available');
    const region = clean(app.querySelector('.bb321-shop-summary-label')?.textContent || 'Your weekly shopping list');
    const first = pending.slice(0, 3).map(box => {
      const row = box.closest('.bb321-buy-row');
      return {
        name:clean(row?.querySelector('.bb321-shop-name')?.textContent || box.getAttribute('aria-label')),
        quantity:clean(row?.querySelector('.bb321-shop-quantity strong')?.textContent)
      };
    });
    const key = JSON.stringify({n: originals.length, pending:pending.length, checked, estimate, region, first});
    if (app.classList.contains('bbmobile-shop-overview') && document.getElementById('bbMobileShopPreview') && key === lastKey) return;
    lastKey = key;

    const root = document.getElementById('bbMobileShopPreview') || document.createElement('section');
    root.id = 'bbMobileShopPreview';
    root.setAttribute('aria-label','Shopping overview');
    root.replaceChildren();
    const hero = document.createElement('div');
    hero.className = 'bbm-shop-hero';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'bbm-eyebrow';
    eyebrow.textContent = '✦ BASKETBOSS · YOUR SHOP';
    const title = document.createElement('h2');
    title.textContent = 'Ready for the aisles?';
    const subtitle = document.createElement('p');
    subtitle.textContent = originals.length ? 'Here’s what your weekly basket looks like before you head to the shop.' : 'Your shopping snapshot will build as you plan meals and weekly essentials.';
    const metrics = document.createElement('div');
    metrics.className = 'bbm-shop-metrics';
    for(const [value,label] of [[pending.length,'Still to buy'],[checked,'Bought'],[estimate,'Basket estimate']]) {
      const item = document.createElement('div'); item.className='bbm-shop-metric';
      const number = document.createElement('strong'); number.textContent=String(value);
      const text = document.createElement('span'); text.textContent=label;
      item.append(number,text); metrics.append(item);
    }
    const progress = document.createElement('div');
    progress.className='bbm-shop-progress'; progress.setAttribute('role','progressbar');
    progress.setAttribute('aria-label','Shopping items bought');
    progress.setAttribute('aria-valuemin','0'); progress.setAttribute('aria-valuemax','100');
    const pct = originals.length ? Math.round(checked * 100 / originals.length) : 0;
    progress.setAttribute('aria-valuenow',String(pct));
    const fill = document.createElement('span'); fill.style.width=pct+'%'; progress.append(fill);
    const progressText = document.createElement('p');progressText.className='bbm-shop-caption';
    progressText.textContent = originals.length ? pct+'% checked off · '+originals.length+' total shopping items' : 'No items in your shopping list yet';
    hero.append(eyebrow,title,subtitle,metrics,progress,progressText);

    const preview = document.createElement('div'); preview.className='bbm-shop-preview';
    const previewTitle=document.createElement('h3');previewTitle.textContent='A peek at your basket';
    const previewNote=document.createElement('p');
    previewNote.textContent = pending.length ? 'Your next items, ready for the dedicated Shop Mode.' : originals.length ? 'Everything is ticked off — nice work!' : 'Add meals or essentials in Plan to build your shopping list.';
    preview.append(previewTitle,previewNote);
    if(first.length) {
      const list=document.createElement('ul'); list.className='bbm-shop-items';
      for(const row of first){const li=document.createElement('li');const n=document.createElement('span');n.textContent=row.name;const q=document.createElement('small');q.textContent=row.quantity;li.append(n,q);list.append(li);}
      preview.append(list);
      if(pending.length>3){const more=document.createElement('p');more.style.marginTop='10px';more.textContent='And '+(pending.length-3)+' more item'+(pending.length-3===1?'':'s')+' ready to shop.';preview.append(more);}
    }
    const actions=document.createElement('div');actions.className='bbm-shop-cta';
    const begin=document.createElement('button');begin.type='button';begin.className='bbm-begin';
    const text=document.createElement('span');text.textContent='Begin shop';const arrow=document.createElement('span');arrow.textContent='→';begin.append(text,arrow);
    begin.setAttribute('aria-label','Begin shop in full screen shopping mode');
    begin.addEventListener('click',()=>{
      const original=app.querySelector('#bb172ShopModeButton') || app.querySelector('.bb1745-go-button');
      if(original) original.click();
      else console.warn('BasketBoss Shop Mode launch control not found; staying in overview.');
    });
    actions.append(begin);
    const secondary=document.createElement('div');secondary.className='bbm-shop-actions';
    const edit=document.createElement('button');edit.type='button';edit.className='bbm-secondary';edit.textContent='Edit kitchen';
    edit.addEventListener('click',()=>findNav('shop')?.click());
    const plan=document.createElement('button');plan.type='button';plan.className='bbm-secondary';plan.textContent='Plan meals';
    plan.addEventListener('click',()=>findNav('week')?.click());
    secondary.append(edit,plan);actions.append(secondary);
    const foot=document.createElement('p');foot.className='bbm-small-note';
    foot.textContent = region+' · Estimates are indicative, not live checkout prices.';
    root.append(hero,preview,actions,foot);
    if(root.parentElement !== app)app.prepend(root);
    app.classList.add('bbmobile-shop-overview');
  }

  const start = () => {
    const app = document.getElementById('app'); if(!app)return;
    const schedule = () => {
      if(scheduled) return;scheduled=true;
      queueMicrotask(()=>{scheduled=false;try{buildSnapshot(app);}catch(error){console.warn('BasketBoss mobile snapshot unavailable:',error);}});
    };
    new MutationObserver(schedule).observe(app,{childList:true});
    window.addEventListener('resize',schedule,{passive:true});
    document.addEventListener('basketboss:cloudflare-qa-ready',schedule);
    schedule();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
