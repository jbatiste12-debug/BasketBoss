import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-day-done.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({preview,finish,reviewDay,undoPreview,undo,complete=false,day='Monday',lunchWeek=false,receipt}={}){
 let doc,actor='actor-one',session='original-session';
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
 const calls=[],previews=[],confirmed=[],reviews=[],undoPreviews=[],undos=[],undone=[];
 const normal={ok:true,fingerprint:'plan-one',items:[{kind:'dinner',name:'Vegetable stew',servings:4},{kind:'lunch',name:'Cheese sandwiches',servingsLabel:'2 children'},{kind:'dessert',name:'Apple crumble',already:true},{kind:'leftover',name:'Tuesday batch',servings:4}],rows:[{name:'Pasta',unit:'g',required:200,owned:500,deduct:200}],issues:[]};
 const win={document:doc,localStorage:{getItem:()=>session},BBHome:{actor:()=>actor,isCooked:()=>complete,previewDay(value){previews.push(value);return preview?preview(value,previews.length):normal;},finishDay(value){calls.push(value);return finish?finish(value,calls.length):Promise.resolve({ok:true,completedCount:3,message:'Day confirmed. At home updated.'});}},BBHomeHost:{dayMeals:()=>[{occurrence:'week|dinner|Monday|stew'}]}};
 if(undoPreview)win.BBHome.previewUndoDay=value=>{undoPreviews.push(value);return undoPreview(value,undoPreviews.length);};
 if(undo)win.BBHome.undoDay=value=>{undos.push(value);return undo(value,undos.length);};
 if(reviewDay)win.BBHomeHost.reviewDay=value=>{reviews.push(value);reviewDay(value);};
 if(receipt)win.BBReceiptHost=receipt;
 win.BBHome.previewLunchWeek=win.BBHome.previewDay;win.BBHome.finishLunchWeek=win.BBHome.finishDay;win.BBHomeHost.schoolLunchWeekMeals=win.BBHomeHost.dayMeals;
 vm.runInNewContext(source,{window:win});
 const ui=win.BBDayDone[lunchWeek?'mountLunchWeek':'mount']({container,day,win,onConfirmed:value=>confirmed.push(value),onUndone:value=>undone.push(value)});
 const all=(node=doc.body)=>[node,...node.children.flatMap(child=>all(child))];
 const action=name=>all().find(node=>node.dataset.bbDayAction===name);
 const trigger=()=>all().find(node=>lunchWeek?node.dataset.bbLunchWeekDone==='true':node.dataset.bbDayDone===day);
 const dialog=()=>all().find(node=>node.tagName==='dialog');
 return {ui,doc,container,win,previews,calls,confirmed,reviews,undoPreviews,undos,undone,all,action,trigger,dialog,setActor:value=>{actor=value;},setSession:value=>{session=value;},setComplete:value=>{complete=value;},async open(){trigger().focus();trigger().click();await tick();}};
}

test('Day done reviews all planned food and quantities without consuming on mount or open',async()=>{
 const h=fixture();assert.equal(h.calls.length,0);assert.equal(h.previews.length,0);
 await h.open();assert.equal(h.calls.length,0);assert.equal(h.previews.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(h.previews[0])),{day:'Monday',actorId:'actor-one'});
 const text=h.dialog().textContent;
 for(const label of ['Vegetable stew','4 servings','Cheese sandwiches','2 children','Apple crumble','Already confirmed','Tuesday batch','Confirm ingredients used','Ingredients used','200 g'])assert.ok(text.includes(label),label);
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
 assert.equal(h.confirmed.length,1);assert.equal(h.trigger().textContent,'Undo day done');assert.equal(h.action('confirm'),undefined);
 assert.match(h.dialog().textContent,/remaining three meals/);h.action('close').click();assert.equal(h.dialog(),undefined);
});

test('already confirmed days open a read-only result without another finish request',async()=>{
 const h=fixture({preview:()=>({ok:true,already:true,items:[{kind:'dinner',name:'Stew',already:true}],message:'This day is already confirmed.'})});await h.open();
 assert.equal(h.action('confirm'),undefined);assert.match(h.dialog().textContent,/already confirmed/);assert.equal(h.trigger().textContent,'Undo day done');assert.equal(h.calls.length,0);
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

const undoReady=()=>({ok:true,fingerprint:'undo-one',items:[{kind:'breakfast',name:'Porridge'},{kind:'dessert',name:'Apple crumble'}],rows:[{name:'Oats',unit:'g',restore:80}],issues:[]});

test('a completed day offers a read-only undo review and cancelling restores nothing',async()=>{
 const h=fixture({complete:true,undoPreview:undoReady,undo:()=>({ok:true})});
 assert.equal(h.trigger().textContent,'Undo day done');assert.equal(h.undoPreviews.length,0);
 await h.open();assert.equal(h.previews.length,0);assert.equal(h.undoPreviews.length,1);assert.equal(h.undos.length,0);assert.equal(h.calls.length,0);
 assert.deepEqual(JSON.parse(JSON.stringify(h.undoPreviews[0])),{day:'Monday',actorId:'actor-one'});
 for(const text of ['Undo Monday Day done?','Meals you cooked earlier stay confirmed.','Breakfast','Bake / dessert','Return to At home','80 g'])assert.ok(h.dialog().textContent.includes(text),text);
 assert.ok(h.action('undo'));h.action('close').click();assert.equal(h.dialog(),undefined);assert.equal(h.undos.length,0);assert.equal(h.doc.activeElement,h.trigger());
});

test('undo submits the reviewed fingerprint once, locks every action and refreshes completion from the ledger',async()=>{
 let resolve;
 const h=fixture({complete:true,undoPreview:undoReady,undo:()=>new Promise(done=>{resolve=done;})});await h.open();
 const confirm=h.action('undo');confirm.click();confirm.click();assert.equal(h.undos.length,1);assert.equal(h.calls.length,0);
 assert.deepEqual(JSON.parse(JSON.stringify(h.undos[0])),{day:'Monday',actorId:'actor-one',expected:'undo-one'});
 assert.equal(confirm.disabled,true);assert.equal(h.action('close').disabled,true);assert.equal(h.trigger().disabled,true);assert.equal(h.dialog().fire('cancel').prevented,true);
 h.setComplete(false);resolve({ok:true,restoredCount:2,remainingConfirmedCount:1,message:'Two meals reopened; your earlier dinner stays confirmed.'});await tick();
 assert.equal(h.undone.length,1);assert.equal(h.confirmed.length,0);assert.equal(h.action('undo'),undefined);assert.equal(h.trigger().textContent,'Day done');assert.equal(h.trigger().disabled,false);assert.match(h.dialog().textContent,/earlier dinner stays confirmed/);
});

test('a partial day can review its existing Day done action without completing the newly added meal',async()=>{
 const h=fixture({undoPreview:undoReady,undo:()=>({ok:true})});await h.open();
 assert.ok(h.action('confirm'));assert.ok(h.action('review-undo'));assert.equal(h.calls.length,0);h.action('review-undo').click();await tick();
 assert.equal(h.action('confirm'),undefined);assert.ok(h.action('undo'));assert.equal(h.calls.length,0);assert.equal(h.undos.length,0);
});

test('legacy days without a reversible record explain manual review and never expose an undo commit',async()=>{
 const h=fixture({complete:true,undoPreview:()=>({ok:false,needsReview:true,message:'This older confirmation has no saved undo record. Review your remaining pantry amounts.'}),undo:()=>({ok:true}),reviewDay(){}});await h.open();
 assert.equal(h.action('undo'),undefined);assert.equal(h.action('confirm'),undefined);assert.match(h.dialog().textContent,/no saved undo record/);assert.ok(h.action('review'));h.action('review').click();assert.deepEqual(h.reviews,['Monday']);assert.equal(h.undos.length,0);
 const unavailable=fixture({complete:true});await unavailable.open();assert.equal(unavailable.action('undo'),undefined);assert.match(unavailable.dialog().textContent,/no saved undo record/);
});

test('account and token changes while undo is previewed prevent submitting stale restoration',async()=>{
 for(const change of [h=>h.setActor('actor-two'),h=>h.setSession('refreshed-token')]){
  const h=fixture({complete:true,undoPreview:undoReady,undo:()=>({ok:true})});await h.open();change(h);h.action('undo').click();
  assert.equal(h.undos.length,0);assert.equal(h.action('undo').disabled,true);assert.match(h.dialog().textContent,/account changed or your session refreshed/);
 }
});

test('undo results arriving after account switching cannot update the new account view',async()=>{
 let resolve;const h=fixture({complete:true,undoPreview:undoReady,undo:()=>new Promise(done=>{resolve=done;})});await h.open();h.action('undo').click();
 h.setActor('actor-two');h.setComplete(false);resolve({ok:true,message:'Previous account restored.'});await tick();
 assert.equal(h.dialog(),undefined);assert.equal(h.trigger().textContent,'Day done');assert.equal(h.undone.length,0);assert.equal(h.trigger().disabled,false);
});

test('a stale undo requires a fresh preview before a second explicit commit',async()=>{
 const h=fixture({complete:true,undoPreview:(_,n)=>({...undoReady(),fingerprint:'undo-'+n}),undo:(_,n)=>n===1?{ok:false,needsReview:true,message:'Your pantry changed. Review the latest amounts.'}:{ok:true,message:'Restored.'}});await h.open();await h.action('undo').click();
 assert.equal(h.undone.length,0);assert.equal(h.undos.length,1);assert.ok(h.action('refresh'));h.action('refresh').click();await tick();assert.equal(h.undos.length,1);assert.equal(h.undoPreviews.length,2);
 h.setComplete(false);await h.action('undo').click();assert.equal(h.undos.length,2);assert.equal(h.undos[1].expected,'undo-2');assert.equal(h.undone.length,1);
});

test('an already undone result is read-only and a missing undo fingerprint fails closed',async()=>{
 const done=fixture({complete:true,undoPreview:()=>({ok:true,already:true,message:'This action has already been undone.'}),undo:()=>({ok:true})});await done.open();assert.equal(done.action('undo'),undefined);assert.equal(done.undos.length,0);assert.match(done.dialog().textContent,/already been undone/);
 const missing=fixture({complete:true,undoPreview:()=>({...undoReady(),fingerprint:null}),undo:()=>({ok:true})});await missing.open();assert.equal(missing.action('undo'),undefined);assert.match(missing.dialog().textContent,/could not be checked safely/);
});

test('undo cannot expose a commit for missing methods, unchecked rows or invalid restoration quantities',async()=>{
 for(const invalid of [value=>({...value,needsReview:true}),value=>({...value,rows:null}),value=>({...value,rows:[{name:'Oats',restore:null}]}),value=>({...value,rows:[{name:'Oats',restore:-1}]}),value=>({...value,rows:[{name:'Oats',restore:Infinity}]})]){
  const h=fixture({complete:true,undoPreview:()=>invalid(undoReady()),undo:()=>({ok:true})});await h.open();assert.equal(h.action('undo'),undefined);assert.equal(h.undos.length,0);assert.match(h.dialog().textContent,/could not be checked safely/);
 }
 const unavailable=fixture({complete:true,undoPreview:undoReady});await unavailable.open();assert.equal(unavailable.action('undo'),undefined);assert.match(unavailable.dialog().textContent,/could not be checked safely/);
});

const pantryBlocked=()=>({ok:false,needsReview:true,reviewAction:'pantry',pantryStatus:{ready:false,reason:'pantry_merge',message:'Review your saved amounts.',canReviewInline:true},items:[{kind:'dinner',name:'Fish finger tacos',servings:4}],rows:[{name:'Fish fingers',required:8,unit:'',planned:true}],issues:[],message:'Review your saved amounts.'});

test('pantry blockers keep planned ingredients visible and review current amounts inside the same dialog',async()=>{
 let options,disposed=0;
 const h=fixture({preview:(_,n)=>n===1?pantryBlocked():{ok:true,fingerprint:'after-review',items:[],rows:[{name:'Fish fingers',required:8,deduct:8,unit:''}]},reviewDay(){},receipt:{async reviewPantry(value){options=value;return {element:value.container,dispose(){disposed++;}};}}});
 await h.open();const original=h.dialog();assert.match(original.textContent,/Fish fingers8/);assert.equal(h.action('confirm'),undefined);assert.equal(h.action('review'),undefined);
 await h.action('review-pantry').click();assert.equal(h.dialog(),original);assert.equal(options.deferProjection,true);assert.equal(options.container.parentNode?.parentNode,original);assert.equal(h.calls.length,0);assert.equal(disposed,0);
 options.onConfirmed({ok:true});await tick();assert.equal(h.dialog(),original);assert.equal(h.previews.length,2);assert.equal(h.calls.length,0);assert.ok(h.action('confirm'));assert.equal(disposed,0);assert.deepEqual(h.reviews,[]);
 await h.action('confirm').click();assert.equal(h.calls.length,1);assert.equal(h.calls[0].expected,'after-review');assert.equal(disposed,0);h.action('close').click();assert.equal(disposed,1);assert.equal(h.dialog(),undefined);
});

test('cancelling inline pantry review never confirms and its controller stays held until outer close',async()=>{
 let options;const releases=[];const h=fixture({preview:pantryBlocked,receipt:{async reviewPantry(value){options=value;return {element:value.container,dispose:value=>releases.push(value)};}}});await h.open();await h.action('review-pantry').click();options.onCancel();
 assert.ok(h.dialog());assert.equal(h.action('confirm'),undefined);assert.equal(h.action('review-pantry').disabled,false);assert.equal(h.calls.length,0);assert.equal(releases.length,0);assert.match(h.dialog().textContent,/Pantry review cancelled/);
 h.action('close').click();assert.equal(releases.length,1);assert.equal(releases[0].refresh,true);
});

test('late inline controller and changed-account review callbacks cannot reload or leak a held projection',async()=>{
 for(const change of [h=>h.action('close').click(),h=>h.setActor('another-actor')]){
  let resolve,options;const releases=[];
  const h=fixture({preview:pantryBlocked,receipt:{reviewPantry(value){options=value;return new Promise(done=>{resolve=done;});}}});await h.open();const pending=h.action('review-pantry').click();change(h);options.onConfirmed({ok:true});resolve({element:options.container,dispose:value=>releases.push(value)});await pending;await tick();
  assert.equal(h.previews.length,1);assert.equal(h.calls.length,0);assert.equal(releases.length,1);assert.equal(releases[0].refresh,false);
 }
});

test('an account change prevents starting an inline pantry review',async()=>{
 let reviewCalls=0;const h=fixture({preview:pantryBlocked,receipt:{reviewPantry(){reviewCalls++;}}});await h.open();h.setSession('new-token');await h.action('review-pantry').click();assert.equal(reviewCalls,0);assert.equal(h.calls.length,0);
});

test('pending receipt status checks reload the same panel without submitting a meal confirmation',async()=>{
 let checks=0;const h=fixture({preview:()=>({...pantryBlocked(),pantryStatus:{ready:false,reason:'receipt_pending',canReviewInline:false}}),reviewDay(){},receipt:{recoverReceipt:async()=>{checks++;}}});await h.open();const original=h.dialog();await h.action('check-receipt').click();await tick();assert.equal(checks,1);assert.equal(h.previews.length,2);assert.equal(h.dialog(),original);assert.equal(h.calls.length,0);assert.equal(h.reviews.length,0);assert.equal(h.action('confirm'),undefined);
});

test('the required amount stays visible when recorded pantry deduction is capped or unknown',async()=>{
 const h=fixture({preview:()=>({ok:true,fingerprint:'planned',items:[],rows:[{name:'Fish fingers',required:8,deduct:3,unit:''},{name:'Lettuce',required:150,unit:'g',planned:true}],issues:[]})});await h.open();const text=h.dialog().textContent;
 assert.match(text,/Fish fingers8/);assert.match(text,/Planned 8; the recorded At home amount will reduce by 3/);assert.match(text,/Lettuce150 g/);assert.doesNotMatch(h.all().find(node=>node.className==='bb-day-done-amount'&&node.textContent.includes('Lettuce')).textContent,/At home|owned|remaining|reduce/i);assert.equal(h.all().filter(node=>node.tagName==='details').length,0);assert.equal(h.calls.length,0);
});

test('weekly school lunch review shares the panel and needs one explicit confirmation, with no weekly undo',async()=>{
 const h=fixture({lunchWeek:true,undoPreview:undoReady,undo:()=>({ok:true})});await h.open();assert.deepEqual(JSON.parse(JSON.stringify(h.previews[0])),{actorId:'actor-one'});assert.match(h.dialog().textContent,/Confirm school lunches for the week/);assert.equal(h.action('confirm').textContent,'Confirm lunches for the week');assert.equal(h.action('review-undo'),undefined);assert.equal(h.undoPreviews.length,0);assert.equal(h.calls.length,0);
 await h.action('confirm').click();assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{actorId:'actor-one',expected:'plan-one'});assert.equal(h.confirmed.length,1);assert.equal(h.trigger().textContent,'Review confirmed school lunches');assert.equal(h.action('review-undo'),undefined);assert.equal(h.undos.length,0);assert.ok(h.dialog());h.action('close').click();assert.equal(h.dialog(),undefined);
});

test('already confirmed weekly lunches stay read-only even when day undo is available',async()=>{
 const h=fixture({lunchWeek:true,complete:true,preview:()=>({ok:true,already:true,items:[{kind:'lunch',day:'Monday',name:'Cheese sandwiches',already:true}],rows:[]}),undoPreview:undoReady});await h.open();assert.equal(h.action('confirm'),undefined);assert.equal(h.action('undo'),undefined);assert.equal(h.undoPreviews.length,0);assert.match(h.dialog().textContent,/already confirmed/);assert.equal(h.calls.length,0);
});

test('weekly lunch days use one compact summary and keep combined ingredients outside collapsed meal details',async()=>{
 const days=['Monday','Tuesday','Wednesday','Thursday','Friday'];const h=fixture({lunchWeek:true,preview:()=>({ok:true,fingerprint:'week-five',items:days.map((day,index)=>({kind:'lunch',day,name:'Cheese sandwiches (2 children)',already:index<2})),rows:[{name:'Bread',unit:'slices',required:12,deduct:12}],issues:[]})});await h.open();
 const summary=h.all().find(node=>node.className==='bb-day-done-lunch-summary');assert.match(summary.textContent,/3 lunch days to confirm/);assert.match(summary.textContent,/Wednesday · Thursday · Friday/);assert.match(summary.textContent,/2 already confirmed/);assert.doesNotMatch(summary.textContent,/children/);
 const details=h.all().find(node=>node.className==='bb-day-done-lunch-details');assert.equal(details.open,undefined);assert.equal(details.children[0].textContent,'View planned lunches');assert.equal(details.children[1].children.length,5);
 const amounts=h.all().find(node=>node.className==='bb-day-done-amounts');assert.equal(amounts.parentNode,summary.parentNode);assert.equal(details.parentNode,amounts.parentNode);assert.ok(amounts.parentNode.children.indexOf(amounts)<amounts.parentNode.children.indexOf(details));assert.match(amounts.textContent,/Bread12 slices/);assert.equal(h.calls.length,0);assert.ok(h.action('confirm'));
});
