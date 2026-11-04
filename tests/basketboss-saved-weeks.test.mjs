import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const weeks=createRequire(import.meta.url)('../bb-saved-weeks.js');
const memory=()=>{const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};};
const input=()=>({plan:{planned:[{day:'Tuesday',recipeId:'fajitas'},{day:'Friday',recipeId:'pasta'}],plannedDesserts:[{day:'Saturday',recipeId:'cake'}],servings:4,feedingSet:true,mealServings:{fajitas:5,unplanned:12},dayServings:{Tuesday:{recipeId:'fajitas',count:3},Friday:{recipeId:'pasta',count:null},Sunday:{recipeId:'old',count:9}},leftoverSources:{fajitas:true},leftoverConfirmed:{pasta:true},bbManualBatch:null,bb81Batch:null,pantry:{honey:true},access_token:'private bearer',recipePhotos:{fajitas:'private-photo'}},lunch:{version:1,children:2,days:{Monday:[{name:'Apple',qty:.5,unit:'each'}]},menus:{Monday:'Cheese sandwich and apple'}},notes:{Sunday:'Eating out'}});
const snapshot=()=>weeks.capture(input());

test('a saved week preserves actual days, daily servings, desserts, school lunches and custom dinners',()=>{
 const original=input(),before=JSON.stringify(original),result=weeks.capture(original);
 assert.deepEqual(result.planned,original.plan.planned);assert.deepEqual(result.plannedDesserts,original.plan.plannedDesserts);
 assert.deepEqual(result.dayServings,{Tuesday:{recipeId:'fajitas',count:3},Friday:{recipeId:'pasta',count:null}});
 assert.deepEqual(result.mealServings,{fajitas:5});assert.equal(result.servings,4);assert.equal(result.feedingSet,true);
 assert.deepEqual(result.lunch.days.Monday,[{name:'Apple',qty:.5,unit:'each'}]);assert.equal(result.lunch.children,2);assert.equal(result.lunch.menus.Monday,'Cheese sandwich and apple');
 assert.deepEqual(result.customDinners,{Sunday:'Eating out'});assert.equal(JSON.stringify(original),before);
 for(const privateValue of ['private bearer','private-photo','honey','unplanned','old'])assert(!JSON.stringify(result).includes(privateValue));
 original.plan.planned[0].day='Monday';original.lunch.days.Monday[0].qty=100;
 assert.equal(result.planned[0].day,'Tuesday');assert.equal(result.lunch.days.Monday[0].qty,.5);
 assert.match(weeks.summary(result),/3 dinners · 1 dessert · 1 lunch day/);
});
test('batch and saved-leftover planning links round trip without copying pantry or shopping state',()=>{
 const value=input();value.plan.bbManualBatch={version:1,pairs:[{sourceDay:'Tuesday',leftoverDay:'Wednesday',recipeId:'fajitas'}]};
 const result=weeks.capture(value);assert.deepEqual(weeks.validateWeek(result),result);assert.equal(result.bbManualBatch.pairs[0].leftoverDay,'Wednesday');
 assert.deepEqual(result.leftoverSources,{fajitas:true});assert.deepEqual(result.leftoverConfirmed,{pasta:true});
});
test('ambiguous days, missing quantities, corrupt lunchboxes and conflicting custom notes fail without truncation',()=>{
 for(const modify of [v=>v.plan.planned.push({day:'Tuesday',recipeId:'other'}),v=>v.plan.dayServings.Tuesday.count=0,v=>v.plan.servings=99,v=>v.lunch.days.Monday[0].qty=0,v=>v.lunch.days.Monday[0].unit='mystery',v=>v.lunch.menus.Monday='x'.repeat(351),v=>v.notes.Tuesday='Two dinners',v=>v.plan.bbManualBatch={version:1,pairs:[{sourceDay:'Tuesday',leftoverDay:'Friday',recipeId:'fajitas'}]}]){
  const value=input();modify(value);assert.throws(()=>weeks.capture(value),/Review/);
 }
});
test('unloaded Premium recipe IDs remain intact in saved weeks for the host to verify on restore',()=>{
 const value=input();value.plan.planned.push({day:'Thursday',recipeId:'premium-unloaded'});
 assert(weeks.validateWeek(weeks.capture(value)).planned.some(row=>row.recipeId==='premium-unloaded'));
});
test('named weeks save without altering the active plan; duplicate names require explicit replacement',()=>{
 const storage=memory(),model=weeks.createStore({storage,now:()=>1}),week=snapshot();
 assert.equal(storage.values.size,0);assert.equal(model.read().weeks.length,0);assert.equal(storage.values.size,0,'read-only startup');
 assert.equal(model.save(' Week 1 ',week).ok,true);const saved=model.read().weeks[0];assert.equal(saved.name,'Week 1');
 const duplicate=model.save('week 1',week);assert.equal(duplicate.ok,false);assert.equal(duplicate.duplicateId,saved.id);
 const revised=weeks.capture({...input(),notes:{Sunday:'Freezer night'}});assert.equal(model.save('Week 1',revised,{replaceId:saved.id}).ok,true);
 assert.equal(model.read().weeks.length,1);assert.equal(model.read().weeks[0].week.customDinners.Sunday,'Freezer night');
 assert.equal(model.remove(saved.id).ok,true);assert.equal(model.read().weeks.length,0);
});
test('saved-week names, snapshots and counts remain bounded and empty weeks are not saved',()=>{
 const storage=memory(),model=weeks.createStore({storage,now:()=>1});
 assert.equal(model.save(' ',snapshot()).ok,false);assert.equal(model.save('x'.repeat(61),snapshot()).ok,false);
 const empty=weeks.capture({plan:{planned:[],servings:4}});assert.equal(model.save('Empty',empty).ok,false);
 for(let i=1;i<=25;i++)assert.equal(model.save('Week '+i,snapshot()).ok,true);
 assert.equal(model.save('Week 26',snapshot()).ok,false);assert.equal(model.read().weeks.length,25);
 assert.equal(new Set(model.read().weeks.map(row=>row.id)).size,25);
});
test('saved weeks are account-scoped and all writes pause for deletion or unreadable storage',()=>{
 const storage=memory();let actor='one',ready=true;
 const model=weeks.createStore({storage,context:()=>({actor,ready})});assert.equal(model.save('Mine',snapshot()).ok,true);
 actor='two';assert.deepEqual(model.read().weeks,[]);assert.equal(model.save('Other',snapshot()).ok,true);actor='one';assert.equal(model.read().weeks[0].name,'Mine');
 ready=false;const before=[...storage.values];assert.equal(model.save('Blocked',snapshot()).ok,false);assert.equal(model.remove('unknown').ok,false);assert.deepEqual([...storage.values],before);
 ready=true;storage.setItem(weeks.KEY+'one','invalid JSON');assert.equal(model.read().ok,false);assert.equal(model.save('No overwrite',snapshot()).ok,false);assert.equal(storage.getItem(weeks.KEY+'one'),'invalid JSON');
});
test('failed save restores its own partial write but never overwrites a newer tab value',()=>{
 const storage=memory(),model=weeks.createStore({storage});assert.equal(model.save('Original',snapshot()).ok,true);
 const key=[...storage.values.keys()][0],original=storage.getItem(key),write=storage.setItem;let fail=true;
 storage.setItem=(k,v)=>{write(k,v);if(fail){fail=false;throw Error('quota');}};
 assert.equal(model.save('Attempt',snapshot()).ok,false);assert.equal(storage.getItem(key),original);
 storage.setItem=(k,v)=>{write(k,'newer-tab-value');throw Error('denied');};
 assert.equal(model.save('Attempt',snapshot()).ok,false);assert.equal(storage.getItem(key),'newer-tab-value');
});
test('a scoped account change or external storage write during save invalidates the proposal',()=>{
 const storage=memory();let actor='first',reads=0,external=false;
 const get=storage.getItem;storage.getItem=k=>{reads++;if(external&&reads===2)storage.values.set(k,'external');return get(k);};
 const model=weeks.createStore({storage,context:()=>({actor,ready:true})});external=true;
 assert.equal(model.save('Stale',snapshot()).ok,false);assert.equal([...storage.values.values()][0],'external');
 const changed=weeks.createStore({storage:memory(),context:()=>({actor:actor==='first'?(actor='second','first'):'second',ready:true})});actor='first';
 assert.equal(changed.save('Stale account',snapshot()).ok,false);
});
test('storage exceptions and corrupt content expose only fixed messages',()=>{
 const denied=weeks.createStore({storage:{getItem(){throw Error('private storage error text');}}});
 assert.equal(denied.read().message,'Saved weeks could not be read. Existing data has been kept.');
 const storage=memory(),model=weeks.createStore({storage});storage.setItem(weeks.KEY+'guest','private corrupt content');
 assert.equal(model.read().message,'Saved weeks could not be read. Existing data has been kept.');
});

class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.className='';this.textContent='';this.isConnected=true;}
 append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(name,value){this[name]=value;}addEventListener(name,fn){this.listeners[name]=fn;}remove(){this.isConnected=false;}
}
const find=(root,className)=>{if(root.className.split(' ').includes(className))return root;for(const child of root.children){const value=find(child,className);if(value)return value;}return null;};
function uiFixture(){
 const storage=memory(),container=new Node('section'),hostWindow=new EventTarget();let actor='person',fingerprint='current-plan',restoreCalls=[],confirmation=async()=>true;
 Object.assign(hostWindow,{document:{createElement:tag=>new Node(tag)},localStorage:storage});
 const context=()=>({actor,ready:true}),model=weeks.createStore({storage,context});model.save('Week 1',snapshot());
 const host={context,snapshot:()=>({ready:true,fingerprint,...input()}),confirm:(...args)=>confirmation(...args),restore:async proposal=>{restoreCalls.push(proposal);return {ok:true,message:'Loaded Week 1'};}};
 const controller=weeks.mount({container,host,window:hostWindow});
 return {storage,container,model,controller,host,find:name=>find(container,name),actor:value=>{actor=value;},fingerprint:value=>{fingerprint=value;},confirm:fn=>{confirmation=fn;},get restores(){return restoreCalls;}};
}
test('load uses a deliberate replacement confirmation and passes exact original-state fingerprint to host',async()=>{
 const h=uiFixture();let prompt;h.confirm(async text=>{prompt=text;return true;});
 await h.find('bbsw-actions').children[0].listeners.click();assert.match(prompt,/Replace your current meal plan/);assert.equal(h.restores.length,1);assert.equal(h.restores[0].expected,'current-plan');assert.equal(h.restores[0].actor,'person');assert.equal(h.restores[0].week.planned[0].day,'Tuesday');h.controller.dispose();
});
test('cancel, account switching and changed saved content prevent a stale restore',async()=>{
 for(const reason of ['cancel','account','saved']){
  const h=uiFixture();h.confirm(async()=>{if(reason==='account')h.actor('other');if(reason==='saved')h.model.save('A new week',snapshot());return reason!=='cancel';});
  await h.find('bbsw-actions').children[0].listeners.click();assert.equal(h.restores.length,0,reason);h.controller.dispose();
 }
});
test('HTML-like week names render as text, and delete confirms without replacing the current plan',async()=>{
 const h=uiFixture();assert.equal(h.model.save('<b>Week 2</b>',snapshot()).ok,true);h.controller.refresh();
 const row=h.find('bbsw-list').children[1];assert.equal(row.children[0].children[0].textContent,'<b>Week 2</b>');
 h.confirm(async()=>false);await row.children[1].children[1].listeners.click();assert.equal(h.model.read().weeks.length,2);
 h.confirm(async()=>true);await h.find('bbsw-list').children[1].children[1].children[1].listeners.click();assert.equal(h.model.read().weeks.length,1);assert.equal(h.restores.length,0);h.controller.dispose();
});
