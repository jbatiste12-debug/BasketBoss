import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySharedShoppingDeployment} from '../scripts/check-cloudflare-catalogue.mjs';

const BASE='https://basketboss.co.uk';
const ORIGIN='capacitor://localhost';
const ASSETS=['/bb-shared-shopping.js','/bb-shared-shopping.css','/bb-home.js'];
function fixture(change=()=>{}){
 const calls=[];let householdCalls=0;
 const perform=async(url,options)=>{
  const path=url.slice(BASE.length),entry={url,path,options,index:++householdCalls};calls.push(entry);
  const state={status:path.startsWith('/api/')?401:200,type:path.endsWith('.css')?'text/css; charset=utf-8':path.startsWith('/api/')?'application/json; charset=utf-8':'text/javascript; charset=utf-8',origin:options.headers.Origin||null,credentials:null,body:{error:'Private provider detail must never be exposed.'},read:false,cancelled:false};
  change(state,entry);
  return {status:state.status,headers:{get(name){return name.toLowerCase()==='content-type'?state.type:name.toLowerCase()==='access-control-allow-origin'?state.origin:name.toLowerCase()==='access-control-allow-credentials'?state.credentials:null;}},json:async()=>{state.read=true;return state.body;},body:{cancel:async()=>{state.cancelled=true;}},_state:state};
 };
 return {calls,perform};
}
const category=code=>error=>error.code===code&&error.message==='Shared shopping deployment check failed: '+code+'.';

test('production shared shopping verifies assets, live household gates, native transport and the Free trip route without credentials',async()=>{
 const h=fixture();const result=await verifySharedShoppingDeployment(h.perform);
 assert.deepEqual(result,{script:true,stylesheet:true,atHome:true,householdGatesEnabled:true,householdStatus:401,householdNativeStatus:401,nativeOrigin:true,weeklyTripRoute:true,weeklyTripStatus:401});
 assert.equal(h.calls.length,6);assert.deepEqual(h.calls.slice(0,3).map(call=>call.path),ASSETS);
 assert.equal(h.calls.at(-1).path,'/api/shopping/weekly-trip');
 for(const {url,options}of h.calls){assert.ok(url.startsWith(BASE+'/'));assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);assert.equal(options.body,undefined);assert.equal(Object.keys(options.headers).some(name=>/authorization|cookie|apikey/i.test(name)),false);}
 assert.equal(h.calls.filter(call=>call.options.headers.Origin).length,1);
});
for(const asset of ASSETS)test('a missing deployed '+asset+' cannot pass readiness',async()=>{
 const h=fixture((state,call)=>{if(call.path===asset)state.status=404;});await assert.rejects(verifySharedShoppingDeployment(h.perform),category('asset_unavailable'));
});
test('HTML or JSON fallback pages cannot masquerade as shared shopping JavaScript or CSS',async()=>{
 for(const asset of ASSETS){const h=fixture((state,call)=>{if(call.path===asset)state.type='text/html; charset=utf-8';});await assert.rejects(verifySharedShoppingDeployment(h.perform),category('asset_content_type'));}
});
test('gated-off sharing has a fixed actionable category without leaking the response',async()=>{
 const secret='private-provider-secret-not-for-logs';const h=fixture((state,call)=>{if(call.path==='/api/household?mode=status'){state.status=200;state.body={configured:false,error:secret};}});
 await assert.rejects(verifySharedShoppingDeployment(h.perform),error=>category('household_gates_disabled')(error)&&!error.message.includes(secret));
});
test('unexpected household responses cannot claim that sharing is active',async()=>{
 for(const status of[200,403,404,503]){const h=fixture((state,call)=>{if(call.path==='/api/household?mode=status'){state.status=status;state.body={configured:true};}});await assert.rejects(verifySharedShoppingDeployment(h.perform),category('household_auth_boundary'));}
 const wrongType=fixture((state,call)=>{if(call.path==='/api/household?mode=status')state.type='text/html';});await assert.rejects(verifySharedShoppingDeployment(wrongType.perform),category('household_auth_boundary'));
});
test('native household requests require exact allowed Origin and no cookie credentials',async()=>{
 for(const [origin,credentials]of[[null,null],['capacitor://localhost.evil',null],[ORIGIN,'true']]){const h=fixture((state,call)=>{if(call.options.headers.Origin){state.origin=origin;state.credentials=credentials;}});await assert.rejects(verifySharedShoppingDeployment(h.perform),category('household_native_transport'));}
 const h=fixture((state,call)=>{if(call.options.headers.Origin)state.status=403;});await assert.rejects(verifySharedShoppingDeployment(h.perform),category('household_native_auth_boundary'));
});
test('the deployed weekly trip API must reject unauthenticated GET with JSON401',async()=>{
 for(const [status,type]of[[200,'application/json'],[404,'application/json'],[401,'text/html']]){const h=fixture((state,call)=>{if(call.path==='/api/shopping/weekly-trip'){state.status=status;state.type=type;}});await assert.rejects(verifySharedShoppingDeployment(h.perform),category('weekly_trip_auth_boundary'));}
});
test('provider/network exception text and unauthenticated response bodies never leave the check',async()=>{
 await assert.rejects(verifySharedShoppingDeployment(async()=>{throw Error('secret exception body');}),category('request_unavailable'));
 const h=fixture();const perform=async(...args)=>{const response=await h.perform(...args);response.json=async()=>{throw Error('unauthenticated bodies must not be read');};return response;};assert.equal((await verifySharedShoppingDeployment(perform)).householdGatesEnabled,true);
});
