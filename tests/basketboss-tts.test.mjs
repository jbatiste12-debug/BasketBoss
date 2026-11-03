import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createTTSHandler} from '../functions/api/tts.js';
import {digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';
import {clipId,clipKey,spokenText,byteRange,TTS_PROFILE,TTS_INSTRUCTIONS,TTS_MENTOR_VOICE,TTS_MENTOR_INSTRUCTIONS,TTS_AUDIO_LIMIT,requestSpeech} from '../bb-server-lib/bb-tts.js';
const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const origin='https://basketboss.co.uk',text='First up, grab 250 grams of gnocchi.';
const audio=new TextEncoder().encode('ID3-test-mp3-audio-for-private-stream');
const member={user:{id:actor,email:'cook@example.invalid'},ownerId:actor};
function sqlite(db){
 return {prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
}
function bucket(){
 const values=new Map(),counts={get:0,head:0,put:0};
 return {values,counts,async head(key){counts.head++;const value=values.get(key);return value?{size:value.bytes.length,httpMetadata:value.httpMetadata,customMetadata:value.customMetadata}:null;},async get(key,options){counts.get++;const value=values.get(key);if(!value)return null;const selected=options?.range,bytes=selected?value.bytes.slice(selected.offset,selected.offset+selected.length):value.bytes;return {size:value.bytes.length,httpMetadata:value.httpMetadata,customMetadata:value.customMetadata,body:new Response(bytes).body};},async put(key,value,options){counts.put++;values.set(key,{bytes:new Uint8Array(value),...options});return {key,size:value.byteLength};}};
}
function harness({who=member,provider,personal=3,global=20}={}){
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../sql/basketboss_cook_tts_20261102.sql',import.meta.url),'utf8'));
 db.exec('CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY,retry_hash TEXT,user_id TEXT,email TEXT,started_at_ms INTEGER,completed_at_ms INTEGER,locked_until_ms INTEGER); CREATE TABLE bb_paid_entitlements(user_id TEXT,status TEXT,price_id TEXT,plan TEXT,updated_at_ms INTEGER);');
 const r2=bucket(),calls=[],env={BB_TTS_ENABLED:'true',BB_TTS_AUDIO:r2,BB_TTS_DAILY_MISS_CAP:String(personal),BB_TTS_GLOBAL_DAILY_MISS_CAP:String(global),OPENAI_API_KEY:'synthetic-provider-key',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',BILLING_DB:sqlite(db)};
 const perform=async(url,options)=>{calls.push({url,options});return provider?provider(url,options):new Response(audio,{headers:{'Content-Type':'audio/mpeg'}});};
 const handle=createTTSHandler({authorizeMember:async()=>who,perform,wait:async()=>{},clock:()=>1800000000000});
 const invoke=(body={text,prepare:true},options={})=>{
  const request=new Request(origin+'/api/tts'+(options.query||''),{method:options.method||'POST',headers:{Authorization:'Bearer synthetic-valid-session',Origin:origin,'Content-Type':'application/json',...options.headers},...(options.method&&options.method!=='POST'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  return handle({request,env,...options.context});
 };
 return {db,r2,calls,env,perform,handle,invoke,usage:()=>db.prepare("SELECT * FROM bb_ai_daily_usage ORDER BY actor").all(),close:()=>db.close()};
}

test('only enabled, configured private storage can start AI Cook voice',async()=>{
 const h=harness();try{for(const change of [env=>{env.BB_TTS_ENABLED='false';},env=>{env.BB_TTS_AUDIO=null;},env=>{env.SUPABASE_URL='';}]){const env={...h.env};change(env);const response=await h.handle({env,request:new Request(origin+'/api/tts',{method:'GET'})});assert.equal(response.status,503);}assert.equal(h.calls.length,0);assert.equal(h.r2.counts.head,0);}finally{h.close();}
});
test('authentication, Premium and deletion denials apply before every cache lookup',async()=>{
 for(const status of [401,403,409]){const h=harness({who:{error:'denied',status}});try{const id=await clipId(text);for(const options of [{method:'POST'},{method:'GET',query:'?clip='+id},{method:'HEAD',query:'?clip='+id}]){const response=await h.invoke({text,prepare:true},options);assert.equal(response.status,status);}assert.equal(h.r2.counts.head+h.r2.counts.get,0);assert.equal(h.calls.length,0);}finally{h.close();}}
});
test('POST origin, JSON type, bounded text and server-owned voice controls are enforced',async()=>{
 const h=harness();try{
  for(const [body,options,status]of [[{text},{headers:{Origin:'https://other.invalid'}},403],[{text},{headers:{'Content-Type':'text/plain'}},415],['{',{},400],[{text:'x'.repeat(1201)},{},400],[{text,voice:'untrusted'},{},400],[{text,prepare:'true'},{},400],[{text:'\u0000hidden'},{},400],[{text:'x'.repeat(9000)},{},413]])assert.equal((await h.invoke(body,options)).status,status);
  assert.equal(h.calls.length,0);assert.equal(h.usage().length,0);
 }finally{h.close();}
});
test('the content hash normalizes whitespace and includes the spoken quantities',async()=>{
 assert.equal(await clipId(spokenText('  First up, grab\n250 grams of gnocchi. ')),await clipId(text));
 assert.notEqual(await clipId(text),await clipId(text.replace('250','500')));
 assert.match(clipKey(await clipId(text)),new RegExp('^cook-voice/'+TTS_PROFILE+'/[a-f0-9]{64}\\.mp3$'));
});
test('one generation persists MP3 and repeated prepared/audio requests never regenerate or consume allowance',async()=>{
 const h=harness();try{
  const first=await h.invoke(),data=await first.json();assert.equal(first.status,200);assert.equal(data.cached,false);assert.match(data.url,/^\/api\/tts\?clip=[a-f0-9]{64}$/);assert.equal(data.contentType,'audio/mpeg');
  assert.equal(h.calls.length,1);const body=JSON.parse(h.calls[0].options.body);assert.equal(body.model,'gpt-4o-mini-tts');assert.equal(body.voice,'cedar');assert.equal(body.input,text);assert.equal(body.instructions,TTS_INSTRUCTIONS);assert.equal(body.response_format,'mp3');
  const before=h.usage();delete h.env.OPENAI_API_KEY;delete h.env.BB_TTS_DAILY_MISS_CAP;delete h.env.BB_TTS_GLOBAL_DAILY_MISS_CAP;
  assert.equal((await (await h.invoke()).json()).cached,true);
  const streamed=await h.invoke(null,{method:'GET',query:'?clip='+data.clipId});assert.equal(streamed.status,200);assert.equal(streamed.headers.get('Content-Type'),'audio/mpeg');assert.equal(streamed.headers.get('Cache-Control'),'private, no-store');assert.equal(streamed.headers.get('Vary'),'Authorization, Origin');assert.deepEqual(new Uint8Array(await streamed.arrayBuffer()),audio);
  const repeated=await h.invoke({text});assert.equal(repeated.status,200);assert.deepEqual(new Uint8Array(await repeated.arrayBuffer()),audio);
  assert.equal(h.calls.length,1);assert.deepEqual(h.usage(),before);
  const object=h.r2.values.get(clipKey(data.clipId));assert.deepEqual(object.customMetadata,{profile:TTS_PROFILE});assert(!JSON.stringify(object).includes(text));
 }finally{h.close();}
});
test('cached GET/HEAD support byte ranges and never expose bearer tokens in a URL',async()=>{
 const h=harness();try{const {clipId:id,url}=await (await h.invoke()).json();assert(!url.includes('synthetic-valid-session'));
  const head=await h.invoke(null,{method:'HEAD',query:'?clip='+id});assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),String(audio.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  for(const [range,expected]of [['bytes=0-1',audio.slice(0,2)],['bytes=3-',audio.slice(3)],['bytes=-5',audio.slice(-5)]]){const response=await h.invoke(null,{method:'GET',query:'?clip='+id,headers:{Range:range}});assert.equal(response.status,206);assert.equal(response.headers.get('Accept-Ranges'),'bytes');assert.equal(Number(response.headers.get('Content-Length')),expected.length);assert.match(response.headers.get('Content-Range'),/^bytes \d+-\d+\/\d+$/);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),expected);}
  assert.equal((await h.invoke(null,{method:'GET',query:'?clip='+id,headers:{Range:'bytes=9999-'}})).status,416);
  assert.equal((await h.invoke(null,{method:'GET',query:'?clip='+id+'&token=secret'})).status,400);
  assert.equal((await h.invoke(null,{method:'GET',query:'?clip='+'0'.repeat(64)})).status,404);assert.equal(h.calls.length,1);
 }finally{h.close();}
});
test('a live generation response streams audio while its complete private copy is persisted',async()=>{
 const h=harness(),pending=[];try{const response=await h.invoke({text},{context:{waitUntil:task=>pending.push(task)}});assert.equal(response.status,200);assert.equal(response.headers.get('X-BB-TTS-Cache'),'miss');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),audio);await Promise.all(pending);assert.equal(h.r2.values.size,1);assert.equal(h.db.prepare('SELECT * FROM bb_tts_cache_leases').all().length,0);assert.equal((await (await h.invoke()).json()).cached,true);}finally{h.close();}
});
test('concurrent identical requests share a D1 lease and cannot create a second charged generation',async()=>{
 let resolve,entered;const deferred=new Promise(r=>resolve=r),started=new Promise(r=>entered=r),h=harness({provider:()=>{entered();return deferred;}});try{
  const first=h.invoke();await started;assert.equal(h.calls.length,1);
  const concurrent=await h.invoke();assert.equal(concurrent.status,503);assert.equal(concurrent.headers.get('Retry-After'),'2');assert.equal(h.calls.length,1);
  resolve(new Response(audio,{headers:{'Content-Type':'audio/mpeg'}}));assert.equal((await first).status,200);assert.equal((await (await h.invoke()).json()).cached,true);assert.equal(h.calls.length,1);assert.equal(h.usage().find(row=>row.actor==='user:'+actor).used,1);
 }finally{h.close();}
});
test('only cache misses consume separate personal/global budgets, and the shared owner owns partner usage',async()=>{
 const h=harness({who:{user:{id:other},ownerId:actor},personal:1});try{assert.equal((await h.invoke()).status,200);assert.equal((await h.invoke({text:'A different cooking instruction.',prepare:true})).status,429);assert.equal((await h.invoke()).status,200);assert.equal(h.calls.length,1);assert.equal(h.usage().find(row=>row.actor.startsWith('user:')).actor,'user:'+actor);}finally{h.close();}
 const limited=harness({global:1});try{assert.equal((await limited.invoke()).status,200);assert.equal((await limited.invoke({text:'Next, stir gently.',prepare:true})).status,429);assert.equal(limited.calls.length,1);}finally{limited.close();}
});
test('provider failure and invalid audio cannot persist a broken clip, and the lease is released',async()=>{
 for(const response of [new Response('upstream failure',{status:500}),Response.json({not:'audio'}),new Response('',{headers:{'Content-Type':'audio/mpeg'}}),new Response('too large',{headers:{'Content-Type':'audio/mpeg','Content-Length':String(TTS_AUDIO_LIMIT+1)}})]){
  const h=harness({provider:()=>response});try{assert.equal((await h.invoke()).status,502);assert.equal(h.r2.values.size,0);assert.equal(h.db.prepare('SELECT * FROM bb_tts_cache_leases').all().length,0);}finally{h.close();}
 }
});
test('a missing reviewed lease migration fails closed before contacting the speech provider',async()=>{
 const h=harness();try{h.db.exec('DROP TABLE bb_tts_cache_leases');assert.equal((await h.invoke()).status,502);assert.equal(h.calls.length,0);}finally{h.close();}
});
test('a deletion beginning between membership check and lease claim cannot create speech or usage',async()=>{
 const h=harness();try{
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('basketboss:account-deletion:actor:'+actor));const hex=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
  h.db.prepare('INSERT INTO bb_account_deletions(actor_hash) VALUES(?)').run(hex);
  assert.equal((await h.invoke()).status,503);assert.equal(h.calls.length,0);assert.equal(h.usage().length,0);
 }finally{h.close();}
});
test('the actual server boundary verifies confirmed Supabase identity and an active server-priced membership',async()=>{
 const h=harness(),original=globalThis.fetch;let confirmed=true;globalThis.fetch=async()=>Response.json({id:actor,email:'cook@example.invalid',...(confirmed?{email_confirmed_at:'2026-01-01T00:00:00Z'}:{})});
 const handle=createTTSHandler({perform:h.perform,wait:async()=>{}}),request=()=>new Request(origin+'/api/tts',{method:'POST',headers:{Origin:origin,Authorization:'Bearer verified-test-token','Content-Type':'application/json'},body:JSON.stringify({text,prepare:true})});
 try{Object.assign(h.env,{BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',PADDLE_LIVE_STANDARD_PRICE_ID:'pri_'+'a'.repeat(26)});
  assert.equal((await handle({request:request(),env:h.env})).status,403);assert.equal(h.calls.length,0);
  h.db.prepare('INSERT INTO bb_paid_entitlements VALUES(?,?,?,?,?)').run(actor,'active','pri_'+'a'.repeat(26),'standard',1);
  assert.equal((await handle({request:request(),env:h.env})).status,200);assert.equal(h.calls.length,1);
  confirmed=false;assert.equal((await handle({request:request(),env:h.env})).status,401);assert.equal(h.calls.length,1);
 }finally{globalThis.fetch=original;h.close();}
});
test('range parsing rejects multiranges, backwards, unsafe and empty offsets',()=>{
 for(const range of ['bytes=0-1,3-4','bytes=-','bytes=9-2','bytes=99999999999999999999-','other=0-2','bytes=-0'])assert.equal(byteRange(range,10),false);
 assert.deepEqual(byteRange('bytes=0-999',10),{offset:0,length:10,end:9});
});


test('a lost final global slot refunds the personal reservation without generating speech',async()=>{
 const h=harness({global:1});try{
  const prepare=h.env.BILLING_DB.prepare.bind(h.env.BILLING_DB);
  h.env.BILLING_DB.prepare=sql=>{
   const statement=prepare(sql);
   if(!sql.includes("VALUES(?,'global','cook-tts',1)"))return statement;
   let values=[];
   return {bind(...args){values=args;return this;},async first(){h.db.prepare("INSERT INTO bb_ai_daily_usage VALUES(?,'global','cook-tts',1)").run(values[0]);return null;}};
  };
  assert.equal((await h.invoke()).status,429);assert.equal(h.calls.length,0);
  assert.equal(h.usage().find(row=>row.actor==='user:'+actor).used,0);
  assert.equal(h.usage().find(row=>row.actor==='global').used,1);
 }finally{h.close();}
});

test('mentor answers use natural server-owned speech and never read or write the shared recipe cache',async()=>{
 const h=harness();try{
  await h.invoke();const before={...h.r2.counts},stored=h.r2.values.size;
  const response=await h.invoke({text,private:true});assert.equal(response.status,200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),audio);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-BB-TTS-Cache'),'bypass');
  assert.equal(response.headers.get('X-BB-TTS-Clip'),null);assert.equal(response.headers.get('Accept-Ranges'),null);
  assert.deepEqual(h.r2.counts,before);assert.equal(h.r2.values.size,stored);assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM bb_tts_cache_leases').get().count,0);
  const body=JSON.parse(h.calls.at(-1).options.body);assert.equal(body.voice,TTS_MENTOR_VOICE);assert.equal(body.voice,'marin');assert.equal(body.instructions,TTS_MENTOR_INSTRUCTIONS);assert.equal(body.input,text);assert.equal(body.model,'gpt-4o-mini-tts');
  assert.equal(h.usage().find(row=>row.actor==='user:'+actor).used,2,'private speech shares the existing generation allowance');
 }finally{h.close();}
});

test('mentor audio needs no R2 or lease table and is never cached on repeat',async()=>{
 const h=harness();try{
  h.env.BB_TTS_AUDIO=null;h.db.exec('DROP TABLE bb_tts_cache_leases');
  for(let index=0;index<2;index++){const response=await h.invoke({text,private:true});assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),audio);}
  assert.equal(h.calls.length,2);assert.deepEqual(h.r2.counts,{head:0,get:0,put:0});assert.equal(h.r2.values.size,0);
 }finally{h.close();}
});

test('private mode cannot prepare a shared clip or override the server voice',async()=>{
 const h=harness();try{
  for(const body of [{text,private:true,prepare:true},{text,private:'true'},{text,private:true,voice:'cedar'},{text,private:true,model:'other'}])assert.equal((await h.invoke(body)).status,400);
  assert.equal(h.calls.length,0);assert.equal(h.usage().length,0);assert.deepEqual(h.r2.counts,{head:0,get:0,put:0});
 }finally{h.close();}
});

test('private speech retains Premium, deletion, per-owner and global quota boundaries before generation',async()=>{
 for(const status of [401,403,409]){
  const h=harness({who:{error:'not for the client',status}});try{assert.equal((await h.invoke({text,private:true})).status,status);assert.equal(h.calls.length,0);assert.equal(h.usage().length,0);assert.deepEqual(h.r2.counts,{head:0,get:0,put:0});}finally{h.close();}
 }
 for(const limits of [{personal:1},{global:1}]){
  const h=harness({...limits,who:{user:{id:other},ownerId:actor}});try{assert.equal((await h.invoke({text,private:true})).status,200);assert.equal((await h.invoke({text,private:true})).status,429);assert.equal(h.calls.length,1);assert.equal(h.usage().find(row=>row.actor.startsWith('user:')).actor,'user:'+actor);assert.deepEqual(h.r2.counts,{head:0,get:0,put:0});}finally{h.close();}
 }
});

test('invalid, empty, oversized or failed mentor audio returns no private clip and never persists anything',async()=>{
 for(const provider of [()=>new Response('secret upstream message',{status:500}),()=>Response.json({private:'provider response'}),()=>new Response('',{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response('not mp3',{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response(new Uint8Array(TTS_AUDIO_LIMIT+1),{headers:{'Content-Type':'audio/mpeg'}})]){
  const h=harness({provider});try{const response=await h.invoke({text,private:true});assert.equal(response.status,502);const body=await response.text();assert(!body.includes('secret upstream'));assert(!body.includes('provider response'));assert.deepEqual(h.r2.counts,{head:0,get:0,put:0});assert.equal(h.r2.values.size,0);}finally{h.close();}
 }
});

test('private speech failure diagnostics distinguish provider categories without returning private details',async()=>{
 const privateDetail='SECRET synthetic-provider-key synthetic-valid-session private spoken reply email@example.invalid';
 for(const [status,code] of [[401,'BB_COOK_PROVIDER_ACCESS'],[403,'BB_COOK_PROVIDER_ACCESS'],[429,'BB_COOK_PROVIDER_LIMIT'],[500,'BB_COOK_PROVIDER_UNAVAILABLE'],[503,'BB_COOK_PROVIDER_UNAVAILABLE'],[400,'BB_COOK_PROVIDER_REJECTED'],[307,'BB_COOK_PROVIDER_REJECTED']]){
  const h=harness({provider:()=>new Response(privateDetail,{status,headers:{'X-Request-ID':privateDetail}})});
  try{
   const response=await h.invoke({text:privateDetail,private:true});assert.equal(response.status,502);
   assert.deepEqual(await response.json(),{error:'Natural Cook Mentor voice could not be prepared. Try again shortly.',code});
   assert.equal(h.calls.length,1);assert.deepEqual(h.r2.counts,{head:0,get:0,put:0});
  }finally{h.close();}
 }
 const network=harness({provider:()=>{throw Object.assign(Error(privateDetail),{code:'SECRET'});}});
 try{assert.equal((await (await network.invoke({text,private:true})).json()).code,'BB_COOK_PROVIDER_UNAVAILABLE');}finally{network.close();}
 const local=harness();try{local.db.exec('DROP TABLE bb_ai_daily_usage');const response=await local.invoke({text,private:true});assert.equal(response.status,502);assert.equal((await response.json()).code,'BB_COOK_SERVICE_FAILURE');assert.equal(local.calls.length,0);}finally{local.close();}
 for(const provider of [()=>new Response(privateDetail,{headers:{'Content-Type':'application/json'}}),()=>new Response(privateDetail,{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response('',{headers:{'Content-Type':'audio/mpeg'}})]){
  const malformed=harness({provider});try{assert.deepEqual(await (await malformed.invoke({text,private:true})).json(),{error:'Natural Cook Mentor voice could not be prepared. Try again shortly.',code:'BB_COOK_PROVIDER_RESPONSE'});}finally{malformed.close();}
 }
});

test('cancelling private narration aborts the provider and cannot return a late successful answer',async()=>{
 let release,entered;const ready=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>release=resolve);
 const h=harness({provider:(url,options)=>{entered(options.signal);return waiting;}}),controller=new AbortController();
 try{
  const request=new Request(origin+'/api/tts',{method:'POST',signal:controller.signal,headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({text,private:true})});
  const pending=h.handle({request,env:h.env}),providerSignal=await ready;controller.abort();assert.equal(providerSignal.aborted,true);
  release(new Response(audio,{headers:{'Content-Type':'audio/mpeg'}}));assert.equal((await pending).status,502);assert.deepEqual(h.r2.counts,{head:0,get:0,put:0});
 }finally{h.close();}
});

test('Cloudflare speech requests use supported manual redirects and never follow a provider redirect with credentials',async()=>{
 for(const body of [{text,prepare:true},{text,private:true}]){
  const h=harness({provider:()=>new Response(null,{status:307,headers:{Location:'https://other.invalid/collect'}})});
  try{const response=await h.invoke(body);assert.equal(response.status,502);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://api.openai.com/v1/audio/speech');assert.equal(h.calls[0].options.redirect,'manual','Workers does not implement error redirect mode');assert.equal(h.r2.values.size,0);assert(!JSON.stringify(await response.json()).includes('other.invalid'));}finally{h.close();}
 }
});

test('deletion beginning during mentor generation prevents personalised audio from leaving the server',async()=>{
 for(const deleting of [actor,other]){
  const h=harness({who:{user:{id:other},ownerId:actor},provider:async()=>{
   h.db.prepare('INSERT INTO bb_account_deletions(actor_hash) VALUES(?)').run(await digestDeletionActor(deleting));
   return new Response(audio,{headers:{'Content-Type':'audio/mpeg'}});
  }});
  try{const response=await h.invoke({text,private:true});assert.equal(response.status,409);assert.match(response.headers.get('Content-Type'),/^application\/json/);assert.deepEqual(await response.json(),{error:'Account deletion is in progress',code:'BB_COOK_ACCOUNT_PENDING'});assert.equal(h.calls.length,1);assert.deepEqual(h.r2.counts,{head:0,get:0,put:0});}finally{h.close();}
 }
});

test('Workers speech requests use manual redirects and reject 3xx without forwarding provider credentials',async()=>{
 const h=harness({provider:()=>new Response(null,{status:307,headers:{Location:'https://other.invalid/collect'}})});
 try{
  const response=await h.invoke();assert.equal(response.status,502);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].url,'https://api.openai.com/v1/audio/speech');
  assert.equal(h.calls[0].options.redirect,'manual','Cloudflare Workers does not implement error redirect mode');
  assert.equal(h.r2.values.size,0);assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM bb_tts_cache_leases').get().count,0);
  const error=JSON.stringify(await response.json());assert(!error.includes('other.invalid'));assert(!error.includes(h.env.OPENAI_API_KEY));
 }finally{h.close();}
});
