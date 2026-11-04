import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateInput,validateGeminiResult,geminiRequest,onRequest,RECEIPT_PRICES_SCHEMA} from '../functions/api/bb173/[action].js';

const photo={mimeType:'image/jpeg',imageBase64:btoa('\xff\xd8\xff'+ 'a'.repeat(90))};
const context=[{key:'potato',name:'Potatoes',unit:'g',packQuantity:2000}];
const line={ingredientKey:'potato',name:'Own-label potatoes',brand:'Usual brand',price:1.32,packQuantity:2000,packUnit:'g',confidence:'high',notes:''};
const receipt={currency:'GBP',items:[line],notes:''};
const request={...photo,scanKind:'receipt_prices',expectedCurrency:'GBP',items:context};
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('receipt scans use the existing scan image gate and bounded ingredient context',()=>{
 assert.equal(validateInput('scan',photo),null);
 assert.equal(validateInput('scan',request),null);
 for(const extra of [{expectedCurrency:'EUR'},{items:[]},{items:[...context,...context]},{items:[{...context[0],packQuantity:0}]},{scanKind:'unmetered_scan'},{imageBase64:'not-image'}])
  assert.ok(validateInput('scan',{...request,...extra}));
});

test('receipt output accepts only supplied ingredient keys and no duplicate or invented prices',()=>{
 assert.equal(validateGeminiResult('scan',receipt,request),true);
 for(const changed of [
  {items:[{...line,ingredientKey:'invented'}]}, {items:[line,line]}, {items:[{...line,price:0}]},
  {items:[{...line,price:'1.32'}]}, {items:[{...line,price:Infinity}]},
  {items:[{...line,brand:'x'.repeat(81)}]}, {currency:'EUR'}, {items:[{...line,packUnit:'box'}]}
 ])assert.equal(validateGeminiResult('scan',{...receipt,...changed},request),false);
 assert.equal(validateGeminiResult('scan',{...receipt,items:[{...line,price:null,packQuantity:null,packUnit:'unknown'}]},request),true);
});

test('old ingredient scan results retain their original contract; receipt outputs are separate',()=>{
 const old={items:[{name:'Potato',estimatedQuantity:'2kg',confidence:'high',notes:''}],caution:''};
 assert.equal(validateGeminiResult('scan',old,photo),true);
 assert.equal(validateGeminiResult('scan',receipt,photo),false);
 assert.equal(geminiRequest('scan',request).schema,RECEIPT_PRICES_SCHEMA);
 const prompt=geminiRequest('scan',request).parts[0].text;
 assert.match(prompt,/UNTRUSTED DATA/);assert.match(prompt,/ONE purchased pack/);assert.match(prompt,/personal details/);assert.match(prompt,/receipt total/);
});

const ownerEnv={BB_OWNER_AI_PREVIEW_ENABLED:'true',BB_PREMIUM_AI_ENABLED:'true',BB_BILLING_MODE:'sandbox',BB_BILLING_ENABLED:'false',
 CF_PAGES_BRANCH:'billing-premium-secure-20261026-2',BB_OWNER_AI_PREVIEW_BRANCH:'billing-premium-secure-20261026-2',BB_OWNER_USER_ID:'owner',
 BB_LIVE_CHECKOUT_ENABLED:'false',BB_LIVE_WEBHOOK_ENABLED:'false',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test',
 GEMINI_API_KEY:'test',TURNSTILE_SECRET_KEY:'test',TURNSTILE_SITE_KEY:'test',BB_AI_GLOBAL_DAILY_CAP:'20'};

test('receipt HTTP request keeps authentication, Turnstile and the original scan quota bucket',async()=>{
 const original=globalThis.fetch,bindings=[],calls=[];
 const env={...ownerEnv,BILLING_DB:{prepare(sql){return {bind(...values){bindings.push({sql,values});return this;},async first(){return {used:1};}};}}};
 globalThis.fetch=async(url,options)=>{
  calls.push(String(url));
  if(String(url).includes('/auth/v1/user'))return Response.json({id:'owner',email:'owner@example.com',email_confirmed_at:'2026-10-26T00:00:00Z'});
  if(String(url).includes('siteverify'))return Response.json({success:true,action:'bb_ai',hostname:'preview.example'});
  if(String(url).includes('generativelanguage'))return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(receipt)}]}}]});
  throw Error('Unexpected request');
 };
 try{
  const make=(body,token=true)=>new Request('https://preview.example/api/bb173/scan',{method:'POST',headers:{Origin:'https://preview.example','Content-Type':'application/json',...(token?{Authorization:'Bearer token'}:{})},body:JSON.stringify(body)});
  const response=await onRequest({request:make({...request,turnstileToken:'test_challenge_token'}),env,params:{action:'scan'}});
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.reviewRequired,true);assert.deepEqual(result.receiptPrices,receipt);assert.equal(result.scan,undefined);
  assert.ok(bindings.some(x=>x.values[1]==='user:owner'&&x.values[2]==='scan'&&x.values[3]===5));
  assert.ok(bindings.some(x=>x.values[1]==='global'&&x.values[2]==='all'));
  const providerCount=calls.filter(x=>x.includes('generativelanguage')).length;
  const anonymous=await onRequest({request:make(request,false),env,params:{action:'scan'}});
  assert.equal(anonymous.status,403);assert.equal(calls.filter(x=>x.includes('generativelanguage')).length,providerCount);
 }finally{globalThis.fetch=original;}
});

class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.events={};this.style={};this.dataset={};this.isConnected=true;this.value='';this.disabled=false;this.checked=false;this._text='';}
 append(...children){for(const child of children){this.children.push(child);if(typeof child==='object')child.parentElement=this;}}
 insertBefore(child,before){const index=this.children.indexOf(before);if(index<0)this.append(child);else{this.children.splice(index,0,child);child.parentElement=this;}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
 setAttribute(key,value){this[key]=value;}
 get textContent(){return this._text+this.children.map(x=>typeof x==='string'?x:x.textContent||'').join('');}
 set textContent(value){this._text=String(value);this.children=[];}
 remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);}
 showModal(){this.open=true;}
 close(){this.open=false;void this.emit('close');}
 async emit(type,event={}){for(const fn of this.events[type]||[])await fn({preventDefault(){},stopImmediatePropagation(){},...event});}
 querySelector(){return null;}
}
function descendants(node){return [node,...node.children.flatMap(child=>typeof child==='object'?descendants(child):[])];}
function harness({result=receipt,premium=true,challenge=false,token=true}={}){
 const saved=new Map(),writes=[],fetches=[],overrides=[],body=new Element('body');
 if(token)saved.set('basketboss_cloud_session_v1',JSON.stringify({access_token:'token',expires_at:Date.now()/1000+3600}));
 const document={body,createElement:tag=>new Element(tag),createTextNode:text=>{const node=new Element('#text');node.textContent=text;return node;},getElementById:id=>descendants(body).find(x=>x.id===id)||null};
 const env={document,console,AbortController,Date,setTimeout,clearTimeout,crypto:globalThis.crypto,TextEncoder,
  localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{writes.push(key);saved.set(key,value);}},
  bb307ActiveMarket:()=> 'UK',bb307ActiveRetailer:()=> 'Aldi',
  BBPriceV19:{setPriceOverride:row=>overrides.push(row)},
  fetch:async(url,options)=>{fetches.push({url,options});return Response.json(String(url).endsWith('/status')?{premium_ai:premium,turnstileRequired:challenge}:{ok:true,reviewRequired:true,receiptPrices:result});},
  createImageBitmap:async()=>({width:100,height:100,close(){}})
 };
 // Canvas is a local transformation; the fixture contains no real photograph.
 const create=document.createElement;document.createElement=tag=>{const node=create(tag);if(tag==='canvas'){node.getContext=()=>({drawImage(){}});node.toDataURL=()=> 'data:image/jpeg;base64,'+photo.imageBase64;}return node;};
 env.window=env;vm.runInNewContext(read('bb-price-scan.js'),env);
 return {api:env.BBPriceScan,env,saved,writes,fetches,overrides,body};
}

test('receipt drafts match only known products, same currency and exactly compatible guide packs',()=>{
 const h=harness();
 const draft=h.api.receiptDraft(receipt,{items:context,market:'UK'});assert.equal(draft.rows.length,1);assert.equal(draft.rows[0].price,1.32);
 assert.equal(h.api.receiptDraft({...receipt,items:[{...line,packQuantity:2,packUnit:'kg'}]},{items:context,market:'UK'}).rows.length,1);
 for(const changed of [{currency:'USD'},{items:[{...line,ingredientKey:'invented'}]},{items:[{...line,packQuantity:500}]}])
  assert.equal(h.api.receiptDraft({...receipt,...changed},{items:context,market:'UK'}).rows.length,0);
 const unknown=h.api.receiptDraft({...receipt,items:[{...line,packQuantity:null,packUnit:'unknown'}]},{items:context,market:'UK'});
 assert.equal(unknown.rows.length,1);assert.equal(unknown.rows[0].packUnverified,true);assert.match(unknown.rows[0].notes,/Pack size was not read/);
 assert.equal(h.api.receiptDraft({...receipt,items:[{...line,confidence:'low'}]},{items:context,market:'UK'}).rows[0].price,null);
 assert.equal(h.writes.length,0);assert.equal(h.overrides.length,0);
});

test('authenticated receipt read submits same-origin scan with no persistence and account guards',async()=>{
 const h=harness();const draft=await h.api.readReceipt({file:{},items:context,market:'UK',preparePhoto:async()=>photo});
 assert.equal(draft.rows.length,1);assert.equal(h.fetches.length,2);assert.equal(h.writes.length,0);assert.equal(h.overrides.length,0);
 const post=h.fetches[1];assert.equal(post.url,'/api/bb173/scan');assert.equal(post.options.credentials,'same-origin');assert.equal(post.options.cache,'no-store');
 const payload=JSON.parse(post.options.body);assert.equal(payload.scanKind,'receipt_prices');assert.equal(payload.expectedCurrency,'GBP');assert.deepEqual(payload.items,context);
 for(const options of [{token:false},{premium:false},{challenge:true}]){
  const blocked=harness(options);await assert.rejects(()=>blocked.api.readReceipt({file:{},items:context,market:'UK',preparePhoto:async()=>photo}));
  assert.ok(blocked.fetches.length<=1);assert.equal(blocked.overrides.length,0);
 }
 const changed=harness();await assert.rejects(()=>changed.api.readReceipt({file:{},items:context,market:'UK',preparePhoto:async()=>{changed.saved.delete('basketboss_cloud_session_v1');return photo;}}),/Account changed/);
 assert.equal(changed.fetches.length,1);
});

test('receipt dialog never saves or finishes Shopping until a product is explicitly reviewed',async()=>{
 const h=harness();let callbacks=0;const dialog=h.api.openReceipt({items:context,market:'UK',retailer:'Aldi',onSaved:()=>callbacks++});
 let nodes=descendants(dialog);const file=nodes.find(x=>x.type==='file'),scan=nodes.find(x=>x.textContent==='Scan receipt'),save=nodes.find(x=>x.tagName==='button'&&x.textContent==='Save reviewed receipt');
 assert.equal(h.fetches.length,0);assert.equal(save.disabled,true);file.files=[{type:'image/jpeg',size:100}];await file.emit('change');assert.equal(h.fetches.length,0);
 await scan.emit('click');assert.equal(h.fetches.length,2);assert.equal(h.overrides.length,0);assert.equal(save.disabled,true);
 nodes=descendants(dialog);const check=nodes.find(x=>x.dataset.bbReceiptReviewRow);nodes.find(x=>x.dataset.bbReceiptStockToggle).checked=false;assert.equal(check.checked,false);check.checked=true;await check.emit('change');assert.equal(save.disabled,false);
 await nodes.find(x=>x.tagName==='form').emit('submit');
 assert.equal(h.overrides.length,1);assert.equal(h.overrides[0].name,'potato');assert.equal(h.overrides[0].market,'UK');assert.equal(h.overrides[0].retailer,'Aldi');assert.equal(h.overrides[0].brand,'Usual brand');assert.equal(h.overrides[0].price,1.32);assert.equal(callbacks,1);
 assert.deepEqual(h.writes,[],'no plan, pantry, purchase or photo persistence');
});

test('receipt dialog rejects scope changes and invalid edited prices before saving',async()=>{
 const h=harness();const dialog=h.api.openReceipt({items:context,market:'UK',retailer:'Aldi'});let nodes=descendants(dialog);const file=nodes.find(x=>x.type==='file');file.files=[{type:'image/jpeg',size:100}];await file.emit('change');await nodes.find(x=>x.textContent==='Scan receipt').emit('click');
 nodes=descendants(dialog);const check=nodes.find(x=>x.dataset.bbReceiptReviewRow);nodes.find(x=>x.dataset.bbReceiptStockToggle).checked=false;check.checked=true;const price=nodes.find(x=>x.type==='number');price.value='0';await nodes.find(x=>x.tagName==='form').emit('submit');assert.equal(h.overrides.length,0);
 price.value='1.32';h.env.bb307ActiveRetailer=()=> 'Tesco';await nodes.find(x=>x.tagName==='form').emit('submit');assert.equal(h.overrides.length,0);
});

test('receipt pack sizes missing from a receipt stay visible for explicit product confirmation',async()=>{
 const h=harness({result:{...receipt,items:[{...line,packQuantity:null,packUnit:'unknown',confidence:'low'}]}});
 const dialog=h.api.openReceipt({items:context,market:'UK',retailer:'Aldi'});let nodes=descendants(dialog);const file=nodes.find(x=>x.type==='file');file.files=[{type:'image/jpeg',size:100}];await file.emit('change');await nodes.find(x=>x.textContent==='Scan receipt').emit('click');
 nodes=descendants(dialog);nodes.find(x=>x.dataset.bbReceiptStockToggle).checked=false;const check=nodes.find(x=>x.dataset.bbReceiptReviewRow),price=nodes.find(x=>x.type==='number'),form=nodes.find(x=>x.tagName==='form');
 assert.ok(check);assert.equal(check.checked,false);assert.equal(price.value,'');assert.match(dialog.textContent,/Pack size was not read from the receipt/);
 await form.emit('submit');assert.equal(h.overrides.length,0);
 check.checked=true;price.value='1.50';h.saved.delete('basketboss_cloud_session_v1');await form.emit('submit');assert.equal(h.overrides.length,0,'account change after preview cannot save');
 h.saved.set('basketboss_cloud_session_v1',JSON.stringify({access_token:'token',expires_at:Date.now()/1000+3600}));await form.emit('submit');assert.equal(h.overrides.length,1);assert.equal(h.overrides[0].price,1.5);
 file.files=[{type:'image/jpeg',size:100}];await file.emit('change');assert.equal(descendants(dialog).filter(x=>x.dataset.bbReceiptReviewRow).length,0,'new photo clears old draft rows');
});


async function reviewed(h,options={}){
 const dialog=h.api.openReceipt({items:context,market:'UK',retailer:'Aldi',...options});let nodes=descendants(dialog);
 const file=nodes.find(x=>x.type==='file');file.files=[{type:'image/jpeg',size:100}];await file.emit('change');await nodes.find(x=>x.textContent==='Scan receipt').emit('click');nodes=descendants(dialog);
 const check=nodes.find(x=>x.dataset.bbReceiptReviewRow);check.checked=true;await check.emit('change');
 return {dialog,nodes,stock:nodes.find(x=>x.dataset.bbReceiptStockToggle),quantity:nodes.find(x=>x.dataset.bbReceiptBoughtQuantity),unit:nodes.find(x=>x.dataset.bbReceiptBoughtUnit),form:nodes.find(x=>x.tagName==='form')};
}
test('legacy receipt review defaults to restocking and delegates the reviewed amounts and learned prices to one save',async()=>{
 const h=harness(),packets=[],callbacks=[];
 const review=await reviewed(h,{shopSessionId:'trip-1234',onSaveReviewedReceipt:async packet=>{packets.push(packet);return {ok:true,saved:1,stocked:1,message:'Saved receipt and restocked pantry.'};},onSaved:(count,result)=>callbacks.push({count,result})});
 assert.equal(review.stock.checked,true);assert.match(review.dialog.textContent,/Also add bought items & essentials to At Home pantry/);assert.equal(review.quantity.value,'2000');assert.equal(review.unit.value,'g');
 review.quantity.value='1';review.unit.value='kg';await review.form.emit('submit');
 assert.equal(packets.length,1);assert.equal(packets[0].stockPantry,true);assert.equal(packets[0].shopSessionId,'trip-1234');assert.match(packets[0].receiptId,/^legacy-[a-f0-9]{64}$/);
 assert.equal(packets[0].items[0].quantity,1000);assert.equal(packets[0].items[0].unit,'g');assert.equal(packets[0].items[0].guidePackQuantity,2000);assert.equal(packets[0].priceUpdates[0].price,1.32);
 assert.equal(h.overrides.length,0,'the host owns prices and stock in the same transaction');assert.equal(review.dialog.open,false);assert.equal(callbacks[0].count,1);assert.equal(callbacks[0].result.stocked,1);
});
test('unticking legacy restock delegates prices only and ignores an unused invalid bought amount',async()=>{
 const h=harness(),packets=[];const review=await reviewed(h,{onSaveReviewedReceipt:async packet=>{packets.push(packet);return {ok:true,saved:1,stocked:0};}});
 review.stock.checked=false;review.quantity.value='';await review.form.emit('submit');assert.equal(packets.length,1);assert.equal(packets[0].stockPantry,false);assert.equal(packets[0].items[0].quantity,null);assert.equal(h.overrides.length,0);
});
test('legacy restock failures retain the same receipt identity and reviewed fields for a safe retry',async()=>{
 const h=harness(),packets=[];let succeed=false;
 const review=await reviewed(h,{onSaveReviewedReceipt:async packet=>{packets.push(packet);return succeed?{ok:true,saved:1,stocked:1}:{ok:false,message:'Could not save. Retry the receipt.'};}});
 await review.form.emit('submit');assert.equal(review.dialog.open,true);assert.equal(h.overrides.length,0);assert.match(review.dialog.textContent,/Could not save/);
 succeed=true;await review.form.emit('submit');assert.equal(packets.length,2);assert.equal(packets[0].receiptId,packets[1].receiptId);assert.equal(review.dialog.open,false);
});
test('a selected legacy receipt item requires an explicit positive compatible amount before stock save',async()=>{
 const h=harness(),packets=[];const review=await reviewed(h,{onSaveReviewedReceipt:async packet=>{packets.push(packet);return {ok:true};}});
 for(const [quantity,unit]of [['0','g'],['-1','g'],['1.2','each'],['5','unknown'],['1000001','g']]){review.quantity.value=quantity;review.unit.value=unit;await review.form.emit('submit');assert.equal(packets.length,0);}
 assert.equal(h.overrides.length,0);assert.equal(review.dialog.open,true);
});
test('household essentials retain their classification through the legacy reviewed save',async()=>{
 const h=harness({result:{currency:'GBP',items:[{...line,ingredientKey:'washing up liquid',name:'Washing up liquid 500ml',packQuantity:500,packUnit:'ml'}],notes:''}}),packets=[];
 const review=await reviewed(h,{items:[{key:'washing up liquid',name:'Washing up liquid',unit:'ml',packQuantity:500,classification:'essential'}],onSaveReviewedReceipt:async packet=>{packets.push(packet);return {ok:true,saved:1,stocked:1};}});
 await review.form.emit('submit');assert.equal(packets[0].items[0].classification,'essential');assert.equal(packets[0].items[0].quantity,500);assert.equal(packets[0].items[0].unit,'ml');
});
test('rescanning an identical resized receipt yields the same non-image replay identity',async()=>{
 const h=harness(),options={file:{},items:context,market:'UK',preparePhoto:async()=>photo};
 const first=await h.api.readReceipt(options),second=await h.api.readReceipt(options);assert.equal(first.receiptId,second.receiptId);assert.match(first.receiptId,/^legacy-[a-f0-9]{64}$/);assert.doesNotMatch(first.receiptId,/data:|base64/);
});
