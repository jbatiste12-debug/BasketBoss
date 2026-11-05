import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),schedule=require('../bb-yellow-stickers.js');
import {onRequest,YELLOW_STICKER_STORES,yellowStickerConfigured} from '../functions/api/yellow-stickers.js';
import {onRequest as apiMiddleware} from '../functions/api/_middleware.js';

const USER='11111111-1111-4111-8111-111111111111',OWNER='22222222-2222-4222-8222-222222222222',SESSION='33333333-3333-4333-8333-333333333333';
const PRICE='pri_'+'a'.repeat(26),TOKEN='header.'+Buffer.from(JSON.stringify({sub:USER,session_id:SESSION,exp:Date.now()/1000+3600})).toString('base64url')+'.signature';
const input=()=>({region:'Guernsey',store:'waitrose',status:'spotted',requestId:'receipt:receipt-1234'});
const snapshot=(extra={})=>({ok:true,region:'Guernsey',store:'waitrose',serverNow:'2026-11-05T18:00:00.000Z',lastSpottedAt:'2026-11-05T17:50:00.000Z',latestNotYetAt:null,expiresAt:'2026-11-05T19:20:00.000Z',spottedReports:2,...extra});
function request(method='GET',body,options={}){const headers={Origin:options.native?'capacitor://localhost':'https://basketboss.co.uk',Authorization:'Bearer '+TOKEN,'Content-Type':'application/json',...options.headers};for(const [key,value]of Object.entries(headers))if(value===null)delete headers[key];return new Request(options.url||'https://basketboss.co.uk/api/yellow-stickers'+(method==='GET'?'?region=Guernsey&store=waitrose':''),{method,headers,...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});}
function setup(options={}){
 const saved=globalThis.fetch,calls=[],queries=[];
 const env={SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_'+'p'.repeat(30),SUPABASE_SECRET_KEY:'sb_secret_'+'s'.repeat(40),CF_PAGES_BRANCH:'main',BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',BB_TESTFLIGHT_BETA_ENABLED:options.beta?'true':'false',PADDLE_LIVE_FOUNDER_PRICE_ID:PRICE,PADDLE_LIVE_STANDARD_PRICE_ID:'pri_'+'b'.repeat(26),BB_PREMIUM_SINGLE_SESSION_ENABLED:'true'};
 if(options.owner)env.BB_OWNER_USER_ID=USER;
 if(options.partner){env.BB_PARTNER_SHARING_ENABLED='true';env.BB_PARTNER_PRODUCTION_READY='true';env.BB_LIVE_WEBHOOK_ENABLED='true';}
 env.BILLING_DB={async batch(){return [];},prepare(sql){let args=[];queries.push(sql);return {bind(...values){args=values;return this;},async first(){if(sql.includes('bb_account_deletions')&&!sql.includes('bb_testflight_beta_grants'))return options.deleting?{found:1}:null;if(sql.includes('bb_testflight_beta_grants'))return options.beta?{user_id:USER,started_at_ms:Date.now()-3600000,expires_at_ms:Date.now()+3600000,application_version:'15',proof_hash:'a'.repeat(64)}:null;if(sql.includes('bb_paid_entitlements')){if(options.entitlementOutage)throw Error('D1 unavailable');const allowed=options.partner?args[0]===OWNER:options.paid!==false;return allowed?{status:'active',price_id:PRICE,plan:'founder'}:null;}throw Error('Unexpected D1 query: '+sql);},async all(){return {results:[]};}};}};
 globalThis.fetch=async(url,init)=>{const address=String(url);calls.push({url:address,init});if(address.endsWith('/auth/v1/user'))return options.authFailure?Response.json({}, {status:401}):Response.json({id:USER,email:'tester@example.invalid',email_confirmed_at:'2026-11-01T12:00:00Z'});if(address.endsWith('/rpc/bb_hh_service_session_ok'))return Response.json(options.newest!==false);if(address.includes('/bb_households?'))return Response.json(options.partner?[{owner_user_id:OWNER,partner_user_id:USER,partner_email:'tester@example.invalid',invite_status:'accepted'}]:[]);if(address.endsWith('/rpc/bb_yellow_sticker_snapshot'))return options.databaseFailure?Response.json({}, {status:503}):Response.json(options.aggregate||snapshot());if(address.endsWith('/rpc/bb_yellow_sticker_report'))return options.databaseFailure?Response.json({}, {status:503}):Response.json(options.report||snapshot({duplicate:false,user_id:USER,unwanted:'private'}));throw Error('Unexpected HTTP address: '+address);};
 return {env,calls,queries,reports:()=>calls.filter(x=>x.url.endsWith('/rpc/bb_yellow_sticker_report')),snapshots:()=>calls.filter(x=>x.url.endsWith('/rpc/bb_yellow_sticker_snapshot')),restore(){globalThis.fetch=saved;}};
}

test('Premium aggregate returns only server timestamps and store-level counts, with no public identity',async()=>{
 const h=setup();try{const result=await onRequest({request:request(),env:h.env});assert.equal(result.status,200);assert.deepEqual(await result.json(),snapshot());assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(h.snapshots().length,1);assert.equal(h.reports().length,0);assert.deepEqual(JSON.parse(h.snapshots()[0].init.body),{p_region:'Guernsey',p_store:'waitrose'});}finally{h.restore();}
});
test('authenticated Premium reports use verified server actor and bounded status/idempotency fields',async()=>{
 const h=setup();try{const response=await onRequest({request:request('POST',input()),env:h.env});assert.equal(response.status,200);assert.deepEqual(await response.json(),snapshot({duplicate:false}));const sent=h.reports()[0];assert.deepEqual(JSON.parse(sent.init.body),{p_user:USER,p_region:'Guernsey',p_store:'waitrose',p_status:'spotted',p_request_id:'receipt:receipt-1234'});assert.equal(sent.init.headers.apikey,h.env.SUPABASE_SECRET_KEY);assert.equal(sent.init.headers.Authorization,undefined);assert.equal(sent.init.redirect,'manual');}finally{h.restore();}
});
test('Free accounts and browser Premium claims cannot read or write sightings',async()=>{
 for(const method of ['GET','POST']){const h=setup({paid:false});try{const body={...input(),premium:true};const req=method==='POST'?request(method,input(),{headers:{'X-Premium':'true'}}):request(method,undefined,{headers:{'X-Premium':'true'}});const response=await onRequest({request:req,env:h.env});assert.equal(response.status,403);assert.equal((await response.json()).error,'yellow_sticker_premium_required');assert.equal(h.snapshots().length+h.reports().length,0);if(method==='POST')assert.equal((await onRequest({request:request(method,body),env:h.env})).status,400);}finally{h.restore();}}
});
test('existing TestFlight, household and owner access policies are honored without client tier shortcuts',async()=>{
 for(const options of [{paid:false,beta:true},{paid:false,partner:true},{paid:false,owner:true}]){const h=setup(options);try{const response=await onRequest({request:request('GET'),env:h.env});assert.equal(response.status,200,JSON.stringify(options));assert.equal(h.snapshots().length,1);}finally{h.restore();}}
});
test('sign-in, replaced sessions, deletion and entitlement outages fail closed before community writes',async()=>{
 for(const [options,status]of [[{authFailure:true},401],[{newest:false},403],[{deleting:true},409],[{paid:false,entitlementOutage:true},503]]){const h=setup(options);try{const response=await onRequest({request:request('POST',input()),env:h.env});assert.equal(response.status,status,JSON.stringify(options));assert.equal(h.reports().length+h.snapshots().length,0);}finally{h.restore();}}
 const h=setup();try{const response=await onRequest({request:request('GET',undefined,{headers:{Authorization:null}}),env:h.env});assert.equal(response.status,401);assert.equal(h.calls.length,0);}finally{h.restore();}
});
test('scope, schema, body-size, content-type and origin validation cannot publish a report',async()=>{
 const h=setup();try{
  for(const bad of [{...input(),region:'US'},{...input(),region:'UK',store:'alliance'},{...input(),store:'alliance;drop'},{...input(),status:'maybe'},{...input(),requestId:'x'},{...input(),timestamp:'2026-11-05'}, {...input(),user_id:OWNER}])assert.equal((await onRequest({request:request('POST',bad),env:h.env})).status,400);
  assert.equal((await onRequest({request:request('POST','{not-json'),env:h.env})).status,400);
  assert.equal((await onRequest({request:request('POST','x'.repeat(513)),env:h.env})).status,413);
  assert.equal((await onRequest({request:request('POST',input(),{headers:{'Content-Type':'text/plain'}}),env:h.env})).status,415);
  assert.equal((await onRequest({request:request('POST',input(),{headers:{Origin:'https://other.example'}}),env:h.env})).status,403);
  assert.equal((await onRequest({request:request('GET',undefined,{url:'https://basketboss.co.uk/api/yellow-stickers?region=UK&region=Jersey&store=waitrose'}),env:h.env})).status,400);
  assert.equal(h.reports().length+h.snapshots().length,0);
 }finally{h.restore();}
});
test('cooldown and idempotency conflicts remain explicit, while outage returns no invented live state',async()=>{
 for(const [report,status]of [[{ok:false,error:'yellow_sticker_cooldown',retryAfterSeconds:299},429],[{ok:false,error:'yellow_sticker_request_conflict'},409],[{ok:false,error:'yellow_sticker_sign_in_required'},401]]){const h=setup({report});try{const response=await onRequest({request:request('POST',input()),env:h.env});assert.equal(response.status,status);if(status===429)assert.equal(response.headers.get('Retry-After'),'299');}finally{h.restore();}}
 for(const options of [{databaseFailure:true},{aggregate:snapshot({region:'Jersey'})},{aggregate:snapshot({lastSpottedAt:'2026-11-05T16:20:00Z'})},{aggregate:snapshot({lastSpottedAt:'2026-11-05T19:00:00Z'})},{aggregate:snapshot({spottedReports:-1})}]){const h=setup(options);try{const response=await onRequest({request:request(),env:h.env});assert.equal(response.status,503);assert.equal((await response.json()).lastSpottedAt,undefined);}finally{h.restore();}}
});
test('native requests retain the shared CORS boundary and same-origin GET works without an Origin header',async()=>{
 const h=setup();try{const native=request('GET',undefined,{native:true});const response=await apiMiddleware({request:native,env:h.env,next:()=>onRequest({request:native,env:h.env})});assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'capacitor://localhost');assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);assert.equal((await onRequest({request:request('GET',undefined,{headers:{Origin:null,'Sec-Fetch-Site':'same-origin'}}),env:h.env})).status,200);}finally{h.restore();}
});
test('configuration is pinned to production and supported store dictionaries never include cross-region chains',()=>{
 const h=setup();try{for(const env of [{...h.env,SUPABASE_URL:'https://other.supabase.co'},{...h.env,CF_PAGES_BRANCH:'preview'},{...h.env,SUPABASE_SECRET_KEY:''}])assert.equal(yellowStickerConfigured(request(),env),false);assert.equal(YELLOW_STICKER_STORES.UK.includes('alliance'),false);assert.equal(YELLOW_STICKER_STORES.Guernsey.includes('tesco'),false);assert.equal(YELLOW_STICKER_STORES.Jersey.includes('iceland'),true);}finally{h.restore();}
});

test('schedule and API resolve the same supported regional store IDs',()=>{for(const [region,stores]of Object.entries(YELLOW_STICKER_STORES))for(const store of stores)assert.equal(schedule.resolveStore(region,store)?.id,store,region+' '+store);});
