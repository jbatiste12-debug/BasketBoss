/* Presentation only. Keep planning controls in their original DOM parents so
   their delegated handlers, identities and saved data remain with their owners. */
(()=>{'use strict';
 if(window.BBPlanCompact)return;
 const doc=document;let queued=false;
 function refresh(){
  queued=false;
  const app=doc.querySelector('#app.bbnext-plan[data-bb-compact-plan="true"]');if(!app)return;
  const card=app.querySelector('#bbpolAutofillCard'),actions=card?.querySelector(':scope>.bbnext-plan-actions');
  if(!app.querySelector('.bbpc-budget-overview')||!card?.querySelector('.bbpc-filter-row')||
   !actions?.querySelector(':scope>.bb-pantry-first-controls')||!actions.querySelector(':scope>[data-bb-start-next-week]')||
   !actions.querySelector('#bb172FillSixDinners')||!actions.querySelector('.bbnext-plan-secondary')||
   !card.querySelector(':scope>#bbnextPlanAutofill')||!app.querySelector('#bbSimplePlannerTabs'))return;
  if(app.dataset.bbCompactHeader!=='true')app.dataset.bbCompactHeader='true';
  const heading=app.querySelector('#bb1759MealsSummary>.bb1759-summary-heading');
  const paragraph=heading?.querySelector('p');
  if(paragraph&&!paragraph.closest('.bb-plan-compact-tips')){
   const details=doc.createElement('details');details.className='bb-plan-compact-tips';
   const summary=doc.createElement('summary');summary.textContent='Tap a day to plan · More tips';
   paragraph.before(details);details.append(summary,paragraph);
  }
 }
 function schedule(){if(queued)return;queued=true;window.requestAnimationFrame(refresh);}
 function start(){
  const app=doc.getElementById('app');if(!app)return;
  refresh();new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
 }
 window.BBPlanCompact=Object.freeze({refresh});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
