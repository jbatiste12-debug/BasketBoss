import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),sync=require('../bb-pantry-pack-sync.js');
const ACTOR='11111111-1111-4111-8111-111111111111',HOUSE='33333333-3333-4333-8333-333333333333',OTHER='44444444-4444-4444-8444-444444444444',ORIGIN='https://basketboss.co.uk';
const clone=value=>JSON.parse(JSON.stringify(value));
const value=()=>({version:1,name:'rice',loc:'cupboard',stockLevel:{version:1,capacity:1000,unit:'g',spares:0,portion:'low',source:'label',estimated:true,capacityEstimated:false,confirmedQuantity:250,confirmedUnit:'g',scope:{kind:'household',id:HOUSE},confirmedAt:'2026-11-16T12:00:00.000Z'}});
const json=(body,status=200)=>Response.json(body,{status});
globalThis.__bbPackApiFixture={
 livePaidBillingEnabled:()=>true,testFlightBetaEnabled:()=>false,readPersonalPaidAccess:async env=>({premiumAccess:env.fixturePremium!==false}),
 json,authenticatedUser:async()=>({id:ACTOR,email:'fixture@example.test'}),isLive:()=>true,expectedPrice:()=>true,entitlementForStatus:()=>true,requireSameOrigin:request=>request.headers.get('Origin')===ORIGIN,isNewestVerifiedSession:async()=>true
};
const source=fs.readFileSync(new URL('../functions/api/household/index.js',import.meta.url),'utf8')
 .replace(/import \{([^\n]+)\} from '\.\.\/\.\.\/\.\.\/bb-server-lib\/bb-paid-access\.js';/,'const {$1}=globalThis.__bbPackApiFixture;')
 .replace(/import \{([^\n]+)\} from '\.\.\/\.\.\/\.\.\/bb-server-lib\/bb-billing\.js';/,'const {$1}=globalThis.__bbPackApiFixture;')
 .replace(/import \{([^\n]+)\} from '\.\.\/\.\.\/\.\.\/bb-server-lib\/bb-premium-seat\.js';/,'const {$1}=globalThis.__bbPackApiFixture;')
 .replace("../../../bb-server-lib/bb-household-email.js",new URL("../bb-server-lib/bb-household-email.js",import.meta.url).href);
assert.ok(!source.includes(" from '../../../bb-server-lib/"));
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const env=()=>({CF_PAGES_BRANCH:'main',BB_PARTNER_SHARING_ENABLED:'true',BB_PARTNER_PRODUCTION_READY:'true',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_fixture_'+'p'.repeat(30),SUPABASE_SECRET_KEY:'sb_secret_fixture_'+'s'.repeat(40),BILLING_DB:{prepare(){}},fixturePremium:true});
const request=(body,mode='pantry_packs')=>new Request(ORIGIN+'/api/household'+(body?'':'?mode='+mode),{method:body?'POST':'GET',headers:{Authorization:'Bearer fixture-token',...(body?{Origin:ORIGIN,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
function fixture({rows=[],conflict=false}={}){
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(address,init={})=>{
  const url=new URL(address),body=init.body?JSON.parse(init.body):null;calls.push({url,body});
  if(url.pathname.endsWith('/bb_households'))return json(url.searchParams.has('owner_user_id')?[{id:HOUSE,owner_user_id:ACTOR,invite_status:'accepted'}]:[]);
  if(url.pathname.endsWith('/bb_household_entries'))return json(rows);
  if(url.pathname.endsWith('/rpc/bb_hh_service_patch'))return json(conflict?{ok:false,conflict:true,revision:2}:{ok:true,revision:body.p_expected+1});
  throw Error('Unexpected fixture request');
 };
 return {calls,restore:()=>{globalThis.fetch=original;},patches:()=>calls.filter(call=>call.body?.p_section)};
}
const patch=(metadata=value(),extra={})=>({action:'patch',section:'kitchen_item',key:sync.entryKey(metadata),value:metadata,expected:0,expectedHouseholdId:HOUSE,...extra});

test('dedicated reads fetch only bounded metadata leaves for the authorized household',async()=>{
 const metadata=value(),rows=[{section:'kitchen_item',entry_key:sync.entryKey(metadata),value:metadata,revision:1}],f=fixture({rows});
 try{
  const response=await api.onRequestGet({request:request(),env:env()});assert.equal(response.status,200);assert.deepEqual(await response.json(),{household_id:HOUSE,entries:rows});
  const query=f.calls.find(call=>call.url.pathname.endsWith('/bb_household_entries')).url.searchParams;
  assert.equal(query.get('household_id'),'eq.'+HOUSE);assert.equal(query.get('section'),'eq.kitchen_item');assert.equal(query.get('entry_key'),'like.pantry-pack-v1:*');assert.equal(query.get('limit'),'501');assert.equal(query.get('select'),'section,entry_key,value,revision');
 }finally{f.restore();}
});

test('metadata patches carry a scope precondition and return the verified household id',async()=>{
 const f=fixture();try{
  const body=patch(),response=await api.onRequestPost({request:request(body),env:env()});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,revision:1,household_id:HOUSE});
  const rpc=f.patches()[0].body;assert.deepEqual(rpc,{p_actor:ACTOR,p_household:HOUSE,p_section:'kitchen_item',p_key:body.key,p_value:body.value,p_expected:0});
  assert.equal(Object.hasOwn(rpc.p_value,'qty'),false);assert.equal(Object.hasOwn(rpc.p_value,'stock'),false);
 }finally{f.restore();}
});

test('missing or changed expected household ids are rejected before the CAS RPC',async()=>{
 for(const expectedHouseholdId of [undefined,OTHER,'not-a-household']){
  const f=fixture();try{const response=await api.onRequestPost({request:request(patch(value(),{expectedHouseholdId})),env:env()});assert.equal(response.status,409);assert.equal((await response.json()).conflict,true);assert.equal(f.patches().length,0);}finally{f.restore();}
 }
});

test('namespace values reject quantity fields, private fields, invalid estimates and identity substitutions',async()=>{
 const bad=[];let entry=value();entry.qty=250;bad.push(entry);entry=value();entry.stockLevel.access_token='forbidden';bad.push(entry);
 for(const stockLevel of [{spares:101},{confirmedQuantity:251},{estimated:false},{confirmedUnit:'ml'},{confirmedAt:'2026-11-16T12:00:00Z'},{scope:{kind:'household',id:OTHER}}]){entry=value();Object.assign(entry.stockLevel,stockLevel);bad.push(entry);}
 for(const metadata of bad){const f=fixture();try{const response=await api.onRequestPost({request:request(patch(metadata)),env:env()});assert.equal(response.status,400);assert.equal(f.patches().length,0);}finally{f.restore();}}
 for(const extra of [{key:sync.entryKey({...value(),name:'milk'})},{section:'pantry_item'},{stock:{'rice|g':250}},{value:{deleted:true}}]){
  const f=fixture();try{const response=await api.onRequestPost({request:request(patch(value(),extra)),env:env()});assert.equal(response.status,400);assert.equal(f.patches().length,0);}finally{f.restore();}
 }
});

test('explicit metadata tombstones retain identity and use the same CAS boundary',async()=>{
 const metadata={...value(),stockLevel:null},f=fixture();try{const response=await api.onRequestPost({request:request(patch(metadata)),env:env()});assert.equal(response.status,200);assert.equal(f.patches()[0].body.p_value.stockLevel,null);}finally{f.restore();}
});

test('independent reviewed capacity is accepted with a cleared level and stays outside physical stock',async()=>{
 const metadata={...value(),stockLevel:null,pack:{quantity:500,unit:'g',estimated:false,source:'label'}},f=fixture();
 try{const response=await api.onRequestPost({request:request(patch(metadata)),env:env()});assert.equal(response.status,200);assert.deepEqual(f.patches()[0].body.p_value,metadata);assert.equal(Object.hasOwn(f.patches()[0].body.p_value,'qty'),false);}finally{f.restore();}
});

test('pack metadata rejects a different level capacity, dimension, unsafe extra fields or missing estimate source',async()=>{
 const packs=[{quantity:500,unit:'g',estimated:false,source:'label'},{quantity:1000,unit:'ml',estimated:false,source:'label'},{quantity:1000,unit:'g',estimated:false,source:'label',qty:1000},{quantity:1000,unit:'g',estimated:false}];
 for(const packValue of packs){const f=fixture();try{const response=await api.onRequestPost({request:request(patch({...value(),pack:packValue})),env:env()});assert.equal(response.status,400);assert.equal(f.patches().length,0);}finally{f.restore();}}
 const f=fixture();try{const metadata={...value(),pack:{quantity:1000,unit:'g',estimated:false,source:'label'}};assert.equal((await api.onRequestPost({request:request(patch(metadata)),env:env()})).status,200);}finally{f.restore();}
});

test('metadata conflicts return attention without replacing the current remote value',async()=>{
 const f=fixture({conflict:true});try{const response=await api.onRequestPost({request:request(patch()),env:env()});assert.equal(response.status,409);assert.deepEqual(await response.json(),{ok:false,conflict:true,revision:2,household_id:HOUSE});assert.equal(f.patches().length,1);}finally{f.restore();}
});

test('oversized metadata snapshots fail without truncating the shared cache',async()=>{
 const metadata=value(),f=fixture({rows:Array.from({length:501},()=>({section:'kitchen_item',entry_key:sync.entryKey(metadata),value:metadata,revision:1}))});
 try{const response=await api.onRequestGet({request:request(),env:env()});assert.equal(response.status,409);assert.equal(f.patches().length,0);}finally{f.restore();}
});

test('existing household clients retain their original patch response and object contract',async()=>{
 const f=fixture();try{const response=await api.onRequestPost({request:request({action:'patch',section:'kitchen_item',key:'cupboard|rice',value:{name:'Rice',qty:250,unit:'g'},expected:0}),env:env()});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,revision:1});assert.equal(f.patches().length,1);}finally{f.restore();}
});

test('legacy entries reads omit the reserved metadata namespace before an older Kitchen merge can see it',async()=>{
 const metadata=value(),legacy={section:'kitchen_item',entry_key:'cupboard|rice',value:{name:'Rice',qty:250,unit:'g'},revision:1},f=fixture({rows:[legacy,{section:'kitchen_item',entry_key:sync.entryKey(metadata),value:metadata,revision:1}]});
 try{const response=await api.onRequestGet({request:request(null,'entries'),env:env()});assert.equal(response.status,200);assert.deepEqual((await response.json()).entries,[legacy]);assert.equal(f.calls.find(call=>call.url.pathname.endsWith('/bb_household_entries')).url.searchParams.get('or'),'(section.neq.kitchen_item,entry_key.not.like.pantry-pack-v1:*)');}finally{f.restore();}
});

test('the new metadata mode and writes retain the existing paid household gate',async()=>{
 const f=fixture();try{const denied={...env(),fixturePremium:false};assert.equal((await api.onRequestGet({request:request(),env:denied})).status,403);assert.equal((await api.onRequestPost({request:request(patch()),env:denied})).status,403);assert.equal(f.calls.some(call=>call.url.pathname.endsWith('/bb_household_entries')),false);assert.equal(f.patches().length,0);}finally{f.restore();}
});
