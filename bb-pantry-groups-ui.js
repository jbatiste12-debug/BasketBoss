/* Editable Kitchen subcategories are presentation metadata. The existing food
   and essentials controls continue to own quantities and shopping actions. */
(function(win){
 'use strict';
 if(!win||win.BBPantryGroupsUI)return;
 const doc=win.document,views=new Map();
 const api=()=>win.BBPantryGroups;
 const el=(tag,cl,text)=>{const node=doc.createElement(tag);if(cl)node.className=cl;if(text!==undefined)node.textContent=text;return node;};
 const labels={cupboard:'Cupboard',fridge:'Fridge',freezer:'Freezer',essentials:'Weekly essentials'};
 const message=error=>error?.message||'Your subcategories could not be saved. Please try again.';
 function button(text,fn,key){const node=el('button','',text);node.type='button';if(key)node.dataset.bbpgFocus=key;node.addEventListener('click',fn);return node;}
 function focus(view,key){if(!key)return;const target=[...view.bar.querySelectorAll('[data-bbpg-focus]')].find(node=>node.dataset.bbpgFocus===key);target?.focus({preventScroll:true});}
 function status(view,text,error=false){view.message=text;view.error=error;const node=view.bar.querySelector('.bbpg-status');if(node){node.textContent=text;node.setAttribute('role',error?'alert':'status');node.classList.toggle('is-error',error);}}
 function load(view,{own=false}={}){
  const pin=api().context(),snapshot=api().snapshot(view.section),stamp=JSON.stringify(pin);
  if(view.pin&&(view.pin.actor!==pin.actor||view.pin.session!==pin.session)){
   view.active='all';view.editing=false;view.drafts.clear();view.newName='';view.message='';
  }else if(view.stamp&&view.stamp!==stamp&&!own){
   view.drafts.clear();view.newName='';view.message='Subcategories changed. Review the latest groups before editing.';view.error=false;
  }
  view.pin=pin;view.stamp=stamp;view.groups=snapshot.groups;view.unavailable=false;
  if(view.active!=='all'&&!view.groups.some(group=>group.id===view.active))view.active='all';
  return snapshot;
 }
 function notify(view,extra){view.callback?.();if(extra&&extra!==view.callback)extra();}
 function mutate(view,pin,action,success,focusKey){
  try{
   action(pin);load(view,{own:true});view.message=success;view.error=false;render(view);notify(view);focus(view,focusKey);return true;
  }catch(error){status(view,message(error),true);return false;}
 }
 function render(view){
  const pin=view.pin,scroll=view.bar.querySelector('.bbpg-tabs')?.scrollLeft??view.tabScroll??0,oldActive=view.renderedActive;view.bar.replaceChildren();
  const header=el('div','bbpg-heading'),title=el('span','bbpg-label','Subcategories');
  const edit=button(view.editing?'Done':'Edit groups',()=>{
   view.editing=!view.editing;render(view);focus(view,view.editing?'new-name':'edit');
  },'edit');edit.className='bbpg-edit';edit.disabled=!!view.unavailable;edit.setAttribute('aria-expanded',String(view.editing));edit.setAttribute('aria-label',(view.editing?'Finish editing ':'Edit ')+labels[view.section]+' subcategories');
  const panelId='bbpg-editor-'+view.section;edit.setAttribute('aria-controls',panelId);header.append(title,edit);view.bar.append(header);
  const tabs=el('div','bbpg-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label',labels[view.section]+' subcategories');
  for(const group of [{id:'all',name:'All'},...view.groups]){
   const tab=button(group.name,()=>{view.active=group.id;render(view);notify(view);focus(view,'filter-'+group.id);},'filter-'+group.id);
   tab.dataset.bbpgGroup=group.id;tab.setAttribute('aria-pressed',String(view.active===group.id));tabs.append(tab);
  }
  tabs.addEventListener('scroll',()=>{view.tabScroll=tabs.scrollLeft;},{passive:true});view.bar.append(tabs);
  const panel=el('div','bbpg-editor');panel.id=panelId;panel.hidden=!view.editing;
  panel.append(el('p','bbpg-help','Make these groups your own. Removing a group keeps its items in Other. Groups are saved on this device for your account.'));
  const list=el('div','bbpg-group-list');
  const editable=view.groups.filter(group=>group.id!=='other');
  editable.forEach((group,index)=>{
   const row=el('form','bbpg-group-editor');row.setAttribute('aria-label','Edit '+group.name);
   const label=el('label','bbpg-name-label','Group name'),input=el('input');input.type='text';input.maxLength=48;input.required=true;input.autocomplete='off';input.value=view.drafts.get(group.id)??group.name;input.dataset.bbpgFocus='name-'+group.id;input.setAttribute('aria-label','Name for '+group.name);
   input.addEventListener('input',()=>view.drafts.set(group.id,input.value));label.append(input);
   const actions=el('div','bbpg-group-actions');
   const save=button('Save',()=>{},'save-'+group.id);save.type='submit';save.setAttribute('aria-label','Save '+group.name+' name');
   row.addEventListener('submit',event=>{event.preventDefault();mutate(view,pin,ctx=>{api().rename(view.section,group.id,input.value,ctx);view.drafts.delete(group.id);},'Group name saved.','name-'+group.id);});
   const up=button('↑',()=>mutate(view,pin,ctx=>api().move(view.section,group.id,-1,ctx),'Group moved.','name-'+group.id),'up-'+group.id);up.disabled=index===0;up.setAttribute('aria-label','Move '+group.name+' up');
   const down=button('↓',()=>mutate(view,pin,ctx=>api().move(view.section,group.id,1,ctx),'Group moved.','name-'+group.id),'down-'+group.id);down.disabled=index===editable.length-1;down.setAttribute('aria-label','Move '+group.name+' down');
   const remove=button('Remove',()=>mutate(view,pin,ctx=>{api().remove(view.section,group.id,ctx);view.drafts.delete(group.id);},'Group removed. Its items are still in Other.','edit'),'remove-'+group.id);remove.className='bbpg-remove';remove.setAttribute('aria-label','Remove '+group.name+' group');
   actions.append(save,up,down,remove);row.append(label,actions);list.append(row);
  });
  panel.append(list);
  const add=el('form','bbpg-add-group'),label=el('label','bbpg-name-label','New subcategory'),input=el('input');input.type='text';input.maxLength=48;input.required=true;input.autocomplete='off';input.placeholder=view.section==='essentials'?'e.g. Pet supplies':'e.g. Weekly favourites';input.value=view.newName;input.dataset.bbpgFocus='new-name';input.setAttribute('aria-label','New '+labels[view.section]+' subcategory');input.addEventListener('input',()=>{view.newName=input.value;});label.append(input);
  const submit=button('＋ Add group',()=>{});submit.type='submit';submit.className='bbpg-add';
  add.addEventListener('submit',event=>{event.preventDefault();mutate(view,pin,ctx=>{api().create(view.section,input.value,ctx);view.newName='';},'Subcategory added. Use an item’s Subcategory menu to put it here.','new-name');});add.append(label,submit);panel.append(add);view.bar.append(panel);
  const notice=el('p','bbpg-status',view.message);notice.setAttribute('role',view.error?'alert':'status');notice.setAttribute('aria-live','polite');notice.classList.toggle('is-error',!!view.error);view.bar.append(notice);
  // Replacing the pill controls must not jump back to the start of their row.
  // Reveal a selected group by scrolling only this row, never the whole page.
  tabs.scrollLeft=scroll;
  const chosen=[...tabs.children].find(node=>node.dataset.bbpgGroup===view.active);
  if(chosen&&(view.active!=='all'||oldActive!==view.active)){
   const row=tabs.getBoundingClientRect(),pill=chosen.getBoundingClientRect();
   if(pill.width>tabs.clientWidth||pill.left<row.left)tabs.scrollLeft+=pill.left-row.left;
   else if(pill.right>row.right)tabs.scrollLeft+=pill.right-row.right;
  }
  view.tabScroll=tabs.scrollLeft;view.renderedActive=view.active;
 }
 function mount(host,section,onChange){
  if(!host||!api()||!Object.hasOwn(labels,section))return null;
  let view=views.get(section);
  if(!view){view={section,host:null,bar:null,callback:onChange,active:'all',editing:false,drafts:new Map(),newName:'',message:'',error:false,groups:[],pin:null,stamp:null};views.set(section,view);}
  view.callback=onChange;
  const fresh=view.host!==host||!view.bar?.isConnected;
  if(fresh){view.tabScroll=view.bar?.querySelector('.bbpg-tabs')?.scrollLeft??view.tabScroll??0;view.bar?.remove();view.host=host;view.bar=el('section','bbpg-controls');view.bar.setAttribute('aria-label',labels[section]+' subcategory options');host.prepend(view.bar);}
  const previous=view.stamp,wasUnavailable=view.unavailable;
  try{load(view);if(fresh||previous!==view.stamp||wasUnavailable)render(view);}
  catch(error){
   view.active='all';view.groups=[];view.editing=false;view.unavailable=true;view.message=message(error);view.error=true;render(view);
  }
  return view.bar;
 }
 function active(section){return views.get(section)?.active||'all';}
 function matches(section,key,name){if(active(section)==='all')return true;try{return api().groupFor(section,key,name)===active(section);}catch{return true;}}
 function picker(section,key,name,onChange){
  if(!api())return null;
  const label=el('label','bbpg-item-group','Subcategory'),select=el('select');select.setAttribute('aria-label','Subcategory for '+name);select.dataset.bbpgItem=key;select.dataset.bbpgSection=section;
  let pin,previous;
  try{
   pin=api().context();previous=api().groupFor(section,key,name);
   for(const group of api().snapshot(section).groups){const option=el('option','',group.name);option.value=group.id;option.selected=group.id===previous;select.append(option);}
  }catch(error){label.append(el('span','bbpg-item-error',message(error)));return label;}
  label.append(select);
  select.addEventListener('change',()=>{
   const view=views.get(section),chosen=select.value;
   try{
    api().assign(section,key,chosen,pin);previous=chosen;pin=api().context();
    if(view){load(view,{own:true});view.message='Item moved to '+view.groups.find(group=>group.id===chosen)?.name+'.';view.error=false;render(view);notify(view,onChange);}
    else onChange?.();
    queueMicrotask(()=>{
     const replacement=[...doc.querySelectorAll('select[data-bbpg-item]')].find(node=>node.dataset.bbpgSection===section&&node.dataset.bbpgItem===key&&node.getClientRects().length);
     if(replacement)replacement.focus({preventScroll:true});else if(view)focus(view,'filter-'+view.active);
    });
   }catch(error){
    select.value=previous;
    if(view)status(view,message(error),true);
    else{let notice=label.querySelector('.bbpg-item-error');if(!notice){notice=el('span','bbpg-item-error');notice.setAttribute('role','alert');label.append(notice);}notice.textContent=message(error);}
   }
  });return label;
 }
 function reset(){for(const view of views.values())view.bar?.remove();views.clear();}
 win.BBPantryGroupsUI=Object.freeze({mount,active,matches,picker,reset});
})(typeof window==='undefined'?null:window);
