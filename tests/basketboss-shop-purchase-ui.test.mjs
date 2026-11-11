import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const ui=createRequire(import.meta.url)('../bb-shop-purchase-ui.js');
const KEY='basketboss_shop_pack_ui_v1';
const context=(extra={})=>({actor:'alice',trip:'trip-one',id:'pasta|g',unit:'g',...extra});
const selection=(extra={})=>({kind:'pack',packQuantity:500,packCount:1,quantity:500,unit:'g',label:'pack',boughtQtyOverride:500,...extra});
function storage(initial={}){
 const values=new Map(Object.entries(initial)),writes=[];
 return {values,writes,getItem:key=>values.get(key)??null,setItem(key,value){writes.push([key,String(value)]);values.set(key,String(value));},removeItem(key){writes.push([key,null]);values.delete(key);}};
}

test('display rounding produces readable strings without changing source amounts',()=>{
 const rows=Object.freeze([[466.666666666,'g','467 g'],[1000,'g','1 kg'],[1500,'g','1500 g'],[1.5,'kg','1500 g'],[2000,'ml','2 L'],[.000001,'g','<1 g'],[.6,'ml','<1 ml'],[0,'g','0 g'],[2.00000000001,'each','2 each'],[3.25,'each','4 each'],[2.5,'each','2.5 each']].map(Object.freeze)),before=JSON.stringify(rows);
 for(const [quantity,unit,expected]of rows)assert.equal(ui.formatDisplayQty(quantity,unit),expected);
 assert.equal(ui.formatDisplayQty(.000001,'each',{countMode:'balance'}),'<0.01 each');
 assert.equal(ui.formatDisplayQty(3.333333,'clove',{countMode:'balance'}),'3.33 cloves');
 assert.equal(ui.formatDisplayQty(1,'bulb'),'1 bulb');assert.equal(ui.formatDisplayQty(2,'loaf'),'2 loaves');
 for(const value of [null,undefined,'300',NaN,Infinity,-1])assert.equal(ui.formatDisplayQty(value,'g'),'Check amount');
 assert.equal(ui.formatDisplayQty(5,'mystery'),'Check unit');assert.equal(JSON.stringify(rows),before);
});

test('optional ingredient nouns distinguish counted garlic and eggs without altering their quantities',()=>{
 assert.equal(ui.amount('Garlic',1.2,'each',{noun:true}),'2 cloves');
 assert.equal(ui.amount('Eggs',.75,'each',{noun:true}),'1 egg');
 assert.equal(ui.amount('Eggs',.75,'each',{noun:true,countMode:'balance'}),'0.75 egg');
 assert.equal(ui.amount('Garlic',3,'each'),'3 each');assert.equal(ui.amount('Milk',466.66666,'ml',{noun:true}),'467 ml');
});

test('buying pills distinguish tubs, bulbs, exact weights and multiple counted packs',()=>{
 assert.equal(ui.buyingLabel(selection({packQuantity:300,quantity:300,boughtQtyOverride:300,label:'tub'}),'Coleslaw'),'Buying: 300 g tub');
 assert.equal(ui.buyingLabel(selection({unit:'each',packQuantity:10,quantity:10,boughtQtyOverride:10,label:'bulb'}),'Garlic'),'Buying: 1 bulb');
 assert.equal(ui.buyingLabel(selection({unit:'each',packQuantity:6,packCount:2,quantity:12,boughtQtyOverride:12}),'Eggs'),'Buying: 2 × 6 pk (12)');
 assert.equal(ui.buyingLabel(selection({kind:'exact'}),'Pasta'),'Buying: 500 g');assert.equal(ui.buyingLabel(null),'Choose buying amount');
});

test('price estimates retain the base without an override and use selected total quantities or manual totals',()=>{
 assert.equal(ui.estimatePrice(2,1000,null),2);assert.equal(ui.estimatePrice(2,1000,{}),2);
 assert.equal(ui.estimatePrice(2,1000,selection()),1);
 assert.equal(ui.estimatePrice(2,1000,selection({priceOverride:7.5})),7.5);
 assert.equal(ui.estimatePrice(2,1000,selection({priceOverride:0})),0);
 assert.equal(ui.estimatePrice(null,1000,null),null);assert.equal(ui.estimatePrice(2,0,selection()),null);
 assert.equal(ui.estimatePrice(2,1000,selection({priceOverride:-1})),null);
 assert.equal(ui.estimatePrice(2,1000,selection({boughtQtyOverride:0})),null);
});

test('reading UI plans is read-only and actor, trip, item and unit scoped',()=>{
 const saved=storage({'basketboss_321_v7_measured_pantry':'{"pasta|g":700}'}),plan=Object.freeze(selection()),pin=Object.freeze(context());
 assert.equal(ui.readPlan(saved,pin),null);assert.equal(saved.writes.length,0);
 assert.equal(ui.writePlan(saved,pin,plan).ok,true);assert.deepEqual(ui.readPlan(saved,pin),plan);
 for(const changed of [{actor:'bob'},{trip:'next-trip'},{id:'rice|g'},{unit:'ml'}])assert.equal(ui.readPlan(saved,context(changed)),null);
 const copy=ui.readPlan(saved,pin);copy.quantity=999;assert.equal(ui.readPlan(saved,pin).quantity,500);
 assert.equal(saved.getItem('basketboss_321_v7_measured_pantry'),'{"pasta|g":700}');assert.ok(saved.writes.every(([key])=>key===KEY));
});

test('UI plan validation rejects malformed contexts and inconsistent quantities without a write',()=>{
 for(const bad of [{actor:''},{actor:'__proto__'},{trip:'one\ntwo'},{id:'constructor'},{unit:'kg'},{unit:'ml\n'}]){
  const saved=storage();assert.equal(ui.writePlan(saved,context(bad),selection()).ok,false);assert.equal(saved.writes.length,0);
 }
 for(const bad of [{kind:'receipt'},{packCount:1.5},{packCount:0},{packQuantity:0},{quantity:600},{boughtQtyOverride:501},{unit:'ml'},{quantity:Infinity},{priceOverride:NaN},{label:'script'}]){
  const saved=storage();assert.equal(ui.writePlan(saved,context(),selection(bad)).ok,false);assert.equal(saved.writes.length,0);
 }
 const saved=storage({[KEY]:'{broken'});assert.equal(ui.readPlan(saved,context()),null);assert.equal(saved.writes.length,0);assert.equal(ui.writePlan(saved,context(),selection()).ok,false);assert.equal(saved.getItem(KEY),'{broken');
});

test('UI plan rollback restores exactly its prior bytes and refuses to overwrite a newer choice',()=>{
 const saved=storage(),first=ui.writePlan(saved,context(),selection());assert.equal(first.ok,true);assert.equal(first.rollback(),true);assert.equal(saved.getItem(KEY),null);assert.equal(first.rollback(),false);
 ui.writePlan(saved,context(),selection());const before=saved.getItem(KEY),change=ui.writePlan(saved,context(),selection({priceOverride:0}));assert.equal(change.ok,true);assert.equal(change.rollback(),true);assert.equal(saved.getItem(KEY),before);
 const stale=ui.writePlan(saved,context(),selection({priceOverride:3}));ui.writePlan(saved,context(),selection({priceOverride:4}));const current=saved.getItem(KEY);assert.equal(stale.rollback(),false);assert.equal(saved.getItem(KEY),current);
});

test('quota and concurrent writes cannot change pantry or erase a newer UI plan',()=>{
 const saved=storage({'basketboss_321_v7_measured_pantry':'{"milk|ml":700}'}),before=[...saved.values];saved.setItem=()=>{throw Error('quota');};
 assert.equal(ui.writePlan(saved,context(),selection()).ok,false);assert.deepEqual([...saved.values],before);
 const afterWrite=storage();afterWrite.setItem=(key,value)=>{afterWrite.values.set(key,String(value));throw Error('quota after write');};assert.equal(ui.writePlan(afterWrite,context(),selection()).ok,false);assert.equal(afterWrite.getItem(KEY),null);
 const conflict=storage(),other=JSON.stringify({version:1,plans:[]});let reads=0;conflict.getItem=key=>{if(++reads===2)conflict.values.set(KEY,other);return conflict.values.get(key)??null;};
 assert.equal(ui.writePlan(conflict,context(),selection()).ok,false);assert.equal(conflict.values.get(KEY),other);assert.equal(conflict.writes.length,0);
});

test('UI plan storage stays bounded and keeps the newest isolated item choices',()=>{
 const saved=storage();for(let index=0;index<257;index++)assert.equal(ui.writePlan(saved,context({id:'item-'+index}),selection()).ok,true);
 assert.equal(JSON.parse(saved.getItem(KEY)).plans.length,256);assert.equal(ui.readPlan(saved,context({id:'item-0'})),null);assert.ok(ui.readPlan(saved,context({id:'item-256'})));
});

function fixture(options={}){
 let doc;const walk=node=>[node,...node.children.flatMap(walk)];
 class Node{
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parentNode:null,ownerDocument:doc,className:'',attributes:new Map(),events:new Map(),dataset:{},value:'',disabled:false,hidden:false,_text:''});}
  set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.get(key)??null;}
  removeAttribute(key){this.attributes.delete(key);}
  addEventListener(name,callback){const list=this.events.get(name)||[];list.push(callback);this.events.set(name,list);}
  async fire(name,event={}){const data={target:this,preventDefault(){},stopPropagation(){},...event};for(const callback of this.events.get(name)||[])await callback(data);}
  matches(selector){if(selector.startsWith('.'))return this.className.split(/\s+/).includes(selector.slice(1));const attr=selector.match(/^\[data-([^=\]]+)(?:="([^"]*)")?\]$/);if(attr){const key=attr[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return Object.hasOwn(this.dataset,key)&&(attr[2]===undefined||this.dataset[key]===attr[2]);}return this.tagName.toLowerCase()===selector;}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  get isConnected(){return this===doc.body||this.parentNode?.isConnected===true;}
  focus(){doc.activeElement=this;}
 }
 doc={createElement:tag=>new Node(tag)};doc.body=new Node('body');doc.activeElement=doc.body;
 const saved=storage({'basketboss_321_v7_measured_pantry':'{"pasta|g":700}'}),calls=[];
 const win={document:doc,localStorage:saved,BBPriceV19:{money:value=>'£'+value.toFixed(2)}};
 const recommended=Object.freeze(selection({packQuantity:1000,quantity:1000,boughtQtyOverride:1000}));
 const picker=ui.createPicker({win,name:'Pasta',unit:'g',needed:466.666666666,recommended,baseEstimatedPrice:2,defaultPackQty:1000,onSave:async chosen=>{calls.push(chosen);return options.save?options.save(chosen):{ok:true};},...options});
 const container=new Node('div');if(options.mount!==false)doc.body.append(container);container.append(picker.button,picker.editor);
 const find=selector=>picker.editor.querySelector(selector);
 return {doc,win,picker,saved,calls,container,find,preset:key=>find('[data-bb-pack-preset="'+key+'"]'),count:direction=>find('[data-bb-pack-count="'+direction+'"]'),custom:()=>find('[data-bb-pack-custom]'),price:()=>find('[data-bb-pack-price]'),save:()=>find('.bb-shop-pack-save'),status:()=>find('.bb-shop-pack-status')};
}

test('creating and opening the inline picker is read-only and leaves initial objects intact',()=>{
 const initial=Object.freeze(selection({priceOverride:3})),before=JSON.stringify(initial),h=fixture({initial});
 assert.equal(h.picker.editor.hidden,true);assert.equal(h.picker.button.getAttribute('aria-expanded'),'false');h.picker.open();
 assert.equal(h.picker.editor.hidden,false);assert.equal(h.picker.button.getAttribute('aria-expanded'),'true');assert.equal(h.calls.length,0);assert.equal(h.saved.writes.length,0);assert.equal(JSON.stringify(initial),before);
 h.picker.close();assert.equal(h.picker.editor.hidden,true);assert.equal(h.doc.body.querySelector('dialog'),null);
});

test('ordinary presets only create a plan when Save is pressed and never credit physical stock',async()=>{
 const h=fixture(),before=[...h.saved.values];h.picker.open();assert.equal(h.preset('exact').textContent,'Exact (467 g)');await h.preset('500').fire('click');assert.equal(h.calls.length,0);assert.deepEqual([...h.saved.values],before);
 await h.save().fire('click');assert.equal(h.calls.length,1);assert.equal(h.calls[0].quantity,500);assert.equal(h.calls[0].boughtQtyOverride,500);assert.equal(Object.isFrozen(h.calls[0]),true);
 assert.equal(h.picker.button.textContent,'Buying: 500 g pack');assert.equal(h.picker.editor.hidden,true);assert.deepEqual([...h.saved.values],before);
});

test('quick presets save once on one tap and ignore overlapping clicks while awaiting the host',async()=>{
 let release;const h=fixture({quickPresets:true,save:()=>new Promise(resolve=>{release=resolve;})});h.picker.open();
 const saving=h.preset('500').fire('click');await Promise.resolve();assert.equal(h.calls.length,1);assert.equal(h.save().disabled,true);await h.preset('250').fire('click');assert.equal(h.calls.length,1);
 release({ok:true});await saving;assert.equal(h.picker.button.textContent,'Buying: 500 g pack');assert.equal(h.picker.editor.hidden,true);assert.equal(h.saved.writes.length,0);
});

test('count packs and a manual total price remain explicit until Save',async()=>{
 const h=fixture({name:'Eggs',unit:'each',needed:5,recommended:selection({unit:'each',packQuantity:6,quantity:6,boughtQtyOverride:6}),baseEstimatedPrice:3,defaultPackQty:6});
 h.picker.open();assert.equal(h.preset('exact').textContent,'Exact (5)');await h.preset('6').fire('click');await h.count('plus').fire('click');assert.equal(h.calls.length,0);
 await h.preset('custom').fire('click');assert.equal(h.doc.activeElement,h.custom());h.price().value='7.50';await h.price().fire('input');await h.save().fire('click');
 assert.equal(h.calls[0].kind,'pack');assert.equal(h.calls[0].quantity,12);assert.equal(h.calls[0].packCount,2);assert.equal(h.calls[0].priceOverride,7.5);assert.equal(h.picker.button.textContent,'Buying: 2 × 6 pk (12)');
 h.picker.open();await h.count('plus').fire('click');assert.equal(h.price().value,'','a changed buying quantity clears a stale manual TOTAL price');
});

test('garlic offers physical bulbs instead of presenting a ten-clove pack',async()=>{
 const h=fixture({name:'Garlic',unit:'each',needed:9,recommended:selection({unit:'each',packQuantity:10,quantity:10,boughtQtyOverride:10,label:'bulb'})});
 h.picker.open();assert.equal(h.picker.button.textContent,'Buying: 1 bulb');assert.equal(h.preset('10'),null);assert.equal(h.preset('bulb-2').textContent,'2 bulbs');await h.preset('bulb-2').fire('click');await h.save().fire('click');
 assert.equal(h.calls[0].quantity,20);assert.equal(h.calls[0].packQuantity,10);assert.equal(h.calls[0].packCount,2);assert.equal(h.picker.button.textContent,'Buying: 2 bulbs');
});

test('custom amounts retain exact input precision and a manual zero price is valid',async()=>{
 const h=fixture();h.picker.open();await h.preset('custom').fire('click');h.custom().value='0.000001';await h.custom().fire('input');assert.equal(h.custom().value,'0.000001');h.price().value='0';await h.price().fire('input');await h.save().fire('click');
 assert.equal(h.calls[0].quantity,.000001);assert.equal(h.calls[0].boughtQtyOverride,.000001);assert.equal(h.calls[0].priceOverride,0);assert.equal(h.picker.button.textContent,'Buying: <1 g');
});

test('invalid custom input stays editable without a save or a rounded replacement',async()=>{
 const h=fixture();h.picker.open();await h.preset('custom').fire('click');h.custom().value='';await h.custom().fire('input');assert.equal(h.save().disabled,true);await h.save().fire('click');assert.equal(h.calls.length,0);assert.equal(h.custom().value,'');
 h.custom().value='500.000001';await h.custom().fire('input');assert.equal(h.custom().value,'500.000001');h.price().value='-1';await h.price().fire('input');assert.equal(h.save().disabled,true);assert.equal(h.calls.length,0);
});

test('a failed host save preserves the draft, and Cancel reopens the last saved choice',async()=>{
 const h=fixture({save:()=>({ok:false,message:'Reopen the changed shopping item.'})});h.picker.open();await h.preset('500').fire('click');await h.save().fire('click');
 assert.equal(h.status().textContent,'Reopen the changed shopping item.');assert.equal(h.save().disabled,false);assert.equal(h.picker.editor.hidden,false);assert.equal(h.custom().value,'500');assert.equal(h.picker.button.textContent,'Buying: 1 kg pack');
 await h.find('.bb-shop-pack-cancel').fire('click');h.picker.open();assert.equal(h.custom().value,'1000');
});

test('detached picker nodes cannot initiate a save or receive a late host result',async()=>{
 const unmounted=fixture({mount:false});unmounted.picker.open();await unmounted.save().fire('click');assert.equal(unmounted.calls.length,0);
 let release;const h=fixture({save:()=>new Promise(resolve=>{release=resolve;})});h.picker.open();await h.preset('500').fire('click');const pending=h.save().fire('click');await Promise.resolve();h.picker.editor.remove();release({ok:true});await pending;assert.equal(h.picker.button.textContent,'Buying: 1 kg pack');assert.equal(h.calls.length,1);
});

test('an exact zero requirement cannot manufacture a one-item purchase plan',async()=>{
 const h=fixture({needed:0,recommended:null});h.picker.open();assert.equal(h.preset('exact').textContent,'Exact (0 g)');assert.equal(h.preset('exact').disabled,true);assert.equal(h.save().disabled,true);await h.save().fire('click');assert.equal(h.calls.length,0);
});
