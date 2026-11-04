import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createTTSHandler} from '../functions/api/tts.js';
import {requestSpeech,TTS_AUDIO_LIMIT} from '../bb-server-lib/bb-tts.js';
import {digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';

const actor='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',encoder=new TextEncoder(),audio=encoder.encode('ID3-private-mp3-clip');
function source(){let controller,cancelled=false;return {response:new Response(new ReadableStream({start(value){controller=value;},cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}}),push(value){controller.enqueue(typeof value==='string'?encoder.encode(value):value);},close(){controller.close();},get cancelled(){return cancelled;}};}
function sqlite(db){return {prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};},async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}};}
function harness({provider,who={user:{id:actor},ownerId:actor},cap=80}={}){
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../sql/basketboss_cook_tts_20261102.sql',import.meta.url),'utf8'));
 db.exec('CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY,retry_hash TEXT,user_id TEXT,email TEXT,started_at_ms INTEGER,completed_at_ms INTEGER,locked_until_ms INTEGER);');
 let now=1793664000000;const storage={get:0,head:0,put:0},calls=[];
 const env={BB_TTS_ENABLED:'true',BB_TTS_AUDIO:Object.fromEntries(Object.keys(storage).map(key=>[key,async()=>{storage[key]++;throw Error('Private audio must not touch R2');}])),BB_TTS_DAILY_MISS_CAP:String(cap),BB_TTS_GLOBAL_DAILY_MISS_CAP:'200',OPENAI_API_KEY:'synthetic-provider-key',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',BILLING_DB:sqlite(db)};
 const handle=createTTSHandler({authorizeMember:async()=>who,clock:()=>now,perform:async(url,options)=>{calls.push({url,options});return provider?.(url,options);}});
 return {db,calls,storage,advance(ms){now+=ms;},invoke({headers={},signal,value={text:'Stir gently.',private:true}}={}){return handle({env,request:new Request('https://basketboss.co.uk/api/tts',{method:'POST',headers:{Origin:'capacitor://localhost','Content-Type':'application/json',Accept:'audio/mpeg; streaming=1',...headers},body:JSON.stringify(value),signal})});},usage(){return db.prepare("SELECT actor,used FROM bb_ai_daily_usage ORDER BY actor").all();},close(){db.close();}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('opt-in private browser audio yields validated MP3 bytes before provider EOF and never touches R2',async()=>{
 const wire=source(),h=harness({provider:()=>wire.response});
 try{
  const pending=h.invoke();wire.push(audio);
  const response=await pending,reader=response.body.getReader();
  assert.match(response.headers.get('Content-Type'),/^audio\/mpeg/);assert.equal(response.headers.get('Content-Length'),null);assert.equal(response.headers.get('Cache-Control'),'private, no-store, no-transform');assert.equal(response.headers.get('Vary'),'Authorization, Origin, Accept');assert.equal(response.headers.get('X-BB-TTS-Cache'),'bypass');
  assert.deepEqual((await reader.read()).value,audio,'audio is delivered before closing the provider stream');
  wire.push('tail');assert.deepEqual((await reader.read()).value,encoder.encode('tail'));wire.close();assert.equal((await reader.read()).done,true);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.signal.aborted,true);assert.deepEqual(h.usage().map(row=>row.used),[1,1]);assert.deepEqual(h.storage,{get:0,head:0,put:0});
 }finally{h.close();}
});
test('native/default private audio waits for the full MP3 with a content length',async()=>{
 const wire=source(),h=harness({provider:()=>wire.response});let resolved=false;
 try{
  const pending=h.invoke({headers:{Accept:'audio/mpeg'}}).then(response=>{resolved=true;return response;});wire.push(audio);await tick();assert.equal(resolved,false);
  wire.close();const response=await pending;assert.equal(response.headers.get('Content-Length'),String(audio.length));assert.deepEqual(new Uint8Array(await response.arrayBuffer()),audio);assert.deepEqual(h.storage,{get:0,head:0,put:0});
 }finally{h.close();}
});
test('one-byte chunks cannot escape before the complete MP3 signature is valid',async()=>{
 const wire=source(),h=harness({provider:()=>wire.response});let resolved=false;
 try{
  const pending=h.invoke().then(response=>{resolved=true;return response;});wire.push('I');await tick();assert.equal(resolved,false);wire.push('D');await tick();assert.equal(resolved,false);wire.push('X');
  const response=await pending;assert.equal(response.status,502);assert.equal((await response.json()).code,'BB_COOK_PROVIDER_RESPONSE');assert.equal(wire.cancelled,true);assert.equal(h.calls[0].options.signal.aborted,true);assert.deepEqual(h.storage,{get:0,head:0,put:0});
 }finally{h.close();}
});
test('invalid or oversized private streaming audio fails before any bytes and cancels the provider',async()=>{
 for(const provider of [()=>Response.json({private:'SECRET'}),()=>new Response('not mp3',{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response(new Uint8Array(TTS_AUDIO_LIMIT+1),{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response(audio,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(TTS_AUDIO_LIMIT+1)}})]){
  const h=harness({provider});try{const response=await h.invoke();assert.equal(response.status,502);const text=await response.text();assert.equal(JSON.parse(text).code,'BB_COOK_PROVIDER_RESPONSE');assert(!text.includes('SECRET'));assert.equal(h.calls.length,1);assert.deepEqual(h.storage,{get:0,head:0,put:0});}finally{h.close();}
 }
});
test('a client disconnect aborts private synthesis and a stalled audio reader',async()=>{
 const wire=source(),h=harness({provider:()=>wire.response});
 try{const pending=h.invoke();wire.push(audio);const response=await pending,reader=response.body.getReader();await reader.read();await reader.cancel();await tick();assert.equal(wire.cancelled,true);assert.equal(h.calls[0].options.signal.aborted,true);assert.deepEqual(h.usage().map(row=>row.used),[1,1]);assert.deepEqual(h.storage,{get:0,head:0,put:0});}finally{h.close();}
});
test('aborting the request rejects a stalled audio tail without appending error JSON to MP3',async()=>{
 const wire=source(),controller=new AbortController(),h=harness({provider:()=>wire.response});
 try{const pending=h.invoke({signal:controller.signal});wire.push(audio);const response=await pending,reader=response.body.getReader();await reader.read();controller.abort();await assert.rejects(reader.read());assert.equal(wire.cancelled,true);assert.equal(h.calls[0].options.signal.aborted,true);assert.deepEqual(h.storage,{get:0,head:0,put:0});}finally{h.close();}
});
test('deletion is checked before first bytes, every 200ms and at EOF for both member and owner',async()=>{
 for(const deleted of [actor,owner]){
  const wire=source(),h=harness({who:{user:{id:actor},ownerId:owner},provider:()=>wire.response});
  try{const pending=h.invoke();wire.push(audio);const response=await pending,reader=response.body.getReader();await reader.read();h.db.prepare('INSERT INTO bb_account_deletions(actor_hash) VALUES (?)').run(await digestDeletionActor(deleted));h.advance(201);wire.push('SECRET tail');await assert.rejects(reader.read(),/BB_COOK_ACCOUNT_PENDING/);assert.equal(wire.cancelled,true);assert.equal(h.calls[0].options.signal.aborted,true);}finally{h.close();}
 }
 const wire=source(),h=harness({provider:()=>wire.response});
 try{const pending=h.invoke();wire.push(audio);const response=await pending,reader=response.body.getReader();await reader.read();h.db.prepare('INSERT INTO bb_account_deletions(actor_hash) VALUES (?)').run(await digestDeletionActor(actor));wire.close();await assert.rejects(reader.read(),/BB_COOK_ACCOUNT_PENDING/);}finally{h.close();}
});
test('streaming does not bypass membership, payload validation or daily allowance',async()=>{
 for(const status of [401,403,409]){const h=harness({who:{error:'denied',status}});try{assert.equal((await h.invoke()).status,status);assert.equal(h.calls.length,0);assert.deepEqual(h.storage,{get:0,head:0,put:0});assert.equal(h.usage().length,0);}finally{h.close();}}
 const h=harness({provider:()=>new Response(audio,{headers:{'Content-Type':'audio/mpeg'}}),cap:1});
 try{assert.equal((await h.invoke({value:{text:'Stir gently.',private:true,stream:true}})).status,400);assert.equal(h.calls.length,0);await (await h.invoke()).arrayBuffer();assert.equal((await h.invoke()).status,429);assert.equal(h.calls.length,1);assert.deepEqual(h.usage().map(row=>row.used),[1,1]);assert.deepEqual(h.storage,{get:0,head:0,put:0});}finally{h.close();}
});
test('the low-level audio reader aborts even when a fake provider ignores fetch cancellation',async()=>{
 const wire=source(),controller=new AbortController();
 const speech=await requestSpeech('Stir gently.',{OPENAI_API_KEY:'synthetic'},async()=>wire.response,{mentor:true,signal:controller.signal});
 const reader=speech.getReader(),pending=reader.read();controller.abort();await assert.rejects(pending,/BB_COOK_PROVIDER_UNAVAILABLE/);assert.equal(wire.cancelled,true);
});
test('the synthesis deadline covers the complete audio body and cancels a stalled reader',async t=>{
 const deadline=new AbortController();let requested=0;t.mock.method(AbortSignal,'timeout',ms=>{requested=ms;return deadline.signal;});
 const wire=source();let providerSignal;
 const speech=await requestSpeech('Stir gently.',{OPENAI_API_KEY:'synthetic'},async(url,options)=>{providerSignal=options.signal;return wire.response;},{mentor:true});
 const reader=speech.getReader();wire.push(audio);await reader.read();const pending=reader.read();deadline.abort();await assert.rejects(pending,/BB_COOK_PROVIDER_UNAVAILABLE/);assert.equal(requested,30000);assert.equal(wire.cancelled,true);assert.equal(providerSignal.aborted,true);
});
test('an oversized late chunk ends progressive MP3 with a read failure and never stores personal audio',async()=>{
 const wire=source(),h=harness({provider:()=>wire.response});
 try{const pending=h.invoke();wire.push(audio);const response=await pending,reader=response.body.getReader();await reader.read();wire.push(new Uint8Array(TTS_AUDIO_LIMIT));await assert.rejects(reader.read(),/BB_COOK_PROVIDER_RESPONSE/);assert.equal(wire.cancelled,true);assert.deepEqual(h.storage,{get:0,head:0,put:0});assert.deepEqual(h.usage().map(row=>row.used),[1,1]);}finally{h.close();}
});
