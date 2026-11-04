/* Reveal more of portrait food photos in the featured swipe card. */
(function(root){
 'use strict';
 const doc=root?.document;
 if(!doc||root.BBFeaturedFraming)return;
 const watched=new WeakSet();
 function frame(image){
  const card=image?.closest?.('#swipeCard');
  if(!card||!image.naturalWidth||!image.naturalHeight)return;
  const ratio=image.naturalWidth/image.naturalHeight;
  card.dataset.bbFoodFrame=ratio<.9?'portrait':ratio<1.15?'square':'landscape';
 }
 function update(){
  const image=doc.querySelector('#swipeCard>img');
  if(!image)return;
  if(!watched.has(image)){
   watched.add(image);image.addEventListener('load',()=>frame(image));
  }
  if(image.complete)frame(image);
 }
 function start(){
  update();
  const app=doc.getElementById('app');
  if(app&&typeof root.MutationObserver==='function')new root.MutationObserver(update).observe(app,{childList:true,subtree:true});
 }
 root.BBFeaturedFraming=Object.freeze({update});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window!=='undefined'?window:globalThis);
