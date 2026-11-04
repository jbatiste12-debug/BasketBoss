/* A photo-first meal workspace. Food selection stays ephemeral; only the
 * authenticated Make a Meal controller can scan or generate a recipe. */
(function(root){
 'use strict';
 const mounted=new WeakMap();
 const cameraArt='<span class="bbpm-camera-art" aria-hidden="true"><svg viewBox="0 0 96 84" focusable="false"><g class="bbpm-camera-crown"><path d="m32 24-4-14 12 7L48 5l8 12 12-7-4 14Z"/></g><rect x="17" y="29" width="62" height="43" rx="12"/><path d="m33 29 5-8h20l5 8"/><circle cx="48" cy="50" r="12"/><circle cx="48" cy="50" r="5"/><path d="M26 39h5M10 25v-7h7m62 0h7v7M10 69v7h7m62 0h7v-7"/></svg><span class="bbpm-scan-line"></span></span>';
 const singular={onions:'onion',carrots:'carrot',potatoes:'potato',tomatoes:'tomato',courgettes:'courgette',mushrooms:'mushroom',eggs:'egg',lemons:'lemon',limes:'lime',apples:'apple'};
 function ingredientNames(values){
  const seen=new Set(),names=[];
  for(const value of values||[]){
   if(typeof value!=='string')continue;
   const name=value.normalize('NFKC').replace(/\s+/g,' ').trim();if(!name)continue;
   const words=name.toLocaleLowerCase('en-GB').split(' ');words[words.length-1]=singular[words.at(-1)]||words.at(-1);
   const key=words.join(' ');if(seen.has(key))continue;seen.add(key);names.push(name);
  }
  return names;
 }
 function mount({hub,workspace}={}){
  if(!hub||!workspace)return null;
  if(mounted.has(hub))return mounted.get(hub);
  const doc=hub.ownerDocument||root.document,stage=doc.getElementById('bbToolStage');
  const scanner=doc.getElementById('aiScanner'),meal=doc.getElementById('aiMeal');
  if(!stage||!scanner||!meal)return null;
  const pantry=new URL(root.location.href).searchParams.get('bbscan')==='pantry';
  doc.body.classList.add('bb-cook-studio-page','bb-photo-meal-page');
  hub.classList.add('bb-cook-studio');hub.setAttribute('aria-label',pantry?'Scan food for At home':'Photo to meal');
  workspace.hidden=true;
  hub.innerHTML=pantry?'<header class="bbpm-intro"><p class="bbpm-kicker">AT HOME · PHOTO SCAN</p><h1>Scan your food</h1><p>Check the foods and amounts before updating At home.</p></header>':
   '<header class="bbpm-intro"><div class="bbpm-brandline"><span class="bbpm-brand"><img src="icons/basketboss-crowned-v1766-192.png" width="30" height="30" alt="" aria-hidden="true"><span>BASKETBOSS KITCHEN</span></span><span class="bbpm-premium">✦ Premium AI</span></div><h1>Your ingredients.<br><em>Your next meal.</em></h1><p>A little inspiration from the food you have.<br>One photo. A meal made for you.</p><span class="bbpm-hero-spark" aria-hidden="true">✧</span></header><ol class="bbpm-steps" aria-label="Photo to meal steps"><li data-bbpm-step="1" aria-current="step"><span>1</span> Photo</li><li data-bbpm-step="2"><span>2</span> Ingredients</li><li data-bbpm-step="3"><span>3</span> Meal + picture</li></ol>';
  stage.hidden=false;stage.classList.remove('bb-ai-native-visible');stage.removeAttribute('role');stage.removeAttribute('aria-modal');
  const close=stage.querySelector('[data-close-tool]');if(close)close.hidden=true;
  scanner.hidden=false;meal.hidden=true;hub.append(stage);
  const heading=scanner.querySelector('.ai-feature-heading');
  if(heading&&!pantry)heading.innerHTML='<span class="feature-label">START WITH A PHOTO</span><h2 id="aiScanTitle">What have you got?</h2><p>Include the ingredients you’d like to cook with. You can correct anything the scan gets wrong.</p>';
  const upload=scanner.querySelector('label[for="ai-photo-input"]');if(upload){upload.innerHTML=cameraArt+'<strong>Take or choose a photo</strong><small>Camera or photo library <span aria-hidden="true">↗</span></small>';upload.tabIndex=0;upload.setAttribute('role','button');upload.setAttribute('aria-label','Take or choose a photo');upload.setAttribute('data-ai-scan-btn','');}
  const scan=doc.getElementById('scanBtn');scan.textContent='Find my ingredients';scan.hidden=true;
  const disclosure=scanner.querySelector('.disclosure');if(disclosure&&!pantry)disclosure.textContent='Your photo is sent for AI recognition only when you approve the scan. You review the ingredients before creating a meal. Nothing is added to At home or your shopping list.';
  if(!pantry){
   const mealHeading=meal.querySelector('.ai-feature-heading');if(mealHeading)mealHeading.innerHTML='<span class="feature-label">MADE FROM YOUR INGREDIENTS</span><h2 id="aiMealTitle">Your meal idea</h2>';
   doc.getElementById('generate').hidden=true;
   const warning=meal.querySelector('.warning');if(warning)warning.hidden=true;
  }
  const limits=doc.createElement('p');limits.className='bbpm-limits';limits.textContent='Premium · Internet required · Daily AI limits apply';hub.append(limits);
  const steps=[...hub.querySelectorAll('[data-bbpm-step]')];
  function refresh(){
   const generated=doc.getElementById('generated');
   const cooking=doc.getElementById('generate')?.disabled===true;
   const phase=generated?.querySelector('.bb-cook-result')?'ready':cooking?'creating':doc.getElementById('reviewMealFoods')?'review':scan.disabled?'scanning':'photo';
   hub.dataset.phase=phase;
   const current=phase==='creating'||phase==='ready'?3:phase==='review'?2:1;
   for(const step of steps){const index=Number(step.getAttribute('data-bbpm-step'));step.dataset.state=index<current?'done':index===current?'current':'next';if(index===current)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');}
  }
  const observer=root.MutationObserver?new root.MutationObserver(refresh):null;
  observer?.observe(stage,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled','class']});
  const pause=()=>{hub.dataset.paused=doc.hidden?'true':'false';};
  doc.addEventListener?.('visibilitychange',pause);pause();refresh();
  const controller=Object.freeze({refresh,showMeal(){meal.hidden=false;},clearMeal(){meal.hidden=true;},destroy(){observer?.disconnect();doc.removeEventListener?.('visibilitychange',pause);mounted.delete(hub);}});mounted.set(hub,controller);return controller;
 }
 root.BBCookStudio=Object.freeze({mount,ingredientNames});
})(typeof window==='undefined'?globalThis:window);
