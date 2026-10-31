/* Public examples only. No account reads, writes, uploads or network requests. */
(()=>{'use strict';
 function revealLinkedDemo(){
  if(!location.hash)return;
  let target;try{target=document.getElementById(decodeURIComponent(location.hash.slice(1)));}catch(_){return;}
  const details=target?.closest('details.bb-more-demos');
  if(details&&!details.open){details.open=true;target.scrollIntoView({block:'start'});}
 }
 window.addEventListener('hashchange',revealLinkedDemo);revealLinkedDemo();
 const tabs=Array.from(document.querySelectorAll('[data-receipt-demo-step]'));
 const next=document.getElementById('receipt-demo-next');
 const status=document.getElementById('receipt-demo-status');
 const messages=['Start with a receipt, then see what carries forward.','Food into your pantry. Household goods kept separate.','Check what remains, then buy the missing ingredients.'];
 const labels=['See your pantry','See the next shop','Back to the receipt'];
 let current=0;
 function select(index,focus=false){
  current=index;
  tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;const panel=document.getElementById(tab.getAttribute('aria-controls'));if(panel)panel.hidden=i!==index;});
  if(status)status.textContent=messages[index];if(next)next.textContent=labels[index]+' →';if(focus)tabs[index]?.focus();
 }
 tabs.forEach((tab,i)=>{
  tab.addEventListener('click',()=>select(i));
  tab.addEventListener('keydown',event=>{
   let index;if(event.key==='ArrowRight')index=(i+1)%tabs.length;if(event.key==='ArrowLeft')index=(i+tabs.length-1)%tabs.length;if(event.key==='Home')index=0;if(event.key==='End')index=tabs.length-1;
   if(index!==undefined){event.preventDefault();select(index,true);}
  });
 });
 if(tabs.length===3&&next)next.addEventListener('click',()=>select((current+1)%3));
 const mealTabs=['tab-plan','tab-shop'].map(id=>document.getElementById(id)).filter(Boolean);
 mealTabs.forEach((tab,i)=>{
  tab.tabIndex=tab.getAttribute('aria-selected')==='true'?0:-1;
  tab.addEventListener('click',()=>mealTabs.forEach(item=>{item.tabIndex=item===tab?0:-1;}));
  tab.addEventListener('keydown',event=>{
   const index=event.key==='Home'?0:event.key==='End'?mealTabs.length-1:['ArrowLeft','ArrowRight'].includes(event.key)?(i+1)%mealTabs.length:undefined;
   if(index!==undefined){event.preventDefault();mealTabs[index].click();mealTabs[index].focus();}
  });
 });
})();
