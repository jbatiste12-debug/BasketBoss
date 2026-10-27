/* BasketBoss v17.3 — Free/Premium experience preview, NOT an entitlement provider.
   This file only upgrades the presentation and intercepts Shop Mode buttons.
   The static public catalogue has 100 Free recipes. The other 221 are
   served through a server-verified Premium API; AI is separately gated server-side.
*/
(() => {
  'use strict';
  const PRICING = 'pricing-sandbox.html';
  const selectFree = 'button[data-collection="Leftover Magic"]';
  let lastOpener = null;
  const $ = (sel,root=document) => root.querySelector(sel);
  const html = `
  <dialog id="bb173TierDialog" class="bb173-tier-dialog" aria-labelledby="bb173TierHeading" aria-describedby="bb173TierDesc">
    <header class="bb173-tier-header"><button type="button" data-bb173-close aria-label="Close Premium information">×</button>
      <p>✦ BASKETBOSS PREMIUM · SANDBOX PREVIEW</p>
      <h2 id="bb173TierHeading">More magic, less waste.</h2>
      <p id="bb173TierDesc">Verified Premium unlocks all 321 recipes, Leftover Magic and Advanced Shop Mode. AI tools are early access and require service availability.</p>
    </header>
    <div class="bb173-tier-body">
      <div class="bb173-tier-stat"><span>🧺 100 recipes stay free</span><span>✨ 321 with Premium</span></div>
      <p><strong>Planned Premium limits:</strong> 5 AI photo scans and 10 AI meal ideas per day. Founding Member has a planned 7-day trial; Standard Premium has a planned 3-day trial after Paddle Sandbox configuration. Server-side entitlements and subscription security must be verified before launch.</p>
      <div class="bb173-tier-plans">
        <a href="${PRICING}#monthly"><strong>Monthly</strong><span>£4.99 / month</span><small>3 days free, then £4.99/month · Sandbox price verification required</small></a>
        <a href="${PRICING}#founder"><strong>Founding Member</strong><span>£1.99 / month</span><small>7 days free · first 25 eligible members</small></a>
      </div>
      <p class="bb173-tier-disclaimer"><strong>Preview only:</strong> Checkout is a test. No real payment or Premium entitlement is activated. Basic shopping lists and manual ingredients remain free.</p>
      <button class="bb173-tier-free" type="button" data-bb173-close>Continue with the 100 free recipes</button>
    </div>
  </dialog>`;
  function installDialog() {
    if ($('#bb173TierDialog')) return;
    document.body.insertAdjacentHTML('beforeend',html);
    const dialog=$('#bb173TierDialog');
    dialog.addEventListener('click',e=>{if(e.target===dialog || e.target.closest('[data-bb173-close]'))hideDialog();});
    dialog.addEventListener('cancel',e=>{e.preventDefault();hideDialog();});
  }
  function hideDialog(){const d=$('#bb173TierDialog');if(d?.open)d.close();else d?.removeAttribute('open');lastOpener?.focus({preventScroll:true});}
  function showDialog(trigger,context){installDialog();lastOpener=trigger||document.activeElement;
    $('#bb173TierDesc').textContent=context||'Verified Premium unlocks all 321 recipes, Leftover Magic and Advanced Shop Mode. AI tools are early access and require service availability.';
    const d=$('#bb173TierDialog');if(!d.open){if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','');}
    $('[data-bb173-close]',d)?.focus({preventScroll:true});
  }
  // Block ONLY the advanced in-store experience in this sandbox UI demonstration.
  // The underlying shopping list/checklist remains available as a free feature.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('#bb172ShopModeButton, #bb172StoreMode');
    if(!button)return;
    if(qaPremiumPreview())return;
    event.preventDefault();event.stopImmediatePropagation();
    showDialog(button,'Advanced Shop Mode is a proposed Premium feature. Your basic shopping list stays free.');
  },true);
  // Read the same QA view as the recipe gate. This changes presentation only, never billing rights.
  function qaPremiumPreview(){
    if(window.BasketBossVerifiedPremium?.isActive?.()===true)return true;
    try {
      const host=String(location.hostname||'').toLowerCase();
      if(host==='localhost'||host==='127.0.0.1'||host.endsWith('.app.github.dev'))
        return window.BasketBossQAMode?.isPremium?.()===true;
      if(host==='basketboss-v17513-qa.basketboss-v1749-qa.pages.dev')
        return window.BasketBossCloudflareQA?.isPremium?.()===true;
    } catch (_) {}
    return false;
  }
  function makeHomeCard(){
    if(qaPremiumPreview()){
      const app=$('#app');
      for(const name of ['.bb173-leftover-card','.bb173-recipe-tier-banner','.bb173-locked-teasers'])
        app?.querySelector(name)?.remove();
      return;
    }
    const app=$('#app');if(!app)return;
    const discover=$('button.tab[data-tab="discover"]');
    if(discover && !discover.classList.contains('active'))return;
    if(!app.querySelector('.bb173-leftover-card')){
      const card=document.createElement('section');card.className='bb173-leftover-card';
      card.innerHTML=`<div class="bb173-leftover-icon" aria-hidden="true">✨</div><div class="bb173-leftover-text"><h3>Leftover Magic</h3><p>Give yesterday’s food a delicious new purpose. All Leftover Magic recipes and ingredient reuse ideas are exclusive to Premium.</p></div><button type="button" data-bb173-leftovers>Unlock Leftover Magic with Premium →</button>`;
      const heading=app.querySelector('.section-head');heading?.insertAdjacentElement('beforebegin',card);
      card.querySelector('[data-bb173-leftovers]').addEventListener('click',()=>{
        if (qaPremiumPreview()) {
          const category=$(selectFree);
          if(category){category.click();return;}
        }
        showDialog(card.querySelector('button'),'Leftover Magic recipes and personalised reuse suggestions are exclusive to Premium.');
      });
      if(!heading)app.prepend(card);
    }
    if(!app.querySelector('.bb173-recipe-tier-banner')){
      const banner=document.createElement('section');banner.className='bb173-recipe-tier-banner';
      banner.innerHTML='<div><strong>100 free recipes today · All 321 with Premium</strong><p>Explore family favourites and quick meals. Leftover Magic and advanced shopping require Premium. AI tools are early access and require service availability.</p></div><button type="button" data-bb173-upgrade>See Premium benefits →</button>';
      const card=app.querySelector('.bb173-leftover-card');if(card)card.insertAdjacentElement('afterend',banner);else app.prepend(banner);
      banner.querySelector('[data-bb173-upgrade]').addEventListener('click',e=>showDialog(e.currentTarget));
    }
    if(!app.querySelector('.bb173-locked-teasers')){
      const teasers=document.createElement('section');teasers.className='bb173-locked-teasers';
      teasers.innerHTML='<div><strong>🔒 221 more recipes in Premium</strong><p>Along with exclusive Leftover Magic recipes and Advanced Shop Mode. AI tools are early access and require service availability.</p></div><button type="button" data-bb173-upgrade>Explore plans</button>';
      app.appendChild(teasers);
      teasers.querySelector('[data-bb173-upgrade]').addEventListener('click',e=>showDialog(e.currentTarget));
    }
  }
  let pending=false;
  function schedule(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;makeHomeCard();markShop();});}
  function markShop(){document.querySelectorAll('#bb172ShopModeButton,#bb172StoreMode').forEach(el=>{if(el.dataset.bb173Marked)return;el.dataset.bb173Marked='1';el.setAttribute('title','Advanced Shop Mode · Premium preview');});}
  function openLeftoversFromHash(){if(location.hash!=='#leftover-magic')return;
    const discover=$('button.tab[data-tab="discover"]');if(discover && !discover.classList.contains('active'))discover.click();
    setTimeout(()=>{$(selectFree)?.click();$('.bb173-leftover-card')?.scrollIntoView({block:'center',behavior:'smooth'});},50);
  }
  document.addEventListener('DOMContentLoaded',()=>{
    installDialog();const app=$('#app');if(app)new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
    const tabs=$('.tabs');if(tabs)new MutationObserver(schedule).observe(tabs,{subtree:true,attributes:true,attributeFilter:['class']});
    schedule();openLeftoversFromHash();
  });
  document.addEventListener('basketboss:premium-verified',schedule);
  window.addEventListener('hashchange',openLeftoversFromHash);
  window.BasketBossPremiumPreview={show:showDialog};
})();
