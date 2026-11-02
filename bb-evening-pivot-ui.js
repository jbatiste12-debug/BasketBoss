/* A reviewed swap of two existing dinners. Plan, PANTRY and persistence remain
 * owned by the configured app adapter; opening this sheet makes no changes. */
(function(root){
 'use strict';
 const doc=root?.document;
 if(!doc||root.BBEveningPivotUI)return;
 let adapter=null,active=null,sequence=0;
 const element=(tag,className,text)=>{
  const node=doc.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);
  return node;
 };
 function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
 }
 function dateLabel(value,fallback='the later day'){
  if(!validDate(value))return fallback;
  return new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
 }
 const mealName=recipe=>String(recipe?.name||'Planned dinner');
 const isPremium=()=>{try{return adapter?.isPremium?.()===true;}catch(_){return false;}};
 const mealMeta=(recipe,servings)=>{
  const minutes=Number(recipe?.mins),count=Number(servings),parts=[];
  if(Number.isFinite(minutes)&&minutes>0)parts.push(minutes+' min');
  if(Number.isInteger(count)&&count>0)parts.push(count+' serving'+(count===1?'':'s'));
  return parts.join(' · ');
 };
 function setMessage(view,message,error=false){
  view.message.textContent=message;
  view.message.setAttribute('role',error?'alert':'status');
  view.message.classList.toggle('is-error',error);
 }
 function close(){
  const view=active;
  if(!view||view.busy)return false;
  active=null;sequence++;
  try{view.dialog.close?.();}catch(_){}
  view.dialog.remove();
  const target=view.opener?.isConnected?view.opener:doc.querySelector('.bb-evening-pivot-open');
  target?.focus?.({preventScroll:true});
  return true;
 }
 function premiumUnavailable(view){
  view.chosen=null;view.dateFields=[];view.choices.replaceChildren();view.review.replaceChildren();view.review.hidden=true;
  view.submit.disabled=true;view.submit.hidden=true;
  setMessage(view,'Premium access could not be confirmed. Close this sheet and check your account.',true);
  if(view.opener)view.opener.textContent='Evening Pivot · Need a quicker dinner? · Premium';
  view.baseControls[0]?.focus?.({preventScroll:true});
 }
 function requestUpgrade(button){
  if(typeof adapter?.upgrade!=='function'){
   button.textContent='Evening Pivot · Premium unavailable';return;
  }
  try{Promise.resolve(adapter.upgrade({feature:'Evening Pivot'})).catch(()=>{button.textContent='Evening Pivot · Check Premium plans';});}
  catch(_){button.textContent='Evening Pivot · Check Premium plans';}
 }
 function validation(view){
  if(!isPremium())return {ok:false,message:'Premium access could not be confirmed. Close this sheet and check your account.'};
  const suggestion=view.chosen;
  if(!suggestion||!validDate(suggestion.movedDateISO))return {ok:false,message:'Choose a meal to review.'};
  const useBy=Object.create(null);
  for(const {item,input}of view.dateFields){
   if(validDate(item.useByISO)&&item.useByISO<suggestion.movedDateISO)return {ok:false,message:item.name+' will be past its use-by date on the later day.'};
   const value=input.value;
   if(!validDate(value))return {ok:false,message:'Add a valid use-by date for '+item.name+'.'};
   if(value<suggestion.movedDateISO)return {ok:false,message:item.name+' needs a use-by date on or after '+dateLabel(suggestion.movedDateISO)+'.'};
   useBy[item.key]=value;
  }
  if(!view.freshness.checked||!view.ready.checked)return {ok:false,message:'Tick both ingredient checks before swapping.'};
  return {ok:true,useBy};
 }
 function updateValidation(view){
  if(!isPremium()){premiumUnavailable(view);return;}
  const result=validation(view);
  view.submit.disabled=view.busy||!result.ok;
  view.hint.textContent=result.ok?'Ready to swap. Both meals keep their planned servings.':result.message;
  for(const {input}of view.dateFields){
   const invalid=Boolean(input.value)&&(!validDate(input.value)||input.value<(view.chosen?.movedDateISO||''));
   input.setAttribute('aria-invalid',String(invalid));
  }
 }
 function checkbox(text,className){
  const label=element('label','bbep-check '+className),input=element('input');
  input.type='checkbox';input.required=true;
  label.append(input,element('span','',text));
  return {label,input};
 }
 function mealPreview(label,recipe,servings){
  const row=element('div','bbep-meal-preview');
  row.append(element('span','bbep-meal-day',label),element('strong','bbep-meal-name',mealName(recipe)),element('span','bbep-meal-meta',mealMeta(recipe,servings)));
  return row;
 }
 function choose(view,suggestion){
  if(view.busy)return;
  if(!isPremium()){premiumUnavailable(view);return;}
  view.chosen=suggestion;view.dateFields=[];view.controls=view.baseControls.concat(view.choiceButtons);
  view.review.replaceChildren();view.review.hidden=false;
  for(const [index,button]of view.choiceButtons.entries())button.setAttribute('aria-pressed',String(view.suggestions[index]===suggestion));
  const title=element('h3','bbep-section-title','Review the swap'),meals=element('div','bbep-meal-swap');
  meals.append(mealPreview('Tonight · '+view.context.day,suggestion.candidateRecipe,suggestion.candidateServings),mealPreview(dateLabel(suggestion.movedDateISO,suggestion.day),suggestion.currentRecipe,suggestion.currentServings));
  const saving=Number(suggestion.minsSaved);
  const saved=element('p','bbep-saving',Number.isFinite(saving)&&saving>0?'Save '+saving+' minutes tonight. Both meals stay in your plan.':'Both meals stay in your plan.');
  const pantry=element('p','bbep-pantry','PANTRY amounts checked. Check the actual packaging dates below.');
  const checks=element('section','bbep-freshness');
  checks.append(element('h3','bbep-section-title','Check the meal moving to '+suggestion.day),element('p','bbep-explanation','Check the labels and storage of ingredients for '+mealName(suggestion.currentRecipe)+'. Their use-by dates must cover '+dateLabel(suggestion.movedDateISO,suggestion.day)+'.'));
  const freshness=Array.isArray(suggestion.requiresFreshness)?suggestion.requiresFreshness:[];
  for(const [index,item]of freshness.entries()){
   const label=element('label','bbep-date-row'),name=element('span','bbep-date-name',item.name),field=element('span','bbep-date-control'),input=element('input','bbep-use-by');
   input.type='date';input.id='bbEveningUseBy'+index;input.required=true;input.min=validDate(suggestion.movedDateISO)?suggestion.movedDateISO:'';
   input.setAttribute('aria-label','Use-by date for '+item.name);label.htmlFor=input.id;
   if(validDate(item.useByISO)){input.value=item.useByISO;input.readOnly=true;}
   field.append(element('span','bbep-date-caption',input.readOnly?'Recorded use by':'Use by'),input);label.append(name,field);checks.append(label);
   view.dateFields.push({item,input});view.controls.push(input);
   input.addEventListener('input',()=>updateValidation(view));input.addEventListener('change',()=>updateValidation(view));
  }
  const suitable=checkbox('I’ve checked these ingredients are suitable for '+dateLabel(suggestion.movedDateISO,suggestion.day)+'.','bbep-freshness-check');
  const ready=checkbox('The ingredients for tonight are ready to cook, including any thawing.','bbep-ready-check');
  view.freshness=suitable.input;view.ready=ready.input;view.controls.push(suitable.input,ready.input);
  for(const input of [suitable.input,ready.input])input.addEventListener('change',()=>updateValidation(view));
  checks.append(suitable.label,ready.label);view.review.append(title,meals,saved,pantry,checks,view.hint);
  view.submit.hidden=false;setMessage(view,'');updateValidation(view);
 }
 async function commit(view){
  if(active!==view||view.busy)return;
  if(!isPremium()){premiumUnavailable(view);return;}
  const result=validation(view);
  if(!result.ok){setMessage(view,result.message,true);updateValidation(view);return;}
  view.busy=true;view.dialog.setAttribute('aria-busy','true');
  for(const control of view.controls)control.disabled=true;
  view.submit.disabled=true;setMessage(view,'Saving the two-meal swap…');
  let saved;
  try{saved=await adapter.apply(view.chosen,{useBy:result.useBy,confirmed:true,readyToCook:true});}
  catch(_){saved={ok:false,error:'The swap could not be saved. Your plan has not been changed.'};}
  if(active!==view)return;
  view.busy=false;view.dialog.setAttribute('aria-busy','false');
  for(const control of view.controls)control.disabled=false;
  if(saved?.ok===true){close();return;}
  setMessage(view,typeof saved?.error==='string'&&saved.error?saved.error:'The swap could not be saved. Close this sheet and try again.',true);
  updateValidation(view);
 }
 function buildDialog(context,opener){
  const dialog=element('dialog','bb-evening-pivot bb-evening-pivot-dialog');dialog.id='bbEveningPivotDialog';
  dialog.setAttribute('aria-labelledby','bbEveningPivotTitle');dialog.setAttribute('aria-describedby','bbEveningPivotIntro');dialog.setAttribute('aria-modal','true');
  const header=element('div','bbep-header'),heading=element('h2','bbep-title','Evening Pivot');heading.id='bbEveningPivotTitle';
  const dismiss=element('button','bbep-dismiss','×');dismiss.type='button';dismiss.setAttribute('aria-label','Close dinner swap');dismiss.addEventListener('click',close);header.append(heading,dismiss);
  const intro=element('p','bbep-intro','Choose a quicker meal already in your plan. We’ll move tonight’s dinner to its day.');intro.id='bbEveningPivotIntro';
  const form=element('form','bbep-form'),choices=element('section','bbep-choices'),review=element('section','bbep-review');review.hidden=true;
  choices.setAttribute('aria-label','Quicker meals already planned');
  const hint=element('p','bbep-validation-hint');hint.id='bbEveningPivotHint';
  const message=element('p','bbep-message','Checking your planned dinners and PANTRY…');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const actions=element('div','bbep-actions'),cancel=element('button','bbep-cancel','Keep my plan');cancel.type='button';cancel.addEventListener('click',close);
  const submit=element('button','bbep-submit','Swap these two meals');submit.type='submit';submit.disabled=true;submit.hidden=true;submit.setAttribute('aria-describedby',hint.id);
  actions.append(cancel,submit);form.append(choices,review,message,actions);dialog.append(header,intro,form);doc.body.append(dialog);
  const view={dialog,context,opener,choices,review,message,hint,submit,suggestions:[],chosen:null,dateFields:[],choiceButtons:[],controls:[],baseControls:[dismiss,cancel],busy:false};
  form.addEventListener('submit',event=>{event.preventDefault();void commit(view);});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();close();return;}
   if(event.key!=='Tab')return;
   const focusable=[...dialog.querySelectorAll('button,input')].filter(node=>!node.disabled&&!node.hidden&&!node.closest('[hidden]'));
   const first=focusable[0],last=focusable[focusable.length-1];
   if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}
  });
  try{if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');}}
  catch(_){dialog.setAttribute('open','');dialog.setAttribute('role','dialog');}
  dismiss.focus({preventScroll:true});return view;
 }
 async function open(context,opener){
  if(!adapter?.preview||!adapter?.apply||active?.busy)return;
  if(!isPremium()){requestUpgrade(opener);return;}
  if(active)close();
  const generation=++sequence,view=buildDialog(context,opener);active=view;
  let result;
  try{result=await adapter.preview({...context});}
  catch(_){result={suggestions:[],reason:'We couldn’t check your plan and PANTRY. Keep your plan for now and try again.'};}
  if(active!==view||sequence!==generation)return;
  if(!isPremium()){premiumUnavailable(view);return;}
  view.suggestions=Array.isArray(result?.suggestions)?result.suggestions:[];
  if(!view.suggestions.length){setMessage(view,typeof result?.reason==='string'&&result.reason?result.reason:'There isn’t a quicker planned dinner with enough confirmed PANTRY ingredients ready for tonight. Your plan is unchanged.');return;}
  view.choices.append(element('h3','bbep-section-title','Quicker meals in your plan'));
  for(const suggestion of view.suggestions){
   const button=element('button','bbep-choice');button.type='button';button.setAttribute('aria-pressed','false');
   const summary=element('span','bbep-choice-summary');summary.append(element('strong','bbep-choice-name',mealName(suggestion.candidateRecipe)),element('span','bbep-choice-meta',suggestion.day+' · '+mealMeta(suggestion.candidateRecipe,suggestion.candidateServings)));
   button.append(summary,element('span','bbep-choice-saving','Save '+suggestion.minsSaved+' min'));button.addEventListener('click',()=>choose(view,suggestion));
   view.choiceButtons.push(button);view.choices.append(button);
  }
  choose(view,view.suggestions[0]);
 }
 function configure(value){
  if(!value||typeof value.preview!=='function'||typeof value.apply!=='function'||typeof value.currentDay!=='function')throw Error('Evening Pivot needs its planner adapter');
  if(active&&!active.busy)close();adapter=value;
 }
 function createButton(context={}){
  let today;
  try{today=adapter?.currentDay();}catch(_){return null;}
  if(!adapter||context.day!==today||typeof context.recipeId!=='string'||!context.recipeId)return null;
  const holder=element('div','bb-evening-pivot bb-evening-pivot-control'),button=element('button','bb-evening-pivot-open','Evening Pivot · Need a quicker dinner?'+(isPremium()?'':' · Premium'));
  button.type='button';button.setAttribute('aria-haspopup','dialog');
  button.addEventListener('click',()=>void open({day:context.day,recipeId:context.recipeId},button));holder.append(button);return holder;
 }
 root.BBEveningPivotUI=Object.freeze({configure,createButton,close});
})(typeof window==='undefined'?globalThis:window);
