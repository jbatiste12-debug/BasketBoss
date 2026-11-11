import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {renderKitchenRulesFallback,replaceKitchenRulesFallback,START,END} from '../scripts/build-kitchen-rules-fallback.mjs';
import * as sharedRules from '../bb-kitchen-choice-rules.mjs';

const source=fs.readFileSync(new URL('../bb-kitchen-essentials.js',import.meta.url),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function entered(h,count){for(let n=0;n<200&&h.attempts.length<count;n++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(h.attempts.length,count);}

function fixture(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bb-rules-recovery-')),key='bbRecovery_'+randomUUID(),attempts=[],timers=new Map(),listeners=new Map(),frames=[],events=[];
 globalThis[key]={attempts};
 fs.writeFileSync(path.join(folder,'bb-kitchen-choice-rules.mjs'),`const record=globalThis[${JSON.stringify(key)}];await new Promise((resolve,reject)=>record.attempts.push({url:import.meta.url,resolve,reject}));export const isHousehold=()=>true;export const previewOrder=items=>items;export const FOOD_PREVIEWS={};export const HOUSEHOLD_PREVIEWS=[];`);
 const policy=Object.freeze({identity:'existing-pantry-policy'}),stock='{"rice|g":16.666667,"milk|ml":233.333333}';
 const win={BBPantryPolicy:policy,localStorage:{getItem:()=>stock,setItem(){throw Error('The classifier must not write stock');}},addEventListener:(name,handler)=>listeners.set(name,handler),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event)};
 const doc={readyState:'loading',currentScript:{src:pathToFileURL(path.join(folder,'bb-kitchen-essentials.js')).href},addEventListener(){}};
 const setTimer=(handler,ms)=>{const id={unref(){}};timers.set(id,{handler,ms});return id;},clearTimer=id=>timers.delete(id);
 new Function('window','document','location','requestAnimationFrame','setTimeout','clearTimeout',source)(win,doc,{href:doc.currentScript.src},callback=>frames.push(callback),setTimer,clearTimer);
 t.after(async()=>{for(const attempt of attempts)attempt.resolve();await turn();delete globalThis[key];fs.rmSync(folder,{recursive:true,force:true});});
 return {win,api:win.BBKitchenEssentials,attempts,timers,listeners,frames,events,policy,stock,deadline(){assert.equal(timers.size,1);const [id,{handler,ms}]=[...timers][0];assert.equal(ms,8000);timers.delete(id);handler();}};
}

test('the inline fallback is reproducibly generated from the shared classifier without replacing the live pantry policy',async()=>{
 const block=await renderKitchenRulesFallback();assert.equal(replaceKitchenRulesFallback(source,block),source);
 const policy=Object.freeze({identity:'live'}),win={BBPantryPolicy:policy};vm.runInNewContext(block,{window:win});
 assert.equal(win.BBPantryPolicy,policy);const fallback=win.BBKitchenChoiceRulesFallback;
 for(const name of ['Toilet rolls','ToiletRolls','kitchen towels','Laundry detergent','tooth brushes','nappies','pet food','Brioche buns','Milk','Pork sausages','Rice','Fresh tomatoes'])assert.equal(fallback.isHousehold(name),sharedRules.isHousehold(name),name);
 assert.equal(fallback.isHousehold('Toilet rolls'),true);assert.equal(fallback.isHousehold('Brioche buns'),false);
 assert.equal(JSON.stringify(fallback.FOOD_PREVIEWS),JSON.stringify(sharedRules.FOOD_PREVIEWS));assert.equal(JSON.stringify(fallback.HOUSEHOLD_PREVIEWS),JSON.stringify(sharedRules.HOUSEHOLD_PREVIEWS));
 assert.throws(()=>replaceKitchenRulesFallback(START+'\n'+START+'\n'+END,block),/markers_invalid/);
});

test('a stalled import releases the startup barrier at the deadline using the same trusted household classifier',async t=>{
 const h=fixture(t),pending=h.api.loadRules();await entered(h,1);assert.equal(h.api.loadRules(),pending);assert.equal(h.win.BBKitchenChoiceRules,undefined);
 h.deadline();const ready=await pending;
 assert.equal(ready,h.win.BBKitchenChoiceRulesFallback);assert.equal(h.win.BBKitchenChoiceRules,ready);assert.equal(ready.isHousehold('Toilet rolls'),true);assert.equal(ready.isHousehold('Brioche buns'),false);
 assert.deepEqual(h.api.loadRules.status(),{state:'ready',ready:true,source:'fallback',attempts:1});assert.equal(h.win.BBPantryPolicy,h.policy);assert.equal(h.win.localStorage.getItem('stock'),h.stock);
});

test('a rejected primary import keeps the initial barrier and then recovers offline at the bounded deadline',async t=>{
 const h=fixture(t),pending=h.api.loadRules();await entered(h,1);h.attempts[0].reject(Error('Offline or invalid cached module'));
 assert.equal(await pending,null);assert.equal(h.win.BBKitchenChoiceRules,undefined);assert.equal(h.api.loadRules.status().state,'unavailable');
 h.deadline();assert.equal(h.api.loadRules.status().ready,true);assert.equal(h.api.loadRules.status().source,'fallback');assert.equal(h.win.BBKitchenChoiceRules.isHousehold('Toilet rolls'),true);
});

test('missing or invalid fallback stays fail-closed, releases a hung waiter and recovers on reconnection',async t=>{
 const h=fixture(t),pending=h.api.loadRules();await entered(h,1);h.win.BBKitchenChoiceRulesFallback={isHousehold:()=>false};
 h.deadline();assert.equal(await pending,null);assert.equal(h.api.loadRules.status().state,'unavailable');assert.equal(h.win.BBKitchenChoiceRules,undefined);
 h.listeners.get('online')();await entered(h,2);const retried=h.api.loadRules();assert.notEqual(h.attempts[0].url,h.attempts[1].url);h.attempts[1].resolve();await retried;
 assert.equal(h.api.loadRules.status().ready,true);assert.equal(h.api.loadRules.status().source,'module');assert.equal(h.timers.size,0);
});

test('a stale completed import cannot replace active fallback rules or clear a newer retry',async t=>{
 const h=fixture(t),first=h.api.loadRules();await entered(h,1);h.deadline();const fallback=await first;
 h.listeners.get('online')();await entered(h,2);const second=h.api.loadRules({refresh:true});h.attempts[0].resolve();await turn();await turn();
 assert.equal(h.win.BBKitchenChoiceRules,fallback);assert.equal(h.api.loadRules({refresh:true}),second,'the stale attempt cannot clear the current in-flight promise');
 h.attempts[1].resolve();const module=await second;assert.notEqual(module,fallback);assert.equal(h.win.BBKitchenChoiceRules,module);assert.equal(h.api.loadRules.status().source,'module');assert.equal(h.timers.size,0);
});

test('a valid primary module remains preferred and clears the recovery deadline',async t=>{
 const h=fixture(t),pending=h.api.loadRules();await entered(h,1);h.attempts[0].resolve();const module=await pending;
 assert.equal(h.win.BBKitchenChoiceRules,module);assert.equal(h.api.loadRules.status().source,'module');assert.equal(h.timers.size,0);h.listeners.get('online')();await turn();assert.equal(h.attempts.length,1);
});
