/* Weekly cupboard reminders. Only the existing shopping API creates demand. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root?.document)api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const STYLE='bbCupboardStaplesStyle',PANEL='bbCupboardStaples';
 const DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
 const css=`
#bbCupboardStaples.bb-cupboard-staples{display:block;margin:18px 0 24px;order:10000;min-width:0;max-width:100%;border:1px solid #ccd9bf;border-radius:20px;background:#f8f8ed;color:#234b36;overflow:hidden;box-shadow:0 6px 20px #28482c08}
#bbCupboardStaples.bb-cupboard-staples[hidden]{display:none!important}
#bbCupboardStaples > summary{display:flex;align-items:center;gap:12px;min-height:76px;padding:17px 18px;cursor:pointer;list-style:none;user-select:none}
#bbCupboardStaples > summary::-webkit-details-marker{display:none}
#bbCupboardStaples > summary:focus-visible,#bbCupboardStaples button:focus-visible{outline:3px solid #c7a957;outline-offset:-4px}
#bbCupboardStaples .bbcs-mark{display:grid;place-items:center;flex:0 0 38px;height:38px;border:1px solid #dfd9b7;border-radius:12px;background:#f1e8c9;font-size:21px}
#bbCupboardStaples .bbcs-heading{display:grid;gap:3px;flex:1;min-width:0}
#bbCupboardStaples .bbcs-heading strong{font-family:inherit;font-size:18px;font-weight:800;line-height:1.3;color:#214d38}
#bbCupboardStaples .bbcs-heading small{font-size:12px;color:#66745d;line-height:1.4}
#bbCupboardStaples .bbcs-chevron{width:8px;height:8px;flex:0 0 8px;border-right:2px solid #426f4d;border-bottom:2px solid #426f4d;transform:rotate(45deg);margin:0 5px 5px 2px;transition:transform .15s}
#bbCupboardStaples[open] .bbcs-chevron{transform:rotate(225deg);margin-top:7px}
#bbCupboardStaples[open] > summary{background:#f1f3e3;border-bottom:1px solid #dce3cd}
#bbCupboardStaples .bbcs-intro{margin:0;padding:14px 18px 4px;font-size:13px;line-height:1.6;color:#63715c}
#bbCupboardStaples .bbcs-list{list-style:none;padding:0 18px;margin:0}
#bbCupboardStaples .bbcs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 0;border-bottom:1px solid #e1e5d5;min-width:0}
#bbCupboardStaples .bbcs-row:last-child{border-bottom:0}
#bbCupboardStaples .bbcs-info{display:grid;gap:5px;flex:1;min-width:0;overflow-wrap:anywhere}
#bbCupboardStaples .bbcs-info strong{font-size:15px;line-height:1.4;color:#264c37}
#bbCupboardStaples .bbcs-days,#bbCupboardStaples .bbcs-pack{font-size:12px;line-height:1.5;color:#68765f}
#bbCupboardStaples .bbcs-add{flex:0 0 auto;min-height:44px;max-width:150px;padding:10px 14px;border:1px solid #b9cdb3;border-radius:12px;background:#fffdf4;color:#245b3a;font-family:inherit;font-size:13px;font-weight:800;line-height:1.4;cursor:pointer;white-space:normal}
#bbCupboardStaples .bbcs-add:disabled{opacity:.6;cursor:default}
#bbCupboardStaples .bbcs-status{margin:0;padding:0 18px 12px;color:#4b6f4b;font-size:12px;line-height:1.5}
#bbCupboardStaples .bbcs-status:empty{display:none}
@media(max-width:360px){#bbCupboardStaples > summary{padding:15px 13px;gap:9px}#bbCupboardStaples .bbcs-list{padding:0 13px}#bbCupboardStaples .bbcs-row{gap:9px}#bbCupboardStaples .bbcs-add{padding:9px 11px;max-width:116px}#bbCupboardStaples .bbcs-heading strong{font-size:17px}}
@media(prefers-reduced-motion:reduce){#bbCupboardStaples .bbcs-chevron{transition:none}}
@media print{#bbCupboardStaples.bb-cupboard-staples{display:none!important}}
`;
 function daysText(values){const found=new Set();for(const value of Array.isArray(values)?values:[]){if(typeof value!=='string')continue;const labels={monday:'Mon',mon:'Mon',tuesday:'Tue',tue:'Tue',wednesday:'Wed',wed:'Wed',thursday:'Thu',thu:'Thu',friday:'Fri',fri:'Fri',saturday:'Sat',sat:'Sat',sunday:'Sun',sun:'Sun'},short=labels[value.trim().toLowerCase()];if(short)found.add(short);}return DAYS.filter(day=>found.has(day)).join(' · ');}
 function nameText(value){const name=String(value||'').trim().slice(0,150);return name?name.charAt(0).toUpperCase()+name.slice(1):'';}
 function records(api){
  let input;try{input=api?.items?.();}catch{return [];}
  if(!Array.isArray(input))return [];
  const seen=new Set(),rows=[];
  for(const row of input){if(!row||row.active===true||typeof row.key!=='string'||!row.key||row.key.length>200||seen.has(row.key))continue;
   const name=nameText(row.displayName||row.name||row.key);if(!name)continue;seen.add(row.key);
   rows.push({key:row.key,name,container:['bottle','jar','pack','bag','tin','tub'].includes(row.container)?row.container:'pack',days:daysText(row.days)});
  }
  return rows;
 }
 function mount({container,win,api=()=>win?.BBCupboardStaples}){
  const doc=container.ownerDocument||win.document,make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const details=make('details','bb-cupboard-staples');details.id=PANEL;details.setAttribute('aria-label','Check your cupboard');
  const summary=make('summary'),mark=make('span','bbcs-mark','🥫');mark.setAttribute('aria-hidden','true');
  const heading=make('span','bbcs-heading'),title=make('strong','','Check your cupboard'),count=make('small'),chevron=make('span','bbcs-chevron');chevron.setAttribute('aria-hidden','true');heading.append(title,count);summary.append(mark,heading,chevron);
  const intro=make('p','bbcs-intro','Small essentials for this week’s meals. Add only what you need.'),list=make('ul','bbcs-list'),notice=make('p','bbcs-status');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  details.append(summary,intro,list,notice);container.append(details);
  let disposed=false,stamp=null,lastActor;const pending=new Set();
  const actor=()=>{try{return win?.BBHome?.actor?.()??null;}catch{return null;}};
  const service=()=>typeof api==='function'?api():api;
  function render(){
   if(disposed)return;
   const who=actor();if(lastActor!==undefined&&lastActor!==who){notice.textContent='';details.open=false;}lastActor=who;
   const rows=records(service()),next=JSON.stringify([who,rows,[...pending]]);if(next===stamp)return;stamp=next;
   details.hidden=rows.length===0;count.textContent=rows.length+' '+(rows.length===1?'staple':'staples')+' to check';
   list.replaceChildren();
   for(const row of rows){
    const item=make('li','bbcs-row'),info=make('div','bbcs-info'),name=make('strong','',row.name),days=make('span','bbcs-days',row.days?'For: '+row.days:'Pantry top-up'),pack=make('span','bbcs-pack','1 '+row.container),button=make('button','bbcs-add','+ Add to list');
    button.type='button';button.setAttribute('aria-label','Add '+row.name+' to shopping list');button.disabled=pending.has(JSON.stringify([who,row.key]));
    info.append(name,days,pack);item.append(info,button);list.append(item);
    button.addEventListener('click',async()=>{
     const who=actor(),intent=JSON.stringify([who,row.key]);if(disposed||pending.has(intent)||button.disabled)return;
     const current=service();if(typeof current?.promote!=='function'){notice.textContent='Shopping is still loading. Try again in a moment.';return;}
     pending.add(intent);button.disabled=true;button.textContent='Adding…';notice.textContent='';
     try{
      const result=await current.promote(row.key);
      if(disposed||!details.isConnected||actor()!==who)return;
      notice.textContent=result?.ok===true?row.name+' added to your shopping list.':'This item could not be added. Please try again.';
     }catch{if(!disposed&&details.isConnected&&actor()===who)notice.textContent='This item could not be added. Please try again.';}
     finally{pending.delete(intent);if(!disposed&&details.isConnected){stamp=null;render();}}
    });
   }
  }
  render();
  return {container,details,render,dispose(){if(disposed)return;disposed=true;details.remove();}};
 }
 function install(win){
  if(win.BBCupboardStaplesUI?.version===1)return win.BBCupboardStaplesUI;
  const doc=win.document;let view=null,viewActor=null,scheduled=false,observer=null,destroyed=false;
  function refresh(){
   scheduled=false;if(destroyed)return;
   const app=doc.getElementById('app'),tab=doc.body?.dataset?.bbnextView||doc.querySelector('.tab.active')?.dataset?.tab;
   if(!app||tab!=='shop-list'){view?.dispose();view=null;viewActor=null;return;}
   const has=(node,name)=>node?.classList?.contains(name)||String(node?.className||'').split(/\s+/).includes(name);
   const basic=has(doc.body,'bb-weekly-basic-open'),overview=doc.getElementById('bbReleaseShopOverview'),mobile=doc.getElementById('bbMobileShopPreview'),list=doc.getElementById('bb321Printable');
   // Mobile Shop snapshots replace or hide #app. Keep the drawer in the
   // visible surface; the free full-list mode exposes only #bb321Printable.
   const container=has(doc.body,'bb-r6-shop-ready')&&!basic&&overview&&!overview.hidden?overview:basic&&list?list:has(app,'bbmobile-shop-overview')&&mobile?mobile:app;
   let who=null;try{who=win.BBHome?.actor?.()??null;}catch{}
   if(!view||view.container!==container||!view.details.isConnected){const expanded=view?.details.open===true&&viewActor===who;view?.dispose();view=mount({container,win});view.details.open=expanded;}viewActor=who;
   view.render();
  }
  const schedule=()=>{if(destroyed||scheduled)return;scheduled=true;(win.requestAnimationFrame||win.setTimeout||setTimeout).call(win,refresh);};
  const events=['basketboss:session-changed','basketboss:account-changed','basketboss:pantry-updated','basketboss:plan-changed','storage'];
  const start=()=>{if(destroyed)return;if(!doc.getElementById(STYLE)){const style=doc.createElement('style');style.id=STYLE;style.textContent=css;doc.head.append(style);}if(win.MutationObserver){observer=new win.MutationObserver(schedule);observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-bbnext-view']});}for(const event of events)win.addEventListener?.(event,schedule);refresh();};
  const controller={version:1,mount,refresh:schedule,destroy(){if(destroyed)return;destroyed=true;observer?.disconnect();view?.dispose();for(const event of events)win.removeEventListener?.(event,schedule);doc.removeEventListener?.('DOMContentLoaded',start);}};
  win.BBCupboardStaplesUI=controller;
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
  return controller;
 }
 return Object.freeze({mount,install});
});
