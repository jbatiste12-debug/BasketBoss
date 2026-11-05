import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const source=fs.readFileSync(new URL('../bb-day-done.js',import.meta.url),'utf8');
const {install}=createRequire(import.meta.url)('../bb-home.js');
const SESSION='basketboss_cloud_session_v1',PLAN='basketboss_321_unified_state_v1';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const clean=()=>({ok:true,fingerprint:'current-plan-and-stock',items:[{kind:'dinner',name:'Rice dinner'}],rows:[{name:'Rice',unit:'g',deduct:200}],issues:[]});

function dom(){
 let doc;
 class Target{
  constructor(){this.events=new Map();}
  addEventListener(name,fn){const values=this.events.get(name)||[];values.push(fn);this.events.set(name,values);}
  removeEventListener(name,fn){this.events.set(name,(this.events.get(name)||[]).filter(value=>value!==fn));}
  fire(name,event={}){event.preventDefault??=()=>{event.defaultPrevented=true;};for(const fn of [...this.events.get(name)||[]])fn(event);return event;}
 }
 class Element extends Target{
  constructor(tag){super();this.tagName=tag;this.ownerDocument=doc;this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.className='';this._text='';this.disabled=false;this.classList={contains:name=>this.className.split(/\s+/).includes(name),toggle:(name,force)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));const add=force??!classes.has(name);if(add)classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');return add;}};}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key];}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  focus(){doc.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
  click(){if(!this.disabled)return this.onclick?.({preventDefault(){},stopPropagation(){}});}
  querySelector(selector){return all(this).slice(1).find(node=>selector.split(',').some(value=>value.startsWith('.')&&node.classList.contains(value.slice(1))));}
 }
 const all=(node)=>[node,...node.children.flatMap(child=>all(child))];
 doc=new Target();doc.createElement=tag=>new Element(tag);doc.visibilityState='visible';doc.body=new Element('body');doc.activeElement=doc.body;
 const win=new Target();win.document=doc;
 return {win,doc,all:()=>all(doc.body)};
}

function fixture({preview,finish,real=false,items,stock}={}){
 const h=dom(),values=new Map([[SESSION,JSON.stringify({user:{id:'actor-one'},access_token:'token-one'})],[PLAN,'week-one']]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 h.win.localStorage=storage;h.win.location={search:''};
 const ledger=new Map(),calls=[],previews=[],confirmed=[];
 let meals=items||[{kind:'dinner',recipeId:'rice-dinner',name:'Rice dinner',day:'Monday',factor:1,occurrence:'week-one|dinner|Monday|rice-dinner',ingredients:[{key:'rice',unit:'g',required:200}]}];
 const host={dayMeals:day=>meals.filter(meal=>meal.day===day),id:(name,unit)=>String(name).toLowerCase()+'|'+unit,keys:()=>({stock:'stock',inventory:'inventory'}),stock:()=>JSON.parse(storage.getItem('stock')||'{}'),completionKeys:()=>[],household:()=>[],requirements:()=>[],refresh(){},notify(){},recipeIngredients:(id,factor)=>meals.find(meal=>meal.recipeId===id)?.ingredients.map(row=>({...row,required:row.required*factor})),occurrence:(id,day,kind='dinner')=>meals.find(meal=>meal.recipeId===id&&meal.day===day&&meal.kind===kind)?.occurrence||null};
 h.win.BBHomeHost=host;
 storage.setItem('stock',JSON.stringify(stock||{'rice|g':1000}));storage.setItem('inventory','{}');
 const actor=()=>JSON.parse(storage.getItem(SESSION)).user.id;
 let home;
 if(real)home=install(h.win);
 else home={actor,isCooked:occurrence=>ledger.get(actor())?.has(occurrence)||false,previewDay:event=>host.dayMeals(event.day).every(meal=>home.isCooked(meal.occurrence))?{ok:true,already:true,rows:[],issues:[],items:[]}:clean(),async finishDay(event){let completed=ledger.get(event.actorId);if(!completed){completed=new Set();ledger.set(event.actorId,completed);}for(const meal of host.dayMeals(event.day))completed.add(meal.occurrence);return {ok:true,message:'At home updated.'};}};
 const originalPreview=home.previewDay.bind(home),originalFinish=home.finishDay.bind(home);
 h.win.BBHome={...home,previewDay(event){previews.push({...event});return preview?preview(event,previews.length,originalPreview):originalPreview(event);},finishDay(event){calls.push({...event});return finish?finish(event,calls.length,originalFinish):originalFinish(event);}};
 let ui,badge,container;
 const mount=({day='Monday',freshModule=false}={})=>{
  ui?.dispose();container=h.doc.createElement('div');badge=h.doc.createElement('span');badge.className='bbnext-day-label';badge.textContent=day.slice(0,3).toUpperCase();h.doc.body.append(badge,container);
  if(freshModule||!h.win.BBDayDone)vm.runInNewContext(source,{window:h.win});
  ui=h.win.BBDayDone.mount({container,badge,day,win:h.win,onConfirmed:value=>confirmed.push(value)});return ui;
 };
 mount();
 return {...h,values,storage,ledger,home:h.win.BBHome,host,calls,previews,confirmed,mount,get ui(){return ui;},get badge(){return badge;},get container(){return container;},isGreen:()=>badge.classList.contains('bb-day-is-done'),dialog:()=>h.all().find(node=>node.tagName==='dialog'),trigger:()=>container.children.find(node=>node.dataset.bbDayDone),action:name=>h.all().find(node=>node.dataset.bbDayAction===name),setActor(id,token='token-two'){storage.setItem(SESSION,JSON.stringify({user:{id},access_token:token}));},setMeals(value){meals=value;},stock:host.stock};
}

test('quick Day done locks immediately across preview and commit and turns green after success',async()=>{
 const first=deferred(),finish=deferred();
 const h=fixture({preview:(_,count)=>count===1?first.promise:clean(),finish:()=>finish.promise});
 const pending=h.win.BBDayDone.quickComplete('Monday');
 assert.equal(h.trigger().disabled,true);assert.equal(h.badge.getAttribute('aria-busy'),'true');assert.equal(h.isGreen(),false);
 await h.ui.quickComplete();assert.equal(h.previews.length,1);assert.equal(h.calls.length,0);
 first.resolve(clean());await tick();assert.equal(h.previews.length,2);assert.equal(h.calls.length,1);assert.equal(h.isGreen(),false);
 await h.ui.quickComplete();assert.equal(h.calls.length,1);
 assert.deepEqual(h.calls[0],{day:'Monday',actorId:'actor-one',expected:'current-plan-and-stock'});
 finish.resolve({ok:true,message:'At home updated.'});await pending;
 assert.equal(h.isGreen(),true);assert.match(h.badge.textContent,/✓/);assert.match(h.trigger().textContent,/✓/);assert.equal(h.trigger().disabled,false);assert.equal(h.badge.getAttribute('aria-busy'),'false');assert.equal(h.confirmed.length,1);assert.equal(h.dialog(),undefined);
 assert.ok(h.all().some(node=>node.getAttribute('role')==='status'&&node.textContent.includes('Monday done')));
});

test('unknown, estimated, blocked and manual-review quantities open the existing review without committing',async()=>{
 for(const value of [
  {...clean(),issues:[{message:'Pack contents need review.'}]},
  {...clean(),rows:[{name:'Carrots',unit:'g',deduct:160,estimated:true,assumptions:['80 g each']}]},
  {...clean(),rows:[{name:'Rice',deduct:0,issueLabel:'Unknown pack stays unchanged.'}]},
  {...clean(),rows:[{name:'Rice',deduct:null}]},
  {...clean(),needsReview:true},
  {ok:false,needsReview:true,rows:[],issues:[],message:'Confirm the original batch first.'}
 ]){
  const h=fixture({preview:()=>value});await h.ui.quickComplete();await tick();
  assert.equal(h.calls.length,0);assert.equal(h.isGreen(),false);assert.ok(h.dialog());assert.match(h.dialog().textContent,/Confirm Monday is done/);assert.equal(h.trigger().disabled,false);
 }
});

test('a changed plan fingerprint is reviewed before any quick completion commit',async()=>{
 const h=fixture({preview:(_,count)=>({...clean(),fingerprint:count===1?'old-plan':'new-plan'})});
 await h.ui.quickComplete();await tick();assert.equal(h.calls.length,0);assert.equal(h.isGreen(),false);assert.ok(h.action('confirm'));
 await h.action('confirm').click();assert.equal(h.calls.length,1);assert.equal(h.calls[0].expected,'new-plan');
});

test('account switching or refreshing a token while checking prevents the old quick request',async()=>{
 for(const change of [h=>h.setActor('actor-two'),h=>h.setActor('actor-one','new-token')]){
  const wait=deferred(),h=fixture({preview:(_,count)=>count===1?wait.promise:clean()});
  const pending=h.ui.quickComplete();change(h);wait.resolve(clean());await pending;await tick();
  assert.equal(h.calls.length,0);assert.equal(h.isGreen(),false);assert.ok(h.dialog());assert.equal(h.previews.at(-1).actorId,h.home.actor());
 }
});

test('a failed guarded commit opens review and never paints a false green badge',async()=>{
 const h=fixture({finish:()=>({ok:false,needsReview:true,message:'Your pantry changed.'})});
 await h.ui.quickComplete();await tick();assert.equal(h.calls.length,1);assert.equal(h.confirmed.length,0);assert.equal(h.isGreen(),false);assert.ok(h.dialog());assert.ok(h.action('confirm'));
});

test('the fresh preview checks the current token again before invoking finishDay',async()=>{
 const wait=deferred(),h=fixture({preview:(_,count)=>count===2?wait.promise:clean()});
 const pending=h.ui.quickComplete();await tick();assert.equal(h.previews.length,2);assert.equal(h.calls.length,0);
 h.setActor('actor-one','refreshed-during-recheck');wait.resolve(clean());await pending;await tick();
 assert.equal(h.calls.length,0);assert.equal(h.isGreen(),false);assert.ok(h.dialog());
});

test('a completion result arriving after account switching cannot paint the new account green',async()=>{
 const wait=deferred(),h=fixture({finish:()=>wait.promise});
 const pending=h.ui.quickComplete();await tick();assert.equal(h.calls.length,1);
 h.setActor('actor-two');h.win.fire('storage',{key:SESSION});wait.resolve({ok:true,message:'Previous account updated.'});await pending;
 assert.equal(h.isGreen(),false);assert.equal(h.confirmed.length,0);assert.equal(h.trigger().disabled,false);assert.doesNotMatch(h.trigger().textContent,/✓/);
});

test('persisted occurrence completions restore green after reload and are scoped to the active account',async()=>{
 const h=fixture();await h.ui.quickComplete();assert.equal(h.calls.length,1);assert.equal(h.isGreen(),true);
 await h.ui.quickComplete();assert.equal(h.calls.length,1,'an already-confirmed preview cannot issue another finish');
 h.mount({freshModule:true});assert.equal(h.isGreen(),true);assert.match(h.badge.textContent,/✓/);
 h.setActor('actor-two');h.win.fire('storage',{key:SESSION});assert.equal(h.isGreen(),false);assert.doesNotMatch(h.badge.textContent,/✓/);
 h.setActor('actor-one');h.win.fire('focus');assert.equal(h.isGreen(),true);assert.equal(h.calls.length,1);
});

test('individual Cook followed by quick Day done confirms only remaining lunch and dessert amounts',async()=>{
 const items=[
  {kind:'dinner',recipeId:'dinner',name:'Dinner',day:'Monday',factor:1,occurrence:'week-one|dinner|Monday',ingredients:[{key:'rice',unit:'g',required:400}]},
  {kind:'lunch',recipeId:'lunch',name:'Lunch',day:'Monday',factor:1,occurrence:'week-one|lunch|Monday',ingredients:[{key:'bread',unit:'each',required:4}]},
  {kind:'dessert',recipeId:'dessert',name:'Dessert',day:'Monday',factor:1,occurrence:'week-one|dessert|Monday',ingredients:[{key:'rice',unit:'g',required:100}]}
 ];
 const h=fixture({real:true,items,stock:{'rice|g':1000,'bread|each':12}});
 const dinner=items[0];assert.equal((await h.home.cooked({sessionId:'individual-cook',recipeId:dinner.recipeId,day:'Monday',kind:'dinner',factor:1,actorId:'actor-one',occurrence:dinner.occurrence})).ok,true);
 assert.deepEqual(h.stock(),{'rice|g':600,'bread|each':12});assert.equal(h.isGreen(),false);
 const result=await h.ui.quickComplete();assert.equal(result.ok,true);assert.equal(result.completedCount,2);assert.equal(h.isGreen(),true);assert.deepEqual(h.stock(),{'rice|g':500,'bread|each':8});
 await h.ui.quickComplete();assert.equal(h.calls.length,1);assert.deepEqual(h.stock(),{'rice|g':500,'bread|each':8});
 h.mount({freshModule:true});assert.equal(h.isGreen(),true);
});

test('quick leftover completion reviews an uncooked source and never deducts the batch twice',async()=>{
 const sourceMeal={kind:'dinner',recipeId:'batch',name:'Batch curry',day:'Monday',factor:1,occurrence:'week-one|dinner|Monday|batch',ingredients:[{key:'rice',unit:'g',required:600}]};
 const leftover={kind:'leftover',recipeId:'leftovers',name:'Leftover curry',day:'Wednesday',factor:1,occurrence:'week-one|leftover|Wednesday|batch',sourceOccurrence:sourceMeal.occurrence,ingredients:[]};
 const h=fixture({real:true,items:[sourceMeal,leftover]});h.mount({day:'Wednesday'});
 await h.ui.quickComplete();await tick();assert.equal(h.calls.length,0);assert.equal(h.isGreen(),false);assert.match(h.dialog().textContent,/original batch/);
 h.action('close').click();h.mount({day:'Monday'});assert.equal((await h.ui.quickComplete()).ok,true);assert.equal(h.stock()['rice|g'],400);
 h.mount({day:'Wednesday'});assert.equal((await h.ui.quickComplete()).ok,true);assert.equal(h.stock()['rice|g'],400);assert.equal(h.isGreen(),true);assert.equal(h.home.isCooked(leftover.occurrence),true);
});

test('replacing a completed day with a different plan occurrence clears its green state',async()=>{
 const h=fixture({real:true});await h.ui.quickComplete();assert.equal(h.isGreen(),true);assert.equal(h.stock()['rice|g'],800);
 h.setMeals([{kind:'dinner',recipeId:'new-dinner',name:'New dinner',day:'Monday',factor:1,occurrence:'week-two|dinner|Monday|new-dinner',ingredients:[{key:'rice',unit:'g',required:300}]}]);h.storage.setItem(PLAN,'week-two');h.win.fire('storage',{key:PLAN});
 assert.equal(h.isGreen(),false);assert.equal(h.stock()['rice|g'],800);
 assert.equal((await h.ui.quickComplete()).ok,true);assert.equal(h.stock()['rice|g'],500);assert.equal(h.isGreen(),true);
});
