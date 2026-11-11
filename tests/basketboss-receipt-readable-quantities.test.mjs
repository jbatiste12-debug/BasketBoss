import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),prices=require('../bb-kitchen-prices.js'),formatter=require('../bb-shop-purchase-ui.js');
const scanSource=fs.readFileSync(new URL('../bb-price-scan.js',import.meta.url),'utf8');
const now=Date.parse('2026-11-11T12:00:00Z');
const quote=(packQuantity,packUnit,market='UK')=>Object.freeze({source:'receipt',name:'Rice',amount:2.4,market,currency:market==='US'?'USD':'GBP',date:'2026-11-04',retailer:'Aldi',packQuantity,packUnit,packCount:1,priceBasis:'pack'});

for(const shared of [true,false])test('historical receipt visible labels round only display quantities '+(shared?'with the shared formatter':'with the readable fallback'),()=>{
 const api=prices.create(shared?{BBShopPurchaseUI:formatter}:{},{now:()=>now});
 for(const [row,expected]of [[quote(533.333333,'g'),/533 g/],[quote(1.333333,'ml'),/1 ml/],[quote(.000001,'g'),/<1 g/],[quote(666.666667,'g','US'),/1\.5 lb/],[quote(333.333333,'ml','US'),/1\.4 US cups/],[quote(1999.999999,'g'),/(?:2000 g|2 kg)/]]){
  const before=JSON.stringify(row),visible=api.visibleLabel(row);assert.match(visible,expected);assert.match(visible,/[$£]2\.40/);assert.doesNotMatch(visible,/\d+\.\d{3,}|NaN|Infinity/);assert.equal(JSON.stringify(row),before);
 }
 assert.match(api.label(quote(.000001,'g')),/0\.000001 g/,'legacy precise labels remain unchanged for existing API consumers');
});

function scannerFixture(shared){
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 class Element{
  constructor(tag){Object.assign(this,{tagName:tag,children:[],events:new Map(),style:{},dataset:{},value:'',disabled:false,checked:false,_text:'',isConnected:true});}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  addEventListener(name,handler){const handlers=this.events.get(name)||[];handlers.push(handler);this.events.set(name,handlers);}
  async emit(name){for(const handler of this.events.get(name)||[])await handler({preventDefault(){}});}
  setAttribute(name,value){this[name]=value;}
  showModal(){this.open=true;}
  close(){this.open=false;void this.emit('close');}
  remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
 }
 const body=new Element('body'),doc={body,createElement:tag=>new Element(tag),createTextNode:text=>{const node=new Element('#text');node.textContent=text;return node;},getElementById:id=>descendants(body).find(node=>node.id===id)||null};
 const create=doc.createElement;doc.createElement=tag=>{const node=create(tag);if(tag==='canvas'){node.getContext=()=>({drawImage(){}});node.toDataURL=()=> 'data:image/jpeg;base64,localtest';}return node;};
 const result=Object.freeze({currency:'GBP',items:Object.freeze([Object.freeze({ingredientKey:'rice',name:'Rice',brand:'Example',price:2.4,packQuantity:666.666667,packUnit:'g',confidence:'high',notes:'Reserve 1.333333 ml separately.'})])});
 const items=Object.freeze([Object.freeze({key:'rice',name:'Rice',unit:'g',packQuantity:666.666667})]);
 const inference=Object.freeze({quantity:233.333333,unit:'g',estimated:false,note:'Bought 233.333333 g; reserve 1.333333 ml.'}),packets=[];
 const win={document:doc,Date,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,TextEncoder,localStorage:{getItem:()=>JSON.stringify({access_token:'readable-actor',expires_at:Date.now()/1000+3600})},
  ...(shared?{BBShopPurchaseUI:formatter}:{}),createImageBitmap:async()=>({width:100,height:100,close(){}}),
  BBReceiptQuantity:{infer:()=>inference,measured:(value,unit)=>({quantity:Number(value),unit})},
  fetch:async url=>Response.json(String(url).endsWith('/status')?{premium_ai:true,turnstileRequired:false}:{ok:true,reviewRequired:true,receiptPrices:result})};
 vm.runInNewContext(scanSource,{window:win,AbortController});const dialog=win.BBPriceScan.openReceipt({items,market:'UK',retailer:'Aldi',onSaveReviewedReceipt:async packet=>{packets.push(packet);return {ok:true,saved:1,stocked:1};}});
 return {dialog,items,result,inference,packets,nodes:()=>descendants(dialog)};
}

for(const shared of [true,false])test('receipt review formats guide packs and notes while retaining exact editable and saved amounts '+(shared?'with the shared formatter':'before the formatter loads'),async()=>{
 const h=scannerFixture(shared),before=JSON.stringify([h.items,h.result,h.inference]);
 const file=h.nodes().find(node=>node.type==='file');file.files=[{type:'image/jpeg',size:100}];await file.emit('change');await h.nodes().find(node=>node.tagName==='button'&&node.textContent==='Scan receipt').emit('click');
 assert.match(h.dialog.textContent,/Guide pack: 667 g/);assert.match(h.dialog.textContent,/Bought 233 g; reserve 1 ml/);assert.match(h.dialog.textContent,/Reserve 1 ml separately/);assert.doesNotMatch(h.dialog.textContent,/\d+\.\d{3,}|NaN|Infinity/);
 const quantity=h.nodes().find(node=>node.dataset.bbReceiptBoughtQuantity);assert.equal(quantity.value,'233.333333');
 const price=h.nodes().find(node=>node.type==='number'&&!node.dataset.bbReceiptBoughtQuantity);assert.equal(price.value,'2.40');assert.equal(JSON.stringify([h.items,h.result,h.inference]),before);assert.equal(h.packets.length,0);
 const checked=h.nodes().find(node=>node.dataset.bbReceiptReviewRow);checked.checked=true;await checked.emit('change');await h.nodes().find(node=>node.tagName==='form').emit('submit');
 assert.equal(h.packets.length,1);assert.equal(h.packets[0].items[0].quantity,233.333333);assert.equal(h.packets[0].items[0].guidePackQuantity,666.666667);assert.equal(h.packets[0].priceUpdates[0].price,2.4);assert.equal(JSON.stringify([h.items,h.result,h.inference]),before);
});
