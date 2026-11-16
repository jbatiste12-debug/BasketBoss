import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../make-a-meal.html',import.meta.url),'utf8');
const start=html.indexOf('  function scannerEntry(entry){'),end=html.indexOf("  document.addEventListener('click',function(event){",start);
assert.ok(start>0&&end>start);
const source=html.slice(start,end);
function fixture({membership='free',access='available',pantry=true}={}){
 const blocked=[],navigation=[],premium=[],errors=[];let refresh=0;
 const window={location:{search:'',assign:value=>navigation.push(value)},BBFoodScanAccess:{state:()=>access,isPantry:()=>pantry,refresh:()=>{refresh++;}},BasketBossVerifiedPremium:{refresh:()=>{refresh++;}}};
 const ctx=vm.createContext({window,membershipState:()=>membership,showPremiumForAI:entry=>premium.push(entry),visibleError:value=>errors.push(value)});vm.runInContext(source,ctx);
 function invoke(scan=true){const entry={matches:()=>scan},event={preventDefault:()=>blocked.push('default'),stopImmediatePropagation:()=>blocked.push('propagation')};return ctx.allowEntry(entry,event);}
 return {invoke,blocked,navigation,premium,errors,refresh:()=>refresh};
}
test('verified Premium controls keep their exact synchronous browser gesture',()=>{const h=fixture({membership:'premium'});assert.equal(h.invoke(),true);assert.equal(h.invoke(false),true);assert.deepEqual(h.blocked,[]);});
test('a server-authorised free pantry scan preserves native file-label activation',()=>{const h=fixture();assert.equal(h.invoke(),true);assert.deepEqual(h.blocked,[]);assert.deepEqual(h.premium,[]);});
test('default free scan routes into the real review and catalogue flow',()=>{const h=fixture({pantry:false});assert.equal(h.invoke(),false);assert.deepEqual(h.navigation,['make-a-meal.html?bbscan=pantry&location=fridge']);assert.equal(h.blocked.length,2);});
test('query removal after handoff cannot repeatedly redirect the free camera picker',()=>{const h=fixture({pantry:true});assert.equal(h.invoke(),true);assert.equal(h.invoke(),true);assert.deepEqual(h.navigation,[]);assert.deepEqual(h.blocked,[]);});
test('exhausted free scan control opens the existing Premium prompt',()=>{const h=fixture({access:'exhausted'});assert.equal(h.invoke(),false);assert.equal(h.premium.length,1);assert.equal(h.blocked.length,2);});
test('signed-out photo entry explains free-account verification while generation stays Premium',()=>{const h=fixture({membership:'signed_out',access:'signed_out'});assert.equal(h.invoke(),false);assert.match(h.errors[0],/free account/);assert.equal(h.premium.length,0);assert.equal(h.invoke(false),false);assert.equal(h.premium.length,1);});
test('pending scan status waits for the existing verified availability check',()=>{const h=fixture({access:'checking'});assert.equal(h.invoke(),false);assert.equal(h.refresh(),1);assert.equal(h.premium.length,0);});
