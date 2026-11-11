/* Reviewed receipt prices and optional restocking. The host owns one atomic save. */
(function(root){'use strict';
 const currency=market=>market==='US'?'USD':['UK','Jersey','Guernsey'].includes(market)?'GBP':null;
 function displayQuantityText(value,market){
  const source=typeof value==='string'?value:'';
  const shared=root.BBShopPurchaseUI?.formatDisplayQuantityText;if(typeof shared==='function')return shared(source,{market,countMode:'balance'});
  return source.replace(/(^|[^\p{L}\p{N}_.-])((?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*(kg|ml|g|l|each|cloves?|packs?|tins?|cans?|bags?|bunch(?:es)?|bottles?|jars?|rolls?|items?|slices?|loaves?|tbsp|tsp|cups?|pints?|oz|lb)\b/giu,(original,prefix,raw,unit)=>{
   const amount=Number(raw);if(!Number.isFinite(amount)||amount<0)return original;const whole=['g','ml'].includes(unit.toLowerCase()),small=whole?1:.1;
   return prefix+(amount>0&&amount<small?'<'+small:new Intl.NumberFormat(market==='US'?'en-US':'en-GB',{maximumFractionDigits:whole?0:1,useGrouping:false}).format(amount))+' '+unit;
  });
 }
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
 function boughtAmount(quantity,unit){
  if(root.BBReceiptQuantity?.measured)return root.BBReceiptQuantity.measured(quantity,unit);
  const value=normalizedPack(quantity,unit);
  return value&&value.quantity<=1000000&&(!['each','clove','tin','can','pack','bag','bunch'].includes(value.unit)||Number.isInteger(value.quantity))?value:null;
 }
 async function receiptIdentity(photo){
  if(!root.crypto?.subtle||typeof root.TextEncoder!=='function')return null;
  const digest=await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(photo.mimeType+'|'+photo.imageBase64));
  return 'legacy-'+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
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
 function receiptDraft(result,{items,market,shoppingItems=[],catalog=root.BBPriceV19?.catalog}={}){
  if(!result||typeof result!=='object'||!Array.isArray(result.items)||result.currency!==currency(market))return {rows:[],unmatched:result?.items?.length||0,message:'The receipt currency could not be matched. Enter prices manually instead.'};
  const expected=new Map(items.map(item=>[item.key,item])),seen=new Set(),rows=[];
  for(const line of result.items.slice(0,40)){
   const item=expected.get(line?.ingredientKey);if(!item||seen.has(line.ingredientKey))continue;
   seen.add(line.ingredientKey);
   const pack=normalizedPack(line.packQuantity,line.packUnit),guide=normalizedPack(item.packQuantity,item.unit);
   const packUnverified=line.packQuantity==null||line.packUnit==='unknown';
   if(!guide||!packUnverified&&(!pack||pack.unit!==guide.unit||Math.abs(pack.quantity-guide.quantity)>Math.max(.000001,guide.quantity*.000001)))continue;
   const price=line.confidence!=='low'&&typeof line.price==='number'&&Number.isFinite(line.price)&&line.price>=.01&&line.price<=10000?Math.round((line.price+Number.EPSILON)*100)/100:null;
   const inferred=root.BBReceiptQuantity?.infer?.({description:line.name,canonicalKey:item.key,classification:item.classification||'food',packQuantity:line.packQuantity,packUnit:line.packUnit},{market,shoppingItems,catalog})||
    (guide?{quantity:guide.quantity,unit:guide.unit,estimated:packUnverified,note:packUnverified?'Estimated guide pack — check the amount bought.':'Pack amount read from receipt; check the number bought.'}:null);
   rows.push({key:item.key,name:item.name,classification:item.classification==='essential'?'essential':'food',brand:typeof line.brand==='string'?line.brand.trim().slice(0,80):'',price,
    reducedSuggested:item.classification!=='essential'&&/\b(?:reduced(?:[ -]to[ -]clear)?|yellow[ -]stickers?|clearance|mark(?:ed)?[ -]down|markdown)\b/i.test(String(line.name||line.description||'').replace(/\breduced[ -]+(?:fat|salt|sodium|sugar|calories?|carbs?|cholesterol)\b|\b(?:fat|salt|sodium|sugar|calories?|carbs?|cholesterol)[ -]+reduced\b/ig,'')),priceType:line.priceType==='promotion'?'promotion':'unknown',
    packQuantity:item.packQuantity,unit:item.unit,confidence:['high','medium','low'].includes(line.confidence)?line.confidence:'low',
    boughtQuantity:inferred?.quantity??null,boughtUnit:inferred?.unit||'',quantitySource:inferred?.source||'guide-pack',quantityEstimated:inferred?.estimated!==false,quantityNote:inferred?.note||'Check the amount bought before adding it to At home.',
    packUnverified,notes:(packUnverified?'Pack size was not read from the receipt. Check it against the product before selecting this row. ':'')+(typeof line.notes==='string'?line.notes.slice(0,500):'')});
  }
  const purchasedAt=typeof result.purchasedAt==='string'&&result.purchasedAt.length<=50&&Number.isFinite(Date.parse(result.purchasedAt))?result.purchasedAt:null;
  return {rows,purchasedAt,unmatched:result.items.length-rows.length,message:rows.length?'Check each product, price and pack size before selecting it to save.':'No products had a clear matching pack size. You can still save your usual prices manually.'};
 }
 async function readReceipt({file,items,market,signal,preparePhoto=resizedPhoto,shoppingItems=[],catalog=root.BBPriceV19?.catalog}){
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
  const id=await receiptIdentity(photo);if(signal?.aborted)throw Error('Receipt scan cancelled.');
  if(accessToken()!==token)throw Error('Account changed. Please try again.');
  return {...receiptDraft(data.receiptPrices,{items,market,shoppingItems,catalog}),receiptId:id};
 }
 function openReceipt({items,market,retailer=null,shopSessionId=null,getShoppingItems,onSaveReviewedReceipt,onSaved}={}){
  const doc=root.document;if(!doc||!Array.isArray(items))return;
  const contexts=items.filter(item=>item&&typeof item.key==='string'&&typeof item.name==='string'&&normalizedPack(item.packQuantity,item.unit)).slice(0,100)
   .filter((item,index,array)=>array.findIndex(other=>other.key===item.key)===index)
   .map(item=>({key:item.key,name:item.name,unit:item.unit,packQuantity:Number(item.packQuantity),classification:item.classification==='essential'?'essential':'food'}));
  const prior=doc.getElementById('bb-receipt-prices');if(prior){prior.close?.();prior.remove();}
  const dialog=doc.createElement('dialog');dialog.id='bb-receipt-prices';dialog.setAttribute('aria-labelledby','bb-receipt-prices-title');
  dialog.style.cssText='box-sizing:border-box;width:min(94vw,560px);max-height:90dvh;overflow:auto;padding:20px;border:1px solid #bbd0c1;border-radius:16px;background:#fff;color:#173c2b';
  const title=doc.createElement('h2');title.id='bb-receipt-prices-title';title.textContent='Learn prices from your receipt';
  const helper=doc.createElement('p');helper.textContent='Review prices for '+(retailer||'your selected region')+' in '+market+', and check the amount bought. Selected items can save your usual prices, restock At home and mark matching items bought on your current list.';
  const photoLabel=doc.createElement('label');photoLabel.textContent='Take or choose receipt photo';
  const photo=doc.createElement('input');photo.type='file';photo.accept='image/*';photo.setAttribute('capture','environment');photoLabel.append(photo);
  const consent=doc.createElement('p');consent.style.fontSize='12px';consent.textContent='Tapping Scan sends the resized photo to Google Gemini. Crop out personal and payment details where possible. Review every suggested price before saving.';
  const scan=doc.createElement('button');scan.type='button';scan.className='btn';scan.textContent='Scan receipt';scan.disabled=true;
  const message=doc.createElement('p');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const form=doc.createElement('form'),rowsBox=doc.createElement('div');
  const stockLabel=doc.createElement('label'),stock=doc.createElement('input');stock.type='checkbox';stock.checked=true;stock.dataset.bbReceiptStockToggle='true';stockLabel.className='bb-receipt-restock-toggle';stockLabel.append(stock,doc.createTextNode(' Also add bought items & essentials to At Home pantry'));
  const save=doc.createElement('button');save.type='submit';save.className='btn primary';save.textContent='Save reviewed receipt';save.disabled=true;
  const close=doc.createElement('button');close.type='button';close.className='btn';close.textContent='Done';close.addEventListener('click',()=>dialog.close());
  const style=doc.createElement('style');style.textContent='#bb-receipt-prices{font:14px/1.5 system-ui,sans-serif}#bb-receipt-prices h2{font-size:22px;line-height:1.3;margin:0 0 14px}#bb-receipt-prices label{display:block;margin:10px 0}#bb-receipt-prices input:not([type=checkbox]){box-sizing:border-box;width:100%;min-height:44px;padding:9px 10px;border:1px solid #b9ccbf;border-radius:9px;background:#fff;color:#173c2b;font:inherit}#bb-receipt-prices input[type=checkbox]{width:18px;height:18px;vertical-align:middle;margin:0 8px 0 0;accent-color:#16623e}#bb-receipt-prices button{min-height:44px;padding:10px 14px;border:1px solid #b9ccbf;border-radius:10px;margin:5px 8px 5px 0;background:#f3f8f2;color:#173c2b;font:600 14px system-ui;cursor:pointer}#bb-receipt-prices button.primary{background:#16623e;color:white;border-color:#16623e}#bb-receipt-prices button:disabled{opacity:.5;cursor:default}#bb-receipt-prices :focus-visible{outline:3px solid #268252;outline-offset:2px}#bb-receipt-prices fieldset p{font-size:13px;color:#526758}#bb-receipt-prices select{box-sizing:border-box;width:100%;min-height:44px;padding:9px 10px;border:1px solid #b9ccbf;border-radius:9px;background:#fff;color:#173c2b;font:inherit}#bb-receipt-prices .bb-receipt-restock-toggle{padding:12px;border:1px solid #c4d8c8;border-radius:10px;background:#f3f8ee}';
  form.append(stockLabel,rowsBox,save);dialog.append(style,title,helper,photoLabel,consent,scan,message,form,close);doc.body.append(dialog);
  let revision=0,busy=false,controller=null,rows=[],reviewToken=null,reviewReceiptId=null,reviewPurchasedAt=null;const openingToken=accessToken();
  const contextCurrent=()=>accessToken()===openingToken&&
   (typeof root.bb307ActiveMarket!=='function'||root.bb307ActiveMarket()===market)&&
   (typeof root.bb307ActiveRetailer!=='function'||(root.bb307ActiveRetailer()||null)===retailer);
  const selected=()=>rows.filter(row=>row.check.checked);
  const updateSave=()=>{save.disabled=busy||!selected().length;};
  photo.addEventListener('change',()=>{revision++;controller?.abort();rows=[];reviewToken=null;reviewReceiptId=null;rowsBox.replaceChildren();updateSave();scan.disabled=!photo.files?.[0]||!contexts.length;message.textContent=photo.files?.[0]?'Photo ready. Tap Scan receipt to review prices and bought quantities.':'';});
  dialog.addEventListener('close',()=>{revision++;controller?.abort();photo.value='';dialog.remove();});
  scan.addEventListener('click',async()=>{
   if(busy||!photo.files?.[0])return;
   if(!contextCurrent()){message.textContent='Your region or supermarket changed. Reopen the receipt scanner.';return;}
   const id=++revision;busy=true;scan.disabled=true;save.disabled=true;message.textContent='Reading matching products and prices…';
   controller=new AbortController();const stop=root.setTimeout(()=>controller.abort(),35000);
   try{
    const draft=await readReceipt({file:photo.files[0],items:contexts,market,signal:controller.signal,shoppingItems:typeof getShoppingItems==='function'?getShoppingItems():items});
    if(id!==revision||!dialog.isConnected||!contextCurrent())return;
    rows=[];reviewToken=accessToken();reviewReceiptId=draft.receiptId;reviewPurchasedAt=draft.purchasedAt;rowsBox.replaceChildren();message.textContent=draft.message+(draft.unmatched?' '+draft.unmatched+' unclear or different-pack item(s) were left out.':'');
    for(const value of draft.rows){
     const field=doc.createElement('fieldset');field.style.cssText='margin:12px 0;padding:12px;min-width:0;border:1px solid #dce7df;border-radius:10px';
     const legend=doc.createElement('legend');legend.textContent=value.name;
     const product=doc.createElement('p');product.textContent=displayQuantityText('Guide pack: '+value.packQuantity+' '+value.unit+'. Confidence: '+value.confidence+'. '+value.notes,market);
     const brandLabel=doc.createElement('label');brandLabel.textContent='Brand (optional)';const brand=doc.createElement('input');brand.type='text';brand.maxLength=80;brand.value=value.brand;brand.style.width='100%';brandLabel.append(brand);
     const priceLabel=doc.createElement('label'),priceTitle=doc.createElement('span');priceTitle.textContent='Price for one guide pack ('+currency(market)+')';priceLabel.append(priceTitle);const price=doc.createElement('input');price.type='number';price.min='.01';price.max='10000';price.step='.01';price.value=value.price===null?'':value.price.toFixed(2);price.style.width='100%';priceLabel.append(price);
     let reduced=null,reducedLabel=null;
     if(value.classification==='food'&&root.BBReducedFoodHost?.isPremium?.()===true){reduced=doc.createElement('input');reduced.type='checkbox';reduced.checked=value.reducedSuggested===true;reduced.dataset.bbReceiptReduced=value.key;reducedLabel=doc.createElement('label');reducedLabel.append(reduced,doc.createTextNode('🏷️ Reduced food · Use soon'));const showReduced=()=>{priceTitle.textContent=(reduced.checked?'Actual total paid for this bought amount':'Price for one guide pack')+' ('+currency(market)+')';};reduced.addEventListener('change',()=>{check.checked=false;showReduced();updateSave();});showReduced();}
     const quantityLabel=doc.createElement('label');quantityLabel.textContent='Total amount bought';const quantity=doc.createElement('input');quantity.type='number';quantity.min='.001';quantity.max='1000000';quantity.step='any';quantity.value=value.boughtQuantity===null?'':String(value.boughtQuantity);quantity.dataset.bbReceiptBoughtQuantity=value.key;quantityLabel.append(quantity);
     const unitLabel=doc.createElement('label');unitLabel.textContent='Unit';const unit=doc.createElement('select');unit.dataset.bbReceiptBoughtUnit=value.key;
     for(const label of ['g','kg','ml','l','each','clove','bulb','tin','pack','bag','bunch','loaf','slice','tsp','tbsp']){const option=doc.createElement('option');option.value=label;option.textContent=label;unit.append(option);}unit.value=value.boughtUnit||value.unit;unitLabel.append(unit);
     const quantityNote=doc.createElement('p');quantityNote.className='bb-receipt-quantity-note';quantityNote.textContent=displayQuantityText(value.quantityNote,market);
     const confirm=doc.createElement('label');const check=doc.createElement('input');check.type='checkbox';check.dataset.bbReceiptReviewRow=value.key;confirm.append(check,doc.createTextNode(' I checked this product, price, guide pack and amount bought. Save this item.'));
     check.addEventListener('change',updateSave);field.append(legend,product,brandLabel,priceLabel,...(reducedLabel?[reducedLabel]:[]),quantityLabel,unitLabel,quantityNote,confirm);rowsBox.append(field);rows.push({value,brand,price,quantity,unit,check,reduced});
    }
   }catch(error){if(id===revision&&dialog.isConnected)message.textContent=controller.signal.aborted?'Receipt scan cancelled or timed out. No prices were saved.':String(error.message||'Receipt scan unavailable.');}
   finally{root.clearTimeout(stop);busy=false;scan.disabled=!photo.files?.[0]||!contexts.length;updateSave();}
  });
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy||!selected().length)return;
   if(!contextCurrent()||reviewToken!==accessToken()){message.textContent='Your account, region or supermarket changed. Reopen the receipt scanner.';return;}
   const chosen=selected();
   if(chosen.some(row=>row.reduced?.checked)&&root.BBReducedFoodHost?.isPremium?.()!==true){message.textContent='Refresh your Premium membership, or turn off Reduced food before saving.';return;}
   if(chosen.some(row=>row.reduced?.checked)&&typeof onSaveReviewedReceipt!=='function'){message.textContent='Open Scan receipt from Shop to save reduced-food prices without changing your usual prices.';return;}
   if(chosen.some(row=>!Number.isFinite(Number(row.price.value))||Number(row.price.value)<.01||Number(row.price.value)>10000||row.brand.value.trim().length>80)){
    message.textContent='Check the selected brands and positive full-pack prices before saving.';return;
   }
   if(stock.checked&&chosen.some(row=>!boughtAmount(row.quantity.value,row.unit.value))){message.textContent='Check a positive bought quantity and compatible unit for every selected item.';return;}
   if(stock.checked&&(!reviewReceiptId||typeof onSaveReviewedReceipt!=='function')){message.textContent='Pantry restocking is unavailable in this view. Reopen Scan receipt from Shop, or untick the pantry option to save prices only.';return;}
   let saved=0;
   busy=true;scan.disabled=true;updateSave();
   try{
    if(typeof onSaveReviewedReceipt==='function'){
     const serial=revision,packet={receiptId:reviewReceiptId,stockPantry:stock.checked,market,retailer,shopSessionId,purchasedAt:reviewPurchasedAt,
      items:chosen.map(row=>{const bought=boughtAmount(row.quantity.value,row.unit.value);return {key:row.value.key,name:row.value.name,classification:row.value.classification,quantity:bought?.quantity??null,unit:bought?.unit||null,guidePackQuantity:row.value.packQuantity,guidePackUnit:row.value.unit,price:Number(row.price.value),brand:row.brand.value.trim(),reduced:row.reduced?.checked===true,priceType:row.reduced?.checked===true?'promotion':row.value.priceType};}),
      priceUpdates:chosen.filter(row=>!row.reduced?.checked&&row.value.priceType!=='promotion').map(row=>({name:row.value.key,unit:row.value.unit,market,retailer,price:Number(row.price.value),brand:row.brand.value.trim()}))};
     const result=await onSaveReviewedReceipt(packet);
     if(serial!==revision||!dialog.isConnected||!contextCurrent())return;
     if(result?.ok!==true)throw Error(result?.message||'The reviewed receipt could not be saved. Your quantities are kept for retry.');
     saved=Number.isSafeInteger(result.saved)?result.saved:chosen.length;
     if(typeof onSaved==='function')onSaved(saved,result);dialog.close();return;
    }
    for(const row of chosen){if(row.value.priceType==='promotion')continue;root.BBPriceV19.setPriceOverride({name:row.value.key,unit:row.value.unit,market,retailer,price:Number(row.price.value),brand:row.brand.value});row.check.checked=false;saved++;}
    message.textContent=saved+' usual price'+(saved===1?'':'s')+' saved for future estimates on this device.';updateSave();if(typeof onSaved==='function')onSaved(saved);
   }catch(error){message.textContent=(saved?saved+' price(s) saved. ':'')+String(error.message||'Could not save prices.');if(saved&&typeof onSaved==='function')onSaved(saved);}
   finally{busy=false;scan.disabled=!photo.files?.[0]||!contexts.length;updateSave();}
  });
  if(!contexts.length)message.textContent='There are no recognised grocery packs in this shopping list to match. You can save usual prices manually.';
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  return dialog;
 }
 root.BBPriceScan=Object.freeze({normalizedPack,receiptDraft,readReceipt,openReceipt});
})(typeof window!=='undefined'?window:globalThis);
