/* A photo-first meal workspace. Food selection stays ephemeral; only the
 * authenticated Make a Meal controller can scan or generate a recipe. */
(function(root){
 'use strict';
 const mounted=new WeakMap();
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
   '<header class="bbpm-intro"><p class="bbpm-kicker">BASKETBOSS · PHOTO TO MEAL</p><h1>Your ingredients.<br>Your next meal.</h1><p>Take a photo of the food you have. Get a meal idea and a picture made for those ingredients.</p></header><ol class="bbpm-steps" aria-label="Photo to meal steps"><li><span>1</span> Photo</li><li><span>2</span> Check ingredients</li><li><span>3</span> Meal + picture</li></ol>';
  stage.hidden=false;stage.classList.remove('bb-ai-native-visible');stage.removeAttribute('role');stage.removeAttribute('aria-modal');
  const close=stage.querySelector('[data-close-tool]');if(close)close.hidden=true;
  scanner.hidden=false;meal.hidden=true;hub.append(stage);
  const heading=scanner.querySelector('.ai-feature-heading');
  if(heading&&!pantry)heading.innerHTML='<span class="feature-label">START WITH A PHOTO</span><h2 id="aiScanTitle">What have you got?</h2><p>Include the ingredients you’d like to cook with. You can correct anything the scan gets wrong.</p>';
  const upload=scanner.querySelector('label[for="ai-photo-input"]');if(upload){upload.textContent='Take or choose a photo';upload.tabIndex=0;upload.setAttribute('role','button');upload.setAttribute('data-ai-scan-btn','');}
  const scan=doc.getElementById('scanBtn');scan.textContent='Find my ingredients';scan.hidden=true;
  const disclosure=scanner.querySelector('.disclosure');if(disclosure&&!pantry)disclosure.textContent='Your photo is sent for AI recognition only when you approve the scan. You review the ingredients before creating a meal. Nothing is added to At home or your shopping list.';
  if(!pantry){
   const mealHeading=meal.querySelector('.ai-feature-heading');if(mealHeading)mealHeading.innerHTML='<span class="feature-label">MADE FROM YOUR INGREDIENTS</span><h2 id="aiMealTitle">Your meal idea</h2>';
   doc.getElementById('generate').hidden=true;
   const warning=meal.querySelector('.warning');if(warning)warning.hidden=true;
  }
  const limits=doc.createElement('p');limits.className='bbpm-limits';limits.textContent='Premium · Internet required · Daily AI limits apply';hub.append(limits);
  const controller=Object.freeze({refresh(){},showMeal(){meal.hidden=false;},clearMeal(){meal.hidden=true;}});mounted.set(hub,controller);return controller;
 }
 root.BBCookStudio=Object.freeze({mount,ingredientNames});
})(typeof window==='undefined'?globalThis:window);
