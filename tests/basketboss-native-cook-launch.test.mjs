import test from 'node:test';
import assert from 'node:assert/strict';
import {launchCookSmoke} from '../scripts/ios-cook-launch.mjs';
const timeout=()=>Object.assign(Error('synthetic handshake timeout'),{code:'ETIMEDOUT'});
function fixture({ci=true,failures=[],reports=[]}={}){
 const calls=[];let launches=0,reads=0;
 return {calls,run:()=>launchCookSmoke({ci,
  launch(){calls.push('launch');const error=failures[launches++];if(error)throw error;},
  readReport(){calls.push('report');return reports[reads++]||null;},
  terminate(){calls.push('terminate');},confirmBoot(){calls.push('ready');}
 })};
}
test('an ordinary launch does not enter CI recovery or read a premature report',()=>{
 const h=fixture();assert.deepEqual(h.run(),{report:null});assert.deepEqual(h.calls,['launch']);
});
test('a timed-out handshake accepts an already complete report without another launch',()=>{
 for(const passed of [true,false]){
  const report={complete:true,passed},h=fixture({failures:[timeout()],reports:[report]});
  assert.equal(h.run().report,report);assert.deepEqual(h.calls,['launch','report']);
 }
});
test('an incomplete CI launch receives exactly one terminate/readiness/relaunch attempt',()=>{
 const h=fixture({failures:[timeout()],reports:[{complete:false},null]});
 assert.deepEqual(h.run(),{report:null});assert.deepEqual(h.calls,['launch','report','terminate','report','ready','launch']);
});
test('a failed app report arriving during termination is retained instead of replaced by a retry',()=>{
 const report={complete:true,passed:false},h=fixture({failures:[timeout()],reports:[{complete:false},report]});
 assert.equal(h.run().report,report);assert.deepEqual(h.calls,['launch','report','terminate','report']);
});
test('a second handshake timeout fails when the app has no complete report; it never loops',()=>{
 const second=timeout(),h=fixture({failures:[timeout(),second]});
 assert.throws(h.run,error=>error===second);assert.equal(h.calls.filter(x=>x==='launch').length,2);
 assert.deepEqual(h.calls,['launch','report','terminate','report','ready','launch','report']);
});
test('a complete report after the one retry remains authoritative, including a UI failure',()=>{
 for(const passed of [true,false]){
  const report={complete:true,passed},h=fixture({failures:[timeout(),timeout()],reports:[null,null,report]});
  assert.equal(h.run().report,report);assert.equal(h.calls.filter(x=>x==='launch').length,2);
 }
});
test('developer machines and non-timeout launch errors cannot enter CI recovery',()=>{
 for(const options of [{ci:false,failures:[timeout()]},{failures:[Object.assign(Error('bad app'),{code:'APP_FAILED'})]}]){
  const h=fixture(options);assert.throws(h.run,error=>error===options.failures[0]);assert.deepEqual(h.calls,['launch']);
 }
});
test('termination and readiness failures stop recovery before another app launch',()=>{
 for(const failing of ['terminate','confirmBoot']){
  const calls=[],error=timeout();
  assert.throws(()=>launchCookSmoke({ci:true,launch(){calls.push('launch');throw timeout();},readReport:()=>null,
   terminate(){calls.push('terminate');if(failing==='terminate')throw error;},
   confirmBoot(){calls.push('ready');throw error;}}),value=>value===error);
  assert.equal(calls.filter(x=>x==='launch').length,1);
 }
});
