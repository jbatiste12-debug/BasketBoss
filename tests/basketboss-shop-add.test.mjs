import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const source=fs.readFileSync(new URL('../bb-shop-add.js',import.meta.url),'utf8');
const next=()=>new Promise(resolve=>setImmediate(resolve));
const {install}=createRequire(import.meta.url)('../bb-home.js');

function fixture(options={}){
 let doc,currentActor='alice',deleting=false,currentPremium=options.premium===true;
 const previews=[],writes=[],saved=[],listeners=new Map();
 const walk=node=>[node,...node.children.flatMap(walk)];
 class Node{
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parentNode:null,ownerDocument:doc,className:'',attributes:new Map(),events:new Map(),style:{},value:'',disabled:false,hidden:false,open:false,_text:''});}
  set textContent(value){this._text=String(value);this.children.forEach(child=>child.parentNode=null);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='id')this.id=String(value);if(name==='open')this.open=true;}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){this.attributes.delete(name);if(name==='open')this.open=false;}
  addEventListener(name,fn){const handlers=this.events.get(name)||[];handlers.push(fn);this.events.set(name,handlers);}
  async fire(name,event={}){const data={target:this,preventDefault(){},...event};const results=(this.events.get(name)||[]).map(fn=>fn(data));if(this['on'+name])results.push(this['on'+name](data));await Promise.all(results);}
  matches(selector){return selector.split(',').some(raw=>{const value=raw.trim();if(value.startsWith('.'))return this.className.split(/\s+/).includes(value.slice(1));if(value==='dialog[open]')return this.tagName==='DIALOG'&&this.open;return this.tagName.toLowerCase()===value;});}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  contains(node){return walk(this).includes(node);}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  focus(){doc.activeElement=this;}
  showModal(){this.setAttribute('open','');}
  close(){this.removeAttribute('open');void this.fire('close');}
  checkValidity(){const n=Number(this.value);return this.value!==''&&Number.isFinite(n)&&n>=Number(this.min||0)&&n<=Number(this.max||Infinity);}
 }
 doc={createElement:tag=>new Node(tag),querySelector:selector=>doc.body.querySelector(selector)};doc.body=new Node('body');doc.body.style.overflow='auto';doc.activeElement=doc.body;
 const win={document:doc,BBReducedFoodHost:{isPremium:()=>currentPremium},BBAccountDeletion:{isDeleting:()=>deleting},
  addEventListener(name,fn){const handlers=listeners.get(name)||[];handlers.push(fn);listeners.set(name,handlers);},removeEventListener(name,fn){listeners.set(name,(listeners.get(name)||[]).filter(handler=>handler!==fn));},
  BBHome:{actor:()=>currentActor,previewShoppingNeed:request=>{previews.push(request);throw Error('Direct shopping entry must not preview pantry stock');},
   addShoppingBuy:request=>{writes.push(request);return options.add?options.add(request,writes.length):{ok:true,message:'Item added to shopping.'};}}
 };
 vm.runInNewContext(source,{window:win});const container=new Node('div');doc.body.append(container);const view=win.BBShopAdd.mount({container,win,onSaved:result=>saved.push(result)});
 const field=name=>walk(doc.body).find(node=>node.name===name),button=text=>walk(doc.body).find(node=>node.tagName==='BUTTON'&&node.textContent===text),dialog=()=>doc.body.querySelector('dialog');
 return {doc,win,view,previews,writes,saved,field,button,dialog,text:()=>doc.body.textContent,
  async open(){await button('Add item to buy').fire('click');await next();},
  async fill(name,qty='1'){field('name').value=name;field('quantityText').value=String(qty);await field('quantityText').fire('input');await next();},
  submit:()=>doc.body.querySelector('form').fire('submit'),setPremium:value=>{currentPremium=value;},setActor:value=>{currentActor=value;},setDeleting:value=>{deleting=value;},
  dispatch(name){for(const fn of listeners.get(name)||[])fn();}
 };
}

test('manual Shop entry has exactly Item and Quantity to buy, with no pantry preview or extra confirmation',async()=>{
 const h=fixture();assert.ok(h.button('Add item to buy'));assert.equal(h.writes.length,0);await h.open();
 assert.equal(h.doc.body.querySelectorAll('input').length,2);assert.equal(h.doc.body.querySelectorAll('select').length,0);assert.equal(h.field('quantityText').value,'1');
 assert.doesNotMatch(h.text(),/Total needed|Already at home|Still to buy|Refresh amounts|Update At home|Item type/);
 await h.fill('Milk','4');assert.equal(h.previews.length,0);assert.equal(h.writes.length,0);await h.submit();
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].name,'Milk');assert.equal(h.writes[0].quantityText,'4');assert.equal(h.writes[0].actorId,'alice');assert.equal(Object.hasOwn(h.writes[0],'expected'),false);assert.equal(Object.hasOwn(h.writes[0],'kind'),false);
 assert.equal(h.saved.length,1);assert.equal(h.dialog(),null);assert.match(h.text(),/Item added/);assert.equal(h.doc.body.style.overflow,'auto');
});

test('units can be typed into the quantity field without a mandatory unit selector',async()=>{
 for(const amount of ['2 packs','500 g','0.5 kg','750 ml']){
  const h=fixture();await h.open();await h.fill('Shopping item',amount);await h.submit();assert.equal(h.writes[0].quantityText,amount);assert.equal(h.doc.body.querySelector('select'),null);assert.equal(h.previews.length,0);
 }
});

test('the default quantity adds one item in one submit',async()=>{
 const h=fixture();await h.open();h.field('name').value='Bin bags';await h.field('name').fire('input');await h.submit();assert.equal(h.writes.length,1);assert.equal(h.writes[0].quantityText,'1');
});

test('pending submission disables edits and double submits create only one request',async()=>{
 let resolve;const h=fixture({add:()=>new Promise(done=>{resolve=done;})});await h.open();await h.fill('Milk','4');const first=h.submit();await next();await h.submit();
 assert.equal(h.writes.length,1);assert.equal(h.field('name').disabled,true);assert.equal(h.field('quantityText').disabled,true);assert.equal(h.button('Cancel').disabled,true);
 let prevented=false;await h.dialog().fire('cancel',{preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.ok(h.dialog());
 resolve({ok:true,message:'Milk added.'});await first;assert.equal(h.saved.length,1);assert.equal(h.dialog(),null);
});

test('an account switch freezes the old form before it can add an item',async()=>{
 const h=fixture();await h.open();await h.fill('Rice','4');h.setActor('bob');h.dispatch('basketboss:session-changed');await h.submit();
 assert.equal(h.writes.length,0);assert.equal(h.field('name').disabled,true);assert.match(h.text(),/Your account changed/);await h.button('Cancel').fire('click');assert.equal(h.dialog(),null);
});

test('a late save for an old account cannot trigger a current-account UI callback',async()=>{
 let resolve;const h=fixture({add:()=>new Promise(done=>{resolve=done;})});await h.open();await h.fill('Rice','4');const pending=h.submit();await next();h.setActor('bob');h.dispatch('basketboss:session-changed');
 resolve({ok:true,message:'Saved for original actor.'});await pending;assert.equal(h.saved.length,0);assert.equal(h.field('name').disabled,true);assert.equal(h.button('Cancel').disabled,false);assert.match(h.text(),/Your account changed/);
});

test('a failed direct addition keeps Item and Quantity editable without adding a preview step',async()=>{
 const h=fixture({add:(_request,count)=>count===1?{ok:false,message:'Enter a valid quantity, such as 2 packs or 500 g.'}:{ok:true,message:'Added.'}});await h.open();await h.fill('Pasta','bad amount');await h.submit();
 assert.equal(h.saved.length,0);assert.equal(h.field('name').value,'Pasta');assert.equal(h.field('quantityText').value,'bad amount');assert.equal(h.field('quantityText').disabled,false);assert.match(h.text(),/Enter a valid quantity/);
 await h.fill('Pasta','500 g');await h.submit();assert.equal(h.writes.length,2);assert.equal(h.saved.length,1);assert.notEqual(h.writes[1].requestId,h.writes[0].requestId);assert.equal(h.previews.length,0);
});

test('retrying the same uncertain addition reuses its identity rather than creating another buy intent',async()=>{
 const intents=new Set();const h=fixture({add:request=>{if(!intents.has(request.requestId)){intents.add(request.requestId);throw Error('UI interrupted after commit');}return {ok:true,already:true,message:'Item already added.'};}});
 await h.open();await h.fill('Rice','4');await h.submit();assert.equal(h.saved.length,0);assert.equal(h.field('name').value,'Rice');await h.submit();
 assert.equal(h.writes.length,2);assert.equal(h.writes[1].requestId,h.writes[0].requestId);assert.equal(intents.size,1);assert.equal(h.saved.length,1);assert.equal(h.dialog(),null);
});

test('blank item or quantity never reaches the core addition',async()=>{
 const h=fixture();await h.open();await h.fill('','4');await h.submit();await h.fill('Milk','');await h.submit();assert.equal(h.writes.length,0);assert.match(h.text(),/Enter an item/);
});

test('disposing Shop closes its form and suppresses a late UI callback',async()=>{
 let resolve;const h=fixture({add:()=>new Promise(done=>{resolve=done;})});await h.open();await h.fill('Rice','4');const pending=h.submit();await next();h.view.dispose();resolve({ok:true,message:'Added.'});await pending;
 assert.equal(h.saved.length,0);assert.equal(h.dialog(),null);assert.equal(h.button('Add item to buy'),undefined);assert.equal(h.doc.body.style.overflow,'auto');
});

test('the two-field form stays inside the visible keyboard viewport and removes its listeners on close',async()=>{
 const h=fixture(),handlers=new Map();h.win.innerHeight=844;h.win.visualViewport={height:844,offsetTop:0,addEventListener(name,fn){handlers.set(name,fn);},removeEventListener(name,fn){if(handlers.get(name)===fn)handlers.delete(name);}};
 await h.open();assert.equal(h.dialog().style.maxHeight,'');h.win.visualViewport.height=480;h.win.visualViewport.offsetTop=40;handlers.get('resize')();
 assert.equal(h.dialog().style.maxHeight,'456px');assert.equal(h.dialog().style.top,'52px');assert.equal(h.previews.length,0);assert.equal(h.writes.length,0);
 h.win.visualViewport.height=844;h.win.visualViewport.offsetTop=0;handlers.get('resize')();assert.equal(h.dialog().style.maxHeight,'');assert.equal(h.dialog().style.top,'');await h.button('Cancel').fire('click');assert.equal(handlers.size,0);
});

function realHomeFixture(){
 const h=fixture(),homeKey='basketboss_at_home_requirements_v1',stockKey='basketboss_321_v7_measured_pantry',inventoryKey='basketboss_makeameal_v1_inventory';
 const values=new Map([[stockKey,JSON.stringify({'eggs|each':10})],[inventoryKey,JSON.stringify({eggs:{name:'Eggs',qty:10,unit:'each',selected:true}})],['basketboss_cloud_session_v1',JSON.stringify({user:{id:'alice'}})],['basketboss_321_unified_state_v1',JSON.stringify({planned:[]})]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},id=(name,unit)=>name.toLowerCase()+'|'+unit;
 const household=[{id:'bin-bags',name:'Bin bags',unit:'pack',qty:0,ownedQty:10,targetQty:10,manualPending:false}];
 h.win.localStorage=storage;h.win.location={search:''};h.win.BBHomeHost={id,keys:()=>({stock:stockKey,inventory:inventoryKey}),stock:()=>JSON.parse(storage.getItem(stockKey)),requirements:()=>[],household:()=>household,shoppingKind:name=>name==='Bin bags'?'household':'food',shoppingPurchaseContext:()=>({shopSessionId:'trip',quantity:0}),refresh(){}};
 h.win.BBHome=install(h.win);return {...h,values,storage,homeKey,stockKey,inventoryKey,household};
}

test('real BBHome: buying four remains four even when At home has ten',async()=>{
 const h=realHomeFixture(),before=new Map(h.values);await h.open();await h.fill('Eggs','4');assert.deepEqual(h.values,before);await h.submit();
 assert.equal(h.saved.length,1);const rows=h.win.BBHome.manualBuyItems([]);assert.equal(rows.length,1);assert.equal(rows[0].toBuy,4);assert.equal(rows[0].manualBuyQty,4);
 assert.equal(h.storage.getItem(h.stockKey),before.get(h.stockKey));assert.equal(h.storage.getItem(h.inventoryKey),before.get(h.inventoryKey));assert.deepEqual([...h.values.keys()].filter(key=>h.values.get(key)!==before.get(key)),[h.homeKey]);
});

test('real BBHome: a direct buy adds to automatic shopping without subtracting pantry again',async()=>{
 const h=realHomeFixture();await h.open();await h.fill('Eggs','4');await h.submit();
 const rows=h.win.BBHome.manualBuyItems([{key:'Eggs',unit:'each',required:12,toBuy:2,pantryUsed:10,spend:1}]);assert.equal(rows.length,1);assert.equal(rows[0].toBuy,6);assert.equal(rows[0].pantryUsed,10);assert.equal(h.win.BBHome.shoppingBuys()[0].quantity,4);
});

test('real BBHome: typed weights and packs are parsed without another form step',async()=>{
 for(const [item,quantity,expected,unit]of [['Pasta','500 g',500,'g'],['Pasta','0.5 kg',500,'g'],['Milk','750 ml',750,'ml'],['Bin bags','2 packs',2,'pack']]){
  const h=realHomeFixture();await h.open();await h.fill(item,quantity);await h.submit();assert.equal(h.saved.length,1,quantity);const row=h.win.BBHome.shoppingBuys()[0];assert.equal(row.quantity,expected,quantity);assert.equal(row.unit,unit,quantity);assert.equal(h.storage.getItem(h.stockKey),JSON.stringify({'eggs|each':10}));
 }
});

test('real BBHome: household type is inferred and the entered buy amount ignores owned essentials',async()=>{
 const h=realHomeFixture(),original=JSON.stringify(h.household);await h.open();await h.fill('Bin bags','4 packs');await h.submit();
 assert.equal(h.saved.length,1);const rows=h.win.BBHome.manualBuyEssentials(h.household);assert.equal(rows.length,1);assert.equal(rows[0].qty,4);assert.equal(rows[0].manualBuyQty,4);assert.equal(h.win.BBHome.shoppingBuys()[0].kind,'household');assert.equal(JSON.stringify(h.household),original);
});

test('real BBHome: a repaint failure after commit still closes the form as saved',async()=>{
 const h=realHomeFixture();h.win.BBHomeHost.refresh=()=>{throw Error('View replaced');};await h.open();await h.fill('Eggs','4');await h.submit();
 assert.equal(h.saved.length,1);assert.equal(h.dialog(),null);assert.equal(h.win.BBHome.shoppingBuys().length,1);assert.equal(h.win.BBHome.manualBuyItems([])[0].toBuy,4);
});

test('Premium quick-add reveals only an optional reduced-price field and submits one paid purchase',async()=>{
 const h=fixture({premium:true});await h.open();await h.fill('Rice','500 g');assert.ok(h.field('boughtReduced'));assert.equal(h.field('reducedPrice').parentNode.hidden,true);h.field('boughtReduced').checked=true;await h.field('boughtReduced').fire('change');assert.equal(h.field('reducedPrice').parentNode.hidden,false);assert.equal(h.button('Record reduced purchase').disabled,true);
 h.field('reducedPrice').value='1.25';await h.field('reducedPrice').fire('input');await h.submit();assert.equal(h.writes.length,1);assert.equal(h.writes[0].reduced.pricePaid,1.25);assert.equal(h.writes[0].quantityText,'500 g');assert.equal(h.dialog(),null);
});
test('losing Premium while the optional reduced form is open prevents a paid purchase commit',async()=>{
 const h=fixture({premium:true});await h.open();await h.fill('Rice','500 g');h.field('boughtReduced').checked=true;await h.field('boughtReduced').fire('change');h.field('reducedPrice').value='1';h.setPremium(false);await h.submit();assert.equal(h.writes.length,0);assert.match(h.text(),/Premium/);
});
test('an unused Premium reduced toggle leaves the ordinary two-field request unchanged',async()=>{
 const h=fixture({premium:true});await h.open();await h.fill('Milk','1 l');await h.submit();assert.equal(h.writes.length,1);assert.equal(Object.hasOwn(h.writes[0],'reduced'),false);
});
