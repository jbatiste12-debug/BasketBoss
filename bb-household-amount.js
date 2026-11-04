/* Explicit household container amounts. Purchases stay whole; measured ownership may be partial. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBHouseholdAmount=api.install(root);})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const MAX=1000000,round=value=>Math.round(value*1000000)/1000000;
 function number(value,label,{positive=false}={}){
  if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&(!value.trim()||!/^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value)))throw Error('Enter '+label+'.');
  const amount=Number(value);if(!Number.isFinite(amount)||amount<0||positive&&amount===0||amount>MAX)throw Error('Check '+label+'; use '+(positive?'a positive amount':'0 or more')+'.');return amount;
 }
 function measure(quantity,unit){
  const q=number(quantity,'the full container size',{positive:true}),base=String(unit||'').trim().toLowerCase();
  if(!['ml','g','l','kg'].includes(base))throw Error('Choose ml or grams for the container size.');
  const amount=q*(base==='l'||base==='kg'?1000:1);if(amount>MAX||amount<0.000001)throw Error('Check the full container size; use no more than 1,000,000 ml or grams.');
  return {quantity:round(amount),unit:base==='l'?'ml':base==='kg'?'g':base};
 }
 function prepare({remaining,capacity,capacityUnit,neededContainers}={}){
  const container=measure(capacity,capacityUnit),owned=number(remaining,'how many containers remain'),needed=number(neededContainers,'the total containers needed');
  const ownedQty=round(owned*container.quantity),targetQty=round(needed*container.quantity);
  if(ownedQty>MAX||targetQty>MAX||owned>0&&ownedQty===0||needed>0&&targetQty===0)throw Error('Check the totals; use no more than 1,000,000 ml or grams.');
  return {unit:container.unit,ownedQty,targetQty,packQuantity:container.quantity,packUnit:container.unit,packReviewed:true};
 }
 function defaultsFor(item={}){
  const empty={remaining:'',capacity:'',capacityUnit:'ml',neededContainers:''};
  if(item.packReviewed!==true)return empty;
  let container;try{container=measure(item.packQuantity,item.packUnit);}catch{return empty;}
  const value={...empty,capacity:String(container.quantity),capacityUnit:container.unit};
  const storedUnit=String(item.unit||'').toLowerCase(),factor=storedUnit==='l'||storedUnit==='kg'?1000:1,base=storedUnit==='l'?'ml':storedUnit==='kg'?'g':storedUnit;
  if(base!==container.unit)return value;
  const owned=item.ownedQty??(item.owned?item.qty:0),needed=item.targetQty??item.qty;
  if(typeof owned==='number'&&Number.isFinite(owned)&&owned>=0&&owned*factor<=MAX)value.remaining=String(owned*factor/container.quantity);
  if(typeof needed==='number'&&Number.isFinite(needed)&&needed>=0&&needed*factor<=MAX)value.neededContainers=String(needed*factor/container.quantity);
  return value;
 }
 function install(win){
  const doc=win.document;
  function decorate(container){
   if(!container)return;
   const host=()=>win.BBHomeHost;
   for(const control of container.querySelectorAll('[data-bb307-skip]')){
    const id=control.dataset.bb307Skip,row=control.closest('.bb16-essential-row');if(!id||!row||row.querySelector('.bb-household-amount'))continue;
    const item=host()?.household?.().find(value=>value.id===id);if(!item)continue;
    const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
    const details=make('details','bb-household-amount'),summary=make('summary','','Enter part of a bottle or pack');details.append(summary);
    const copy=make('p','bb-household-amount-help','For liquids or powders, enter the amount left and the full size shown on the container. For example, 0.5 of a 750 ml bottle means 375 ml at home.');details.append(copy);
    const form=make('form','bb-household-amount-form'),fields=make('div','bb-home-quantities'),inputs={};form.append(fields);
    for(const [key,title,placeholder,positive]of [['remaining','Containers remaining','e.g. 0.5',false],['capacity','Full container size','e.g. 750',true],['neededContainers','Total containers needed','e.g. 2',false]]){
     const label=make('label','',title),input=make('input');input.type='number';input.min=positive?'0.000001':'0';input.max=String(MAX);input.step='any';input.inputMode='decimal';input.required=true;input.placeholder=placeholder;input.setAttribute('aria-label',title+' for '+item.name);inputs[key]=input;label.append(input);fields.append(label);
    }
    const unitLabel=make('label','','Container size unit'),unit=make('select');unit.setAttribute('aria-label','Container size unit for '+item.name);
    for(const [value,title]of [['ml','ml'],['g','g'],['l','litres'],['kg','kg']]){const option=make('option','',title);option.value=value;unit.append(option);}inputs.capacityUnit=unit;unit.value='ml';unitLabel.append(unit);fields.append(unitLabel);
    const preview=make('output','bb-household-amount-preview');preview.setAttribute('aria-live','polite');fields.append(preview);
    const save=make('button','btn primary','Save amount'),status=make('p','bb-household-amount-status');save.type='submit';status.setAttribute('role','status');form.append(save,status);details.append(form);row.append(details);
    let pin=null,loaded=false,busy=false,done=false,needsRefresh=false;
    function value(){return prepare(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])));}
    function draw(){
     try{const patch=value();preview.textContent=patch.ownedQty+' '+patch.unit+' already at home · '+patch.targetQty+' '+patch.unit+' total needed';save.disabled=busy||done||needsRefresh;return patch;}
     catch(error){preview.textContent='Enter all amounts and the full container size. Unknown sizes stay unchanged.';save.disabled=true;return null;}
    }
    function initialise(){
     try{
      if(typeof host()?.householdAmountContext!=='function'||typeof host()?.saveHouseholdAmount!=='function')throw Error('Household amount editing is still loading. Reopen this section to try again.');
      const latest=host().household().find(value=>value.id===id);if(!latest)throw Error('This household item changed. Reopen Weekly essentials.');
      pin=host().householdAmountContext();if(!pin||typeof pin.actor!=='string'||typeof pin.session!=='string'&&pin.session!==null||typeof pin.features!=='string'&&pin.features!==null)throw Error('Review your account and household amounts before saving.');
      const defaults=defaultsFor(latest);for(const [key,input]of Object.entries(inputs))input.value=defaults[key];
      loaded=true;needsRefresh=false;status.textContent='This changes the amount at home and its target, without recording a purchase.';draw();
     }catch(error){pin=null;loaded=false;save.disabled=true;status.textContent=error.message||'Review this item in Weekly essentials.';}
    }
    details.addEventListener('toggle',()=>{if(details.open&&!busy&&!done&&(!loaded||needsRefresh))initialise();});
    form.addEventListener('input',draw);form.addEventListener('change',draw);
    form.addEventListener('submit',async event=>{
     event.preventDefault();if(busy||done)return;if(needsRefresh){status.textContent='Close and reopen this amount editor to review the latest values.';return;}if(!loaded){initialise();if(!loaded)return;}
     let patch;try{patch=value();}catch(error){status.textContent=error.message;draw();return;}
     busy=true;save.disabled=true;form.setAttribute('aria-busy','true');for(const input of Object.values(inputs))input.disabled=true;status.textContent='Saving the reviewed household amount…';
     try{
      const result=await host().saveHouseholdAmount(id,patch,pin);
      if(result?.ok!==true)throw Error(result?.message||'The amount could not be confirmed. Reopen this item to review it.');
      done=true;save.textContent='Amount saved';status.textContent=result.message||'Amount saved. Matching measured purchases can now add to this balance.';
     }catch(error){needsRefresh=true;status.textContent=error.message||'Review the latest household amounts before trying again.';}
     finally{busy=false;form.removeAttribute('aria-busy');for(const input of Object.values(inputs))input.disabled=done;draw();}
    });
    initialise();
   }
  }
  return Object.freeze({decorate,prepare,defaultsFor});
 }
 return Object.freeze({prepare,defaultsFor,install});
});
