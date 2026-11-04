import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-day-done.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({preview,finish,reviewDay,day='Monday'}={}){
 let doc,actor='actor-one';
 class Element{
  constructor(tag){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.events=new Map();this._text='';this.disabled=false;}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children.forEach(node=>node.parentNode=null);this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key];}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  focus(){doc.activeElement=this;}
  addEventListener(key,fn){const callbacks=this.events.get(key)||[];callbacks.push(fn);this.events.set(key,callbacks);}
  fire(key,event={}){event.preventDefault??=()=>{event.prevented=true;};for(const fn of this.events.get(key)||[])fn(event);return event;}
  click(){if(this.disabled)return;return this.onclick?.({preventDefault(){},stopPropagation(){}});}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
 }
 doc={createElement:tag=>new Element(tag)};doc.body=new Element('body');const container=new Element('div');doc.body.append(container);doc.activeElement=container;
 const calls=[],previews=[],confirmed=[],reviews=[];
 const normal={ok:true,fingerprint:'plan-one',items:[{kind:'dinner',name:'Vegetable stew',servings:4},{kind:'lunch',name:'Cheese sandwiches',servingsLabel:'2 children'},{kind:'dessert',name:'Apple crumble',already:true},{kind:'leftover',name:'Tuesday batch',servings:4}],rows:[{name:'Pasta',unit:'g',owned:500,deduct:200}],issues:[]};
 const win={document:doc,BBHome:{actor:()=>actor,previewDay(value){previews.push(value);return preview?preview(value,previews.length):normal;},finishDay(value){calls.push(value);return finish?finish(value,calls.length):Promise.resolve({ok:true,completedCount:3,message:'Day confirmed. At home updated.'});}},BBHomeHost:{}};
 if(reviewDay)win.BBHomeHost.reviewDay=value=>{reviews.push(value);reviewDay(value);};
 vm.runInNewContext(source,{window:win});
 const ui=win.BBDayDone.mount({container,day,win,onConfirmed:value=>confirmed.push(value)});
 const all=(node=doc.body)=>[node,...node.children.flatMap(child=>all(child))];
 const action=name=>all().find(node=>node.dataset.bbDayAction===name);
 const trigger=()=>all().find(node=>node.dataset.bbDayDone===day);
 const dialog=()=>all().find(node=>node.tagName==='dialog');
 return {ui,doc,container,win,previews,calls,confirmed,reviews,all,action,trigger,dialog,setActor:value=>{actor=value;},async open(){trigger().focus();trigger().click();await tick();}};
}

test('Day done reviews all planned food and quantities without consuming on mount or open',async()=>{
 const h=fixture();assert.equal(h.calls.length,0);assert.equal(h.previews.length,0);
 await h.open();assert.equal(h.calls.length,0);assert.equal(h.previews.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(h.previews[0])),{day:'Monday',actorId:'actor-one'});
 const text=h.dialog().textContent;
 for(const label of ['Vegetable stew','4 servings','Cheese sandwiches','2 children','Apple crumble','Already confirmed','Tuesday batch','Review ingredient amounts','Use up to 200 g'])assert.ok(text.includes(label),label);
 assert.equal(h.dialog().getAttribute('aria-modal'),'true');assert.ok(h.action('confirm'));
 h.action('close').click();assert.equal(h.dialog(),undefined);assert.equal(h.calls.length,0);assert.equal(h.doc.activeElement,h.trigger());
});

test('one explicit confirmation sends the reviewed fingerprint once and locks pending controls',async()=>{
 let resolve;
 const h=fixture({finish:()=>new Promise(done=>{resolve=done;})});await h.open();
 const confirm=h.action('confirm');confirm.click();confirm.click();
 assert.equal(h.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{day:'Monday',actorId:'actor-one',expected:'plan-one'});
 assert.equal(confirm.disabled,true);assert.equal(h.action('close').disabled,true);
 const cancel=h.dialog().fire('cancel');assert.equal(cancel.prevented,true);assert.ok(h.dialog());
 resolve({ok:true,completedCount:3,message:'Pantry updated for the remaining three meals.'});await tick();
 assert.equal(h.confirmed.length,1);assert.match(h.trigger().textContent,/✓/);assert.equal(h.action('confirm'),undefined);
 assert.match(h.dialog().textContent,/remaining three meals/);h.action('close').click();assert.equal(h.dialog(),undefined);
});

test('already confirmed days open a read-only result without another finish request',async()=>{
 const h=fixture({preview:()=>({ok:true,already:true,items:[{kind:'dinner',name:'Stew',already:true}],message:'This day is already confirmed.'})});await h.open();
 assert.equal(h.action('confirm'),undefined);assert.match(h.dialog().textContent,/already confirmed/);assert.match(h.trigger().textContent,/✓/);assert.equal(h.calls.length,0);
});

test('stale results require a fresh review before a second confirmation',async()=>{
 const h=fixture({preview:(_,n)=>({ok:true,fingerprint:'revision-'+n,rows:[],items:[],issues:[]}),finish:(_,n)=>Promise.resolve(n===1?{ok:false,needsReview:true,message:'Your pantry changed.'}:{ok:true,completedCount:1,message:'Updated.'})});await h.open();
 await h.action('confirm').click();assert.equal(h.confirmed.length,0);assert.equal(h.calls.length,1);assert.match(h.dialog().textContent,/pantry changed/);
 h.action('refresh').click();await tick();assert.equal(h.calls.length,1);assert.equal(h.previews.length,2);
 await h.action('confirm').click();assert.equal(h.calls.length,2);assert.equal(h.calls[1].expected,'revision-2');assert.equal(h.confirmed.length,1);
});

test('blocked batch or manual food cannot confirm and can open the host review',async()=>{
 const h=fixture({preview:()=>({ok:false,items:[{kind:'leftover',name:'Leftover curry'}],issues:[{message:'Confirm Monday’s batch first.'}],message:'Review the source meal.'}),reviewDay(){}});await h.open();
 assert.equal(h.action('confirm'),undefined);assert.match(h.dialog().textContent,/Confirm Monday’s batch first/);h.action('review').click();
 assert.deepEqual(h.reviews,['Monday']);assert.equal(h.dialog(),undefined);assert.equal(h.calls.length,0);
});

test('an account change prevents submitting the old account’s review',async()=>{
 const h=fixture();await h.open();h.setActor('actor-two');await h.action('confirm').click();
 assert.equal(h.calls.length,0);assert.match(h.dialog().textContent,/account changed/);assert.equal(h.action('confirm').disabled,true);
 h.action('close').click();await h.open();assert.equal(h.previews.at(-1).actorId,'actor-two');
});

test('disposing a pending view cannot undo its authorized completion or update detached UI',async()=>{
 let resolve,committed=0;
 const h=fixture({finish:()=>new Promise(done=>{resolve=()=>{committed++;done({ok:true,completedCount:1,message:'Updated.'});};})});await h.open();h.action('confirm').click();h.ui.dispose();
 assert.equal(h.dialog(),undefined);assert.equal(h.trigger(),undefined);resolve();await tick();assert.equal(committed,1);assert.equal(h.confirmed.length,0);
});

test('failed completion requests offer refresh instead of reporting success',async()=>{
 const h=fixture({finish:()=>{throw Error('Network unavailable');}});await h.open();await h.action('confirm').click();
 assert.equal(h.confirmed.length,0);assert.ok(h.action('refresh'));assert.match(h.dialog().textContent,/could not be confirmed/);assert.equal(h.action('close').disabled,false);
});

test('opening or cancelling while a preview is pending never confirms food',async()=>{
 let resolve;
 const h=fixture({preview:()=>new Promise(done=>{resolve=done;})});await h.open();h.dialog().fire('cancel');assert.equal(h.dialog(),undefined);
 resolve({ok:true,fingerprint:'old',items:[],rows:[]});await tick();assert.equal(h.dialog(),undefined);assert.equal(h.calls.length,0);
});

test('invalid days do not create confirmation controls',()=>{
 const h=fixture({day:'Tomorrow'});assert.equal(h.ui,null);assert.equal(h.trigger(),undefined);assert.equal(h.calls.length,0);
});

test('day confirmation exposes conversion estimates and unknown unit fallbacks before commit',async()=>{
 const h=fixture({preview:()=>({ok:true,fingerprint:'units',items:[],rows:[{name:'Carrots',unit:'g',deduct:160,estimated:true,assumptions:['80 g per whole item']},{name:'Rice',unit:'g',deduct:0,issueLabel:'1 bag stays unchanged. Review At home.'}],issues:[{message:'Rice pack contents need review.'}]})});
 await h.open();const text=h.dialog().textContent;
 assert.match(text,/estimated ingredient weights/);assert.match(text,/80 g per whole item/);assert.match(text,/1 bag stays unchanged/);assert.equal(h.calls.length,0);assert.ok(h.action('confirm'));
});
