import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validateCookingQuestion} from '../bb-server-lib/bb-cook-assistant.js';
const {create}=createRequire(import.meta.url)('../bb-cook-assistant.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fresh=()=>({user:{id:'person-one'},access_token:'current-bearer',expires_at:Date.now()/1000+3600});
const recipe=()=>({id:'fajitas',title:'Chicken fajitas',servings:4,ingredients:[{name:'Chicken breast',quantity:'665 g'},{name:'Mixed peppers',quantity:'2'}],steps:['Cook the chicken until it reaches 75°C.','Add the peppers and stir.'],currentStep:0,phase:'cook',region:'UK'});
const question=()=>({question:'Can I use milk instead?',recipe:recipe(),history:[]});
function fixture({session=fresh(),online=true,response}={}){
 const store=new Map(session?[['basketboss_cloud_session_v1',JSON.stringify(session)]]:[]),requests=[],timers=new Map();let sequence=0;
 const win=Object.assign(new EventTarget(),{AbortController,TextEncoder,TextDecoder,navigator:{onLine:online},localStorage:{getItem:key=>store.get(key)??null},
  setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
  BasketBossSession:{read:()=>JSON.parse(store.get('basketboss_cloud_session_v1')||'null'),ensureFresh:async()=>{}},
  fetch:async(url,options)=>{requests.push({url,options});return response?response(url,options):Response.json({answer:'Use a little milk and keep the heat gentle.'});}
 });
 return {win,store,requests,timers,api:create({window:win}),session(value){value?store.set('basketboss_cloud_session_v1',JSON.stringify(value)):store.delete('basketboss_cloud_session_v1');},event(name){win.dispatchEvent(new Event(name));}};
}
test('question transport sends current recipe and completed history with fresh auth, preserving natural question text',async()=>{
 const h=fixture(),input=question();input.history=[{role:'user',text:'It looks thick.'},{role:'assistant',text:'Stir gently.'}];
 const pending=h.api.ask(input);input.recipe.steps[0]='stale mutation';input.history[0].text='stale mutation';
 assert.deepEqual(await pending,{answer:'Use a little milk and keep the heat gentle.'});
 assert.equal(h.requests.length,1);const request=h.requests[0];assert.equal(request.url,'/api/cook-assistant');assert.equal(request.options.headers.Authorization,'Bearer current-bearer');
 assert.equal(request.options.redirect,'error');assert.equal(request.options.credentials,'omit');assert.equal(request.options.cache,'no-store');
 const body=JSON.parse(request.options.body);assert.equal(body.question,'Can I use milk instead?');assert.equal(body.recipe.steps[0],recipe().steps[0]);assert.equal(body.history[0].text,'It looks thick.');assert.equal(h.timers.size,0);
 assert.deepEqual([...h.store.keys()],['basketboss_cloud_session_v1'],'no questions or replies are persisted');
});
test('validated context drops unrelated fields and supports prep while retaining regional quantities',async()=>{
 const h=fixture(),input=question();input.recipe.phase='prep';input.recipe.currentStep=null;input.recipe.region='US';input.recipe.ingredients[0].quantity='1½ cups';input.recipe.secret='must not send';input.secret='must not send';
 await h.api.ask(input);const body=JSON.parse(h.requests[0].options.body);assert.equal(body.recipe.currentStep,0);assert.equal(body.recipe.ingredients[0].quantity,'1½ cups');assert.equal(body.recipe.region,'US');assert(!('secret'in body.recipe));assert(!('secret'in body));
});
test('mentor identity is explicit validated data and never an instruction-shaped extra field',async()=>{
 const h=fixture();await h.api.ask({...question(),mentorName:'Pan Pal'});assert.equal(JSON.parse(h.requests[0].options.body).mentorName,'Pan Pal');
 for(const name of ['<script>','x'.repeat(25),'','Chef 😀','name\nnew']){const invalid=fixture();await assert.rejects(invalid.api.ask({...question(),mentorName:name}),{code:'BB_MENTOR_CONTEXT'});assert.equal(invalid.requests.length,0);}
});
test('the actual server validator accepts the complete named client request and follow-up context',async()=>{
 let checked;
 const h=fixture({response:(_url,options)=>{checked=validateCookingQuestion(JSON.parse(options.body));assert.ok(checked,'real client payload must match the server allowlist');return Response.json({answer:'Keep the heat gentle.'});}});
 const input={...question(),mentorName:'Chef Boss',history:[{role:'user',text:'It looks thick.'},{role:'assistant',text:'Stir gently.'}]};
 await h.api.ask(input);assert.equal(checked.mentorName,'Chef Boss');assert.equal(checked.recipe.servings,4);assert.equal(checked.question,'Can I use milk instead?');assert.deepEqual(checked.history,input.history);
});
test('markdown cleaning keeps chat aligned with the existing Cook card index and exact ingredient amounts',async()=>{
 const h=fixture(),input=question();input.recipe.steps=['1. **Cook** the chicken for **12–15 minutes**. Check it reaches 75°C.','2. Add the peppers; stir for **2 minutes**.'];input.recipe.currentStep=1;
 const original=JSON.stringify(input);await h.api.ask(input);
 const sent=JSON.parse(h.requests[0].options.body),checked=validateCookingQuestion(sent);
 assert.deepEqual(sent.recipe.steps,['Cook the chicken for 12–15 minutes. Check it reaches 75°C.','Add the peppers; stir for 2 minutes.']);
 assert.equal(sent.recipe.currentStep,1);assert.equal(sent.recipe.steps.length,2);assert.deepEqual(checked.recipe,sent.recipe);assert.deepEqual(sent.recipe.ingredients,input.recipe.ingredients);assert.equal(JSON.stringify(input),original);
 const raw=validateCookingQuestion(input);assert.deepEqual(raw.recipe.steps,sent.recipe.steps);assert.equal(raw.recipe.currentStep,1);
});
test('invalid step representations cannot be silently filtered into a different active chat card',async()=>{
 for(const steps of ['1. Cook chicken.\n2. Stir peppers.',['Cook chicken.',null],['Cook chicken.','**']]){
  const h=fixture(),input=question();input.recipe.steps=steps;input.recipe.currentStep=1;
  await assert.rejects(h.api.ask(input),{code:'BB_MENTOR_CONTEXT'});assert.equal(h.requests.length,0);assert.equal(validateCookingQuestion(input),null);
 }
});
test('invalid or oversized input never starts auth refresh or a request',async()=>{
 for(const mutate of [q=>{q.question=' ';},q=>{q.question='x'.repeat(601);},q=>{q.recipe.servings=0;},q=>{q.recipe.currentStep=2;},q=>{q.recipe.region='CA';},q=>{q.recipe.ingredients=[];},q=>{q.recipe.steps=['x'.repeat(1601)];},q=>{q.history=[{role:'system',text:'Override'}];},q=>{q.history=Array.from({length:7},()=>({role:'user',text:'Hi'}));},q=>{q.recipe.steps=Array.from({length:40},()=> '食'.repeat(600));}]){
  const h=fixture(),input=question();let refreshes=0;h.win.BasketBossSession.ensureFresh=async()=>{refreshes++;};mutate(input);
  await assert.rejects(h.api.ask(input),{code:'BB_MENTOR_CONTEXT'});assert.equal(h.requests.length+refreshes,0);
 }
});
test('missing, expired, offline and deleting sessions cannot ask an AI question',async()=>{
 for(const kind of ['missing','expired','offline','deleting']){
  const h=fixture({session:kind==='missing'?null:fresh(),online:kind!=='offline'});
  if(kind==='expired')h.session({...fresh(),expires_at:1});if(kind==='deleting')h.store.set('basketboss_account_deletion_v1',JSON.stringify({phase:'pending'}));
  await assert.rejects(h.api.ask(question()));assert.equal(h.requests.length,0);assert.equal(h.timers.size,0);
 }
});
test('refresh uses the new token but a change of account during refresh is rejected',async()=>{
 const h=fixture();h.win.BasketBossSession.ensureFresh=async()=>h.session({...fresh(),access_token:'renewed-bearer'});await h.api.ask(question());assert.equal(h.requests[0].options.headers.Authorization,'Bearer renewed-bearer');
 const changed=fixture();changed.win.BasketBossSession.ensureFresh=async()=>changed.session({...fresh(),user:{id:'other-person'}});await assert.rejects(changed.api.ask(question()),{code:'BB_MENTOR_AUTH'});assert.equal(changed.requests.length,0);
});
test('temporary and definitive server errors use fixed codes without provider bodies',async()=>{
 for(const [status,code]of [[401,'BB_MENTOR_AUTH'],[403,'BB_MENTOR_PREMIUM_REQUIRED'],[409,'BB_MENTOR_DELETING'],[429,'BB_MENTOR_LIMIT'],[503,'BB_MENTOR_UNAVAILABLE']]){
  const h=fixture({response:()=>Response.json({error:'private-provider-message'},{status})});await assert.rejects(h.api.ask(question()),{code});assert.equal(h.timers.size,0);
 }
 const network=fixture({response:()=>{throw Error('private-network-message');}});await assert.rejects(network.api.ask(question()),error=>error.code==='BB_MENTOR_UNAVAILABLE'&&!error.message.includes('private-network'));
});
test('only a bounded plain answer is accepted, never provider actions, HTML or overlong replies',async()=>{
 for(const response of [()=>new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}}),()=>Response.json({answer:'x'.repeat(1001)}),()=>Response.json({answer:'Safe',action:'next'}),()=>Response.json({answer:''}),()=>new Response('x'.repeat(16385),{headers:{'Content-Type':'application/json'}})]){
  const h=fixture({response});await assert.rejects(h.api.ask(question()),{code:'BB_MENTOR_RESPONSE'});assert.equal(h.timers.size,0);
 }
});
test('service failures distinguish provider access and limits from the signed-in account',async()=>{
 for(const [code,expected]of [['BB_COOK_PROVIDER_ACCESS','BB_MENTOR_SERVICE_ACCESS'],['BB_COOK_PROVIDER_LIMIT','BB_MENTOR_SERVICE_LIMIT'],['BB_COOK_SERVICE_UNAVAILABLE','BB_MENTOR_SERVICE_UNAVAILABLE'],['BB_COOK_PROVIDER_RESPONSE','BB_MENTOR_SERVICE_RESPONSE'],['arbitrary-private-code','BB_MENTOR_UNAVAILABLE'],['toString','BB_MENTOR_UNAVAILABLE']]){
  const h=fixture({response:()=>Response.json({error:'private upstream text',code},{status:502})});
  await assert.rejects(h.api.ask(question()),error=>error.code===expected&&error.message===expected);assert.equal(h.timers.size,0);
 }
 const auth=fixture({response:()=>Response.json({code:'BB_COOK_PROVIDER_ACCESS'},{status:401})});
 await assert.rejects(auth.api.ask(question()),{code:'BB_MENTOR_AUTH'});
});
test('oversized and cancelled diagnostic bodies cannot leak details or delay cancellation',async()=>{
 let cancelled=false;
 const oversized=fixture({response:()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(2049)));},cancel(){cancelled=true;}}),{status:502,headers:{'Content-Type':'application/json'}})});
 await assert.rejects(oversized.api.ask(question()),{code:'BB_MENTOR_UNAVAILABLE'});assert.equal(cancelled,true);
 const controller=new AbortController();
 const stalled=fixture({response:()=>new Response(new ReadableStream({pull(){},cancel(){cancelled=true;}}),{status:502,headers:{'Content-Type':'application/json'}})});
 cancelled=false;const pending=stalled.api.ask(question(),{signal:controller.signal});await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);assert.equal(stalled.timers.size,0);
});
test('Stop cancels an in-flight request and a late answer cannot be returned',async()=>{
 let release;const h=fixture({response:()=>new Promise(resolve=>{release=resolve;})}),controller=new AbortController();
 const pending=h.api.ask(question(),{signal:controller.signal});await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});release(Response.json({answer:'Late reply'}));await tick();assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.timers.size,0);
});
test('account/deletion events cancel pending answers, and same-account token rotation cannot expose an old response',async()=>{
 for(const kind of ['account','deletion','token']){
  let release;const h=fixture({response:()=>new Promise(resolve=>{release=resolve;})});const pending=h.api.ask(question());await tick();
  if(kind==='account'){h.session({...fresh(),user:{id:'other-person'}});h.event('basketboss:session-changed');}
  if(kind==='deletion'){h.store.set('basketboss_account_deletion_v1',JSON.stringify({phase:'deleting'}));h.event('basketboss:account-deletion-started');}
  if(kind==='token')h.session({...fresh(),access_token:'renewed-bearer'});
  release(Response.json({answer:'Late answer'}));await assert.rejects(pending,error=>['BB_MENTOR_SESSION_CHANGED','BB_MENTOR_DELETING'].includes(error.code));assert.equal(h.timers.size,0);
 }
});
test('bounded setup timeout aborts rather than persisting or returning an eventual answer',async()=>{
 let release;const h=fixture({response:()=>new Promise(resolve=>{release=resolve;})});const pending=h.api.ask(question(),{timeoutMs:45000});await tick();const timer=[...h.timers.values()][0];assert.equal(timer.delay,45000);timer.fn();await assert.rejects(pending,{code:'BB_MENTOR_TIMEOUT'});release(Response.json({answer:'Late'}));await tick();assert.equal(h.timers.size,0);
});
const encode=new TextEncoder();
const line=event=>JSON.stringify(event)+'\n';
function liveStream(){
 let sink,cancelled=0;
 const response=new Response(new ReadableStream({start(controller){sink=controller;},cancel(){cancelled++;}}),{headers:{'Content-Type':'application/x-ndjson; charset=utf-8'}});
 return {response,send:source=>sink.enqueue(typeof source==='string'?encode.encode(source):source),close:()=>sink.close(),get cancelled(){return cancelled;}};
}
test('streaming delivers UTF-8 deltas before the HTTP body completes and resolves the assembled answer',async()=>{
 const stream=liveStream(),h=fixture({response:()=>stream.response}),deltas=[];let settled=false;
 const pending=h.api.ask(question(),{onDelta:(delta,answer)=>deltas.push({delta,answer})}).finally(()=>{settled=true;});await tick();
 assert.equal(h.requests[0].options.headers.Accept,'application/x-ndjson');
 const first=encode.encode(line({type:'delta',text:'Cook at 75°C. '})),degree=first.indexOf(194);
 stream.send(first.slice(0,degree+1));await tick();assert.equal(deltas.length,0,'an incomplete UTF-8 frame is held');
 stream.send(first.slice(degree+1));await tick();assert.deepEqual(deltas,[{delta:'Cook at 75°C. ',answer:'Cook at 75°C. '}]);assert.equal(settled,false,'first sentence arrives before the provider and HTTP stream finish');
 stream.send(line({type:'delta',text:'Stir gently.'})+line({type:'done'}));
 assert.deepEqual(await pending,{answer:'Cook at 75°C. Stir gently.'});assert.equal(deltas[1].answer,'Cook at 75°C. Stir gently.');assert.equal(stream.cancelled,1);assert.equal(h.timers.size,0);
});
test('JSON fallback for an older deployment makes one request and one streaming callback',async()=>{
 const h=fixture(),seen=[];const result=await h.api.ask(question(),{onDelta:(delta,answer)=>seen.push([delta,answer])});
 assert.equal(h.requests.length,1);assert.deepEqual(seen,[[result.answer,result.answer]]);
 const normal=fixture();await normal.api.ask(question());assert.equal(normal.requests[0].options.headers.Accept,'application/json');
});
test('a fragmented terminal event also works without a final newline',async()=>{
 const stream=liveStream(),h=fixture({response:()=>stream.response}),seen=[];const pending=h.api.ask(question(),{onDelta:delta=>seen.push(delta)});await tick();
 stream.send(line({type:'delta',text:'Answer.'})+'{"type":"do');await tick();assert.deepEqual(seen,['Answer.']);
 stream.send('ne"}');stream.close();assert.deepEqual(await pending,{answer:'Answer.'});
});
test('stream history is limited to recent complete pairs without changing recipe facts or quantities',async()=>{
 const h=fixture(),input=question();input.recipe.ingredients[0].quantity='1½ cups / 665 g, skin on';input.history=[
  {role:'user',text:'Old question.'},{role:'assistant',text:'Old reply.'},
  {role:'user',text:'Recent question.'},{role:'assistant',text:'Recent reply.'},
  {role:'user',text:'Newest question.'},{role:'assistant',text:'Newest reply.'}
 ];
 await h.api.ask(input,{onDelta(){}});let sent=JSON.parse(h.requests[0].options.body);
 assert.deepEqual(sent.history,input.history.slice(-4));assert.deepEqual(sent.recipe,input.recipe);assert.equal(sent.question,input.question);
 const large=fixture();input.history=input.history.map((entry,i)=>({...entry,text:i<4?'x'.repeat(900):entry.text}));await large.api.ask(input,{onDelta(){}});
 sent=JSON.parse(large.requests[0].options.body);assert.deepEqual(sent.history,input.history.slice(-2));assert(sent.history.reduce((size,h)=>size+h.text.length,0)<=1800);
 const orphan=fixture();input.history=[{role:'assistant',text:'Orphan reply.'},{role:'user',text:'Question.'},{role:'assistant',text:'Reply.'},{role:'user',text:'Pending question.'}];await orphan.api.ask(input,{onDelta(){}});
 assert.deepEqual(JSON.parse(orphan.requests[0].options.body).history,input.history.slice(1,3));
});
test('Stop cancels a live stream immediately, including a reader waiting for the next token',async()=>{
 const stream=liveStream(),h=fixture({response:()=>stream.response}),controller=new AbortController(),seen=[];
 const pending=h.api.ask(question(),{signal:controller.signal,onDelta:delta=>seen.push(delta)});await tick();stream.send(line({type:'delta',text:'First sentence. '}));await tick();
 controller.abort();await assert.rejects(pending,{name:'AbortError',code:'BB_MENTOR_CANCELLED'});await tick();assert.deepEqual(seen,['First sentence. ']);assert.equal(stream.cancelled,1);assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.timers.size,0);
});
test('every streamed chunk rechecks account, bearer token and deletion even without an event',async()=>{
 for(const kind of ['account','token','expired','missing','deletion']){
  const stream=liveStream(),h=fixture({response:()=>stream.response}),seen=[];
  const pending=h.api.ask(question(),{onDelta:delta=>seen.push(delta)});await tick();stream.send(line({type:'delta',text:'First sentence. '}));await tick();
  if(kind==='account')h.session({...fresh(),user:{id:'someone-else'}});
  if(kind==='token')h.session({...fresh(),access_token:'newest-session-bearer'});
  if(kind==='expired')h.session({...fresh(),expires_at:1});if(kind==='missing')h.session(null);
  if(kind==='deletion')h.store.set('basketboss_account_deletion_v1',JSON.stringify({phase:'pending'}));
  stream.send(line({type:'delta',text:'Private late sentence.'})+line({type:'done'}));
  await assert.rejects(pending,error=>['BB_MENTOR_SESSION_CHANGED','BB_MENTOR_DELETING'].includes(error.code));assert.deepEqual(seen,['First sentence. '],kind);assert.equal(stream.cancelled,1);
 }
});
test('account and same-account refreshed-session events cancel an idle stream before any callback',async()=>{
 for(const kind of ['account','token','deletion']){
  const stream=liveStream(),h=fixture({response:()=>stream.response}),seen=[];
  const pending=h.api.ask(question(),{onDelta:delta=>seen.push(delta)});await tick();
  if(kind==='account')h.session({...fresh(),user:{id:'other'}});if(kind==='token')h.session({...fresh(),access_token:'refreshed'});
  if(kind==='deletion')h.store.set('basketboss_account_deletion_v1',JSON.stringify({phase:'deleting'}));
  h.event(kind==='deletion'?'basketboss:account-deletion-started':'basketboss:session-changed');
  await assert.rejects(pending,{code:'BB_MENTOR_SESSION_CHANGED'});assert.deepEqual(seen,[]);assert.equal(stream.cancelled,1);
 }
});
test('identity changes inside the callback prevent later frames from the same network chunk',async()=>{
 const stream=liveStream(),h=fixture({response:()=>stream.response}),seen=[];
 const pending=h.api.ask(question(),{onDelta:delta=>{seen.push(delta);h.session({...fresh(),access_token:'rotated'});}});await tick();
 stream.send(line({type:'delta',text:'First.'})+line({type:'delta',text:'Second.'})+line({type:'done'}));
 await assert.rejects(pending,{code:'BB_MENTOR_SESSION_CHANGED'});assert.deepEqual(seen,['First.']);assert.equal(stream.cancelled,1);
});
test('stream errors use only fixed categories and never leak provider text',async()=>{
 for(const [code,expected]of [['BB_COOK_PROVIDER_ACCESS','BB_MENTOR_SERVICE_ACCESS'],['BB_COOK_PROVIDER_LIMIT','BB_MENTOR_SERVICE_LIMIT'],['BB_COOK_PROVIDER_RESPONSE','BB_MENTOR_SERVICE_RESPONSE'],['BB_COOK_ACCOUNT_PENDING','BB_MENTOR_DELETING'],['BB_COOK_REQUEST_CANCELLED','BB_MENTOR_CANCELLED'],['private-upstream-detail','BB_MENTOR_UNAVAILABLE'],['toString','BB_MENTOR_UNAVAILABLE']]){
  const stream=liveStream(),h=fixture({response:()=>stream.response});const pending=h.api.ask(question(),{onDelta(){}});await tick();stream.send(line({type:'error',code}));
  await assert.rejects(pending,error=>error.code===expected&&error.message===expected);assert.equal(stream.cancelled,1);
 }
});
test('malformed, oversized, unbounded and incomplete streams are rejected and cancelled',async()=>{
 const cases=[
  '{bad}\n',line([]),line({type:'unknown'}),line({type:'delta',text:4}),line({type:'delta',text:''}),line({type:'delta',text:'Safe',action:'next'}),line({type:'delta',text:'bad\u0000text'}),
  line({type:'done'}),line({type:'delta',text:'x'.repeat(1001)}),' '.repeat(4097),
  line({type:'delta',text:'Answer.'}),line({type:'delta',text:'Answer.'})+line({type:'done',answer:'Answer.'}),
  line({type:'delta',text:'Answer.'})+line({type:'done'})+line({type:'delta',text:'Extra.'}),
  line({type:'error',code:'BB_COOK_PROVIDER_ACCESS',message:'private'}),
  '\n'.repeat(65537),'data: '+JSON.stringify({type:'delta',text:'SSE is not this protocol.'})+'\n',new Uint8Array([0xff,0x0a])
 ];
 for(const source of cases){
  const stream=liveStream(),h=fixture({response:()=>stream.response});const pending=h.api.ask(question(),{onDelta(){}});await tick();stream.send(source);stream.close();
  await assert.rejects(pending,{code:'BB_MENTOR_RESPONSE'});assert.equal(h.timers.size,0);
 }
 const jsonOnly=fixture({response:()=>new Response(line({type:'delta',text:'Wrong mode.'}),{headers:{'Content-Type':'application/x-ndjson'}})});
 await assert.rejects(jsonOnly.api.ask(question()),{code:'BB_MENTOR_RESPONSE'});
});
test('a stalled streaming reply times out and stops its reader after the first sentence',async()=>{
 const stream=liveStream(),h=fixture({response:()=>stream.response}),seen=[];const pending=h.api.ask(question(),{onDelta:delta=>seen.push(delta),timeoutMs:5000});await tick();
 stream.send(line({type:'delta',text:'First sentence.'}));await tick();[...h.timers.values()][0].fn();await assert.rejects(pending,{code:'BB_MENTOR_TIMEOUT'});assert.deepEqual(seen,['First sentence.']);assert.equal(stream.cancelled,1);assert.equal(h.timers.size,0);
});
