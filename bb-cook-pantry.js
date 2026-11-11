/* Completing the steps opens review; one explicit cooked confirmation updates stock. */
(function(root){'use strict';
 function mount({container,event,onOpenAtHome=()=>{},onConfirmed=()=>{},win=root}){
  const doc=container.ownerDocument,home=win.BBHome;let disposed=false,busy=false,done=false,notified=false,preview;
  const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  function displayAmount(value,unit){
   if(!Number.isFinite(value)||value<0)return 'Check amount';
   try{const formatted=win.BBShopPurchaseUI?.formatDisplayQty?.(value,unit,{countMode:'balance'});if(formatted&&!/^Check\b/.test(formatted))return formatted;}catch{}
   const suffix=unit?' '+unit:'';if(value>0&&value<1&&['g','ml'].includes(unit))return '<1'+suffix;
   const counted=/^(?:each|counts?|cloves?|packs?|tins?|cans?|buns?|bulbs?|rolls?|eggs?|fillets?|bottles?|jars?|bags?|loaves?|slices?|pieces?|items?)$/i.test(unit||'');
   return new Intl.NumberFormat('en-GB',{maximumFractionDigits:['g','ml'].includes(unit)?0:counted?1:2,useGrouping:false}).format(value)+suffix;
  }
  const displayNote=value=>{try{return win.BBShopPurchaseUI?.formatDisplayQuantityText?.(value)||value;}catch{return value;}};
  const card=make('section','bb-cook-pantry');card.setAttribute('aria-label','Confirm cooked meal');container.append(card);
  const status=make('p','bb-cook-pantry-status');status.setAttribute('role','status');
  function confirmed(result){
   done=true;busy=false;card.removeAttribute('aria-busy');card.replaceChildren();
   card.append(make('h3','',result.already?'Meal already confirmed':'Meal confirmed'));
   status.textContent=result.message||(result.already?'This meal’s pantry update is already recorded.':'Your cooked servings and pantry update are recorded.');card.append(status);
   if(result.issues?.length){const open=make('button','btn','Review remaining amounts in At home');open.type='button';open.onclick=onOpenAtHome;card.append(open);}
   if(!notified){notified=true;try{onConfirmed(result);}catch{}}
  }
  function show(){
   if(disposed||done)return;
   status.textContent='';card.removeAttribute('aria-busy');card.replaceChildren();card.append(make('h3','','Confirm this meal is cooked'),make('p','','Confirm once to record the meal and deduct used ingredients from At home.'));
   try{preview=home?.previewCook?.(event);}catch{preview=null;}
   if(!preview?.ok){status.textContent=preview?.message||'Open At home to review your stock before updating it.';card.append(status);const open=make('button','btn','Review At home');open.onclick=onOpenAtHome;card.append(open);return;}
   if(preview.already){confirmed({ok:true,already:true,message:preview.message});return;}
   const review=make('details','bb-cook-pantry-review'),summary=make('summary','','Adjust amounts used');review.append(summary);
   review.append(make('p','muted','Amounts reflect the servings you cooked. Edit what you used; 0 skips an ingredient.'));
   const edits=[];
   for(const row of preview.rows||[]){
    const line=make('div','bb-cook-pantry-row'),label=make('label','',row.name);line.append(label);
    if(row.staple){
     line.append(make('span','muted',row.stockLabel||({in:'In Stock',low:'Low — restock',out:'Out — restock'}[row.stapleStatus])||'Check stock status'));
     line.append(make('small','muted','Staple: container/status tracking. Recipe spoonfuls do not reduce its saved stock.'));
     if(row.issueLabel)line.append(make('small','bb-cook-pantry-issue',displayNote(row.issueLabel)));review.append(line);continue;
    }
    if(row.canDeduct&&row.required!==null){const field=make('input');field.type='number';field.min='0';field.max='1000000';field.step='any';field.inputMode='decimal';field.value=String(row.required);field.setAttribute('aria-label','Amount used: '+row.name);label.append(field,doc.createTextNode(' '+row.unit));edits.push({row,field});}
    else line.append(make('span','muted',row.required===null?'Amount unknown':displayAmount(row.required,row.unit)));
    const balance=make('small','muted','At home: '+displayAmount(row.owned,row.unit)+' · deduct up to '+displayAmount(row.deduct,row.unit));if(Number.isFinite(row.owned))balance.setAttribute('data-bb-cook-raw-owned',String(row.owned));if(Number.isFinite(row.deduct))balance.setAttribute('data-bb-cook-raw-deduct',String(row.deduct));line.append(balance);
    if(row.issueLabel)line.append(make('small','bb-cook-pantry-issue',displayNote(row.issueLabel)));
    for(const assumption of row.assumptions||[])line.append(make('small','muted',displayNote(assumption)));review.append(line);
   }
   if(preview.rows?.some(row=>row.estimated)){review.open=true;card.append(make('p','bb-cook-pantry-issue','Some conversions use estimated ingredient weights. Check the amounts below before confirming.'));}
   if(preview.issues?.length){review.open=true;card.append(make('p','bb-cook-pantry-issue','Some amounts need a check. Compatible stock can still be deducted; flagged units stay unchanged.'));}
   const confirm=make('button','btn primary','Confirm cooked & update pantry');confirm.type='button';
   confirm.onclick=async()=>{
    if(busy||done||disposed)return;const amounts=[];
    for(const {row,field}of edits){if(!field.value.trim()||!field.checkValidity()){review.open=true;field.reportValidity();field.focus();return;}amounts.push({id:row.id,quantity:Number(field.value),unit:row.unit});}
    busy=true;card.setAttribute('aria-busy','true');confirm.disabled=true;edits.forEach(x=>x.field.disabled=true);status.textContent='Confirming cooked meal and updating At home…';
    try{const result=await home.cooked({...event,expected:preview.fingerprint,amounts});if(disposed)return;if(result?.ok===true){confirmed(result);return;}status.textContent=result?.message||'Review At home to check your stock.';card.removeAttribute('aria-busy');if(result?.needsReview){confirm.textContent='Review latest amounts';busy=false;confirm.disabled=false;confirm.onclick=()=>{if(!disposed){busy=false;show();}};}else{busy=false;confirm.disabled=false;edits.forEach(x=>x.field.disabled=false);}}
    catch{if(!disposed){status.textContent='The pantry update needs checking. Review At home before retrying confirmation.';card.removeAttribute('aria-busy');busy=false;confirm.disabled=false;edits.forEach(x=>x.field.disabled=false);}}
   };
   card.append(review,confirm,status);
  }
  show();return {dispose(){disposed=true;card.remove();}};
 }
 if(root)root.BBCookPantry=Object.freeze({mount});
})(typeof window==='undefined'?null:window);
