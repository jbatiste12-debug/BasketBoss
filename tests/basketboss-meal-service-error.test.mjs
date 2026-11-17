import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest,GEMINI_URL,MODEL} from '../functions/api/bb173/[action].js';
import {mealProviderCode,mealServiceErrorPayload,logMealDiagnostic} from '../bb-server-lib/bb-meal-service-error.js';
import {nativeCorsResponse} from '../bb-server-lib/bb-request-origin.js';
import {verifyMealImageTicket} from '../bb-server-lib/bb-meal-image.js';

const marker='private-test-marker';
const origin='https://basketboss.co.uk';
const input={ingredients:['Rice','Carrots'],mode:'only_have',servings:4};
const recipe=()=>({title:'Rice with carrots',summary:'A simple dinner.',servings:4,prepMinutes:5,cookMinutes:20,
 ingredients:[{name:'Rice',quantity:'250 g',fromHome:true},{name:'Carrots',quantity:'200 g',fromHome:true}],
 steps:['Cook the rice and carrots thoroughly.'],extraIngredients:[],allergens:[],safetyNotes:['Review ingredient labels and cooking safety.']});
const providerRecipe=value=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]});

function harness({provide=()=>providerRecipe(recipe()),user=true}={}){
 const db=new DatabaseSync(':memory:'),calls=[],logs=[],deadlines=[];
 db.exec('CREATE TABLE bb_ai_daily_usage(day_utc TEXT,actor TEXT,action TEXT,used INTEGER,PRIMARY KEY(day_utc,actor,action)); CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY);');
 const env={BB_PREMIUM_AI_ENABLED:'true',BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',BB_OWNER_USER_ID:marker,
  SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:marker,GEMINI_API_KEY:marker,
  TURNSTILE_SITE_KEY:marker,TURNSTILE_SECRET_KEY:marker,BB_AI_GLOBAL_DAILY_CAP:'20',
  BILLING_DB:{prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;}};}};}}};
 const previous={fetch:globalThis.fetch,warn:console.warn,timeout:AbortSignal.timeout};
 console.warn=(...args)=>logs.push(args.join(' '));
 AbortSignal.timeout=ms=>{deadlines.push(ms);return previous.timeout(ms);};
 globalThis.fetch=async(address,options)=>{
  if(String(address).endsWith('/auth/v1/user'))return user?Response.json({id:marker,email:marker+'@example.invalid',email_confirmed_at:'2026-11-01T00:00:00Z'}):new Response(null,{status:401});
  assert.match(String(address),/^https:\/\/generativelanguage\.googleapis\.com\//,'only the mocked AI provider may be requested');
  calls.push({address:String(address),options});
  return provide(address,options);
 };
 return {env,db,calls,logs,deadlines,
  async request(action='generate',body=input,headers={}){
   const request=new Request(origin+'/api/bb173/'+action,{method:action==='status'?'GET':'POST',
    headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+marker,...headers},
    ...(action==='status'?{}:{body:JSON.stringify(body)})});
   const response=await onRequest({request,env,params:{action}});
   return {response,status:response.status,body:await response.clone().json()};
  },
  quota(){return db.prepare('SELECT actor,action,used FROM bb_ai_daily_usage ORDER BY actor,action').all();},
  restore(){globalThis.fetch=previous.fetch;console.warn=previous.warn;AbortSignal.timeout=previous.timeout;db.close();}
 };
}
async function withHarness(options,run){const h=harness(options);try{return await run(h);}finally{h.restore();}}
function assertSafeFailure(h,result,code,stage,status=502){
 assert.equal(result.status,status);assert.deepEqual(result.body,mealServiceErrorPayload(code));
 assert.ok(result.body.error.length<=200,'installed clients retain the full reference');
 assert.equal(h.logs.length,1);assert.equal(h.logs[0],'BB_MEAL_DIAGNOSTIC '+JSON.stringify({stage,code,status}));
 assert.doesNotMatch(JSON.stringify({body:result.body,logs:h.logs}),new RegExp(marker+'|https?://|Bearer|<html>|stack-trace'));
}

test('meal references use fixed bounded categories and unknown inputs fall back safely',()=>{
 for(const [status,expected]of [[401,'ACCESS'],[403,'ACCESS'],[429,'LIMIT'],[500,'UNAVAILABLE'],[503,'UNAVAILABLE'],[599,'UNAVAILABLE'],[400,'REJECTED'],[404,'REJECTED'],[200,'REJECTED'],['503','REJECTED']])
  assert.equal(mealProviderCode(status),'BB_MEAL_PROVIDER_'+expected);
 for(const code of ['BB_MEAL_PROVIDER_ACCESS','BB_MEAL_PROVIDER_LIMIT','BB_MEAL_PROVIDER_UNAVAILABLE','BB_MEAL_PROVIDER_REJECTED','BB_MEAL_PROVIDER_RESPONSE','BB_MEAL_RESPONSE_INVALID','BB_MEAL_TIMEOUT','BB_MEAL_SERVICE_FAILURE']){
  const payload=mealServiceErrorPayload(code);assert.equal(payload.code,code);assert.match(payload.error,new RegExp('Reference: '+code+'\\.$'));assert.ok(payload.error.length<=200);
 }
 for(const untrusted of [marker,Error(marker),{},'constructor','__proto__'])assert.deepEqual(mealServiceErrorPayload(untrusted),mealServiceErrorPayload('BB_MEAL_SERVICE_FAILURE'));
});

test('diagnostic logging accepts only allowlisted primitive categories',()=>{
 const previous=console.warn,logs=[];console.warn=(...args)=>logs.push(args);
 try{
  for(const args of [[marker,'BB_MEAL_TIMEOUT',502],['request',marker,503],['request',Error(marker),503],['request','BB_MEAL_TIMEOUT',399],['request','BB_MEAL_TIMEOUT',600],['request','BB_MEAL_TIMEOUT','502']])assert.equal(logMealDiagnostic(...args),false);
  assert.deepEqual(logs,[]);assert.equal(logMealDiagnostic('provider_request','BB_MEAL_TIMEOUT',502),true);
  assert.deepEqual(logs,[['BB_MEAL_DIAGNOSTIC {"stage":"provider_request","code":"BB_MEAL_TIMEOUT","status":502}']]);
 }finally{console.warn=previous;}
});

test('provider HTTP failures preserve the 502 boundary and quota while exposing only a safe reference',async()=>{
 for(const status of [401,403,429,500,503,404])await withHarness({provide:()=>new Response('<html>'+marker+' stack-trace</html>',{status,headers:{'Content-Type':'text/html'}})},async h=>{
  const result=await h.request();assertSafeFailure(h,result,mealProviderCode(status),'provider_request');
  assert.equal(h.calls.length,1,'provider failures are not retried');assert.equal(h.quota().length,2,'per-account and global quota are still consumed before the provider');
  assert(h.quota().every(row=>row.used===1));assert.equal(h.calls[0].address,GEMINI_URL);assert.ok(h.deadlines.includes(25000));
 });
});

test('unreadable provider JSON, missing text and malformed recipe JSON have distinct safe response references',async()=>{
 for(const provide of [()=>new Response(marker,{headers:{'Content-Type':'application/json'}}),()=>Response.json({candidates:[],privateDetails:marker}),()=>Response.json({candidates:[{content:{parts:[{text:'{"privateDetails":"'+marker+'",'}]}}]})])
  await withHarness({provide},async h=>{assertSafeFailure(h,await h.request(),'BB_MEAL_PROVIDER_RESPONSE','provider_response');assert.equal(h.calls.length,1);});
});

test('validation rejection cannot return a recipe or issue a picture ticket',async()=>withHarness({provide:()=>providerRecipe({...recipe(),ingredients:[{name:'Chicken',quantity:'250 g',fromHome:true}]})},async h=>{
 const result=await h.request();assertSafeFailure(h,result,'BB_MEAL_RESPONSE_INVALID','response_validation');
 assert.equal(result.body.recipe,undefined);assert.equal(result.body.mealImage,undefined);assert.equal(h.calls.length,1);
}));

test('provider transport and timeout failures retain the existing deadline and never retry',async()=>{
 for(const [name,code]of [['TypeError','BB_MEAL_PROVIDER_UNAVAILABLE'],['TimeoutError','BB_MEAL_TIMEOUT'],['AbortError','BB_MEAL_TIMEOUT']])
  await withHarness({provide:()=>{const error=Error(marker+' stack-trace');error.name=name;throw error;}},async h=>{
   assertSafeFailure(h,await h.request(),code,'provider_request');assert.deepEqual(h.deadlines,[6500,25000]);assert.equal(h.calls.length,1);assert.equal(h.quota().length,2);
  });
});

test('a provider body timeout is still classified as a timeout instead of a format error',async()=>withHarness({provide:()=>({ok:true,json:async()=>{const error=Error(marker);error.name='TimeoutError';throw error;}})},async h=>{
 assertSafeFailure(h,await h.request(),'BB_MEAL_TIMEOUT','provider_response');assert.equal(h.calls.length,1);
}));

test('successful generation keeps its validated recipe, image ticket, model and request contract',async()=>withHarness({},async h=>{
 const result=await h.request();assert.equal(result.status,200);assert.deepEqual(result.body.recipe,recipe());
 assert.equal(result.body.ok,true);assert.equal(result.body.aiGenerated,true);assert.equal(result.body.reviewRequired,true);
 assert.equal(result.body.warning,'Unverified recipe. Confirm quantities, allergens, cooking and storage safety.');
 assert.deepEqual(h.logs,[]);assert.equal(h.calls.length,1);assert.match(h.calls[0].address,new RegExp('/'+MODEL+':generateContent$'));
 const sent=JSON.parse(h.calls[0].options.body);assert.equal(sent.generationConfig.maxOutputTokens,1550);assert.equal(sent.generationConfig.temperature,0.25);assert.equal(sent.generationConfig.responseMimeType,'application/json');
 const grant=await verifyMealImageTicket(result.body.mealImage.ticket,{id:marker},h.env,origin);assert.deepEqual(grant.recipe,recipe());assert.equal(h.quota().length,2);
}));

test('a picture failure retains its existing message and cannot invalidate the returned recipe',async()=>withHarness({provide:address=>String(address)===GEMINI_URL?providerRecipe(recipe()):new Response(marker,{status:502})},async h=>{
 const created=await h.request(),original=JSON.stringify(created.body.recipe);
 const picture=await h.request('meal-image',{ticket:created.body.mealImage.ticket});
 assert.equal(picture.status,502);assert.deepEqual(picture.body,{error:'The meal picture could not be created. Your recipe is still ready to review.'});
 assert.equal(JSON.stringify(created.body.recipe),original);assert.equal(h.calls.length,2);assert.deepEqual(h.logs,[]);
}));

test('authorization, origin, validation and daily limits still stop before any provider request',async()=>{
 for(const setup of ['no-auth','origin','input','quota'])await withHarness({},async h=>{
  if(setup==='quota')h.db.prepare('INSERT INTO bb_ai_daily_usage VALUES(?,?,?,?)').run(new Date().toISOString().slice(0,10),'user:'+marker,'generate',10);
  const result=await h.request('generate',setup==='input'?{...input,ingredients:[]}:input,setup==='no-auth'?{Authorization:''}:setup==='origin'?{Origin:'https://attacker.invalid'}:{});
  assert.equal(result.status,setup==='input'?400:setup==='quota'?429:403);assert.equal(h.calls.length,0);assert.deepEqual(h.logs,[]);
  if(setup!=='quota')assert.deepEqual(h.quota(),[]);
 });
});

test('unexpected endpoint exceptions become redacted JSON503 compatible with native CORS',async()=>withHarness({},async h=>{
 Object.defineProperty(h.env,'GEMINI_API_KEY',{get(){throw Error(marker+' stack-trace');}});
 const result=await h.request();assertSafeFailure(h,result,'BB_MEAL_SERVICE_FAILURE','request',503);
 assert.equal(h.calls.length,0);assert.deepEqual(h.quota(),[]);
 const cors=nativeCorsResponse(new Request(origin+'/api/bb173/generate',{headers:{Origin:'capacitor://localhost'}}),result.response);
 assert.equal(cors.status,503);assert.equal(cors.headers.get('Access-Control-Allow-Origin'),'capacitor://localhost');assert.match(cors.headers.get('Content-Type'),/application\/json/);
}));

test('public status and missing configuration keep their original guarded responses',async()=>withHarness({},async h=>{
 const status=await h.request('status',{}, {Authorization:''});assert.equal(status.status,200);assert.deepEqual(status.body,{status:'disabled',premium_ai:false,turnstileRequired:true,siteKey:null});
 h.env.BB_PREMIUM_AI_ENABLED='false';const disabled=await h.request();assert.equal(disabled.status,503);assert.deepEqual(disabled.body,{error:'Premium AI not configured'});
 assert.equal(h.calls.length,0);assert.deepEqual(h.quota(),[]);assert.deepEqual(h.logs,[]);
}));
