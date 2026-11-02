/* The Done screen offers one explicit, reviewable pantry update per cook. */
(function(root){'use strict';
 function mount({container,event,onOpenAtHome=()=>{},win=root}){
  const doc=container.ownerDocument,home=win.BBHome;let disposed=false,busy=false,done=false,preview;
  const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const card=make('section','bb-cook-pantry');card.setAttribute('aria-label','Update your pantry');container.append(card);
  const status=make('p','bb-cook-pantry-status');status.setAttribute('role','status');
  function show(){
   card.replaceChildren();card.append(make('h3','','Update your pantry?'),make('p','','Deduct used ingredients from At Home.'));
   try{preview=home?.previewCook?.(event);}catch{preview=null;}
   if(!preview?.ok){status.textContent=preview?.message||'Open At home to review your stock before updating it.';card.append(status);const open=make('button','btn','Review At home');open.onclick=onOpenAtHome;card.append(open);return;}
   if(preview.already){done=true;status.textContent='Ingredients already deducted for this meal.';card.append(status);return;}
   const review=make('details','bb-cook-pantry-review'),summary=make('summary','','Review amounts');review.append(summary);
   review.append(make('p','muted','Amounts reflect the servings you cooked. Edit what you used; 0 skips an ingredient.'));
   const edits=[];
   for(const row of preview.rows||[]){
    const line=make('div','bb-cook-pantry-row'),label=make('label','',row.name);line.append(label);
    if(row.canDeduct&&row.required!==null){const field=make('input');field.type='number';field.min='0';field.max='1000000';field.step='any';field.inputMode='decimal';field.value=String(row.required);field.setAttribute('aria-label','Amount used: '+row.name);label.append(field,doc.createTextNode(' '+row.unit));edits.push({row,field});}
    else line.append(make('span','muted',row.required===null?'Amount unknown':String(row.required)+' '+(row.unit||'')));
    line.append(make('small','muted','At home: '+row.owned+' '+(row.unit||'')+' · deduct up to '+row.deduct+' '+(row.unit||'')));
    if(row.issueLabel)line.append(make('small','bb-cook-pantry-issue',row.issueLabel));review.append(line);
   }
   if(preview.issues?.length){review.open=true;card.append(make('p','bb-cook-pantry-issue','Some amounts need a check. Compatible stock can still be deducted; flagged units stay unchanged.'));}
   const confirm=make('button','btn primary','Yes, deduct ingredients');confirm.type='button';
   confirm.onclick=async()=>{
    if(busy||done||disposed)return;const amounts=[];
    for(const {row,field}of edits){if(!field.value.trim()||!field.checkValidity()){review.open=true;field.reportValidity();field.focus();return;}amounts.push({id:row.id,quantity:Number(field.value),unit:row.unit});}
    busy=true;confirm.disabled=true;edits.forEach(x=>x.field.disabled=true);status.textContent='Updating At home…';
    try{const result=await home.cooked({...event,expected:preview.fingerprint,amounts});if(disposed)return;status.textContent=result?.message||'Review At home to check your stock.';done=result?.ok===true;if(done){confirm.remove();review.remove();}else if(result?.needsReview){confirm.textContent='Review latest amounts';busy=false;confirm.disabled=false;confirm.onclick=()=>{if(!disposed){busy=false;show();}};}else{busy=false;confirm.disabled=false;edits.forEach(x=>x.field.disabled=false);}}
    catch{if(!disposed){status.textContent='At home could not be updated. Review the amounts there before retrying.';busy=false;confirm.disabled=false;edits.forEach(x=>x.field.disabled=false);}}
   };
   card.append(review,confirm,status);
  }
  show();return {dispose(){disposed=true;card.remove();}};
 }
 if(root)root.BBCookPantry=Object.freeze({mount});
})(typeof window==='undefined'?null:window);
