import test from 'node:test';
import assert from 'node:assert/strict';
import {keyboardRuntimePlan} from '../scripts/ios-keyboard-runtime.mjs';
const runtimes=[{identifier:'latest',name:'iOS 26.5',version:'26.5',isAvailable:true},{identifier:'working',name:'iOS 26.2',version:'26.2',isAvailable:true}];
const devices={latest:[{udid:'cold-se',name:'iPhone SE (3rd generation)',state:'Shutdown',isAvailable:true}],working:[{udid:'tested-phone',name:'iPhone 17',state:'Booted',isAvailable:true}]};
test('keyboard CI reuses the booted simulator that already passed native checks instead of cold-booting the latest runtime',()=>{
 const plan=keyboardRuntimePlan({runtimes,devices,githubActions:true});
 assert.deepEqual(plan.reuse,{id:'tested-phone',name:'iPhone 17',runtimeVersion:'26.2'});
 assert.equal(plan.resetSyntheticCIApp,true);
});
test('local keyboard checks retain disposable-device isolation and cannot reset a developer app',()=>{
 const local=keyboardRuntimePlan({runtimes,devices});
 assert.equal(local.reuse,null);assert.equal(local.resetSyntheticCIApp,false);
 assert.equal(local.runtimes[0].identifier,'working','local disposable devices also prefer the proven runtime');
 const coldCI=keyboardRuntimePlan({runtimes,devices:{},githubActions:true});
 assert.equal(coldCI.reuse,null);assert.equal(coldCI.resetSyntheticCIApp,false);
});
