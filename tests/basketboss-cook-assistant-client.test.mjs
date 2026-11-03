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
