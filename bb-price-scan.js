/* Optional label/receipt reader. Only fills a draft; the existing Save owns persistence. */
(function(root){'use strict';
 const currency=market=>market==='US'?'USD':['UK','Jersey','Guernsey'].includes(market)?'GBP':null;
 function accessToken(){
  try{const value=JSON.parse(root.localStorage?.getItem('basketboss_cloud_session_v1')||'null');
   return typeof value?.access_token==='string'&&Number(value.expires_at)*1000>Date.now()+5000?value.access_token:null;
  }catch(_){return null;}
 }
 function normalizedPack(quantity,unit){
  const n=Number(quantity);if(quantity==null||!Number.isFinite(n)||n<=0)return null;
  if(unit==='kg')return {quantity:n*1000,unit:'g'};
  if(unit==='l')return {quantity:n*1000,unit:'ml'};
  return ['g','ml','each','clove','tin','can','pack','bag','bunch'].includes(unit)?{quantity:n,unit}:null;
 }
 async function resizedPhoto(file){
  if(!file||!String(file.type||'').startsWith('image/')||file.size>12*1024*1024)throw Error('Choose an image under 12 MB.');
  const bitmap=await root.createImageBitmap(file);
  try{
   if(!bitmap.width||!bitmap.height)throw Error('The image could not be read.');
   const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));
   const canvas=root.document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   const imageBase64=canvas.toDataURL('image/jpeg',.8).split(',')[1];
   if(!imageBase64||imageBase64.length>2500000)throw Error('The image is still too large. Try a closer crop.');
   return {mimeType:'image/jpeg',imageBase64};
  }finally{bitmap.close?.();}
 }
 function receiptDraft(result,{items,market}){
  if(!result||typeof result!=='object'||!Array.isArray(result.items)||result.currency!==currency(market))return {rows:[],unmatched:result?.items?.length||0,message:'The receipt currency could not be matched. Enter prices manually instead.'};
  const expected=new Map(items.map(item=>[item.key,item])),seen=new Set(),rows=[];
  for(const line of result.items.slice(0,40)){
   const item=expected.get(line?.ingredientKey);if(!item||seen.has(line.ingredientKey))continue;
   seen.add(line.ingredientKey);
   const pack=normalizedPack(line.packQuantity,line.packUnit),guide=normalizedPack(item.packQuantity,item.unit);
   const packUnverified=line.packQuantity==null||line.packUnit==='unknown';
   if(!guide||!packUnverified&&(!pack||pack.unit!==guide.unit||Math.abs(pack.quantity-guide.quantity)>Math.max(.000001,guide.quantity*.000001)))continue;
   const price=line.confidence!=='low'&&typeof line.price==='number'&&Number.isFinite(line.price)&&line.price>=.01&&line.price<=10000?Math.round((line.price+Number.EPSILON)*100)/100:null;
   rows.push({key:item.key,name:item.name,brand:typeof line.brand==='string'?line.brand.trim().slice(0,80):'',price,
    packQuantity:item.packQuantity,unit:item.unit,confidence:['high','medium','low'].includes(line.confidence)?line.confidence:'low',
    packUnverified,notes:(packUnverified?'Pack size was not read from the receipt. Check it against the product before selecting this row. ':'')+(typeof line.notes==='string'?line.notes.slice(0,500):'')});
  }
  return {rows,unmatched:result.items.length-rows.length,message:rows.length?'Check each product, price and pack size before selecting it to save.':'No products had a clear matching pack size. You can still save your usual prices manually.'};
 }
 async function readReceipt({file,items,market,signal,preparePhoto=resizedPhoto}){
  const token=accessToken();if(!token)throw Error('Sign in to a verified Premium account to scan, or enter your usual prices manually.');
  const expectedCurrency=currency(market);if(!expectedCurrency)throw Error('Choose a supported shopping region first.');
  const response=await root.fetch('/api/bb173/status',{headers:{Accept:'application/json',Authorization:'Bearer '+token},cache:'no-store',credentials:'same-origin',redirect:'manual',signal});
  const status=await response.json().catch(()=>({}));
  if(accessToken()!==token)throw Error('Account changed. Please try again.');
  if(!response.ok||status.premium_ai!==true)throw Error('Receipt scanning is unavailable for this account. You can still save prices manually.');
  if(status.turnstileRequired!==false)throw Error('Receipt price scanning is unavailable in this preview. You can still save prices manually.');
  const photo=await preparePhoto(file);if(signal?.aborted)throw Error('Receipt scan cancelled.');
  if(accessToken()!==token)throw Error('Account changed. Please try again.');
  const res=await root.fetch('/api/bb173/scan',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
   body:JSON.stringify({...photo,scanKind:'receipt_prices',expectedCurrency,items,turnstileToken:''}),cache:'no-store',credentials:'same-origin',redirect:'manual',signal});
  const data=await res.json().catch(()=>({}));
  if(accessToken()!==token)throw Error('Account changed. Please try again.');
  if(!res.ok)throw Error(String(data.error||'Receipt scan unavailable. You can still save prices manually.').slice(0,200));
  if(data.ok!==true||data.reviewRequired!==true||!data.receiptPrices)throw Error('The receipt result is not ready for review.');
  return receiptDraft(data.receiptPrices,{items,market});
 }
 function openReceipt({items,market,retailer=null,onSaved}={}){
  const doc=root.document;if(!doc||!Array.isArray(items))return;
  const contexts=items.filter(item=>item&&typeof item.key==='string'&&typeof item.name==='string'&&normalizedPack(item.packQuantity,item.unit)).slice(0,100)
   .filter((item,index,array)=>array.findIndex(other=>other.key===item.key)===index)
   .map(item=>({key:item.key,name:item.name,unit:item.unit,packQuantity:Number(item.packQuantity)}));
  const prior=doc.getElementById('bb-receipt-prices');if(prior){prior.close?.();prior.remove();}
  const dialog=doc.createElement('dialog');dialog.id='bb-receipt-prices';dialog.setAttribute('aria-labelledby','bb-receipt-prices-title');
  dialog.style.cssText='box-sizing:border-box;width:min(94vw,560px);max-height:90dvh;overflow:auto;padding:20px;border:1px solid #bbd0c1;border-radius:16px;background:#fff;color:#173c2b';
  const title=doc.createElement('h2');title.id='bb-receipt-prices-title';title.textContent='Learn prices from your receipt';
  const helper=doc.createElement('p');helper.textContent='Optional Premium scan. Prices you review here will be remembered for '+(retailer||'your selected region')+' in '+market+' on this device. Check the receipt is from that shop. Your shopping progress and Kitchen stock stay as they are.';
  const photoLabel=doc.createElement('label');photoLabel.textContent='Take or choose receipt photo';
  const photo=doc.createElement('input');photo.type='file';photo.accept='image/*';photo.setAttribute('capture','environment');photoLabel.append(photo);
  const consent=doc.createElement('p');consent.style.fontSize='12px';consent.textContent='Tapping Scan sends the resized photo to Google Gemini. Crop out personal and payment details where possible. Review every suggested price before saving.';
  const scan=doc.createElement('button');scan.type='button';scan.className='btn';scan.textContent='Scan receipt';scan.disabled=true;
  const message=doc.createElement('p');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const form=doc.createElement('form'),rowsBox=doc.createElement('div');
  const save=doc.createElement('button');save.type='submit';save.className='btn primary';save.textContent='Save reviewed prices';save.disabled=true;
  const close=doc.createElement('button');close.type='button';close.className='btn';close.textContent='Done';close.addEventListener('click',()=>dialog.close());
  const style=doc.createElement('style');style.textContent='#bb-receipt-prices{font:14px/1.5 system-ui,sans-serif}#bb-receipt-prices h2{font-size:22px;line-height:1.3;margin:0 0 14px}#bb-receipt-prices label{display:block;margin:10px 0}#bb-receipt-prices input:not([type=checkbox]){box-sizing:border-box;width:100%;min-height:44px;padding:9px 10px;border:1px solid #b9ccbf;border-radius:9px;background:#fff;color:#173c2b;font:inherit}#bb-receipt-prices input[type=checkbox]{width:18px;height:18px;vertical-align:middle;margin:0 8px 0 0;accent-color:#16623e}#bb-receipt-prices button{min-height:44px;padding:10px 14px;border:1px solid #b9ccbf;border-radius:10px;margin:5px 8px 5px 0;background:#f3f8f2;color:#173c2b;font:600 14px system-ui;cursor:pointer}#bb-receipt-prices button.primary{background:#16623e;color:white;border-color:#16623e}#bb-receipt-prices button:disabled{opacity:.5;cursor:default}#bb-receipt-prices :focus-visible{outline:3px solid #268252;outline-offset:2px}#bb-receipt-prices fieldset p{font-size:13px;color:#526758}';
  form.append(rowsBox,save);dialog.append(style,title,helper,photoLabel,consent,scan,message,form,close);doc.body.append(dialog);
  let revision=0,busy=false,controller=null,rows=[],reviewToken=null;const openingToken=accessToken();
  const contextCurrent=()=>accessToken()===openingToken&&
   (typeof root.bb307ActiveMarket!=='function'||root.bb307ActiveMarket()===market)&&
   (typeof root.bb307ActiveRetailer!=='function'||(root.bb307ActiveRetailer()||null)===retailer);
  const selected=()=>rows.filter(row=>row.check.checked);
  const updateSave=()=>{save.disabled=busy||!selected().length;};
  photo.addEventListener('change',()=>{revision++;controller?.abort();rows=[];reviewToken=null;rowsBox.replaceChildren();updateSave();scan.disabled=!photo.files?.[0]||!contexts.length;message.textContent=photo.files?.[0]?'Photo ready. Tap Scan receipt to review prices.':'';});
  dialog.addEventListener('close',()=>{revision++;controller?.abort();photo.value='';dialog.remove();});
  scan.addEventListener('click',async()=>{
   if(busy||!photo.files?.[0])return;
   if(!contextCurrent()){message.textContent='Your region or supermarket changed. Reopen the receipt scanner.';return;}
   const id=++revision;busy=true;scan.disabled=true;save.disabled=true;message.textContent='Reading matching products and prices…';
   controller=new AbortController();const stop=root.setTimeout(()=>controller.abort(),35000);
   try{
    const draft=await readReceipt({file:photo.files[0],items:contexts,market,signal:controller.signal});
    if(id!==revision||!dialog.isConnected||!contextCurrent())return;
    rows=[];reviewToken=accessToken();rowsBox.replaceChildren();message.textContent=draft.message+(draft.unmatched?' '+draft.unmatched+' unclear or different-pack item(s) were left out.':'');
    for(const value of draft.rows){
     const field=doc.createElement('fieldset');field.style.cssText='margin:12px 0;padding:12px;min-width:0;border:1px solid #dce7df;border-radius:10px';
     const legend=doc.createElement('legend');legend.textContent=value.name;
     const product=doc.createElement('p');product.textContent='Guide pack: '+value.packQuantity+' '+value.unit+'. Confidence: '+value.confidence+'. '+value.notes;
     const brandLabel=doc.createElement('label');brandLabel.textContent='Brand (optional)';const brand=doc.createElement('input');brand.type='text';brand.maxLength=80;brand.value=value.brand;brand.style.width='100%';brandLabel.append(brand);
     const priceLabel=doc.createElement('label');priceLabel.textContent='Price for one guide pack ('+currency(market)+')';const price=doc.createElement('input');price.type='number';price.min='.01';price.max='10000';price.step='.01';price.value=value.price===null?'':value.price.toFixed(2);price.style.width='100%';priceLabel.append(price);
     const confirm=doc.createElement('label');const check=doc.createElement('input');check.type='checkbox';confirm.append(check,doc.createTextNode(' I checked this product, price and pack size. Remember it.'));
     check.addEventListener('change',updateSave);field.append(legend,product,brandLabel,priceLabel,confirm);rowsBox.append(field);rows.push({value,brand,price,check});
    }
   }catch(error){if(id===revision&&dialog.isConnected)message.textContent=controller.signal.aborted?'Receipt scan cancelled or timed out. No prices were saved.':String(error.message||'Receipt scan unavailable.');}
   finally{root.clearTimeout(stop);busy=false;scan.disabled=!photo.files?.[0]||!contexts.length;updateSave();}
  });
  form.addEventListener('submit',event=>{
   event.preventDefault();if(busy||!selected().length)return;
   if(!contextCurrent()||reviewToken!==accessToken()){message.textContent='Your account, region or supermarket changed. Reopen the receipt scanner.';return;}
   const chosen=selected();
   if(chosen.some(row=>!Number.isFinite(Number(row.price.value))||Number(row.price.value)<.01||Number(row.price.value)>10000||row.brand.value.trim().length>80)){
    message.textContent='Check the selected brands and positive full-pack prices before saving.';return;
   }
   let saved=0;
   try{
    for(const row of chosen){root.BBPriceV19.setPriceOverride({name:row.value.key,unit:row.value.unit,market,retailer,price:Number(row.price.value),brand:row.brand.value});row.check.checked=false;saved++;}
    message.textContent=saved+' usual price'+(saved===1?'':'s')+' saved for future estimates on this device.';updateSave();if(typeof onSaved==='function')onSaved(saved);
   }catch(error){message.textContent=(saved?saved+' price(s) saved. ':'')+String(error.message||'Could not save prices.');if(saved&&typeof onSaved==='function')onSaved(saved);}
  });
  if(!contexts.length)message.textContent='There are no recognised grocery packs in this shopping list to match. You can save usual prices manually.';
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  return dialog;
 }
 root.BBPriceScan=Object.freeze({normalizedPack,receiptDraft,readReceipt,openReceipt});
})(typeof window!=='undefined'?window:globalThis);
