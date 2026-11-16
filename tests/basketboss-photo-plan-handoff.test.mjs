import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const begin=html.indexOf('/* BEGIN_BASKETBOSS_PHOTO_ONBOARDING_HOST_V1');
const end=html.indexOf('/* END_BASKETBOSS_PHOTO_ONBOARDING_HOST_V1 */',begin);
assert.ok(begin>=0&&end>begin);
const host=html.slice(begin,end),at=html.indexOf('function persist(){'),persist=html.slice(at,html.indexOf('\n}',at)+2);
const KEY='basketboss_321_unified_state_v1',SESSION='basketboss_cloud_session_v1';
function fixture({saved,fail=false,expired=false,deleting=false,owner='alice',onWrite}={}){
 const values=new Map([[SESSION,JSON.stringify({user:{id:'alice'},access_token:'local-fixture-only',expires_at:expired?1:9999999999})]]),writes=[];let saves=0;
 if(saved!==undefined)values.set(KEY,saved);
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){if(fail&&key===KEY)throw Error('full');values.set(key,String(value));writes.push(key);if(key===KEY)onWrite?.(values);},removeItem:key=>values.delete(key)};
 const state={version:2,planned:[],plannedBreakfasts:[],plannedDesserts:[],pantry:{},servings:4};
 const window={BBHome:{actor:()=>owner},BBAccountDeletion:{isDeleting:()=>deleting},BasketBossCloud:{scheduleSave(){saves++;}}};
 const ctx=vm.createContext({window,localStorage:storage,KEY,state,bbStorageSafe:true,BB_SNAPSHOT:'snapshot',document:{getElementById:()=>null},notify(){},console:{error(){}}});
 vm.runInContext(persist+'\n'+host,ctx);
 return {prepare:()=>window.BBPhotoOnboardingHost.preparePlan(),values,writes,state,window,saves:()=>saves};
}
test('a first photo handoff saves the actual in-memory plan through the existing persistence owner once',()=>{
 const h=fixture();assert.equal(h.values.has(KEY),false,'installing the bridge keeps startup read-only');
 assert.equal(h.prepare(),true);assert.equal(h.values.get(KEY),JSON.stringify(h.state));assert.equal(h.saves(),1);
 assert.equal(h.prepare(),true);assert.equal(h.saves(),1);
});
test('an existing valid plan remains byte-for-byte unchanged',()=>{
 const saved=' {"version":2,"planned":[{"recipeId":"fajitas","day":"Monday"}]} ';
 const h=fixture({saved});assert.equal(h.prepare(),true);assert.equal(h.values.get(KEY),saved);assert.deepEqual(h.writes,[]);assert.equal(h.saves(),0);
});
test('invalid saved plans are not replaced by an empty plan',()=>{
 for(const saved of ['broken','null','[]','{"version":1,"planned":[]}','{"version":2}']){
  const h=fixture({saved});assert.equal(h.prepare(),false);assert.equal(h.values.get(KEY),saved);assert.deepEqual(h.writes,[]);
 }
});
test('a failed original save blocks navigation without fabricating a saved plan',()=>{
 const h=fixture({fail:true});assert.equal(h.prepare(),false);assert.equal(h.values.has(KEY),false);assert.equal(h.saves(),0);
});
test('account changes during the save remove only this bridge attempt and preserve the new session',()=>{
 const h=fixture({onWrite:values=>values.set(SESSION,'new-account-session')});assert.equal(h.prepare(),false);assert.equal(h.values.has(KEY),false);assert.equal(h.values.get(SESSION),'new-account-session');
});
test('a newer concurrently written plan is never rolled back',()=>{
 const newer='{"version":2,"planned":[{"recipeId":"other","day":"Tuesday"}]}';
 const h=fixture({onWrite:values=>{values.set(SESSION,'new-account-session');values.set(KEY,newer);}});assert.equal(h.prepare(),false);assert.equal(h.values.get(KEY),newer);
});
test('expired, deleting and foreign-owned sessions cannot initialise a plan',()=>{
 for(const options of [{expired:true},{deleting:true},{owner:'bob'}]){const h=fixture(options);assert.equal(h.prepare(),false);assert.equal(h.values.has(KEY),false);assert.deepEqual(h.writes,[]);}
});
