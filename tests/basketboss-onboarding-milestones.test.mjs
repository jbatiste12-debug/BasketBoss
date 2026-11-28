import {householdPlanCaptureSource} from './helpers/household-plan-capture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const {install}=createRequire(import.meta.url)('../bb-home.js');

const source=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const begin=source.indexOf('/* BEGIN_BASKETBOSS_ACTIVATION_MILESTONES_V1');
const end=source.indexOf('function bbRecordPlannedRecipesToStorage',begin);
assert.ok(begin>=0&&end>begin);
const milestones=source.slice(begin,end);
const addRecipe=householdPlanCaptureSource(source)+source.slice(source.indexOf('function addRecipe(id,day){'),source.indexOf('\nfunction renderWeek(app)',source.indexOf('function addRecipe(id,day){')));

function fixture({save=true,listenerThrows=false}={}){
 const events=[],history=[],state={planned:[]};
 const recipes=new Map([['family-dinner',{id:'family-dinner',ingredients:[['Chicken breast','666.666667 g',2,'Meat']]}]]);
 const storedPantry={'chicken breast|g':533.333333},before=JSON.stringify(storedPantry);
 const context={state,localStorage:{},DAYS:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
  CustomEvent:class{constructor(type){this.type=type;}},
  window:{dispatchEvent(event){if(listenerThrows)throw Error('Optional listener unavailable');events.push(event);}},
  getRecipe:id=>recipes.get(id),bbRecordPlannedRecipesToStorage:ids=>{history.push([...ids]);return 'recorded';},
  bbIsBreakfast:()=>false,bbIsDessert:()=>false,bb176AllowedRecipe:()=>true,bbBatchPairs:()=>[],
  persist:()=>save,notify(){},render(){},bb176OpenPremiumUpgrade(){},bbPlanBreakfast(){},bbPlanDessert(){}};
 vm.createContext(context);vm.runInContext(milestones+'\n'+addRecipe,context);
 return {context,state,events,history,storedPantry,before,run:script=>vm.runInContext(script,context)};
}

test('successful user plan save emits only payload-free activation signals after real requirements exist',()=>{
 const h=fixture();
 h.run("addRecipe('family-dinner','Monday')");
 assert.equal(h.state.planned.length,1);
 assert.deepEqual(h.events.map(event=>event.type),['basketboss:first-meal-plan-created']);
 h.context.requirements={items:[{key:'chicken breast',required:666.666667,toBuy:133.333334}]};
 const requirements=JSON.stringify(h.context.requirements);
 h.run('bbOnboardingShoppingMilestone(requirements)');
 assert.deepEqual(h.events.map(event=>event.type),['basketboss:first-meal-plan-created','basketboss:first-shopping-list-created']);
 assert.equal(JSON.stringify(h.context.requirements),requirements,'precise shopping quantities stay unchanged');
 assert.equal(JSON.stringify(h.storedPantry),h.before,'pantry quantities stay unchanged');
 for(const event of h.events)assert.deepEqual(Object.keys(event),['type'],'no recipe, stock or account payload is attached');
 h.run('bbOnboardingShoppingMilestone(requirements)');
 assert.equal(h.events.length,2,'a render of the same generated list cannot emit another list milestone');
});

test('failed plan persistence rolls back the plan and emits no milestones',()=>{
 const h=fixture({save:false});h.run("addRecipe('family-dinner','Monday')");
 assert.deepEqual(h.state.planned,[]);
 assert.deepEqual(h.history,[]);
 assert.deepEqual(h.events,[]);
 h.run('bbOnboardingShoppingMilestone({items:[{required:666.666667}]})');
 assert.deepEqual(h.events,[],'a later render cannot turn a failed save into activation');
});

test('restoring an existing saved week keeps its history without reporting creation',()=>{
 const h=fixture();
 assert.equal(h.run("bbRecordPlannedRecipes(['family-dinner'],false)"),'recorded');
 assert.deepEqual(h.history,[['family-dinner']]);
 h.run('bbOnboardingShoppingMilestone({items:[{required:600}]})');
 assert.deepEqual(h.events,[]);
 assert.ok(source.includes('bbRecordPlannedRecipes([...ids],false);'),'saved-week restore opts out explicitly');
});

test('opening an existing plan or generating an empty list cannot count as new activation',()=>{
 const h=fixture();
 h.run('bbOnboardingShoppingMilestone({items:[{required:600}]})');
 assert.deepEqual(h.events,[],'initial/returning renders have no user-save intent');
 h.run("bbOnboardingPlanCreated(['missing-recipe'])");
 assert.deepEqual(h.events,[],'unresolved recipes cannot create a milestone');
 h.run("bbOnboardingPlanCreated(['family-dinner'])");
 h.run('bbOnboardingShoppingMilestone({items:[]})');
 assert.equal(h.events.length,1);
 h.run('bbOnboardingShoppingMilestone({items:[{required:0}]})');
 assert.equal(h.events.length,1);
 h.run('bbOnboardingShoppingMilestone({items:[{required:0.000001,toBuy:0}]})');
 assert.equal(h.events.at(-1).type,'basketboss:first-shopping-list-created','covered or tiny requirements still form a real list');
});

test('optional telemetry errors never undo a successfully persisted plan',()=>{
 const h=fixture({listenerThrows:true});
 assert.doesNotThrow(()=>h.run("addRecipe('family-dinner','Monday')"));
 assert.equal(h.state.planned.length,1);
 assert.doesNotThrow(()=>h.run('bbOnboardingShoppingMilestone({items:[{required:600}]})'));
});

test('a school-lunch-only first plan signals activation after its successful save, without counting count edits or removals',()=>{
 const h=fixture(),saved=new Map();
 h.context.BB321_LUNCH_KEY='school-lunches';
 h.context.bb321LunchState={children:1,days:{Monday:[]}};
 h.context.BB321Lunch={normaliseLunchbox:value=>JSON.parse(JSON.stringify(value))};
 h.context.localStorage={setItem:(key,value)=>saved.set(key,value)};
 const start=source.indexOf('function bb321StoreLunch(next){');
 vm.runInContext(source.slice(start,source.indexOf('\nfunction bb321LunchboxRequirements',start)),h.context);
 assert.equal(h.run('bb321StoreLunch({children:1,days:{Monday:[{name:"Pasta",qty:0.333333,unit:"g"}]}})'),true);
 assert.equal(JSON.parse(saved.get('school-lunches')).days.Monday[0].qty,0.333333,'lunch state stays precise');
 assert.deepEqual(h.events.map(event=>event.type),['basketboss:first-meal-plan-created']);
 h.run('bbOnboardingShoppingMilestone({items:[{required:0.333333,toBuy:0}]})');
 assert.equal(h.events.at(-1).type,'basketboss:first-shopping-list-created');
 h.run('bb321StoreLunch({children:2,days:{Monday:[{name:"Pasta",qty:0.333333,unit:"g"}]}})');
 h.run('bb321StoreLunch({children:2,days:{Monday:[]}})');
 assert.equal(h.events.length,2,'editing children or removing lunch items is not a first creation');
});

function manualFixture(){
 const homeKey='basketboss_at_home_requirements_v1',values=new Map([['stock',JSON.stringify({'eggs|each':10})],['inventory','{}'],['basketboss_cloud_session_v1',JSON.stringify({user:{id:'test-person'}})]]),events=[],saved=[];
 let blocked=false,requestId='first-add',doc;
 const walk=node=>[node,...node.children.flatMap(walk)];
 class Node{
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parentNode:null,ownerDocument:doc,className:'',attributes:new Map(),events:new Map(),style:{},value:'',disabled:false,hidden:false,open:false,_text:''});}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='open')this.open=true;}
  removeAttribute(name){this.attributes.delete(name);if(name==='open')this.open=false;}
  addEventListener(name,fn){const handlers=this.events.get(name)||[];handlers.push(fn);this.events.set(name,handlers);}
  async fire(name){const event={target:this,preventDefault(){}};await Promise.all((this.events.get(name)||[]).map(fn=>fn(event)));}
  matches(selector){return selector.split(',').some(raw=>{const text=raw.trim();return text==='dialog[open]'?this.tagName==='DIALOG'&&this.open:text.startsWith('.')?this.className.split(/\s+/).includes(text.slice(1)):this.tagName.toLowerCase()===text;});}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>node.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  contains(node){return walk(this).includes(node);}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  focus(){doc.activeElement=this;}
  blur(){doc.activeElement=doc.body;}
  showModal(){this.setAttribute('open','');}
  close(){this.removeAttribute('open');void this.fire('close');}
 }
 doc={createElement:tag=>new Node(tag),querySelector:selector=>doc.body.querySelector(selector)};doc.body=new Node('body');doc.body.style.overflow='auto';doc.activeElement=doc.body;
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){if(blocked&&key===homeKey)throw Error('Storage unavailable');values.set(key,value);},removeItem:key=>values.delete(key)};
 const win={localStorage:storage,CustomEvent:class{constructor(type){this.type=type;}},dispatchEvent:event=>events.push(event),document:doc,location:{search:''},crypto:{randomUUID:()=>requestId},
  BBHomeHost:{id:(name,unit)=>name.toLowerCase()+'|'+unit,keys:()=>({stock:'stock',inventory:'inventory'}),stock:()=>JSON.parse(values.get('stock')),household:()=>[],refresh(){},shoppingKind:name=>name==='Toilet rolls'?'household':'food',shoppingPurchaseContext:()=>({shopSessionId:'test-trip',quantity:0})}};
 const home=install(win);win.BBHome=home;
 vm.runInNewContext(fs.readFileSync(new URL('../bb-shop-add.js',import.meta.url),'utf8'),{window:win});
 const container=new Node('div');doc.body.append(container);win.BBShopAdd.mount({container,win,onSaved:result=>saved.push(result)});
 return {home,events,values,win,saved,setBlocked:value=>{blocked=value;},setRequestId:value=>{requestId=value;},async add(name='Eggs',qty='4'){
  if(!doc.querySelector('dialog'))doc.querySelector('.bb-shop-add-open').onclick();
  const nodes=walk(doc.body),item=nodes.find(node=>node.name==='name'),quantity=nodes.find(node=>node.name==='quantityText');
  item.value=name;quantity.value=qty;await quantity.fire('input');await doc.querySelector('form').fire('submit');
  return saved.at(-1);
 }};
}

test('manual food and essential UI additions count only after committed nonzero requests, excluding retries and removals',async()=>{
 for(const name of ['Eggs','Toilet rolls']){
  const h=manualFixture(),stock=h.values.get('stock');
  assert.equal((await h.add(name)).ok,true);
  assert.deepEqual(h.events.map(event=>event.type),['basketboss:first-shopping-list-created']);
  assert.deepEqual(Object.keys(h.events[0]),['type']);
  assert.equal((await h.add(name)).already,true);
  assert.equal(h.events.length,1,'idempotent retries emit no second event');
  h.setRequestId('remove');assert.equal((await h.add(name,'0')).ok,true);
  assert.equal(h.events.length,1,'removing a top-up creates no list');
  assert.equal(h.values.get('stock'),stock,'adding a shopping request cannot credit stock');
 }
});

test('failed manual UI saves and optional telemetry failures never misreport or damage the purchase request',async()=>{
 const h=manualFixture();h.setBlocked(true);await h.add();
 assert.deepEqual(h.saved,[]);assert.deepEqual(h.events,[]);
 h.setBlocked(false);h.win.dispatchEvent=()=>{throw Error('Optional telemetry unavailable');};
 assert.equal((await h.add()).ok,true);
 assert.equal(h.home.shoppingBuys()[0].quantity,4);
});

test('an explicit saved Weekly essentials selection counts only after its real generated need exists',()=>{
 const h=fixture(),values=new Map([['features',JSON.stringify({essentials:[]})]]);
 h.context.BB307_FEATURE_KEY='features';
 h.context.bb307FeatureState={essentials:[{id:'toilet-rolls',name:'Toilet rolls',qty:3,selected:true,owned:false}]};
 h.context.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const start=source.indexOf('function bb307StoreFeatures(){');
 vm.runInContext(source.slice(start,source.indexOf('\nfunction bb307FeaturesRefresh',start)),h.context);
 assert.equal(h.run('bb307StoreFeatures()'),true);
 assert.deepEqual(h.events,[],'the selection must first produce a generated list');
 h.run('bbOnboardingShoppingMilestone({items:[]})');
 assert.deepEqual(h.events,[]);
 h.run('bbOnboardingShoppingMilestone({items:[{qty:3}]})');
 assert.deepEqual(h.events.map(event=>event.type),['basketboss:first-shopping-list-created']);
 assert.equal(h.run('bb307StoreFeatures()'),true);
 h.run('bbOnboardingShoppingMilestone({items:[{qty:3}]})');
 assert.equal(h.events.length,1,'resaving unrelated preferences cannot arm another creation');
});

test('a failed school-lunch or essential save cannot arm activation',()=>{
 for(const kind of ['lunch','essential']){
  const h=fixture();
  h.context.console={warn(){}};
  h.context.localStorage={getItem:()=>null,setItem(){throw Error('Storage unavailable');}};
  if(kind==='lunch'){
   h.context.BB321_LUNCH_KEY='lunches';h.context.bb321LunchState={days:{Monday:[]}};
   h.context.BB321Lunch={normaliseLunchbox:value=>value};
   const start=source.indexOf('function bb321StoreLunch(next){');
   vm.runInContext(source.slice(start,source.indexOf('\nfunction bb321LunchboxRequirements',start)),h.context);
   assert.equal(h.run('bb321StoreLunch({days:{Monday:[{name:"Pasta",qty:50,unit:"g"}]}})'),false);
  }else{
   h.context.BB307_FEATURE_KEY='features';h.context.bb307FeatureState={essentials:[{id:'soap',selected:true,owned:false,qty:1}]};
   const start=source.indexOf('function bb307StoreFeatures(){');
   vm.runInContext(source.slice(start,source.indexOf('\nfunction bb307FeaturesRefresh',start)),h.context);
   assert.equal(h.run('bb307StoreFeatures()'),false);
  }
  h.run('bbOnboardingShoppingMilestone({items:[{required:50}]})');
  assert.deepEqual(h.events,[]);
 }
});

test('web entry documents stay byte identical after activation instrumentation',()=>{
 assert.equal(source,fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));
});
