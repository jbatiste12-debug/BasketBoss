/* Optional shopping presentation. Plans live apart from pantry, receipts and prices. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.BBShopPurchaseUI=api;root.formatDisplayQty=api.formatDisplayQty;}})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const KEY='basketboss_shop_pack_ui_v1',MAX=1000000,LIMIT=256;
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX;
 const positive=value=>number(value)&&value>0;
 const text=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
 const aliases={grams:'g',gram:'g',millilitres:'ml',milliliters:'ml',millilitre:'ml',milliliter:'ml',kilograms:'kg',kilogram:'kg',litres:'l',liters:'l',litre:'l',liter:'l',units:'each',unit:'each',items:'each',item:'each',pieces:'each',piece:'each',counts:'each',count:'each',packs:'pack',tins:'tin',cans:'can',buns:'bun',bulbs:'bulb',cloves:'clove',bottles:'bottle',jars:'jar',bags:'bag',loaves:'loaf',slices:'slice',rolls:'roll',tubs:'tub',eggs:'egg',fillets:'fillet'};
 const unitOf=value=>{const key=String(value||'').trim().toLowerCase();return aliases[key]||key;};
 const units=new Set(['g','ml','kg','l','each','pack','tin','can','bun','bulb','clove','bottle','jar','bag','loaf','slice','roll','tub','egg','fillet']);
 const plural=value=>({loaf:'loaves'}[value]||value+'s');
 const digits=(value,maximumFractionDigits=1,market='UK')=>new Intl.NumberFormat(market==='US'?'en-US':'en-GB',{maximumFractionDigits,useGrouping:false}).format(value);
 function countValue(value,options={}){
  if(options.countMode==='balance')return value;
  const whole=Math.round(value),half=Math.round(value*2)/2;
  if(Math.abs(value-whole)<1e-9)return whole;
  return Math.abs(value-half)<1e-9?half:Math.ceil(value);
 }
 function formatDisplayQty(value,rawUnit,options={}){
  if(!number(value))return 'Check amount';
  const unit=unitOf(rawUnit),market=options.market||'UK';if(!units.has(unit))return 'Check unit';
  if(['g','ml','kg','l'].includes(unit)){
   const weight=unit==='g'||unit==='kg',base=value*(unit==='kg'||unit==='l'?1000:1),baseUnit=weight?'g':'ml';
   if(base>0&&base<1)return '<1 '+baseUnit;
   const rounded=Math.round(base);
   if(rounded>=1000&&rounded%1000===0&&options.compact!==false)return digits(rounded/1000,0,market)+' '+(weight?'kg':'L');
   return digits(rounded,0,market)+' '+baseUnit;
  }
  const shown=countValue(value,options),label=unit==='each'?'each':shown<=1?unit:plural(unit);
  return (shown>0&&shown<.05?'<0.1':digits(shown,1,market))+' '+label;
 }
 function amount(name,value,rawUnit,options={}){
  const formatted=formatDisplayQty(value,rawUnit,options),unit=unitOf(rawUnit);
  if(!options.noun||unit!=='each'||!number(value))return formatted;
  const food=String(name||'').toLowerCase(),noun=/\bgarlic\b/.test(food)?'clove':/\beggs?\b/.test(food)?'egg':/\brolls?\b/.test(food)?'roll':/\bbuns?\b/.test(food)?'bun':/\btubs?\b/.test(food)?'tub':/\bcans?\b/.test(food)?'can':'item',shown=countValue(value,options);
  return formatted.replace(/ each$/,' '+(shown<=1?noun:plural(noun)));
 }
 function formatDisplayQuantityText(value,options={}){
  if(typeof value!=='string')return '';
  return value.replace(/(^|[^\p{L}\p{N}_.-])((?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*(millilitres?|milliliters?|kilograms?|grams?|litres?|liters?|kg|ml|g|l|each|counts?|cloves?|packs?|tins?|cans?|buns?|bulbs?|rolls?|eggs?|fillets?|bottles?|jars?|bags?|loaves?|slices?|pieces?|items?|tbsp|tsp|cups?|pints?|oz|lb|bunch(?:es)?|cartons?|sachets?|leaves?)\b/giu,(original,prefix,raw,unit)=>{
   const quantity=Number(raw);if(!number(quantity))return original;
   const rendered=formatDisplayQty(quantity,unit,{...options,countMode:'balance'});
   return prefix+(/^Check\b/.test(rendered)?digits(quantity,1,options.market||'UK')+' '+unit:rendered);
  });
 }
 function contextOf(value){
  if(!object(value)||!text(value.actor,200)||!text(value.trip,200)||!text(value.id,240)||!text(value.unit,32))return null;
  const unit=unitOf(value.unit);if(!['g','ml','each'].includes(unit))return null;
  return {actor:value.actor,trip:value.trip,id:value.id,unit};
 }
 function retailProfileOf(value){return object(value)&&text(value.food,80)&&text(value.unitLabel,40)&&positive(value.gramsPerEach)?{food:value.food,unitLabel:value.unitLabel,gramsPerEach:value.gramsPerEach}:null;}
 function retailCountOf(value,selection){
  const profile=retailProfileOf(value);if(!profile||selection.unit!=='g'||!Number.isSafeInteger(value.count)||value.count<1||value.count>MAX||selection.packCount!==value.count||selection.packQuantity!==profile.gramsPerEach)return null;
  return {...profile,count:value.count};
 }
 function selectionOf(value,unit){
  if(!object(value)||!['exact','pack','custom'].includes(value.kind)||unitOf(value.unit)!==unit||!positive(value.packQuantity)||!Number.isSafeInteger(value.packCount)||value.packCount<1||value.packCount>MAX||!positive(value.quantity)||!['pack','tub','bulb'].includes(value.label))return null;
  const total=value.packQuantity*value.packCount;
  if(!positive(total)||Math.abs(total-value.quantity)>Math.max(1e-9,Math.abs(total)*Number.EPSILON*4)||value.boughtQtyOverride!==undefined&&value.boughtQtyOverride!==value.quantity)return null;
  if(value.priceOverride!==undefined&&!number(value.priceOverride))return null;
  const retailCount=value.retailCount===undefined?null:retailCountOf(value.retailCount,value);if(value.retailCount!==undefined&&!retailCount)return null;
  return {kind:value.kind,packQuantity:value.packQuantity,packCount:value.packCount,quantity:value.quantity,unit,label:value.label,boughtQtyOverride:value.quantity,...(value.priceOverride!==undefined?{priceOverride:value.priceOverride}:{}),...(retailCount?{retailCount}:{})};
 }
 const sameContext=(left,right)=>left.actor===right.actor&&left.trip===right.trip&&left.id===right.id&&left.unit===right.unit;
 function plansOf(raw){
  if(raw===null)return [];
  if(typeof raw!=='string'||raw.length>1048576)throw Error('Saved buying choices need checking.');
  const saved=JSON.parse(raw);if(!object(saved)||saved.version!==1||!Array.isArray(saved.plans)||saved.plans.length>LIMIT)throw Error('Saved buying choices need checking.');
  return saved.plans.map(row=>{const context=contextOf(row),selection=context&&selectionOf(row.selection,context.unit);if(!context||!selection)throw Error('Saved buying choices need checking.');return {...context,selection};});
 }
 function readPlan(storage,context){
  try{const checked=contextOf(context);if(!checked)return null;const plans=plansOf(storage.getItem(KEY));for(let index=plans.length-1;index>=0;index--)if(sameContext(plans[index],checked))return {...plans[index].selection};return null;}catch{return null;}
 }
 function writePlan(storage,context,selection){
  const failed=message=>({ok:false,message,rollback:()=>false});
  let oldRaw,newRaw;
  try{
   const checked=contextOf(context),chosen=checked&&selectionOf(selection,checked.unit);if(!checked||!chosen)return failed('Check the buying amount and unit.');
   oldRaw=storage.getItem(KEY);const plans=plansOf(oldRaw).filter(row=>!sameContext(row,checked));plans.push({...checked,selection:chosen});
   newRaw=JSON.stringify({version:1,plans:plans.slice(-LIMIT)});
   if(storage.getItem(KEY)!==oldRaw)return failed('Buying choices changed. Reopen this item.');
   storage.setItem(KEY,newRaw);if(storage.getItem(KEY)!==newRaw)throw Error('Buying choices changed while saving.');
   let undone=false;
   return {ok:true,rollback(){if(undone)return false;try{if(storage.getItem(KEY)!==newRaw)return false;if(oldRaw===null)storage.removeItem(KEY);else storage.setItem(KEY,oldRaw);if(storage.getItem(KEY)!==oldRaw)return false;undone=true;return true;}catch{return false;}}};
  }catch{
   try{if(newRaw!==undefined&&storage.getItem(KEY)===newRaw){if(oldRaw===null)storage.removeItem(KEY);else storage.setItem(KEY,oldRaw);}}catch{}
   return failed('Buying choices could not be saved. Please try again.');
  }
 }
 function buyingLabel(selection,name=''){
  const chosen=selectionOf(selection,unitOf(selection?.unit));if(!chosen)return 'Choose buying amount';
  if(chosen.retailCount)return 'Buying: '+digits(chosen.retailCount.count,0)+' '+(chosen.retailCount.count===1?chosen.retailCount.unitLabel:plural(chosen.retailCount.unitLabel));
  const options={countMode:'balance',noun:true};
  if(chosen.kind!=='pack')return 'Buying: '+amount(name,chosen.quantity,chosen.unit,options);
  if(chosen.label==='bulb')return 'Buying: '+chosen.packCount+' '+(chosen.packCount===1?'bulb':'bulbs');
  if(chosen.unit==='each')return 'Buying: '+(chosen.packCount===1?'':chosen.packCount+' × ')+digits(chosen.packQuantity)+' pk ('+digits(chosen.quantity)+')';
  const size=formatDisplayQty(chosen.packQuantity,chosen.unit,options),container=chosen.label==='tub'?'tub':'pack';
  return 'Buying: '+(chosen.packCount===1?size+' '+container:chosen.packCount+' × '+size+' '+plural(container));
 }
 function estimatePrice(baseEstimatedPrice,defaultBoughtQty,selection){
  if(selection&&Object.hasOwn(selection,'priceOverride'))return number(selection.priceOverride)?selection.priceOverride:null;
  if(!number(baseEstimatedPrice))return null;
  if(!selection||selection.boughtQtyOverride===undefined)return baseEstimatedPrice;
  if(!positive(defaultBoughtQty)||!positive(selection.boughtQtyOverride))return null;
  const price=baseEstimatedPrice*(selection.boughtQtyOverride/defaultBoughtQty);return number(price)?price:null;
 }
 let sequence=0;
 function createPicker({win=typeof window==='undefined'?null:window,name='',unit:rawUnit,needed,initial,recommended,onSave=()=>({ok:true}),baseEstimatedPrice,defaultPackQty,defaultBoughtQty,market='UK',quickPresets=false,retailCountProfile}={}){
  const doc=win?.document,unit=unitOf(rawUnit);if(!doc?.createElement||!['g','ml','each'].includes(unit)||!number(needed))throw Error('A shopping item and canonical unit are required.');
  const make=(tag,className,value)=>{const node=doc.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node;};
  const practical=Math.ceil(needed),defaultLabel=/\bcoleslaw\b/i.test(name)?'tub':'pack',retailProfile=unit==='g'?retailProfileOf(retailCountProfile):null;
  const pack=(quantity,count=1,label=defaultLabel)=>({kind:'pack',packQuantity:quantity,packCount:count,quantity:quantity*count,unit,label,boughtQtyOverride:quantity*count,...(retailProfile&&quantity===retailProfile.gramsPerEach&&label==='pack'?{retailCount:{...retailProfile,count}}:{})});
  const exact=()=>retailProfile?{...pack(retailProfile.gramsPerEach,Math.ceil(needed/retailProfile.gramsPerEach)),kind:'exact'}:{kind:'exact',packQuantity:practical,packCount:1,quantity:practical,unit,label:defaultLabel,boughtQtyOverride:practical};
  const suggestedSize=recommended?.packQuantity??recommended?.packQty,suggestedCount=Number.isSafeInteger(recommended?.packCount)&&recommended.packCount>0?recommended.packCount:positive(suggestedSize)?Math.max(1,Math.ceil(needed/suggestedSize)):1;
  const suggestion=selectionOf(recommended,unit)||selectionOf(pack(suggestedSize,suggestedCount,['pack','tub','bulb'].includes(recommended?.label)?recommended.label:defaultLabel),unit);
  let saved=selectionOf(initial,unit)||suggestion||exact(),draft={...saved},busy=false,opened=false,customMode=false;
  const button=make('button','bb-shop-buying-pill',buyingLabel(saved,name)),editor=make('section','bb-shop-pack-picker');
  button.type='button';button.setAttribute('aria-expanded','false');editor.hidden=true;editor.id='bbShopPackPicker'+(++sequence);button.setAttribute('aria-controls',editor.id);
  editor.setAttribute('role','region');editor.setAttribute('aria-label','Buying amount for '+String(name));
  const heading=make('strong','bb-shop-pack-heading','Choose what you’re buying'),presets=make('div','bb-shop-pack-presets'),controls=[];
  const presetChoices=[];
  const click=(node,handler)=>node.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(!busy)return handler();});
  function setDraft(next){const chosen=selectionOf(next,unit);if(!chosen)return false;if(chosen.quantity!==draft.quantity){price.value='';delete chosen.priceOverride;}draft=chosen;custom.value=String(chosen.quantity);update();return true;}
  function addPreset(key,label,choose){const node=make('button','bb-shop-pack-preset',label);node.type='button';node.dataset.bbPackPreset=String(key);node.setAttribute('aria-pressed','false');click(node,()=>{customMode=false;if(!setDraft(choose()))return;if(quickPresets)return saveChoice();});presets.append(node);controls.push(node);presetChoices.push({node,choose});return node;}
  const exactCount=retailProfile?Math.ceil(needed/retailProfile.gramsPerEach):null,exactLabel=retailProfile?digits(exactCount,0,market)+' '+(exactCount===1?retailProfile.unitLabel:plural(retailProfile.unitLabel)):unit==='each'?digits(practical,0,market):formatDisplayQty(practical,unit,{market});
  const exactButton=addPreset('exact','Exact ('+exactLabel+')',exact);if(practical===0)exactButton.disabled=true;
  const garlic=unit==='each'&&/\bgarlic\b/i.test(name)&&suggestion?.label==='bulb';
  if(retailProfile)for(const count of [1,2,3,4,6])addPreset(count,count+' '+(count===1?retailProfile.unitLabel:plural(retailProfile.unitLabel)),()=>pack(retailProfile.gramsPerEach,count));
  else if(garlic)for(const count of [1,2,3])addPreset('bulb-'+count,count+' '+(count===1?'bulb':'bulbs'),()=>pack(suggestion.packQuantity,count,'bulb'));
  else for(const size of unit==='each'?[4,6,8,10,12]:[200,250,300,400,500,1000])addPreset(size,unit==='each'?size+' pk':formatDisplayQty(size,unit,{market}),()=>pack(size,Math.max(1,Math.ceil(needed/size))));
  if(suggestion&&!garlic&&!retailProfile&&!presetChoices.some(choice=>{const value=choice.choose();return value.kind==='pack'&&value.packQuantity===suggestion.packQuantity;}))addPreset('recommended',formatDisplayQty(suggestion.packQuantity,unit,{market})+(suggestion.label==='tub'?' tub':''),()=>({...suggestion}));
  const customButton=make('button','bb-shop-pack-preset','Custom');customButton.type='button';customButton.dataset.bbPackPreset='custom';customButton.setAttribute('aria-pressed','false');presets.append(customButton);controls.push(customButton);
  const countWrap=make('div','bb-shop-pack-count-row'),countLabel=make('span','','Number of '+(saved.label==='bulb'?'bulbs':saved.label==='tub'?'tubs':'packs')),minus=make('button','bb-shop-pack-count-button','−'),countValueNode=make('output','bb-shop-pack-count-value'),plus=make('button','bb-shop-pack-count-button','+');
  minus.type=plus.type='button';minus.dataset.bbPackCount='minus';plus.dataset.bbPackCount='plus';minus.setAttribute('aria-label','One fewer pack');plus.setAttribute('aria-label','One more pack');countWrap.append(countLabel,minus,countValueNode,plus);controls.push(minus,plus);
  const field=(labelText,input)=>{const label=make('label','bb-shop-pack-field',labelText);label.append(input);return label;};
  const custom=make('input','bb-shop-pack-custom');custom.type='number';custom.inputMode='decimal';custom.min='0.000001';custom.max=String(MAX);custom.step='any';custom.value=String(draft.quantity);custom.dataset.bbPackCustom='';custom.setAttribute('aria-label','Custom total buying amount in '+unit);
  const price=make('input','bb-shop-pack-price');price.type='number';price.inputMode='decimal';price.min='0';price.max=String(MAX);price.step='0.01';price.placeholder='Optional';price.value=saved.priceOverride===undefined?'':String(saved.priceOverride);price.dataset.bbPackPrice='';price.setAttribute('aria-label','Total price for this purchase');
  const preview=make('p','bb-shop-pack-preview'),pricePreview=make('p','bb-shop-pack-estimate'),status=make('p','bb-shop-pack-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const actions=make('div','bb-shop-pack-actions'),cancel=make('button','bb-shop-pack-cancel','Cancel'),save=make('button','bb-shop-pack-save','Save buying amount');cancel.type=save.type='button';actions.append(cancel,save);controls.push(custom,price,cancel,save);
  const customField=field('Custom total amount ('+unit+')',custom),priceField=field('Total cost for this purchase (optional)',price);editor.append(heading,presets,countWrap,customField,priceField,preview,pricePreview,status,actions);
  function withPrice(){const chosen={...draft};if(price.value.trim()==='')delete chosen.priceOverride;else chosen.priceOverride=Number(price.value);return selectionOf(chosen,unit);}
  function update(){
   const chosen=withPrice();status.textContent='';preview.textContent=buyingLabel(chosen||draft,name);countWrap.hidden=draft.kind!=='pack'&&!draft.retailCount;countValueNode.textContent=String(draft.packCount);countLabel.textContent='Number of '+(draft.retailCount?plural(draft.retailCount.unitLabel):draft.label==='bulb'?'bulbs':draft.label==='tub'?'tubs':'packs');customField.hidden=priceField.hidden=!customMode;customButton.setAttribute('aria-pressed',String(customMode));
   const countNoun=draft.retailCount?.unitLabel||(draft.label==='bulb'?'bulb':draft.label==='tub'?'tub':'pack');minus.setAttribute('aria-label','One fewer '+countNoun);plus.setAttribute('aria-label','One more '+countNoun);
   minus.disabled=busy||draft.packCount<=1;plus.disabled=busy||draft.packQuantity*(draft.packCount+1)>MAX;save.disabled=busy||!chosen;
   for(const choice of presetChoices){const value=choice.choose();choice.node.setAttribute('aria-pressed',String(draft.kind===value.kind&&draft.packQuantity===value.packQuantity&&draft.packCount===value.packCount));}
   const estimate=chosen?estimatePrice(baseEstimatedPrice,defaultPackQty??defaultBoughtQty,chosen):null;pricePreview.hidden=estimate===null;
   if(estimate!==null){let formatted;try{formatted=win.BBPriceV19?.money?.(estimate,market);}catch{}pricePreview.textContent='Estimated total '+(formatted||new Intl.NumberFormat(market==='US'?'en-US':'en-GB',{style:'currency',currency:market==='US'?'USD':'GBP'}).format(estimate));}
  }
  click(minus,()=>setDraft(pack(draft.packQuantity,Math.max(1,draft.packCount-1),draft.label)));click(plus,()=>setDraft(pack(draft.packQuantity,draft.packCount+1,draft.label)));
  click(customButton,()=>{customMode=true;update();custom.focus?.({preventScroll:true});});
  custom.addEventListener('input',event=>{event.stopPropagation();if(busy)return;const quantity=custom.value.trim()===''?NaN:Number(custom.value);if(quantity!==draft.quantity)price.value='';draft={kind:'custom',packQuantity:quantity,packCount:1,quantity,unit,label:defaultLabel,boughtQtyOverride:quantity};customMode=true;update();});
  price.addEventListener('input',event=>{event.stopPropagation();if(!busy)update();});
  function close(){if(busy)return false;opened=false;editor.hidden=true;button.setAttribute('aria-expanded','false');return true;}
  function open(){if(busy)return false;draft={...saved};custom.value=String(draft.quantity);price.value=saved.priceOverride===undefined?'':String(saved.priceOverride);customMode=draft.kind==='custom'||saved.priceOverride!==undefined;opened=true;editor.hidden=false;button.setAttribute('aria-expanded','true');update();return true;}
  function openPrice(){if(!open())return false;customMode=true;update();price.focus?.({preventScroll:true});return true;}
  click(button,()=>opened?close():open());click(cancel,close);
  editor.addEventListener('click',event=>event.stopPropagation());editor.addEventListener('change',event=>event.stopPropagation());editor.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();if(close()&&button.isConnected)button.focus?.({preventScroll:true});}});
  async function saveChoice(){
   const chosen=withPrice();if(!chosen||!editor.isConnected||!button.isConnected)return;
   busy=true;editor.setAttribute('aria-busy','true');controls.forEach(node=>node.disabled=true);status.textContent='Saving buying amount…';
   try{
    const result=await onSave(Object.freeze({...chosen,...(chosen.retailCount?{retailCount:Object.freeze({...chosen.retailCount})}:{})}));if(!editor.isConnected||!button.isConnected)return;
    if(result?.ok===true){saved={...chosen};button.textContent=buyingLabel(saved,name);busy=false;close();}
    else status.textContent=result?.message||'The buying amount could not be saved. Please try again.';
   }catch{if(editor.isConnected&&button.isConnected)status.textContent='The buying amount could not be saved. Please try again.';}
   finally{busy=false;if(editor.isConnected&&button.isConnected){editor.removeAttribute('aria-busy');controls.forEach(node=>node.disabled=false);exactButton.disabled=practical===0;minus.disabled=draft.packCount<=1;plus.disabled=draft.packQuantity*(draft.packCount+1)>MAX;save.disabled=!withPrice();}}
  }
  click(save,saveChoice);
  function snapshot(){return !busy&&opened?{draft:{...draft,...(draft.retailCount?{retailCount:{...draft.retailCount}}:{})},customMode,custom:custom.value,price:price.value}:null;}
  function restore(value){
   const restored=object(value)?selectionOf(value.draft,unit):null;if(busy||!restored||typeof value.custom!=='string'||value.custom.length>64||typeof value.price!=='string'||value.price.length>64)return false;
   draft=restored;customMode=value.customMode===true;custom.value=value.custom;price.value=value.price;opened=true;editor.hidden=false;button.setAttribute('aria-expanded','true');update();return true;
  }
  update();return {button,editor,open,close,openPrice,snapshot,restore};
 }
 return Object.freeze({formatDisplayQty,formatDisplayQuantityText,amount,readPlan,writePlan,buyingLabel,estimatePrice,createPicker});
});
