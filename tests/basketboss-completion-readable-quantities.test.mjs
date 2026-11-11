import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const formatter=createRequire(import.meta.url)('../bb-shop-purchase-ui.js');
const pantry=createRequire(import.meta.url)('../bb-pantry-inline.js'),policy=createRequire(import.meta.url)('../bb-pantry-policy.js');
const looseProduce=createRequire(import.meta.url)('../bb-loose-produce-ui.js');
const deduction=createRequire(import.meta.url)('../bb-pantry-deduction.js');
const daySource=fs.readFileSync(new URL('../bb-day-done.js',import.meta.url),'utf8');
const cookSource=fs.readFileSync(new URL('../bb-cook-pantry.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('At home visible summaries round grams and counts without changing legacy helpers or saved quantities',()=>{
 const rows=Object.freeze([Object.freeze({name:'Chicken breast',qty:666.666667,unit:'g'}),Object.freeze({name:'Cheddar',qty:233.33333299999998,unit:'g'}),Object.freeze({name:'Milk',qty:333.333333,unit:'ml'}),Object.freeze({name:'Egg',qty:3.333333,unit:'each'}),Object.freeze({name:'Tiny reserve',qty:.000001,unit:'g'})]),before=JSON.stringify(rows);
 assert.deepEqual(rows.map(row=>pantry.visibleSummaryAmount(row,'Guernsey',policy,formatter)),['667 g','233 g','333 ml','3.3 each','<1 g']);
 assert.equal(pantry.summaryAmount(rows[4],'Guernsey',policy),'0.000001 g','the legacy helper and its precision contract remain available');assert.equal(JSON.stringify(rows),before);
});

function documentFixture(){
 let doc;
 class Element{
  constructor(tag){Object.assign(this,{tagName:tag,ownerDocument:doc,children:[],parentNode:null,dataset:{},attributes:{},events:new Map(),_text:'',disabled:false,value:''});}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  setAttribute(name,value){this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  getAttribute(name){return this.attributes[name];}
  removeAttribute(name){delete this.attributes[name];}
  get isConnected(){return this===doc.body||this.parentNode?.isConnected===true;}
  focus(){doc.activeElement=this;}
  addEventListener(name,handler){const handlers=this.events.get(name)||[];handlers.push(handler);this.events.set(name,handlers);}
  fire(name,event={}){event.preventDefault??=()=>{};event.stopPropagation??=()=>{};for(const handler of this.events.get(name)||[])handler(event);}
  click(){if(!this.disabled)return this.onclick?.({preventDefault(){},stopPropagation(){}});}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
  checkValidity(){return this.value.trim()!==''&&Number.isFinite(Number(this.value))&&Number(this.value)>=0&&Number(this.value)<=1000000;}
  reportValidity(){return this.checkValidity();}
 }
 doc={createElement:tag=>new Element(tag),createTextNode:value=>{const node=new Element('#text');node.textContent=value;return node;}};doc.body=new Element('body');doc.activeElement=doc.body;
 const container=new Element('div');doc.body.append(container);
 const all=(node=doc.body)=>[node,...node.children.flatMap(child=>all(child))];
 return {doc,container,all};
}
async function dayFixture(rows,{lunchWeek=false,undo=false,withFormatter=true,produceStorage,stock}={}){
 const h=documentFixture(),calls=[];
 const preview=Object.freeze({ok:true,fingerprint:'unchanged-exact-review',items:[],rows,issues:[]});
 const win={document:h.doc,localStorage:produceStorage||{getItem:()=>null},...(withFormatter?{BBShopPurchaseUI:formatter}:{}),...(produceStorage?{BBLooseProduceUI:looseProduce,BBPantryPolicy:policy}:{}),
  BBHome:{actor:()=> 'display-test-actor',isCooked:()=>undo,previewDay:()=>preview,previewLunchWeek:()=>preview,previewUndoDay:()=>preview,
   finishDay:event=>{calls.push(event);return {ok:true};},finishLunchWeek:event=>{calls.push(event);return {ok:true};},undoDay:event=>{calls.push(event);return {ok:true};}},
  BBHomeHost:{dayMeals:()=>[{occurrence:'display-test-dinner'}],schoolLunchWeekMeals:()=>[{occurrence:'display-test-lunch'}],...(stock?{stock:()=>stock}:{})}};
 vm.runInNewContext(daySource,{window:win});
 const view=win.BBDayDone[lunchWeek?'mountLunchWeek':'mount']({container:h.container,day:'Monday',win});view.open();await tick();
 return {...h,view,win,calls,preview,action:name=>h.all().find(node=>node.dataset.bbDayAction===name),tableRows:()=>h.all().filter(node=>node.tagName==='tr'&&node.className?.includes('bb-day-done-amount'))};
}

test('Day done rounds only visible required, owned and remaining labels while retaining exact reviewed quantities',async()=>{
 const rows=Object.freeze([
  Object.freeze({name:'Chicken breast',unit:'g',required:666.666667,owned:1200,deduct:666.666667,remaining:533.333333}),
  Object.freeze({name:'Cheddar',unit:'g',required:66.666667,owned:300,deduct:66.666667,remaining:233.33333299999998}),
  Object.freeze({name:'Milk',unit:'ml',required:266.666667,owned:500,deduct:266.666667,remaining:233.333333}),
  Object.freeze({name:'Egg',unit:'each',required:.666667,owned:2,deduct:.666667,remaining:1.333333}),
  Object.freeze({name:'Tiny reserve',unit:'g',required:.000001,owned:.000002,deduct:.000001,remaining:.000001})
 ]),before=JSON.stringify(rows),h=await dayFixture(rows);
 assert.deepEqual(h.tableRows().map(row=>row.children.map(cell=>cell.textContent)),[
  ['Chicken breast','667 g','1200 g','533 g'],['Cheddar','67 g','300 g','233 g'],['Milk','267 ml','500 ml','233 ml'],['Egg','0.7 each','2 each','1.3 each'],['Tiny reserve','<1 g','<1 g','<1 g']
 ]);
 for(const [index,line]of h.tableRows().entries())for(const [column,field]of [[1,'required'],[2,'owned'],[3,'remaining']]){
  assert.equal(line.children[column].dataset.bbDayRawAmount,String(rows[index][field]));assert.equal(line.children[column].dataset.bbDayQuantityField,field);assert.equal(line.children[column].dataset.bbDayUnit,rows[index].unit);
 }
 assert.doesNotMatch(h.doc.body.textContent,/6666667|333333|99999998/);assert.equal(JSON.stringify(rows),before);assert.equal(h.calls.length,0);
 await h.action('confirm').click();assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{day:'Monday',actorId:'display-test-actor',expected:'unchanged-exact-review'}]);assert.equal(JSON.stringify(rows),before);
});

test('school-lunch confirmation uses the same readable labels and leaves its exact projection untouched',async()=>{
 const rows=Object.freeze([Object.freeze({name:'Milk',unit:'ml',required:333.333333,owned:1000,remaining:666.666667,deduct:333.333333})]),before=JSON.stringify(rows),h=await dayFixture(rows,{lunchWeek:true});
 assert.deepEqual(h.tableRows()[0].children.map(cell=>cell.textContent),['Milk','333 ml','1 L','667 ml']);assert.equal(h.calls.length,0);assert.equal(JSON.stringify(rows),before);
 await h.action('confirm').click();assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{actorId:'display-test-actor',expected:'unchanged-exact-review'}]);assert.equal(JSON.stringify(rows),before);
});

test('Day done uses each only for actor-scoped count-purchase proof and keeps raw gram amounts untouched',async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const chosen=looseProduce.selection('Lime',1,policy),stock=Object.freeze({'lime|g':70}),rows=Object.freeze([Object.freeze({id:'lime|g',name:'Lime',unit:'g',required:46.666667,owned:70,deduct:46.666667,remaining:23.333333})]);
 assert.equal(looseProduce.writeStockProof(storage,{actor:'display-test-actor',stockKey:'lime|g',name:'Lime'},{selection:chosen,beforeQuantity:0,afterQuantity:70},policy).recorded,true);
 const beforeRows=JSON.stringify(rows),beforeStorage=[...values],h=await dayFixture(rows,{produceStorage:storage,stock});
 assert.deepEqual(h.tableRows()[0].children.map(cell=>cell.textContent),['Lime','0.7 each','1 each','0.3 each']);
 for(const [column,field]of [[1,'required'],[2,'owned'],[3,'remaining']]){const cell=h.tableRows()[0].children[column];assert.equal(cell.dataset.bbDayRawAmount,String(rows[0][field]));assert.equal(cell.dataset.bbDayUnit,'g');}
 assert.equal(JSON.stringify(rows),beforeRows);assert.deepEqual([...values],beforeStorage);assert.equal(stock['lime|g'],70);assert.equal(h.calls.length,0);
 const oldRows=[{id:'lime|g',name:'Lime',unit:'g',required:46.666667,owned:1000,remaining:953.333333}],legacy=await dayFixture(oldRows,{produceStorage:storage,stock:{'lime|g':1000}});
 assert.deepEqual(legacy.tableRows()[0].children.map(cell=>cell.textContent),['Lime','47 g','1 kg','953 g'],'an old larger gram balance is not reinterpreted from a stale smaller count proof');
 const mixed=await dayFixture(rows,{produceStorage:storage,stock:{'lime|g':70,'fresh lime|g':1000}});
 assert.deepEqual(mixed.tableRows()[0].children.map(cell=>cell.textContent),['Lime','47 g','70 g','23 g'],'an unproved compatible physical source keeps the whole row in grams');
 await h.action('confirm').click();assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{day:'Monday',actorId:'display-test-actor',expected:'unchanged-exact-review'}]);assert.equal(JSON.stringify(rows),beforeRows);
});

test('Day done undo formats a recorded restoration without altering the recorded restore amount',async()=>{
 const rows=Object.freeze([Object.freeze({name:'Chicken breast',unit:'g',restore:666.666667})]),h=await dayFixture(rows,{undo:true});
 const cell=h.all().find(node=>node.dataset.bbDayQuantityField==='restore');assert.equal(cell.textContent,'667 g');assert.equal(cell.dataset.bbDayRawAmount,'666.666667');assert.equal(rows[0].restore,666.666667);
 await h.action('undo').click();assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{day:'Monday',actorId:'display-test-actor',expected:'unchanged-exact-review'}]);assert.equal(rows[0].restore,666.666667);
});

test('unknown units and amounts retain review messages, including a readable legacy fallback without the shared formatter',async()=>{
 const rows=[{name:'Seasoning',unit:'tsp',required:1.333333,owned:2,remaining:.666667},{name:'Unknown quantity',unit:'g',required:null,issue:'amount_unknown'},{name:'Wrong unit',unit:'g',required:666.666667,owned:200,remaining:200,issue:'unit_mismatch'}];
 for(const withFormatter of [true,false]){
  const h=await dayFixture(rows,{withFormatter});assert.deepEqual(h.tableRows().map(row=>row.children.map(cell=>cell.textContent)),[['Seasoning','1.3 tsp','2 tsp','0.7 tsp'],['Unknown quantity','Check amount','Check amount','Check amount'],['Wrong unit','667 g','Check unit','Check unit']]);assert.equal(h.calls.length,0);
 }
});

test('individual Cook renders readable balance labels but keeps editable values and submitted amounts exact',async()=>{
 const h=documentFixture(),calls=[],required=666.666667,rows=Object.freeze([Object.freeze({id:'chicken breast|g',name:'Chicken breast',unit:'g',required,owned:1200,deduct:required,remaining:533.333333,canDeduct:true}),Object.freeze({id:'cheddar|g',name:'Cheddar',unit:'g',required:233.33333299999998,owned:300,deduct:0,canDeduct:false})]);
 const before=JSON.stringify(rows),win={document:h.doc,BBShopPurchaseUI:formatter,BBHome:{previewCook:()=>({ok:true,fingerprint:'exact-cook-review',rows,issues:[]}),cooked:event=>{calls.push(event);return {ok:true};}}};
 vm.runInNewContext(cookSource,{window:win});const event=Object.freeze({sessionId:'cook-display',recipeId:'scaled-fajitas',factor:1});win.BBCookPantry.mount({container:h.container,event,win});
 const input=h.all().find(node=>node.tagName==='input');assert.equal(input.value,String(required));assert.match(h.doc.body.textContent,/At home: 1200 g · deduct up to 667 g/);assert.match(h.doc.body.textContent,/Cheddar233 g/);assert.doesNotMatch(h.doc.body.textContent,/6666667|99999998/);
 const raw=h.all().find(node=>node.dataset.bbCookRawOwned==='1200');assert.equal(raw.dataset.bbCookRawDeduct,String(required));assert.equal(JSON.stringify(rows),before);assert.equal(calls.length,0);
 await h.all().find(node=>node.tagName==='button'&&node.textContent==='Confirm cooked & update pantry').click();
 assert.equal(calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{...event,expected:'exact-cook-review',amounts:[{id:'chicken breast|g',quantity:required,unit:'g'}]});assert.equal(JSON.stringify(rows),before);
});

test('expanded Day done details and Cook unit warnings format narrative quantities without changing core messages',async()=>{
 const source=deduction.proposal({stock:{'rice|each':1.333333},ingredients:[{key:'Rice',unit:'g',required:200}],id:(name,unit)=>policy.canonicalName(name)+'|'+unit,conversion:{pantryMode:true,market:'UK',basis:{wholeProduce:false,spoons:false}}});
 const rows=source.rows,before=JSON.stringify(source);rows[0].assumptions=['Reviewed contents: 1 pack = 233.33333299999998 g.'];const exact=JSON.stringify(rows);
 assert.match(rows[0].issueLabel,/1\.333333 each/);const h=await dayFixture(rows),details=h.all().find(node=>node.className==='bb-day-done-conversion-details');details.open=true;
 assert.match(details.textContent,/At home has 1\.3 each of rice/);assert.match(details.textContent,/1 pack = 233 g/);assert.doesNotMatch(details.textContent,/1\.333333|99999998/);assert.equal(JSON.stringify(rows),exact);assert.equal(h.calls.length,0);
 const cooked=documentFixture(),win={document:cooked.doc,BBShopPurchaseUI:formatter,BBHome:{previewCook:()=>({ok:true,fingerprint:'unmodified-warning',rows,issues:source.issues})}};vm.runInNewContext(cookSource,{window:win});win.BBCookPantry.mount({container:cooked.container,event:{sessionId:'warning-review'},win});
 assert.match(cooked.doc.body.textContent,/At home has 1\.3 each of rice/);assert.match(cooked.doc.body.textContent,/1 pack = 233 g/);assert.doesNotMatch(cooked.doc.body.textContent,/1\.333333|99999998/);assert.equal(JSON.stringify(rows),exact);assert.match(before,/1\.333333/);
 assert.equal(formatter.formatDisplayQuantityText('Guide v1.333333 and £2.333333 on 2026-11-11; 533.333333 g remaining.'),'Guide v1.333333 and £2.333333 on 2026-11-11; 533 g remaining.','only recognized quantity phrases are reformatted');
});
