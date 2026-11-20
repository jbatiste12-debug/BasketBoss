import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),source=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const from=source.indexOf('function bbCanRefreshSharedHousehold('),to=source.indexOf('window.BBHomeHost=Object.freeze(',from);
const normalize=source.slice(source.indexOf('function normalize(s){'),source.indexOf('\nfunction norm(s)',source.indexOf('function normalize(s){')));
const code=normalize+'\n'+source.slice(from,to)+'\nglobalThis.sharedRefresh={can:bbCanRefreshSharedHousehold,refresh:bbRefreshSharedHousehold};';
const ACTOR='5ed78e55-f45b-4fa0-bc4d-88807f526aae',TOKEN='verified-session-token',KEY='saved-plan';
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const previous={version:2,planned:[{day:'Monday',recipeId:'before'}]},stock={before:250},features={version:1,essentials:[]};
 const saved={version:2,planned:[{day:'Tuesday',recipeId:'after',servings:6}],pantry:{rice:true},servings:6,feedingSet:true,dayServings:{Tuesday:{recipeId:'after',count:6}},plannedBreakfasts:[{day:'Tuesday',recipeId:'oats'}]};
 const store=new Map([[KEY,JSON.stringify(saved)],['basketboss_cloud_session_v1',JSON.stringify({user:{id:ACTOR},access_token:TOKEN})]]),fields=[],modals=[];
 let renders=0,deleted=false,readFailure=false;
 const ctx={state:previous,bb307Stock:stock,bb307FeatureState:features,bbStorageSafe:true,KEY,DAYS:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
  BBServing:require('../bb-serving-scale.js'),BBPlanExtras:require('../bb-plan-extras.js'),
  localStorage:{getItem:key=>{if(readFailure)throw Error('device storage blocked');return store.get(key)??null;},setItem:()=>{throw Error('A memory refresh must not save');},removeItem:()=>{throw Error('A memory refresh must not delete');}},
  document:{hidden:false,activeElement:{matches:()=>false},querySelectorAll:selector=>selector.startsWith('dialog')?modals:fields},
  window:{BBAccountDeletion:{isDeleting:()=>deleted}},
  bb307ReadStock:()=>({after:250}),bb307ReadFeatures:()=>clone(features),render:()=>{renders++;}
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,store,fields,modals,previous,stock,features,saved,host:ctx.sharedRefresh,pin:()=>({actor:ACTOR,token:TOKEN,expected:store.get(KEY)}),deleting:()=>{deleted=true;},failStorage:()=>{readFailure=true;},get renders(){return renders;}};
}
const field=(values={})=>({tagName:'INPUT',type:'text',value:'',defaultValue:'',disabled:false,readOnly:false,hidden:false,getClientRects:()=>[{}],...values});

test('shared plan refresh reuses the existing normalizer without writing storage, changing tabs or uploading a cloud copy',()=>{
 const h=fixture(),before=[...h.store];h.ctx.tab='discover';h.ctx.window.BasketBossCloud={scheduleSave:()=>assert.fail('must not upload')};
 assert.equal(h.host.can(h.pin()),true);assert.equal(h.host.refresh(h.pin()),true);
 assert.equal(h.renders,1);assert.equal(h.ctx.tab,'discover');
 assert.deepEqual(clone(h.ctx.state.planned),h.saved.planned);assert.deepEqual(clone(h.ctx.state.dayServings),h.saved.dayServings);
 assert.deepEqual(clone(h.ctx.state.plannedBreakfasts),h.saved.plannedBreakfasts);assert.deepEqual(clone(h.ctx.state.pantry),h.saved.pantry);
 assert.deepEqual(h.ctx.bb307Stock,{after:250});assert.deepEqual([...h.store],before);
});

test('account, token, stale plan, deletion, unreadable storage and invalid saved schema all fail closed',()=>{
 for(const alter of [
  (h,p)=>{p.actor='another-account';},(h,p)=>{p.token='old-token';},(h,p)=>{p.expected='previous plan';},
  h=>h.deleting(),h=>{h.ctx.bbStorageSafe=false;},h=>h.failStorage(),
  h=>h.store.set(KEY,'{"version":1,"planned":[]}'),h=>h.store.set(KEY,'{"version":2,"planned":null}'),
  h=>h.store.set('basketboss_cloud_session_v1','not-json'),h=>{h.ctx.document.hidden=true;}
 ]){
  const h=fixture(),p=h.pin();alter(h,p);if(h.store.get(KEY)!==p.expected&&p.expected!=='previous plan')p.expected=h.store.get(KEY);
  assert.equal(h.host.refresh(p),false);assert.equal(h.ctx.state,h.previous);assert.equal(h.renders,0);
 }
});

test('open editors, cooking, and any focused editable control defer the refresh; sharing dialog alone does not',()=>{
 for(const modal of ['pantry-editor','cook-dialog','account-panel']){
  const h=fixture();h.modals.push(field({id:modal}));assert.equal(h.host.can(h.pin()),false);assert.equal(h.renders,0);
 }
 const h=fixture();h.modals.push(field({id:'bbhs-dialog'}));assert.equal(h.host.can(h.pin()),true);
 h.ctx.document.activeElement={matches:()=>true};assert.equal(h.host.can(h.pin()),false);
});

test('a typed then blurred draft is preserved, while pristine, hidden and disabled fields do not block updates',()=>{
 const h=fixture(),draft=field({value:'unsaved pasta'});h.fields.push(draft);
 assert.equal(h.host.refresh(h.pin()),false);assert.equal(h.ctx.state,h.previous);assert.equal(draft.value,'unsaved pasta');
 draft.defaultValue=draft.value;assert.equal(h.host.can(h.pin()),true);
 draft.defaultValue='';draft.hidden=true;assert.equal(h.host.can(h.pin()),true);
 draft.hidden=false;draft.disabled=true;assert.equal(h.host.can(h.pin()),true);
 draft.disabled=false;draft.readOnly=true;assert.equal(h.host.can(h.pin()),true);
});

test('select defaults handle implicit first selection, explicit selection, empty and multiple controls without treating clean fields as dirty',()=>{
 const h=fixture(),select=field({tagName:'SELECT',selectedIndex:0,options:[{defaultSelected:false,selected:true},{defaultSelected:false,selected:false}]});h.fields.push(select);
 assert.equal(h.host.can(h.pin()),true);select.selectedIndex=1;assert.equal(h.host.can(h.pin()),false);
 select.options[1].defaultSelected=true;assert.equal(h.host.can(h.pin()),true);
 select.options=[];select.selectedIndex=-1;assert.equal(h.host.can(h.pin()),true);
 select.multiple=true;select.options=[{defaultSelected:true,selected:true},{defaultSelected:false,selected:false}];assert.equal(h.host.can(h.pin()),true);
 select.options[1].selected=true;assert.equal(h.host.can(h.pin()),false);
});

test('a session, deletion or saved-plan change during reads cancels before replacing any in-memory state',()=>{
 for(const change of [h=>h.store.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:ACTOR},access_token:'replacement-token'})),h=>h.deleting(),h=>h.store.set(KEY,JSON.stringify({...h.saved,planned:[]}))]){
  const h=fixture();h.ctx.bb307ReadStock=()=>{change(h);return {after:250};};
  assert.equal(h.host.refresh(h.pin()),false);assert.equal(h.ctx.state,h.previous);assert.equal(h.ctx.bb307Stock,h.stock);assert.equal(h.renders,0);
 }
});

test('normalizer or renderer failure restores the original plan, stock and feature references',()=>{
 for(const fail of ['normalize','render']){
  const h=fixture();h.ctx[fail]=()=>{throw Error('temporarily unavailable');};
  assert.equal(h.host.refresh(h.pin()),false);assert.equal(h.ctx.state,h.previous);assert.equal(h.ctx.bb307Stock,h.stock);assert.equal(h.ctx.bb307FeatureState,h.features);
 }
});
