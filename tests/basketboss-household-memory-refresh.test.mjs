import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),source=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const from=source.indexOf('function bbSharedHouseholdScreenReady('),to=source.indexOf('window.BBHomeHost=Object.freeze(',from);
const normalize=source.slice(source.indexOf('function normalize(s){'),source.indexOf('\nfunction norm(s)',source.indexOf('function normalize(s){')));
const code=normalize+'\n'+source.slice(from,to)+'\nglobalThis.sharedRefresh={can:bbCanRefreshSharedHousehold,refresh:bbRefreshSharedHousehold,prepare:bbPrepareSharedHouseholdRecipes,prepareEmpty:bbPrepareEmptySharedHousehold};';
const ACTOR='5ed78e55-f45b-4fa0-bc4d-88807f526aae',TOKEN='verified-session-token',KEY='saved-plan';
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const previous={version:2,planned:[{day:'Monday',recipeId:'before'}]},stock={before:250},features={version:1,essentials:[]};
 const saved={version:2,planned:[{day:'Tuesday',recipeId:'after',servings:6}],pantry:{rice:true},servings:6,feedingSet:true,dayServings:{Tuesday:{recipeId:'after',count:6}},plannedBreakfasts:[{day:'Tuesday',recipeId:'oats'}]};
 const store=new Map([[KEY,JSON.stringify(saved)],['basketboss_cloud_session_v1',JSON.stringify({user:{id:ACTOR},access_token:TOKEN})]]),fields=[],modals=[];
 let renders=0,deleted=false,readFailure=false,loader=async()=>{};const loads=[];
 const ctx={state:previous,bb307Stock:stock,bb307FeatureState:features,bbStorageSafe:true,bbRecovered:false,KEY,BB_SNAPSHOT:'recovered-plan',OLD_PLAN:'legacy-plan',OLD_PANTRY:'legacy-pantry',DAYS:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
  BBServing:require('../bb-serving-scale.js'),BBPlanExtras:require('../bb-plan-extras.js'),
  localStorage:{getItem:key=>{if(readFailure)throw Error('device storage blocked');return store.get(key)??null;},setItem:()=>{throw Error('A memory refresh must not save');},removeItem:()=>{throw Error('A memory refresh must not delete');}},
  document:{hidden:false,activeElement:{matches:()=>false},querySelectorAll:selector=>selector.startsWith('dialog')?modals:fields},
  window:{BBAccountDeletion:{isDeleting:()=>deleted}},
  bb307ReadStock:()=>({after:250}),bb307ReadFeatures:()=>clone(features),render:()=>{renders++;},
  bbVerifiedPaidRecipes:false,bbPremiumUser:null,bbPremiumToken:null,
  bbPremiumMatches:pin=>{const current=JSON.parse(store.get('basketboss_cloud_session_v1')||'null');return pin?.id===current?.user?.id&&pin?.token===current?.access_token;},
  bbPremiumReload:async guard=>{loads.push(guard);return loader(guard);}
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,store,fields,modals,previous,stock,features,saved,loads,host:ctx.sharedRefresh,pin:()=>({actor:ACTOR,token:TOKEN,expected:store.get(KEY)??null}),deleting:()=>{deleted=true;},failStorage:()=>{readFailure=true;},set loader(value){loader=value;},get renders(){return renders;}};
}
const field=(values={})=>({tagName:'INPUT',type:'text',value:'',defaultValue:'',disabled:false,readOnly:false,hidden:false,getClientRects:()=>[{}],...values});

function freshFixture(){
 const h=fixture();h.store.delete(KEY);h.ctx.state=h.ctx.normalize({version:2,planned:[],servings:6,feedingSet:true});
 h.ctx.localStorage.setItem=(key,value)=>h.store.set(key,value);
 return h;
}

test('a pristine signed-in browser can save its actual empty plan before receiving the shared household',()=>{
 const h=freshFixture(),before=JSON.stringify(h.ctx.state),previous=[...h.store];
 assert.equal(h.host.can(h.pin()),false,'the ordinary refresh guard still requires a readable saved plan');
 assert.equal(h.host.prepareEmpty(h.pin()),true);assert.equal(h.store.get(KEY),before);
 assert.equal(h.ctx.state.servings,6);assert.equal(h.ctx.state.feedingSet,true);assert.equal(h.renders,0);
 assert.deepEqual([...h.store].filter(([key])=>key!==KEY),previous);assert.equal(h.host.can(h.pin()),true);
 assert.equal(h.host.prepareEmpty(h.pin()),false,'existing saved plans never use the empty-browser path');
});

test('fresh-browser preparation keeps corrupt, recovered, legacy and nonempty local plans untouched',()=>{
 for(const alter of [
  h=>h.store.set(KEY,'unreadable-saved-plan'),h=>{h.ctx.bbRecovered=true;},
  h=>h.store.set(h.ctx.BB_SNAPSHOT,'unreadable-recovery'),h=>h.store.set(h.ctx.OLD_PLAN,'[]'),h=>h.store.set(h.ctx.OLD_PANTRY,''),
  h=>h.ctx.state.planned.push({day:'Monday',recipeId:'private-dinner'}),h=>{h.ctx.state.pantry.rice=true;},
  h=>h.ctx.state.plannedBreakfasts.push({day:'Monday',recipeId:'oats'}),h=>h.ctx.state.customPantry.push('private-item')
 ]){
  const h=freshFixture();alter(h);const before=[...h.store],memory=JSON.stringify(h.ctx.state);
  assert.equal(h.host.prepareEmpty(h.pin()),false);assert.deepEqual([...h.store],before);assert.equal(JSON.stringify(h.ctx.state),memory);assert.equal(h.renders,0);
 }
});

test('fresh-browser preparation keeps session, deletion, visibility, editor and draft guards intact',()=>{
 for(const alter of [
  h=>h.store.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:'other-account'},access_token:TOKEN})),
  h=>h.store.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:ACTOR},access_token:'different-token'})),
  h=>h.deleting(),h=>{h.ctx.document.hidden=true;},h=>{h.ctx.bbStorageSafe=false;},h=>h.failStorage(),
  h=>{h.ctx.document.activeElement={matches:()=>true};},h=>h.fields.push(field({value:'unsaved note'})),h=>h.modals.push(field({id:'account-editor'}))
 ]){
  const h=freshFixture();alter(h);const before=[...h.store];assert.equal(h.host.prepareEmpty(h.pin()),false);assert.deepEqual([...h.store],before);
 }
});

test('a failed fresh-browser write leaves storage and the in-memory plan unchanged',()=>{
 const h=freshFixture(),before=[...h.store],memory=JSON.stringify(h.ctx.state);
 h.ctx.localStorage.setItem=()=>{throw Error('Storage quota unavailable');};
 assert.equal(h.host.prepareEmpty(h.pin()),false);assert.deepEqual([...h.store],before);assert.equal(JSON.stringify(h.ctx.state),memory);
});

test('fresh-browser preparation rechecks concurrent account, local-plan and recovered-data changes before saving',()=>{
 for(const change of [
  h=>h.store.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:ACTOR},access_token:'replacement-token'})),
  h=>h.store.set(KEY,'concurrent local plan'),h=>h.store.set(h.ctx.OLD_PLAN,'concurrent recovery'),
  h=>h.ctx.state.planned.push({day:'Friday',recipeId:'unsaved local dinner'})
 ]){
  const h=freshFixture(),read=h.ctx.localStorage.getItem;let changed=false,writes=0;
  h.ctx.localStorage.getItem=key=>{const value=read(key);if(!changed&&key===h.ctx.BB_SNAPSHOT){changed=true;change(h);}return value;};
  h.ctx.localStorage.setItem=()=>{writes++;throw Error('A concurrent change cannot be replaced');};
  assert.equal(h.host.prepareEmpty(h.pin()),false);assert.equal(changed,true);assert.equal(writes,0);
 }
});

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

test('preparing shared recipes delegates to the server loader with the existing readiness guard without granting access',async()=>{
 const h=fixture(),before=[...h.store];assert.equal(await h.host.prepare(h.pin()),true);
 assert.equal(h.loads.length,1);assert.equal(typeof h.loads[0],'function');assert.equal(h.loads[0](),true);
 h.fields.push(field({value:'unsaved food'}));assert.equal(h.loads[0](),false,'the exact same callback checks drafts again at response time');
 assert.equal(h.ctx.bbVerifiedPaidRecipes,false,'only the real verified loader may hydrate private recipes');assert.equal(h.renders,0);assert.deepEqual([...h.store],before);
});

test('preparing shared recipes does not start a request while editing, stale, hidden or deleting',async()=>{
 for(const change of [h=>{h.ctx.document.activeElement={matches:()=>true};},h=>h.fields.push(field({value:'typed draft'})),h=>h.modals.push(field({id:'pantry-editor'})),h=>{h.ctx.document.hidden=true;},h=>h.deleting(),(h,p)=>{p.expected='older saved plan';}]){
  const h=fixture(),pin=h.pin();change(h,pin);const before=[...h.store];assert.equal(await h.host.prepare(pin),false);assert.equal(h.loads.length,0);assert.equal(h.renders,0);assert.deepEqual([...h.store],before);
 }
});

test('a delayed recipe load cannot complete preparation after actor, token, plan, draft or deletion changes',async()=>{
 for(const change of [h=>h.store.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:'another-actor'},access_token:TOKEN})),h=>h.store.set('basketboss_cloud_session_v1',JSON.stringify({user:{id:ACTOR},access_token:'another-token'})),h=>h.store.set(KEY,JSON.stringify({...h.saved,planned:[]})),h=>h.fields.push(field({value:'new unsaved food'})),h=>h.deleting()]){
  const h=fixture();let finish;h.loader=()=>new Promise(resolve=>{finish=resolve;});const pending=h.host.prepare(h.pin());assert.equal(h.loads.length,1);change(h);const before=[...h.store];assert.equal(h.loads[0](),false);finish();assert.equal(await pending,false);assert.equal(h.renders,0);assert.deepEqual([...h.store],before);
 }
});

test('only a private catalogue already loaded for the same actor and token skips the server loader',async()=>{
 for(const cache of [{actor:ACTOR,token:TOKEN,expected:0},{actor:'another-actor',token:TOKEN,expected:1},{actor:ACTOR,token:'old-token',expected:1}]){
  const h=fixture();h.ctx.bbVerifiedPaidRecipes=true;h.ctx.bbPremiumUser=cache.actor;h.ctx.bbPremiumToken=cache.token;
  assert.equal(await h.host.prepare(h.pin()),true);assert.equal(h.loads.length,cache.expected);assert.equal(h.renders,0);
 }
});
