import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createCookAssistantHandler} from '../functions/api/cook-assistant.js';
import {createTTSHandler} from '../functions/api/tts.js';
import {logCookDiagnostic} from '../bb-server-lib/bb-cook-service-error.js';

const secret='PRIVATE synthetic-token synthetic-key user@example.invalid recipe question spoken-reply';
const actor='11111111-1111-4111-8111-111111111111';
const origin='https://basketboss.co.uk';
const question={question:'How should I stir?',recipe:{id:'pasta',title:'Pasta',servings:2,ingredients:[{name:'Pasta',quantity:'200 g'}],steps:['Stir gently.'],currentStep:0,phase:'cook',region:'UK'},history:[]};
function sqlite(db){return {prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}};},async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}};}
function harness(kind,{provider,authorizeMember}={}){
 const db=new DatabaseSync(':memory:');
 db.exec(fs.readFileSync(new URL('../sql/basketboss_cook_tts_20261102.sql',import.meta.url),'utf8'));
 db.exec('CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY,retry_hash TEXT,user_id TEXT,email TEXT,started_at_ms INTEGER,completed_at_ms INTEGER,locked_until_ms INTEGER);');
 const env={BB_PREMIUM_AI_ENABLED:'true',BB_TTS_ENABLED:'true',BB_TTS_DAILY_MISS_CAP:'80',BB_TTS_GLOBAL_DAILY_MISS_CAP:'200',OPENAI_API_KEY:secret,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',BILLING_DB:sqlite(db)};
 const calls=[];
 const perform=async(...args)=>{calls.push(args);return provider?provider(...args):kind==='assistant'?Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({answer:'Stir gently.'})}]}]}):new Response('ID3-synthetic-audio',{headers:{'Content-Type':'audio/mpeg'}});};
 const handle=(kind==='assistant'?createCookAssistantHandler:createTTSHandler)({authorizeMember:authorizeMember||(async()=>({user:{id:actor,email:secret},ownerId:actor})),perform});
 const invoke=(authenticated=true)=>handle({env,request:new Request(origin+'/api/'+(kind==='assistant'?'cook-assistant':'tts'),{method:'POST',headers:{Origin:'capacitor://localhost','Content-Type':'application/json',...(authenticated?{Authorization:'Bearer synthetic-token'}:{})},body:JSON.stringify(kind==='assistant'?question:{text:secret,private:true})})});
 return {db,env,calls,invoke,close:()=>db.close()};
}
async function capture(action){
 const saved=console.warn,lines=[];
 console.warn=(...values)=>lines.push(values);
 try{
  const result=await action();
  const records=lines.map(args=>{
   assert.equal(args.length,1);assert.equal(typeof args[0],'string');assert(args[0].startsWith('BB_COOK_DIAGNOSTIC '));
   assert(!args[0].includes(secret));assert(!args[0].includes(actor));assert(!args[0].includes('synthetic-token'));assert(!args[0].includes('upstream-body'));
   const entry=JSON.parse(args[0].slice('BB_COOK_DIAGNOSTIC '.length));assert.deepEqual(Object.keys(entry),['stage','code','status']);return entry;
  });
  return {result,records};
 }finally{console.warn=saved;}
}
test('the diagnostic logger rejects unknown categories and non-HTTP statuses without printing context',async()=>{
 const {records}=await capture(()=>{
  for(const args of [[secret,'BB_COOK_SERVICE_FAILURE',502],['provider_request',secret,502],['provider_request','BB_COOK_SERVICE_FAILURE',secret],['provider_request','BB_COOK_SERVICE_FAILURE',200],['provider_request','BB_COOK_SERVICE_FAILURE',600],['provider_request',{code:'BB_COOK_SERVICE_FAILURE'},502]])assert.equal(logCookDiagnostic(...args),false);
 });assert.deepEqual(records,[]);
});
for(const kind of ['assistant','tts']){
 test(kind+' logs one fixed provider category without provider body or credentials',async()=>{
  for(const [status,code]of [[401,'BB_COOK_PROVIDER_ACCESS'],[403,'BB_COOK_PROVIDER_ACCESS'],[429,'BB_COOK_PROVIDER_LIMIT'],[503,'BB_COOK_PROVIDER_UNAVAILABLE'],[400,'BB_COOK_PROVIDER_REJECTED']]){
   const h=harness(kind,{provider:()=>new Response('upstream-body '+secret,{status})});
   try{const {result,records}=await capture(()=>h.invoke());assert.equal(result.status,502);assert.equal((await result.json()).code,code);assert.deepEqual(records,[{stage:'provider_request',code,status:502}]);}finally{h.close();}
  }
 });
 test(kind+' distinguishes missing real usage storage from provider failures',async()=>{
  const h=harness(kind);h.db.exec('DROP TABLE bb_ai_daily_usage');
  try{const {result,records}=await capture(()=>h.invoke());assert.equal(result.status,502);assert.equal((await result.json()).code,'BB_COOK_SERVICE_FAILURE');assert.equal(h.calls.length,0);assert.deepEqual(records,[{stage:'quota_database',code:'BB_COOK_SERVICE_FAILURE',status:502}]);}finally{h.close();}
 });
 test(kind+' separates authorization failures and suppresses unauthenticated probes',async()=>{
  const h=harness(kind,{authorizeMember:async()=>{throw Error(secret);}});
  try{
   const denied=await capture(()=>h.invoke());assert.equal(denied.result.status,503);assert.equal((await denied.result.json()).code,'BB_COOK_MEMBERSHIP_UNAVAILABLE');assert.deepEqual(denied.records,[{stage:'authorization',code:'BB_COOK_MEMBERSHIP_UNAVAILABLE',status:503}]);
   const probe=await capture(()=>h.invoke(false));assert.equal(probe.result.status,503);assert.deepEqual(probe.records,[]);assert.equal(h.calls.length,0);
  }finally{h.close();}
 });
 test(kind+' separates configured limits from exhausted daily allowance and keeps success quiet',async()=>{
  const h=harness(kind);h.env.BB_TTS_DAILY_MISS_CAP='1';
  try{
   const success=await capture(()=>h.invoke());assert.equal(success.result.status,200);assert.deepEqual(success.records,[]);
   const limited=await capture(()=>h.invoke());assert.equal(limited.result.status,429);assert.deepEqual(limited.records,[{stage:'quota',code:'BB_COOK_DAILY_LIMIT',status:429}]);assert.equal(h.calls.length,1);
   h.env.BB_TTS_DAILY_MISS_CAP='0';const invalid=await capture(()=>h.invoke());assert.equal(invalid.result.status,503);assert.equal((await invalid.result.json()).code,'BB_COOK_SERVICE_UNAVAILABLE');assert.deepEqual(invalid.records,[{stage:'config',code:'BB_COOK_CONFIG_LIMITS_UNAVAILABLE',status:503}]);
  }finally{h.close();}
 });
 test(kind+' reports fixed configuration categories while preserving unavailable response codes',async()=>{
  const changes=[['BB_COOK_CONFIG_BINDINGS_UNAVAILABLE',env=>{env.SUPABASE_URL='';}],['BB_COOK_CONFIG_PROVIDER_UNAVAILABLE',env=>{delete env.OPENAI_API_KEY;}],[kind==='assistant'?'BB_COOK_CONFIG_AI_DISABLED':'BB_COOK_CONFIG_TTS_DISABLED',env=>{env[kind==='assistant'?'BB_PREMIUM_AI_ENABLED':'BB_TTS_ENABLED']='false';}]];
  for(const [code,change]of changes){const h=harness(kind);change(h.env);try{const {result,records}=await capture(()=>h.invoke());assert.equal(result.status,503);assert.equal((await result.json()).code,'BB_COOK_SERVICE_UNAVAILABLE');assert.deepEqual(records,[{stage:'config',code,status:503}]);const probe=await capture(()=>h.invoke(false));assert.deepEqual(probe.records,[]);}finally{h.close();}}
 });
}
test('private audio body validation has its own stage after provider headers succeeded',async()=>{
 const h=harness('tts',{provider:()=>new Response('upstream-body '+secret,{headers:{'Content-Type':'audio/mpeg'}})});
 try{const {result,records}=await capture(()=>h.invoke());assert.equal(result.status,502);assert.equal((await result.json()).code,'BB_COOK_PROVIDER_RESPONSE');assert.deepEqual(records,[{stage:'provider_audio',code:'BB_COOK_PROVIDER_RESPONSE',status:502}]);}finally{h.close();}
});
