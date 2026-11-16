import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../make-a-meal.js',import.meta.url),'utf8');
function actual(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);const end=source.indexOf('\n}',start);return source.slice(start,end+2);}
function fixture(native=true){
 const calls=[],callbacks=[],events=new Map(),host={isConnected:true},status={textContent:''},panel={style:{setProperty(){}},hidden:true},stage={hidden:false};let token='account-one';
 const ctx=vm.createContext({location:{protocol:native?'capacitor:':'https:'},nativeHumanCheck:null,nativeHumanAccount:null,turnstileToken:'',turnstileWidgetId:null,bbTurnstileRequired:true,bbTurnstileLoading:false,
  $:selector=>({'#bbToolStage':stage,'#aiHumanCheck':host,'#aiHumanStatus':status,'#aiSecurityBox':panel})[selector],bbPaidToken:()=>token,requestAnimationFrame:fn=>fn(),document:{querySelector:()=>null,createElement:()=>{throw Error('Unexpected direct challenge script');}},
  window:{addEventListener:(name,fn)=>events.set(name,fn),BBAccountDeletion:{isDeleting:()=>false},BBNativeHumanCheck:{isNative:()=>native,mount(node,options){assert.equal(node,host);calls.push('mount');callbacks.push(options);return {reset(){calls.push('reset');},remove(){calls.push('remove');}};}},turnstile:{render(){calls.push('web-render');return 'web-widget';},reset(){calls.push('web-reset');}}}});
 vm.runInContext(['clearNativeHumanCheck','resetHumanCheck','setupHumanCheck'].map(actual).join('\n'),ctx);
 return {ctx,calls,callbacks,setup:()=>ctx.setupHumanCheck('public_site_key'),switchAccount:()=>{token='account-two';},status};
}
test('native scanner mounts the HTTPS verification helper once and pins its callback to the current account',()=>{
 const h=fixture();h.setup();h.setup();assert.deepEqual(h.calls,['mount']);
 h.callbacks[0].onToken('human-token');assert.equal(h.ctx.turnstileToken,'human-token');
 h.switchAccount();h.callbacks[0].onToken('stale-token');assert.equal(h.ctx.turnstileToken,'human-token');
 h.ctx.clearNativeHumanCheck();assert.equal(h.ctx.turnstileToken,'');assert.deepEqual(h.calls,['mount','remove']);
 h.callbacks[0].onToken('late-token');assert.equal(h.ctx.turnstileToken,'');
});
test('native retry, expiry and cancellation clear the scan token without granting an allowance',()=>{
 const h=fixture();h.setup();h.callbacks[0].onToken('human-token');h.ctx.resetHumanCheck();assert.equal(h.ctx.turnstileToken,'');assert.deepEqual(h.calls,['mount','reset']);
 h.callbacks[0].onToken('next-token');h.callbacks[0].onExpire();assert.equal(h.ctx.turnstileToken,'');assert.match(h.status.textContent,/Retry/);
 h.callbacks[0].onError();assert.match(h.status.textContent,/manually/);h.ctx.clearNativeHumanCheck();assert.equal(h.ctx.nativeHumanCheck,null);
});
test('web scanning retains its existing Turnstile renderer and verified paid users need no hosted frame',()=>{
 const web=fixture(false);web.setup();assert.deepEqual(web.calls,['web-render']);web.ctx.resetHumanCheck();assert.deepEqual(web.calls,['web-render','web-reset']);
 const paid=fixture();paid.ctx.bbTurnstileRequired=false;paid.setup();assert.deepEqual(paid.calls,[]);
});
