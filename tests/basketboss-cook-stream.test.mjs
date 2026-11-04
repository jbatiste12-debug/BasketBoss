import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createCookAssistantHandler} from '../functions/api/cook-assistant.js';
import {digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';
import {COOK_ASSISTANT_MODEL,COOK_ASSISTANT_INSTRUCTIONS,compactCookingContext,cookingProviderRequest} from '../bb-server-lib/bb-cook-assistant.js';
import {cookingAnswerStreamResponse} from '../bb-server-lib/bb-cook-stream.js';

const actor='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
const body=()=>({question:'What does a gentle simmer look like?',recipe:{id:'fajitas',title:'Chicken fajitas',servings:4,ingredients:[{name:'chicken',quantity:'665 g'},{name:'pepper',quantity:'2 each'}],steps:['Heat the pan.','Simmer gently for 10 minutes.'],currentStep:1,phase:'cook',region:'UK'},history:[],mentorName:'Chef Boss'});
const encode=new TextEncoder(),message=answer=>({id:'msg_cook',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer}]}),indices={item_id:'msg_cook',output_index:0,content_index:0};
const event=(type,value={})=>({type,...value});
const opening=()=>[event('response.created',{response:{status:'in_progress'}}),event('response.output_item.added',{output_index:0,item:{id:'msg_cook',type:'message',role:'assistant',status:'in_progress',content:[]}}),event('response.content_part.added',{...indices,part:{type:'output_text',text:''}})];
const delta=text=>event('response.output_text.delta',{...indices,delta:text});
const ending=answer=>[event('response.output_text.done',{...indices,text:answer}),event('response.content_part.done',{...indices,part:{type:'output_text',text:answer}}),event('response.output_item.done',{output_index:0,item:message(answer)}),event('response.completed',{response:{status:'completed',output:[message(answer)]}})];
const frame=value=>'event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n';
function wire(){
 let controller,cancelled=false;
 const response=new Response(new ReadableStream({start(value){controller=value;},cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}});
 return {response,push(...values){for(const value of values)controller.enqueue(encode.encode(frame(value)));},bytes(bytes){controller.enqueue(bytes);},close(){controller.close();},get cancelled(){return cancelled;}};
}
function sqlite(db){return {prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};},async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}};}
function harness({provider,who={user:{id:actor},ownerId:actor},cap=80}={}){
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../sql/basketboss_cook_tts_20261102.sql',import.meta.url),'utf8'));
 db.exec('CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY,retry_hash TEXT,user_id TEXT,email TEXT,started_at_ms INTEGER,completed_at_ms INTEGER,locked_until_ms INTEGER);');
 const env={BB_PREMIUM_AI_ENABLED:'true',BB_TTS_DAILY_MISS_CAP:String(cap),BB_TTS_GLOBAL_DAILY_MISS_CAP:'200',OPENAI_API_KEY:'synthetic-provider-key',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',BILLING_DB:sqlite(db)},calls=[];
 let now=1793664000000;
 const handle=createCookAssistantHandler({authorizeMember:async()=>who,clock:()=>now,perform:async(url,options)=>{calls.push({url,options});return provider?.(url,options);}});
 return {db,env,calls,advance(ms){now+=ms;},async invoke({value=body(),signal,headers={}}={}){return handle({env,request:new Request('https://basketboss.co.uk/api/cook-assistant',{method:'POST',headers:{Origin:'capacitor://localhost','Content-Type':'application/json',Accept:'application/x-ndjson',...headers},body:JSON.stringify(value),signal})});},usage(){return db.prepare("SELECT actor,used FROM bb_ai_daily_usage ORDER BY actor").all();},close(){db.close();}};
}
const read=async reader=>{const result=await reader.read();return result.done?null:JSON.parse(new TextDecoder().decode(result.value));};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('first answer tokens reach the caller while the provider is still generating, with one quota reservation',async()=>{
 const source=wire(),h=harness({provider:()=>source.response});
 try{
  const response=await h.invoke(),reader=response.body.getReader();
  assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/^application\/x-ndjson/);assert.match(response.headers.get('Cache-Control'),/private, no-store/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  source.push(...opening(),delta('Keep it at a gentle simmer.'));
  assert.deepEqual(await read(reader),{type:'delta',text:'Keep it at a gentle simmer.'},'a first sentence is available before any completion frame exists');
  source.push(delta(' Stir now and then.'),...ending('Keep it at a gentle simmer. Stir now and then.'));
  assert.deepEqual(await read(reader),{type:'delta',text:' Stir now and then.'});assert.deepEqual(await read(reader),{type:'done'});assert.equal(await read(reader),null);
  assert.equal(h.calls.length,1);assert.deepEqual(h.usage().map(row=>row.used),[1,1]);assert.equal(source.cancelled,true);
  const sent=JSON.parse(h.calls[0].options.body);assert.equal(sent.stream,true);assert.equal(sent.store,false);assert.equal(sent.model,COOK_ASSISTANT_MODEL);assert.deepEqual(sent.tools,[]);assert.deepEqual(sent.text,{format:{type:'text'}});assert.equal(h.calls[0].options.redirect,'manual');assert.match(sent.instructions,/plain text, never JSON/);
  assert(!h.calls[0].options.body.includes(actor));assert(!h.calls[0].options.body.includes('synthetic-provider-key'));assert.deepEqual(JSON.parse(sent.input[0].content[0].text).recipe,body().recipe);
 }finally{h.close();}
});
test('legacy clients still receive the original complete JSON answer',async()=>{
 const h=harness({provider:()=>Response.json({status:'completed',output:[message(JSON.stringify({answer:'Stir gently.'}))]})});
 try{const response=await h.invoke({headers:{Accept:'application/json'}});assert.deepEqual(await response.json(),{answer:'Stir gently.'});assert.equal(JSON.parse(h.calls[0].options.body).stream,false);}finally{h.close();}
});
test('streaming uses the same pre-generation membership, request validation and atomic daily allowance',async()=>{
 for(const status of [401,403,409]){const h=harness({who:{error:'denied',status}});try{assert.equal((await h.invoke()).status,status);assert.equal(h.calls.length,0);assert.equal(h.usage().length,0);}finally{h.close();}}
 const source=wire(),h=harness({provider:()=>source.response,cap:1});
 try{
  const invalid=body();invalid.model='other';assert.equal((await h.invoke({value:invalid})).status,400);assert.equal(h.calls.length,0);
  const first=await h.invoke();source.push(...opening(),delta('Stir gently.'),...ending('Stir gently.'));await first.text();
  assert.equal((await h.invoke()).status,429);assert.equal(h.calls.length,1);assert.deepEqual(h.usage().map(row=>row.used),[1,1]);
 }finally{h.close();}
});
test('client disconnect cancels a stalled provider reader and its fetch immediately',async()=>{
 const source=wire(),h=harness({provider:()=>source.response});
 try{
  const response=await h.invoke(),reader=response.body.getReader();source.push(...opening(),delta('Stir gently.'));await read(reader);
  await reader.cancel();await tick();assert.equal(source.cancelled,true);assert.equal(h.calls[0].options.signal.aborted,true);assert.deepEqual(h.usage().map(row=>row.used),[1,1]);
 }finally{h.close();}
});
test('request abort before generation spends nothing; an in-flight abort emits no late words',async()=>{
 const early=new AbortController();early.abort();const denied=harness();
 try{assert.equal((await denied.invoke({signal:early.signal})).status,499);assert.equal(denied.calls.length,0);assert.equal(denied.usage().length,0);}finally{denied.close();}
 const source=wire(),controller=new AbortController(),h=harness({provider:()=>source.response});
 try{
  const response=await h.invoke({signal:controller.signal}),reader=response.body.getReader();source.push(...opening(),delta('Stir gently.'));await read(reader);controller.abort();
  assert.deepEqual(await read(reader),{type:'error',code:'BB_COOK_REQUEST_CANCELLED'});assert.equal(await read(reader),null);assert.equal(source.cancelled,true);assert.equal(h.calls[0].options.signal.aborted,true);
 }finally{h.close();}
});
test('member or household deletion between streamed chunks withholds every later word and cancels provider',async()=>{
 for(const deleted of [actor,owner]){
  const source=wire(),h=harness({who:{user:{id:actor},ownerId:owner},provider:()=>source.response});
  try{
   const response=await h.invoke(),reader=response.body.getReader();source.push(...opening(),delta('Stir gently.'));await read(reader);
   h.db.prepare('INSERT INTO bb_account_deletions(actor_hash) VALUES (?)').run(await digestDeletionActor(deleted));h.advance(201);source.push(delta(' PRIVATE late answer.'),...ending('Stir gently. PRIVATE late answer.'));
   assert.deepEqual(await read(reader),{type:'error',code:'BB_COOK_ACCOUNT_PENDING'});assert.equal(await read(reader),null);assert.equal(source.cancelled,true);assert.equal(h.calls[0].options.signal.aborted,true);
  }finally{h.close();}
 }
});
test('fragmented UTF-8 and CRLF provider frames preserve exact spoken text',async()=>{
 const source=wire(),h=harness({provider:()=>source.response});
 try{
  const response=await h.invoke(),answer='Café sauce: use ½ tsp.';
  const bytes=encode.encode([...opening(),delta(answer),...ending(answer)].map(frame).join('').replace(/\n/g,'\r\n'));
  for(let at=0;at<bytes.length;at+=7)source.bytes(bytes.slice(at,at+7));
  assert.deepEqual((await response.text()).trim().split('\n').map(JSON.parse),[{type:'delta',text:answer},{type:'done'}]);
 }finally{h.close();}
});
test('provider failures never leak private bodies, credentials, frame metadata or unknown error categories',async()=>{
 const privateText='SECRET provider body synthetic-provider-key';
 for(const [status,code] of [[403,'BB_COOK_PROVIDER_ACCESS'],[429,'BB_COOK_PROVIDER_LIMIT'],[503,'BB_COOK_PROVIDER_UNAVAILABLE'],[302,'BB_COOK_PROVIDER_REJECTED']]){
  const h=harness({provider:()=>new Response(privateText,{status})});
  try{const text=await (await h.invoke()).text();assert.deepEqual(JSON.parse(text),{type:'error',code});assert(!text.includes(privateText));assert.equal(h.calls.length,1);}finally{h.close();}
 }
});
test('malformed, oversized, tool, refusal, mismatched and incomplete provider streams fail closed',async()=>{
 const cases=[
  [event('response.output_item.added',{output_index:0,item:{id:'tool',type:'function_call',name:'update_pantry',arguments:'PRIVATE'}})],
  [...opening(),event('response.refusal.delta',{...indices,delta:'PRIVATE'})],
  [...opening(),delta('{"answer":"PRIVATE"}')],
  [...opening(),delta('x'.repeat(1001))],
  [...opening(),delta('Private\u0000control')],
  [...opening(),{...delta('PRIVATE'),item_id:'other'}],
  [...opening(),delta('Stir.'),...ending('Different answer.')],
  [...opening(),delta('Stir.')],
  [event('unknown.provider.frame',{secret:'PRIVATE'})]
 ];
 for(const values of cases){
  const source=wire(),h=harness({provider:()=>source.response});
  try{const response=await h.invoke();source.push(...values);source.close();const frames=(await response.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(frames.at(-1),{type:'error',code:'BB_COOK_PROVIDER_RESPONSE'});assert(!frames.some(value=>value.type==='done'));assert(!JSON.stringify(frames).includes('PRIVATE'));assert.equal(h.calls[0].options.signal.aborted,true);}finally{h.close();}
 }
 for(const value of ['not json\n\n','data: '+JSON.stringify({type:'response.created',private:'x'.repeat(17000)})+'\n\n']){
  const source=wire(),h=harness({provider:()=>source.response});
  try{const response=await h.invoke();source.bytes(encode.encode(value));source.close();assert.deepEqual(JSON.parse(await response.text()),{type:'error',code:'BB_COOK_PROVIDER_RESPONSE'});}finally{h.close();}
 }
});
test('compact history removes old turns without changing authoritative recipe facts or scaled quantities',()=>{
 const value=body();value.history=Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',text:String(i)+'x'.repeat(499)}));
 const compact=compactCookingContext(value);assert.deepEqual(compact.history,value.history.slice(-2));assert.deepEqual(compact.recipe,value.recipe);assert.equal(compact.question,value.question);assert.equal(value.history.length,6);
 const sent=cookingProviderRequest(value,{stream:true}),context=JSON.parse(sent.input[0].content[0].text);assert.deepEqual(context.recipe.ingredients,[{name:'chicken',quantity:'665 g'},{name:'pepper',quantity:'2 each'}]);assert.deepEqual(context.recipe.steps,value.recipe.steps);
 value.history=[{role:'assistant',text:'orphan'},{role:'user',text:'x'.repeat(1200)},{role:'assistant',text:'y'.repeat(1200)}];assert.deepEqual(compactCookingContext(value).history,[],'an oversized pair is omitted whole');
 value.history=[{role:'assistant',text:'orphan'},{role:'user',text:'Complete question?'},{role:'assistant',text:'Complete answer.'},{role:'user',text:'Unanswered question'}];assert.deepEqual(compactCookingContext(value).history,value.history.slice(1,3),'no orphan or unanswered turn is sent');
 assert.match(COOK_ASSISTANT_INSTRUCTIONS,/UNTRUSTED DATA/);assert.match(COOK_ASSISTANT_INSTRUCTIONS,/ingredient list is authoritative for ingredient amounts/);assert.match(COOK_ASSISTANT_INSTRUCTIONS,/Never double-scale/);assert.match(COOK_ASSISTANT_INSTRUCTIONS,/cross-contamination/);assert.match(COOK_ASSISTANT_INSTRUCTIONS,/Do not navigate/);
});
test('a stalled provider body hits the whole-request deadline instead of waiting indefinitely',async t=>{
 const deadline=new AbortController(),original=AbortSignal.timeout.bind(AbortSignal);
 t.mock.method(AbortSignal,'timeout',ms=>ms===25000?deadline.signal:original(ms));
 const source=wire(),h=harness({provider:()=>source.response});
 try{const response=await h.invoke(),reader=response.body.getReader();source.push(...opening(),delta('Stir gently.'));await read(reader);deadline.abort();assert.deepEqual(await read(reader),{type:'error',code:'BB_COOK_PROVIDER_UNAVAILABLE'});assert.equal(source.cancelled,true);assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(await read(reader),null);}finally{h.close();}
});
test('token bursts use bounded deletion checks instead of a serial database check per token',async()=>{
 const source=wire();let checks=0;
 const response=cookingAnswerStreamResponse(body(),{OPENAI_API_KEY:'synthetic'},{perform:async()=>source.response,clock:()=>100,guard:async()=>{checks++;}});
 source.push(...opening(),...Array.from({length:64},()=>delta('a')),...ending('a'.repeat(64)));
 const frames=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(frames.length,65);assert.equal(checks,2,'first chunk and verified completion each check once');assert.equal(frames.at(-1).type,'done');
});
