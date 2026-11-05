import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const lockSource=source.slice(source.indexOf('function bbAfSetBusy('),source.indexOf('async function bb81AutoFillProRun('));
function autofill(){
 const button={disabled:false,attrs:{},setAttribute(key,value){this.attrs[key]=value;}},notices=[];
 const context={document:{querySelectorAll:()=>[button]},notify:message=>notices.push(message),Promise};
 vm.createContext(context);vm.runInContext('let bbAfBusy=false;'+lockSource,context);
 return {context,button,notices,run:action=>context.bbAfWithLock(action)};
}
test('Auto-fill locks synchronously, shares one pending action and releases after confirmation',async()=>{
 const h=autofill();let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 const first=h.run(async()=>{calls++;return gate;});
 assert.equal(h.button.disabled,true);assert.equal(h.button.attrs['aria-busy'],'true');
 assert.equal(await h.run(()=>{calls++;}),false);assert.equal(calls,1);
 release(true);assert.equal(await first,true);assert.equal(h.button.disabled,false);
 assert.equal(h.button.attrs['aria-busy'],'false');
 assert.equal(await h.run(()=>true),true);
});
test('unexpected Auto-fill failures resolve safely and permit a retry',async()=>{
 const h=autofill();assert.equal(await h.run(()=>Promise.reject(Error('offline'))),false);
 assert.equal(h.button.disabled,false);assert.equal(h.notices.length,1);
 assert.equal(await h.run(()=>true),true);
});
test('Premium Auto-fill delegates inside the same lock without blocking itself',async()=>{
 const h=autofill();let calls=0;
 Object.assign(h.context,{bbBatchPairs:()=>[],bb176IsPremiumPreview:()=>true,BB81_PRO_FILTERS:['quick'],bb81ProFilters:{quick:true},bb81AutoFillProRun:async()=>{calls++;return true;}});
 const start=source.indexOf('async function bb172AutoFillSixDinners()');
 vm.runInContext(source.slice(start,source.indexOf('\nfunction bb172DrawSixDinnerControl',start)),h.context);
 assert.equal(await h.context.bb172AutoFillSixDinners(),true);assert.equal(calls,1);
});

function shop({purchases=true,save=true}={}){
 const notices=[],nodes=new Map();let transferred=0,archived=0,scanned=0,after=0,focused=0;
 class Node{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.disabled=false;this.attrs={};this.isConnected=false;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);node.connect(this.isConnected);}}
  appendChild(node){this.append(node);}
  connect(value){this.isConnected=value;if(this.id)nodes.set(this.id,this);for(const child of this.children)child.connect(value);}
  setAttribute(name,value){this.attrs[name]=value;}
  removeAttribute(name){delete this.attrs[name];}
  addEventListener(name,handler){this.listeners[name]=handler;}
  remove(){this.connect(false);if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  focus(){focused++;}
  click(){if(!this.disabled)this.onclick?.();}
 }
 const body=new Node('body');body.connect(true);
 const context={document:{body,activeElement:{isConnected:true,focus(){focused++;}},createElement:tag=>new Node(tag)},
  bb172ShopDialogOpen:false,bb172ShopLastInteraction:0,Date,
  bb172ShopUncheckedRows:()=>[],bbBetaPendingBought:()=>purchases?[{id:'carrot'}]:[],bbHomePendingHouseholdPurchases:()=>[],
  bb83TransferBought:()=>{transferred++;return {count:1};},bbShopV7Close:()=>{archived++;return save;},
  bb172ShopSetActive:()=>{},notify:message=>notices.push(message),
  bb307ReceiptPriceContext:()=>({}),bb307OpenReceiptPrices:()=>{scanned++;}};
 vm.createContext(context);const start=source.indexOf('function bb172ShopPrompt(');
 vm.runInContext(source.slice(start,source.indexOf('\nfunction bb172ShopRequestExit(',start)),context);
 context.bb172ShopPrompt('finish',()=>{after++;});
 const overlay=nodes.get('bb172ShopConfirm'),dialog=overlay.children[0],actions=dialog.children.find(node=>node.className==='bb172-shop-dialog-actions');
 return {context,overlay,actions,notices,counts:()=>({transferred,archived,scanned,after,focused}),setSave:value=>{save=value;}};
}
test('Finish shop credits once even if an old detached confirmation is invoked again',()=>{
 const h=shop(),finish=h.actions.children[1];finish.click();finish.onclick();
 assert.equal(h.counts().transferred,1);assert.equal(h.counts().archived,1);assert.equal(h.counts().after,1);
 assert.equal(h.context.bb172ShopDialogOpen,false);assert.equal(h.overlay.isConnected,false);
});
test('Finish and scan commits despite sibling controls being disabled, and scans only once',()=>{
 const h=shop(),scan=h.actions.children[2];scan.click();scan.onclick();
 assert.equal(h.counts().transferred,1);assert.equal(h.counts().archived,1);assert.equal(h.counts().scanned,1);
});
test('a failed Finish remains open and enabled for a safe retry',()=>{
 const h=shop({save:false}),finish=h.actions.children[1];finish.click();
 assert.equal(h.overlay.isConnected,true);assert.equal(finish.disabled,false);assert.equal(h.counts().after,0);
 h.setSave(true);finish.click();assert.equal(h.overlay.isConnected,false);assert.equal(h.counts().after,1);
});
test('Finish backdrop dismisses without purchases and an inside tap does not dismiss',()=>{
 const h=shop();h.overlay.listeners.click({target:h.actions});assert.equal(h.overlay.isConnected,true);
 h.overlay.listeners.click({target:h.overlay});assert.equal(h.overlay.isConnected,false);
 assert.equal(h.context.bb172ShopDialogOpen,false);assert.equal(h.counts().transferred,0);assert.ok(h.counts().focused>0);
});

test('legacy add-food dialogs release Escape handlers on cancel, backdrop and replacement',()=>{
 const handlers=new Set(),nodes=new Map();let focusRestored=0;
 class Node{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.isConnected=false;}
  append(...children){for(const child of children){this.children.push(child);child.parent=this;child.isConnected=this.isConnected;if(child.id)nodes.set(child.id,child);}}
  setAttribute(){}
  addEventListener(name,handler){this.listeners[name]=handler;}
  querySelector(){return null;}
  reportValidity(){return true;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  remove(){this.isConnected=false;if(this.id)nodes.delete(this.id);if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
 }
 const body=new Node('body');body.isConnected=true;
 const context={document:{body,activeElement:{isConnected:true,focus(){focusRestored++;}},createElement:tag=>new Node(tag),getElementById:id=>nodes.get(id),addEventListener:(_name,handler)=>handlers.add(handler),removeEventListener:(_name,handler)=>handlers.delete(handler)},window:{},bb172Msg(){}};
 const start=source.indexOf('function bb172Modal(');vm.createContext(context);vm.runInContext(source.slice(start,source.indexOf('\nfunction bb172Input(',start)),context);
 const open=()=>{context.bb172Modal('Food',()=>{},'Save',()=>false);return nodes.get('bb172PlusOverlay');};
 let modal=open();assert.equal(handlers.size,1);
 modal.children[0].children[1].children[0].children[1].onclick();assert.equal(handlers.size,0);
 modal=open();modal.listeners.click({target:modal});assert.equal(handlers.size,0);
 open();modal=open();assert.equal(handlers.size,1,'replacement removes the old global handler');
 for(const handler of [...handlers])handler({key:'Escape',preventDefault(){}});
 assert.equal(handlers.size,0);assert.equal(modal.isConnected,false);assert.ok(focusRestored>=4);
});
