/* A created meal is a reviewable draft. Rendering never writes saved app data. */
(function(root){
 'use strict';
 const active=new WeakMap();let sequence=0;
 const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
 const items=value=>Array.isArray(value)?value:[];
 function markup(recipe,id){
  const prep=Number(recipe.prepMinutes),cook=Number(recipe.cookMinutes);
  const duration=Number.isFinite(prep)&&Number.isFinite(cook)?prep+cook:null;
  const ingredients=items(recipe.ingredients),steps=items(recipe.steps).slice(0,15);
  const allergens=items(recipe.allergens),safety=items(recipe.safetyNotes);
  return `<article class="generated bb-cook-result" aria-labelledby="${id}-title">
   <div class="bb-cook-result__image" data-bb-meal-image aria-label="Illustrative meal picture"></div>
   <div class="bb-cook-result__body"><p class="bb-cook-result__kicker">A little inspiration, served up</p>
    <h3 id="${id}-title">${escape(recipe.title||'Your meal idea')}</h3>
    <p class="bb-cook-result__summary">${escape(recipe.summary||'')}</p>
    <div class="bb-cook-result__meta"><span>✦ AI recipe draft</span><span>${escape(recipe.servings)} servings</span>${duration===null?'':`<span>${escape(duration)} estimated minutes</span>`}</div>
    <p class="bb-cook-result__notice">AI-generated and not kitchen-tested. Check ingredients, quantities, allergens and safe cooking before use.</p>
    <details class="bb-cook-result__review"><summary>Review ingredients &amp; steps <span aria-hidden="true">＋</span></summary>
     <div class="bb-cook-result__instructions"><h4>Ingredients</h4><ul>${ingredients.map(item=>`<li><span>${escape(item?.quantity||'Quantity unclear')} ${escape(item?.name||'')}</span><small>${item?.fromHome===false?'To buy':'Selected food · check quantity'}</small></li>`).join('')}</ul>
      <h4>Method · review for food safety</h4><ol>${steps.map(step=>`<li>${escape(String(step).replace(/^\s*\d+[.)]\s*/,''))}</li>`).join('')}</ol>
      <h4>Possible allergens</h4><p>${escape(allergens.join(', ')||'Review packaged ingredients and allergens yourself.')}</p>
      <h4>Food safety reminders</h4><ul>${safety.map(note=>`<li>${escape(note)}</li>`).join('')||'<li>Check safe handling, storage and cooking temperatures.</li>'}</ul>
      <p class="bb-cook-result__saved-note">No cost estimate. This draft is not added to Planner or Shopping automatically.</p>
     </div>
    </details>
    <button class="bb-cook-result__again" type="button" data-bb-meal-again>Try another idea <span aria-hidden="true">✦</span></button>
    <p class="bb-cook-result__saved-note">Your saved ingredients and meal plan stay as they are.</p>
   </div>
  </article>`;
 }
 function render(host,recipe,options={}){
  if(!host||!recipe)return null;
  active.get(host)?.cancel();
  if(options.isCurrent?.()===false)return null;
  const id='bb-created-meal-'+(++sequence);
  host.innerHTML=markup(recipe,id);
  const imageHost=host.querySelector('[data-bb-meal-image]');
  let image=null,cancelled=false;
  const isCurrent=()=>!cancelled&&host.isConnected!==false&&options.isCurrent?.()!==false;
  const again=host.querySelector('[data-bb-meal-again]');
  const retry=()=>{if(isCurrent())options.onTryAgain?.();};
  again?.addEventListener('click',retry);
  const controller={cancel(){
   if(cancelled)return;cancelled=true;
   image?.cancel?.();again?.removeEventListener('click',retry);
   if(active.get(host)===controller)active.delete(host);
  }};
  active.set(host,controller);
  // The validated text is in the DOM before image work starts. A picture error
  // cannot replace a usable recipe or fall back to an unrelated stock dish.
  try{
   if(root.BBMealImage?.attach&&imageHost){
    image=root.BBMealImage.attach(imageHost,{ticket:options.mealImage?.ticket,recipe,getToken:options.getToken,isCurrent});
   }else if(imageHost){
    imageHost.classList?.add('bb-cook-result__image--unavailable');
    imageHost.textContent='Meal picture unavailable. Your recipe is ready below.';
   }
  }catch{
   if(imageHost){imageHost.classList?.add('bb-cook-result__image--unavailable');imageHost.textContent='Meal picture unavailable. Your recipe is ready below.';}
  }
  return controller;
 }
 function clear(host){if(!host)return;active.get(host)?.cancel();host.replaceChildren?.();}
 root.BBCookResult=Object.freeze({render,clear});
})(typeof window==='undefined'?globalThis:window);
