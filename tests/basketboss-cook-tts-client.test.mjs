import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {create}=createRequire(import.meta.url)('../bb-cook-tts.js');
const KEY='basketboss_cloud_session_v1',clip='a'.repeat(64);
const fresh=()=>({user:{id:'person-one'},access_token:'current-bearer',expires_at:Date.now()/1000+3600});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({native=false,media=false,online=true,saved=fresh(),response,autoEnd=true,delayedPlay=false}={}){
 const store=new Map(saved?[[KEY,JSON.stringify(saved)]]:[]),calls=[],players=[],urls=new Map(),revoked=[],timers=new Map(),appends=[];let sequence=0,refreshes=0;
 const win=new EventTarget();
 class Audio extends EventTarget{
  constructor(){super();this.played=0;this.paused=0;this.loaded=0;players.push(this);}
  set src(value){this.value=value;const object=urls.get(value);if(object instanceof MediaSource){object.audio=this;queueMicrotask(()=>{object.readyState='open';object.dispatchEvent(new Event('sourceopen'));});}}
  get src(){return this.value;}
  async play(){this.played++;if(delayedPlay)return new Promise(resolve=>{this.releasePlay=resolve;});if(autoEnd&&!(urls.get(this.value)instanceof MediaSource))queueMicrotask(()=>this.dispatchEvent(new Event('ended')));}
  pause(){this.paused++;}
  removeAttribute(name){if(name==='src')this.value='';}
  load(){this.loaded++;}
 }
 class Buffer extends EventTarget{
  appendBuffer(value){appends.push([...new Uint8Array(value)]);this.updating=true;queueMicrotask(()=>{this.updating=false;this.dispatchEvent(new Event('updateend'));});}
  abort(){this.updating=false;}
 }
 class MediaSource extends EventTarget{
  static isTypeSupported(value){return value==='audio/mpeg';}
  constructor(){super();this.readyState='closed';}
  addSourceBuffer(type){assert.equal(type,'audio/mpeg');return this.buffer=new Buffer();}
  removeSourceBuffer(buffer){assert.equal(buffer,this.buffer);this.removed=true;}
  endOfStream(){this.readyState='ended';this.audio.releasePlay?.();if(autoEnd)queueMicrotask(()=>this.audio.dispatchEvent(new Event('ended')));}
 }
 Object.assign(win,{Event,AbortController,Blob,Audio,navigator:{onLine:online},location:{href:native?'capacitor://localhost/index.html':'https://basketboss.co.uk/index.html',protocol:native?'capacitor:':'https:'},
  localStorage:{getItem:key=>store.get(key)??null},
  URL:{createObjectURL(value){const id='blob:clip-'+(++sequence);urls.set(id,value);return id;},revokeObjectURL(value){revoked.push(value);}},
  setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
  BasketBossSession:{read:()=>JSON.parse(store.get(KEY)||'null'),async ensureFresh(){refreshes++;}},
  fetch:async(url,options)=>{calls.push({url,options});return response?response(url,options):Response.json({clipId:clip,url:'/api/tts?clip='+clip,contentType:'audio/mpeg',cached:true});}
 });
 if(media)win.MediaSource=MediaSource;
 const api=create({window:win});
 return {win,api,store,calls,players,urls,revoked,timers,appends,get refreshes(){return refreshes},setSession(value){value?store.set(KEY,JSON.stringify(value)):store.delete(KEY);},event(name){win.dispatchEvent(new Event(name));},expire(){const session=JSON.parse(store.get(KEY));session.expires_at=1;store.set(KEY,JSON.stringify(session));}};
}
const mp3=()=>new Response(new Uint8Array([73,68,51,0,1]),{headers:{'Content-Type':'audio/mpeg'}});

test('creation is read only; native preparation refreshes a saved session and returns only the trusted clip route',async()=>{
 const h=fixture({native:true});assert.equal(h.calls.length,0);assert.equal(h.players.length,0);assert.equal(h.refreshes,0);
 h.expire();h.win.BasketBossSession.ensureFresh=async()=>h.setSession({...fresh(),access_token:'renewed-bearer'});
 const result=await h.api.prepare('First up, grab 250 grams of gnocchi.');
 assert.equal(result.url,'https://basketboss.co.uk/api/tts?clip='+clip);assert.equal(result.token,'renewed-bearer');
 assert(!result.url.includes('bearer'));assert.equal(h.calls.length,1);assert.equal(h.players.length,0);
 assert.equal(h.calls[0].url,'/api/tts');assert.equal(h.calls[0].options.headers.Authorization,'Bearer renewed-bearer');
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{text:'First up, grab 250 grams of gnocchi.',prepare:true});
 assert.equal(h.calls[0].options.redirect,'error');assert.equal(h.calls[0].options.credentials,'omit');assert.equal(h.timers.size,0);
});

test('prepare rejects arbitrary, redirected or mismatched clip addresses without exposing the bearer',async()=>{
 for(const url of ['https://attacker.invalid/api/tts?clip='+clip,'//attacker.invalid/api/tts?clip='+clip,'/api/tts?clip='+clip+'&token=leak','/api/tts?clip='+'b'.repeat(64)]){
  const h=fixture({response:()=>Response.json({clipId:clip,url,contentType:'audio/mpeg'})});
  await assert.rejects(h.api.prepare('Stir gently.'),{code:'BB_TTS_RESPONSE'});assert.equal(h.players.length,0);assert.equal(h.timers.size,0);
 }
});

test('expired, missing, offline and deleting sessions never make a speech request',async()=>{
 for(const kind of ['missing','expired','offline','deleting']){
  const h=fixture({saved:kind==='missing'?null:fresh(),online:kind!=='offline'});
  if(kind==='expired')h.expire();if(kind==='deleting')h.store.set('basketboss_account_deletion_v1',JSON.stringify({phase:'pending'}));
  await assert.rejects(h.api.prepare('Stir gently.'));assert.equal(h.calls.length,0);assert.equal(h.players.length,0);
 }
});

test('AI text is bounded without truncating a long recipe or starting partial audio',async()=>{
 const h=fixture();await assert.rejects(h.api.play('x'.repeat(1201)),{code:'BB_TTS_TEXT'});
 await assert.rejects(h.api.prepare('  '),{code:'BB_TTS_TEXT'});assert.equal(h.calls.length,0);assert.equal(h.players.length,0);
});

test('the browser plays bounded MP3 audio through a Blob when progressive MP3 is unsupported',async()=>{
 const h=fixture({response:mp3});assert.deepEqual(await h.api.play('Stir gently.'),{played:true});
 assert.equal(h.calls.length,1);assert.deepEqual(JSON.parse(h.calls[0].options.body),{text:'Stir gently.'});
 assert.equal(h.players[0].played,1);assert.equal(h.players[0].paused,1);assert.equal(h.players[0].loaded,1);
 assert.equal(h.urls.size,1);assert.deepEqual(h.revoked,[...h.urls.keys()]);assert.equal(h.timers.size,0);
});

test('supported browsers append streamed MP3 chunks and begin playback before the response ends',async()=>{
 const later=deferred();let reads=0,cancels=0;
 const h=fixture({media:true,response:()=>({ok:true,headers:new Headers({'Content-Type':'audio/mpeg'}),body:{getReader:()=>({read(){reads++;if(reads===1)return Promise.resolve({value:new Uint8Array([73,68,51]),done:false});return later.promise;},cancel(){cancels++;return Promise.resolve();}})}})});
 const pending=h.api.play('Stir gently.');await tick();assert.equal(h.players[0].played,1);assert.equal(reads,2);assert.deepEqual(h.appends,[[73,68,51]]);
 later.resolve({done:true});assert.deepEqual(await pending,{played:true});assert.equal(cancels,1);assert.equal(h.revoked.length,1);assert.equal(h.timers.size,0);
});

test('HTTP, wrong content, empty audio and oversized audio failures return control to the speech fallback',async()=>{
 for(const respond of [()=>Response.json({error:'unconfigured'},{status:503}),()=>new Response('not audio',{headers:{'Content-Type':'application/json'}}),()=>new Response(new Uint8Array(),{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response(new Uint8Array([1]),{headers:{'Content-Type':'audio/mpeg','Content-Length':String(2*1024*1024+1)}})]){
  const h=fixture({response:respond});await assert.rejects(h.api.play('Stir gently.'));assert.equal(h.players.some(player=>player.played),false);assert.equal(h.timers.size,0);
 }
});

test('cancellation during a pending request rejects AbortError and never plays a late response',async()=>{
 const response=deferred(),controller=new AbortController(),h=fixture({response:()=>response.promise});
 const pending=h.api.play('Stir gently.',{signal:controller.signal});await tick();assert.equal(h.calls.length,1);
 controller.abort();await assert.rejects(pending,{name:'AbortError'});response.resolve(mp3());await tick();
 assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.players.length,0);assert.equal(h.timers.size,0);
});

test('cancelling streamed playback pauses audio, cancels the reader and revokes its URL',async()=>{
 const response=deferred(),controller=new AbortController();let reads=0,cancels=0;
 const h=fixture({media:true,autoEnd:false,response:()=>({ok:true,headers:new Headers({'Content-Type':'audio/mpeg'}),body:{getReader:()=>({read:()=>++reads===1?Promise.resolve({value:new Uint8Array([73,68,51]),done:false}):response.promise,cancel(){cancels++;return Promise.resolve();}})}})});
 const pending=h.api.play('Stir gently.',{signal:controller.signal});await tick();assert.equal(h.players[0].played,1);
 controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(cancels,1);assert.equal(h.players[0].paused,1);assert.equal(h.revoked.length,1);assert.equal(h.timers.size,0);
 response.resolve({done:true});await tick();assert.equal(h.players[0].played,1);
});

test('logout, account switching and deletion cancel pending audio without a stale playback',async()=>{
 for(const kind of ['logout','switch','deletion']){
  const response=deferred(),h=fixture({response:()=>response.promise});const pending=h.api.play('Stir gently.');await tick();
  if(kind==='logout')h.setSession(null);
  if(kind==='switch')h.setSession({...fresh(),user:{id:'person-two'}});
  if(kind==='deletion')h.store.set('basketboss_account_deletion_v1',JSON.stringify({phase:'pending'}));
  h.event(kind==='deletion'?'basketboss:account-deletion-started':'basketboss:session-changed');
  await assert.rejects(pending,{code:'BB_TTS_SESSION_CHANGED'});response.resolve(mp3());await tick();assert.equal(h.players.length,0);
 }
});

test('a stalled request times out with a recoverable error and releases the request signal',async()=>{
 const h=fixture({response:()=>new Promise(()=>{})}),pending=h.api.prepare('Stir gently.');await tick();
 assert.equal(h.calls.length,1);assert.equal(h.timers.size,1);[...h.timers.values()][0].fn();
 await assert.rejects(pending,{code:'BB_TTS_TIMEOUT'});assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.timers.size,0);
});

test('a token replacement before playback rejects the obsolete response even before a storage event',async()=>{
 const response=deferred(),h=fixture({response:()=>response.promise});const pending=h.api.play('Stir gently.');await tick();
 h.setSession({...fresh(),access_token:'newer-bearer'});response.resolve(mp3());await assert.rejects(pending,{code:'BB_TTS_SESSION_CHANGED'});assert.equal(h.players.length,0);
});


test('a browser waiting for more decoded audio does not block the network stream pump',async()=>{
 let reads=0;const h=fixture({media:true,delayedPlay:true,response:()=>({ok:true,headers:new Headers({'Content-Type':'audio/mpeg'}),body:{getReader:()=>({read:async()=>++reads<=3?{value:new Uint8Array([73,68,51]),done:false}:{done:true},cancel:async()=>{}})}})});
 assert.deepEqual(await h.api.play('Stir gently.'),{played:true});assert.equal(reads,4);assert.equal(h.appends.length,3);assert.equal(h.players[0].played,1);
});


test('definitive authorization failures are distinct from recoverable service failures',async()=>{
 for(const [status,code]of [[401,'BB_TTS_AUTH'],[403,'BB_TTS_PREMIUM_REQUIRED'],[409,'BB_TTS_DELETING'],[429,'BB_TTS_UNAVAILABLE'],[503,'BB_TTS_UNAVAILABLE']]){
  for(const method of ['prepare','play']){const h=fixture({response:()=>Response.json({error:'not for presentation'},{status})});await assert.rejects(h.api[method]('Stir gently.'),{code});assert.equal(h.players.length,0);}
 }
});

test('native mentor preparation returns only bounded in-memory MP3 data without a clip URL or bearer',async()=>{
 const h=fixture({native:true,response:mp3}),before=[...h.store.entries()];
 const result=await h.api.prepareMentor('Let the sauce coat the back of your spoon.');
 assert.deepEqual(result,{base64:'SUQzAAE=',contentType:'audio/mpeg'});assert.equal(h.calls.length,1);
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{text:'Let the sauce coat the back of your spoon.',private:true});
 assert.equal(h.calls[0].options.headers.Accept,'audio/mpeg');assert.equal(h.calls[0].options.headers.Authorization,'Bearer current-bearer');
 assert.equal(h.calls[0].options.cache,'no-store');assert.equal(h.calls[0].options.redirect,'error');assert.equal(h.calls[0].options.credentials,'omit');
 assert.deepEqual([...h.store.entries()],before);assert.equal(h.players.length+h.urls.size,0);assert.equal(h.timers.size,0);
 assert(!JSON.stringify(result).includes('bearer'));assert.equal('url'in result,false);
});
test('private speech reports only allowlisted service categories and preserves account errors',async()=>{
 for(const [code,expected]of [['BB_COOK_PROVIDER_ACCESS','BB_TTS_SERVICE_ACCESS'],['BB_COOK_PROVIDER_LIMIT','BB_TTS_SERVICE_LIMIT'],['BB_COOK_SERVICE_FAILURE','BB_TTS_SERVICE_UNAVAILABLE'],['BB_COOK_PROVIDER_RESPONSE','BB_TTS_SERVICE_RESPONSE'],['private-code','BB_TTS_UNAVAILABLE'],['constructor','BB_TTS_UNAVAILABLE']]){
  const h=fixture({response:()=>Response.json({error:'private upstream text',code},{status:502})});
  await assert.rejects(h.api.prepareMentor('Stir gently.'),error=>error.code===expected&&error.message===expected);
  assert.equal(h.players.length,0);assert.equal(h.timers.size,0);
 }
 const auth=fixture({response:()=>Response.json({code:'BB_COOK_PROVIDER_ACCESS'},{status:403})});
 await assert.rejects(auth.api.prepareMentor('Stir gently.'),{code:'BB_TTS_PREMIUM_REQUIRED'});
});
test('private speech bounds diagnostic bodies and cancels a stalled error stream',async()=>{
 let cancelled=false;
 const large=fixture({response:()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(2049)));},cancel(){cancelled=true;}}),{status:502,headers:{'Content-Type':'application/json'}})});
 await assert.rejects(large.api.prepareMentor('Stir gently.'),{code:'BB_TTS_UNAVAILABLE'});assert.equal(cancelled,true);
 cancelled=false;const controller=new AbortController(),h=fixture({response:()=>new Response(new ReadableStream({pull(){},cancel(){cancelled=true;}}),{status:502,headers:{'Content-Type':'application/json'}})});
 const pending=h.api.prepareMentor('Stir gently.',{signal:controller.signal});await tick();controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);assert.equal(h.timers.size,0);assert.equal(h.players.length,0);
});

test('browser mentor playback uses uncached memory audio and revokes it after the full answer',async()=>{
 const h=fixture({response:mp3,autoEnd:false}),pending=h.api.playMentor('Keep the heat gentle.');let ended=false;pending.then(()=>ended=true);await tick();
 assert.equal(h.players.length,1);assert.equal(h.players[0].played,1);assert.equal(ended,false);
 assert.deepEqual(JSON.parse(h.calls[0].options.body),{text:'Keep the heat gentle.',private:true});
 h.players[0].dispatchEvent(new Event('ended'));assert.deepEqual(await pending,{played:true});assert.equal(ended,true);
 assert.equal(h.players[0].paused,1);assert.equal(h.revoked.length,1);assert.equal(h.timers.size,0);
});

test('mentor preparation validates the complete MP3 before returning base64 or starting audio',async()=>{
 const cases=[()=>new Response('not audio',{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response(new Uint8Array([73,68]),{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response(new Uint8Array(),{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response(new Uint8Array(2*1024*1024+1),{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response(new Uint8Array([73,68,51]),{headers:{'Content-Type':'text/html'}})];
 for(const response of cases){for(const method of ['prepareMentor','playMentor']){const h=fixture({response});await assert.rejects(h.api[method]('Stir gently.'));assert.equal(h.players.length,0);assert.equal(h.timers.size,0);}}
});

test('mentor byte validation handles fragmented ID3 and MPEG headers without losing data',async()=>{
 for(const bytes of [[73,68,51,0,1],[255,251,144,0]]){
  const h=fixture({response:()=>new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}}),{headers:{'Content-Type':'audio/mpeg'}})});
  const result=await h.api.prepareMentor('Stir gently.');assert.deepEqual([...Buffer.from(result.base64,'base64')],bytes);
 }
});

test('mentor cancellation, account change and deletion discard late bytes before any audio is returned',async()=>{
 for(const reason of ['cancel','switch','deletion']){
  const response=deferred(),controller=new AbortController(),h=fixture({response:()=>response.promise});
  const pending=h.api.prepareMentor('Let the sauce thicken.',{signal:controller.signal});await tick();
  if(reason==='cancel')controller.abort();
  if(reason==='switch'){h.setSession({...fresh(),user:{id:'another-person'}});h.event('basketboss:session-changed');}
  if(reason==='deletion'){h.store.set('basketboss_account_deletion_v1',JSON.stringify({phase:'deleting'}));h.event('basketboss:account-deletion-started');}
  await assert.rejects(pending);response.resolve(mp3());await tick();assert.equal(h.players.length,0);assert.equal(h.timers.size,0);
 }
});

test('private browser audio cancellation pauses playback, revokes the blob and never falls back to synthesis',async()=>{
 const h=fixture({response:mp3,autoEnd:false}),controller=new AbortController(),pending=h.api.playMentor('Stir gently.',{signal:controller.signal});await tick();
 assert.equal(h.players[0].played,1);controller.abort();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(h.players[0].paused,1);assert.equal(h.revoked.length,1);assert.equal(h.timers.size,0);
});

test('mentor operations preserve definitive account errors and use a 45-second preparation budget',async()=>{
 for(const [status,code]of [[401,'BB_TTS_AUTH'],[403,'BB_TTS_PREMIUM_REQUIRED'],[409,'BB_TTS_DELETING'],[429,'BB_TTS_UNAVAILABLE']]){
  for(const method of ['prepareMentor','playMentor']){const h=fixture({response:()=>Response.json({error:'private provider text'},{status})});await assert.rejects(h.api[method]('Stir gently.'),{code});assert.equal(h.players.length,0);}
 }
 const h=fixture({response:()=>new Promise(()=>{})}),pending=h.api.prepareMentor('Stir gently.');await tick();
 assert.equal([...h.timers.values()][0].delay,45000);[...h.timers.values()][0].fn();await assert.rejects(pending,{code:'BB_TTS_TIMEOUT'});
});
