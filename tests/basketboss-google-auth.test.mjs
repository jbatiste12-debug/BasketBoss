import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {create,googleAvailability,googleAuthorizeURL}=require('../bb-auth-flow.js');
const PENDING='basketboss_google_oauth_pending_v1',SIGNUP='basketboss_signup_pending_v1';
const ORIGIN='https://project.supabase.co',CODE='synthetic-google-code';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ok=data=>({data,error:null});
function authorizeURL(redirect='basketboss://auth/callback?bb_auth=google'){
 const url=new URL('/auth/v1/authorize',ORIGIN);
 for(const [name,value]of Object.entries({provider:'google',redirect_to:redirect,code_challenge:'a'.repeat(43),code_challenge_method:'s256'}))url.searchParams.set(name,value);
 return url.href;
}
function fixture({native=true,enabled=true,actor=null,navigate,remember=true,pendingSeparate=false,storageBlocked=false,blocked=false}={}){
 let time=100000,raw=actor?JSON.stringify({user:{id:actor},access_token:'existing-supabase-token'}):null,locked=blocked;
 const values=new Map(),pendingValues=pendingSeparate?new Map():values,calls=[],navigation=[],success=[],events=[],states=[],durable=[],transient=[];
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){if(storageBlocked)throw Error('storage unavailable');values.set(key,String(value));},removeItem:key=>values.delete(key)};
 const pendingStorage={getItem:key=>pendingValues.get(key)??null,setItem(key,value){if(storageBlocked)throw Error('storage unavailable');pendingValues.set(key,String(value));},removeItem:key=>pendingValues.delete(key)};
 const user={id:'google-actor',email:'google-family@example.invalid',email_confirmed_at:'2026-11-22T12:00:00Z',app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google',identity_data:{sub:'synthetic-google-subject'}}]};
 const session={user,access_token:'synthetic-supabase-access',refresh_token:'synthetic-supabase-refresh',expires_in:3600,provider_token:'synthetic-google-api-access',provider_refresh_token:'synthetic-google-api-refresh'};
 const redirectTo=type=>native?'basketboss://auth/callback?bb_auth='+type:'https://basketboss.co.uk/app?bb_auth='+type;
 const auth={};
 for(const name of ['signInWithOAuth','exchangeCodeForSession','getUser','signUp','signInWithPassword','signInWithIdToken','verifyOtp','setSession','resetPasswordForEmail','getSession','updateUser','resend'])auth[name]=async(...args)=>{
  calls.push({name,args});
  if(name==='signInWithOAuth')return ok({url:authorizeURL(redirectTo('google'))});
  if(name==='getUser'||name==='updateUser')return ok({user});
  return ok({session});
 };
 const core=create({auth,storage,...(pendingSeparate?{pendingStorage}:{}),now:()=>time,sessionRaw:()=>raw,blocked:()=>locked,redirectTo,
  remember(value){durable.push(value);if(!remember)return false;raw=JSON.stringify(value);return true;},
  clearTransient:()=>transient.push(true),onSuccess:(type,actor)=>success.push({type,actor}),onLifecycle:name=>events.push(name),onState:value=>states.push(value),
  google:{enabled:()=>enabled,origin:ORIGIN,native,navigate:async address=>{navigation.push(address);return navigate?.(address);}},
 });
 return {core,auth,user,session,calls,navigation,success,events,states,durable,transient,values,pendingValues,storage,pendingStorage,redirectTo,
  advance:value=>{time+=value;},changeActor(value){raw=value===null?null:JSON.stringify({user:{id:value},access_token:'replacement-'+value});},block:value=>{locked=value;},read:()=>raw,time:()=>time};
}
function onlyCalls(h,name){return h.calls.filter(call=>call.name===name);}

for(const native of [false,true])test(`Google ${native?'native':'web'} launch requests only PKCE account selection and does not authenticate or unlock membership`,async()=>{
 const h=fixture({native});
 assert.equal(await h.core.signInWithGoogle({intent:'sign-in'}),true);
 assert.deepEqual(onlyCalls(h,'signInWithOAuth').map(call=>call.args),[[{provider:'google',options:{redirectTo:h.redirectTo('google'),skipBrowserRedirect:true,queryParams:{prompt:'select_account'}}}]]);
 assert.equal(h.navigation.length,1);assert.equal(h.navigation[0],authorizeURL(h.redirectTo('google')));
 assert.deepEqual(JSON.parse(h.pendingValues.get(PENDING)),{version:1,createdAt:100000,actor:null,signingUp:false});
 assert.equal(h.read(),null);assert.deepEqual(h.durable,[]);assert.deepEqual(h.success,[]);assert.deepEqual(h.events,[]);
 assert.equal(onlyCalls(h,'getUser').length,0);assert.equal(onlyCalls(h,'signInWithPassword').length,0);
 assert.equal(h.core.state().busy,!native,'native callback must not be blocked by browser launch; web waits for navigation');
});

test('duplicate Google taps share one OAuth preparation and one pending browser launch',async()=>{
 const response=deferred(),browser=deferred(),h=fixture({navigate:()=>browser.promise});
 h.auth.signInWithOAuth=async(...args)=>{h.calls.push({name:'signInWithOAuth',args});return response.promise;};
 const first=h.core.signInWithGoogle();assert.equal(await h.core.signInWithGoogle(),false);
 response.resolve(ok({url:authorizeURL()}));await tick();
 assert.equal(await h.core.signInWithGoogle(),false);assert.equal(onlyCalls(h,'signInWithOAuth').length,1);assert.equal(h.navigation.length,1);
 browser.resolve();assert.equal(await first,true);assert.deepEqual(h.durable,[]);
});

for(const settings of [{enabled:false},{blocked:true}])test(`Google ${settings.enabled===false?'provider-disabled':'deletion-blocked'} launch makes no provider request or progress marker`,async()=>{
 const h=fixture(settings);assert.equal(await h.core.signInWithGoogle(),false);
 assert.deepEqual(h.calls,[]);assert.deepEqual(h.navigation,[]);assert.equal(h.pendingValues.has(PENDING),false);assert.equal(h.read(),null);
});

test('verified Google PKCE callback uses exchange and independent getUser, strips provider API tokens and persists only then',async()=>{
 const h=fixture({pendingSeparate:true});await h.core.signInWithGoogle({intent:'sign-up'});
 assert.equal(h.values.has(PENDING),false);assert.equal(h.pendingValues.has(PENDING),true);
 assert.equal(h.events.includes('signup_succeeded'),false);assert.equal(h.events.includes('signup_attempted'),true);
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),true);
 assert.deepEqual(onlyCalls(h,'exchangeCodeForSession')[0].args,[CODE,undefined]);
 assert.deepEqual(onlyCalls(h,'getUser')[0].args,['synthetic-supabase-access']);
 assert.equal(h.success.length,1);assert.equal(h.success[0].actor.id,h.user.id);assert.equal(h.durable.length,1);
 assert.equal(Object.hasOwn(h.durable[0],'provider_token'),false);assert.equal(Object.hasOwn(h.durable[0],'provider_refresh_token'),false);
 assert.doesNotMatch(h.read(),/synthetic-google-api/);assert.equal(JSON.parse(h.read()).access_token,'synthetic-supabase-access');
 assert.equal(h.pendingValues.has(PENDING),false);assert.equal(h.pendingValues.has(SIGNUP),false);
 assert.equal(h.events.filter(name=>name==='signup_succeeded').length,1);assert.equal(h.core.state().busy,false);
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),false,'a consumed local Google attempt cannot be replayed');
 assert.equal(onlyCalls(h,'exchangeCodeForSession').length,1);assert.equal(h.events.filter(name=>name==='signup_succeeded').length,1);
});

test('native Google callback can finish while Browser.open is still pending',async()=>{
 const browser=deferred(),h=fixture({navigate:()=>browser.promise});
 const launched=h.core.signInWithGoogle({intent:'sign-up'});await tick();
 assert.equal(h.navigation.length,1);assert.equal(h.core.state().busy,false);
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),true);assert.equal(h.success.length,1);
 assert.equal(h.core.cancelGoogleSignIn(),false,'a late browser close cannot undo consumed verified sign-in');
 browser.resolve();await launched;assert.equal(h.success.length,1);assert.equal(h.events.filter(name=>name==='signup_succeeded').length,1);
});

test('cancelling Google before callback removes only its progress and leaves the current account and unrelated pending signup intact',async()=>{
 const h=fixture({actor:'existing-actor'});await h.core.signInWithGoogle();
 h.pendingValues.set(SIGNUP,JSON.stringify({createdAt:h.time(),method:'email'}));
 const before=h.read();assert.equal(h.core.cancelGoogleSignIn(),true);
 assert.equal(h.read(),before);assert.equal(h.pendingValues.has(PENDING),false);assert.equal(JSON.parse(h.pendingValues.get(SIGNUP)).method,'email');
 assert.equal(h.core.state().busy,false);assert.match(h.core.state().message,/cancelled/i);
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),false);assert.equal(onlyCalls(h,'exchangeCodeForSession').length,0);assert.deepEqual(h.durable,[]);
});

test('browser cancellation while Google callback is verifying cannot release its lock or suppress verification',async()=>{
 const exchange=deferred(),h=fixture();await h.core.signInWithGoogle();
 h.auth.exchangeCodeForSession=async(...args)=>{h.calls.push({name:'exchangeCodeForSession',args});return exchange.promise;};
 const callback=h.core.callback({code:CODE,bb_auth:'google'});await tick();
 assert.equal(h.core.state().busy,true);assert.equal(h.core.cancelGoogleSignIn(),false);assert.equal(h.core.state().busy,true);
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),false,'duplicate callback cannot enter while exchange is in flight');
 exchange.resolve(ok({session:h.session}));assert.equal(await callback,true);assert.equal(h.success.length,1);
});

for(const kind of ['missing','stale','future','malformed','wrong-actor'])test(`Google ${kind} attempt rejects callback before token exchange`,async()=>{
 const h=fixture({actor:'existing-actor'});
 if(kind!=='missing')await h.core.signInWithGoogle();
 if(kind==='stale')h.advance(600000);
 if(kind==='future')h.pendingValues.set(PENDING,JSON.stringify({version:1,createdAt:h.time()+1,actor:'existing-actor'}));
 if(kind==='malformed')h.pendingValues.set(PENDING,'{invalid');
 if(kind==='wrong-actor')h.changeActor('different-actor');
 const before=h.read();assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),false);
 assert.equal(onlyCalls(h,'exchangeCodeForSession').length,0);assert.equal(h.read(),before);assert.deepEqual(h.durable,[]);assert.equal(h.core.state().busy,false);
});

for(const cause of ['actor','deletion','invalidate'])test(`Google ${cause} change during getUser verification never commits the delayed session`,async()=>{
 const gate=deferred(),h=fixture({actor:'original-actor'});await h.core.signInWithGoogle({intent:'sign-up'});
 h.auth.getUser=async(...args)=>{h.calls.push({name:'getUser',args});return gate.promise;};
 const verification=h.core.callback({code:CODE,bb_auth:'google'});await tick();
 if(cause==='actor')h.changeActor('replacement-actor');else if(cause==='deletion')h.block(true);else h.core.invalidate();
 const before=h.read();gate.resolve(ok({user:h.user}));assert.equal(await verification,false);
 assert.equal(h.read(),before);assert.deepEqual(h.durable,[]);assert.deepEqual(h.success,[]);assert.equal(h.events.includes('signup_succeeded'),false);
});

for(const failure of ['exchange','user-rejected','user-missing','unconfirmed','storage'])test(`Google ${failure} failure never records signup success or persists an unverified session`,async()=>{
 const h=fixture({remember:failure!=='storage'});await h.core.signInWithGoogle({intent:'sign-up'});
 if(failure==='exchange')h.auth.exchangeCodeForSession=async()=>({data:{session:null},error:{code:'flow_state_expired',message:'Expired'}});
 if(failure==='user-rejected')h.auth.getUser=async()=>({data:{user:null},error:{code:'session_not_found',message:'Rejected'}});
 if(failure==='user-missing')h.auth.getUser=async()=>ok({user:null});
 if(failure==='unconfirmed')h.auth.getUser=async()=>ok({user:{...h.user,email_confirmed_at:null,confirmed_at:null}});
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),false);assert.equal(h.read(),null);assert.deepEqual(h.success,[]);assert.equal(h.events.includes('signup_succeeded'),false);
 if(failure!=='storage')assert.deepEqual(h.durable,[]);
 assert.equal(h.core.state().busy,false);
});

test('OAuth provider denial, incomplete and non-PKCE Google callbacks do not reach exchange or token injection',async()=>{
 for(const fields of [{error:'access_denied',error_description:'private-provider-response'},{},{access_token:'injected-access',refresh_token:'injected-refresh'},{token_hash:'injected-hash',type:'google'}]){
  const h=fixture();await h.core.signInWithGoogle({intent:'sign-up'});
  assert.equal(await h.core.callback({...fields,bb_auth:'google'}),false);assert.equal(onlyCalls(h,'exchangeCodeForSession').length,0);assert.equal(onlyCalls(h,'setSession').length,0);assert.equal(onlyCalls(h,'verifyOtp').length,0);
  assert.equal(h.read(),null);assert.deepEqual(h.success,[]);assert.doesNotMatch(h.core.state().message,/private-provider-response/);assert.equal(h.core.state().busy,false);
 }
});

for(const failure of ['provider-error','navigate-error','storage-blocked'])test(`Google ${failure} unlocks retry without recording authentication`,async()=>{
 const h=fixture({storageBlocked:failure==='storage-blocked',navigate:failure==='navigate-error'?async()=>{throw Error('Browser could not open');}:undefined});
 if(failure==='provider-error')h.auth.signInWithOAuth=async()=>({data:null,error:{code:'provider_disabled',message:'Google disabled'}});
 assert.equal(await h.core.signInWithGoogle({intent:'sign-up'}),false);
 assert.equal(h.core.state().busy,false);assert.equal(h.pendingValues.has(PENDING),false);assert.equal(h.read(),null);assert.deepEqual(h.success,[]);
});

for(const change of ['actor','deletion'])test(`Google ${change} change during preparation prevents browser launch and marker writes`,async()=>{
 const prepared=deferred(),h=fixture({actor:'original-actor'});h.auth.signInWithOAuth=()=>prepared.promise;
 const launch=h.core.signInWithGoogle();if(change==='actor')h.changeActor('replacement-actor');else h.block(true);
 prepared.resolve(ok({url:authorizeURL()}));assert.equal(await launch,false);assert.deepEqual(h.navigation,[]);assert.equal(h.pendingValues.has(PENDING),false);assert.deepEqual(h.durable,[]);
});

test('Google authorization URLs require exact configured origin, provider, callback and PKCE S256 challenge',()=>{
 const redirect='basketboss://auth/callback?bb_auth=google',valid=authorizeURL(redirect);
 assert.equal(googleAuthorizeURL(valid,ORIGIN,redirect),valid);
 const invalid=[null,'not a URL','javascript:alert(1)'];
 for(const change of [url=>{url.protocol='http:';},url=>{url.hostname='attacker.invalid';},url=>{url.username='untrusted';},url=>{url.password='untrusted';},url=>{url.pathname='/auth/v1/elsewhere';},url=>{url.hash='fragment';},url=>{url.searchParams.set('provider','apple');},url=>{url.searchParams.set('redirect_to','https://attacker.invalid/callback');},url=>{url.searchParams.delete('redirect_to');},url=>{url.searchParams.set('code_challenge_method','plain');},url=>{url.searchParams.delete('code_challenge');},url=>{url.searchParams.set('code_challenge','short');},url=>{url.searchParams.set('code_challenge','+'.repeat(43));}]){
  const url=new URL(valid);change(url);invalid.push(url.href);
 }
 for(const value of invalid)assert.equal(googleAuthorizeURL(value,ORIGIN,redirect),null,String(value));
 assert.equal(googleAuthorizeURL(valid,'not a configured URL',redirect),null);
});

function availabilityFixture({native=false,browser=true,status=200,body={external:{google:true}},jsonText,headersPending=false}={}){
 const calls=[],timers=[],cleared=[];let abort;
 const win={BBNative:native?{isNative:true}:undefined,BBNativeAuthBrowser:browser?{open(){}}:undefined,
  setTimeout(fn,ms){const entry={fn,ms};timers.push(entry);return entry;},clearTimeout(timer){cleared.push(timer);},
  fetch:async(input,init)=>{
   calls.push({input,init});abort=init.signal;
   if(headersPending)return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError')),{once:true}));
   return new Response(jsonText??JSON.stringify(body),{status});
  }};
 return {win,calls,timers,cleared,config:{url:ORIGIN+'/',anonKey:'synthetic-publishable-key'},abort:()=>abort};
}

for(const native of [false,true])test(`Google availability reads provider settings with publishable key only on ${native?'native':'web'}`,async()=>{
 const h=availabilityFixture({native});assert.deepEqual(await googleAvailability(h.win,h.config),{enabled:true});
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].input,ORIGIN+'/auth/v1/settings');
 assert.deepEqual(h.calls[0].init.headers,{apikey:'synthetic-publishable-key'});assert.equal(h.calls[0].init.credentials,'omit');assert.equal(h.calls[0].init.redirect,'error');assert.equal(h.calls[0].init.cache,'no-store');
 assert.equal(h.timers[0].ms,20000);assert.equal(h.cleared.length,1);
});

test('unavailable native system browser or disabled Google provider stays unavailable without fabricating readiness',async()=>{
 const missing=availabilityFixture({native:true,browser:false});assert.deepEqual(await googleAvailability(missing.win,missing.config),{enabled:false});assert.deepEqual(missing.calls,[]);
 for(const body of [{},{external:{}},{external:{google:false}},{external:{google:'true'}}]){
  const h=availabilityFixture({body});assert.deepEqual(await googleAvailability(h.win,h.config),{enabled:false});
 }
});

test('unreadable and rejected Google availability responses fail closed and clear their deadlines',async()=>{
 for(const options of [{status:403},{status:503},{jsonText:'{not JSON'}]){
  const h=availabilityFixture(options);await assert.rejects(googleAvailability(h.win,h.config));assert.equal(h.cleared.length,1);
 }
});

test('Google availability timeout aborts a stalled provider request and releases its timer',async()=>{
 const h=availabilityFixture({headersPending:true});const availability=googleAvailability(h.win,h.config);assert.equal(h.timers.length,1);
 h.timers[0].fn();await assert.rejects(availability,error=>error.name==='AbortError');assert.equal(h.abort().aborted,true);assert.equal(h.cleared.length,1);
});

test('Google availability deadline remains active while its response body is unreadable/stalled',async()=>{
 const h=availabilityFixture();
 h.win.fetch=async(input,init)=>{h.calls.push({input,init});return {ok:true,clone:()=>({arrayBuffer:()=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError')),{once:true}))}),json:async()=>({external:{google:true}})};};
 const availability=googleAvailability(h.win,h.config);await tick();assert.equal(h.cleared.length,0,'headers alone do not release the auth deadline');
 h.timers[0].fn();await assert.rejects(availability,error=>error.name==='AbortError');assert.equal(h.cleared.length,1);
});

test('a Google callback cannot bypass its pending-attempt and PKCE checks by forging recovery or email type',async()=>{
 for(const type of ['recovery','email']){
  const missing=fixture();assert.equal(await missing.core.callback({bb_auth:'google',type,code:CODE}),false);
  assert.equal(onlyCalls(missing,'exchangeCodeForSession').length,0);assert.deepEqual(missing.durable,[]);
  const nonPKCE=fixture();await nonPKCE.core.signInWithGoogle();
  assert.equal(await nonPKCE.core.callback({bb_auth:'google',type,token_hash:'forged-recovery-hash'}),false);
  assert.equal(onlyCalls(nonPKCE,'verifyOtp').length,0);assert.deepEqual(nonPKCE.durable,[]);
  const legitimate=fixture();await legitimate.core.signInWithGoogle();
  assert.equal(await legitimate.core.callback({bb_auth:'google',type,code:CODE}),true);
  assert.equal(legitimate.core.state().view,'sign-in','a Google callback cannot acquire a password-recovery lease');
  assert.equal(legitimate.values.has('basketboss_password_recovery_v1'),false);
  assert.equal(legitimate.success.length,1);
 }
});

test('a late browser-launch rejection cannot unlock or overwrite Google callback verification already in flight',async()=>{
 const browser=deferred(),exchange=deferred(),h=fixture({navigate:()=>browser.promise});
 const launch=h.core.signInWithGoogle({intent:'sign-up'});await tick();
 h.auth.exchangeCodeForSession=async(...args)=>{h.calls.push({name:'exchangeCodeForSession',args});return exchange.promise;};
 const callback=h.core.callback({code:CODE,bb_auth:'google'});await tick();
 assert.equal(h.core.state().busy,true);assert.equal(h.core.state().action,'callback');
 browser.reject(Error('Synthetic late Browser.open failure'));
 assert.equal(await launch,false);
 assert.equal(h.core.state().busy,true);assert.equal(h.core.state().action,'callback');assert.equal(h.core.state().view,'verifying');
 assert.doesNotMatch(h.core.state().message,/Browser.open failure/);
 assert.equal(h.pendingValues.has(SIGNUP),true,'late browser failure does not erase the verification signup intent');
 assert.equal(await h.core.signInWithGoogle(),false,'the independent callback verification lock still rejects new launches');
 exchange.resolve(ok({session:h.session}));assert.equal(await callback,true);
 assert.equal(h.success.length,1);assert.equal(h.events.filter(name=>name==='signup_succeeded').length,1);assert.equal(h.core.state().busy,false);
});

test('a second native Google tap after browser launch resolves preserves the original PKCE attempt and callback',async()=>{
 const h=fixture();assert.equal(await h.core.signInWithGoogle({intent:'sign-up'}),true);
 const original=h.pendingValues.get(PENDING);assert.ok(original);
 assert.equal(h.core.state().busy,false,'native callback verification can acquire its own lock');
 assert.equal(await h.core.signInWithGoogle({intent:'sign-up'}),false);
 assert.equal(onlyCalls(h,'signInWithOAuth').length,1,'a second tap cannot replace the SDK PKCE verifier');
 assert.equal(h.navigation.length,1);assert.equal(h.pendingValues.get(PENDING),original,'the original browser retains its continuity marker');
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),true);
 assert.equal(h.success.length,1);assert.equal(h.durable.length,1);assert.equal(onlyCalls(h,'getUser').length,1);
});

test('closing a native Google browser after its marker TTL releases the launch latch and permits a fresh attempt',async()=>{
 const h=fixture();assert.equal(await h.core.signInWithGoogle(),true);
 h.advance(600001);
 assert.equal(h.core.cancelGoogleSignIn(),true,'an expired marker must not strand the in-memory native launch latch');
 assert.equal(h.pendingValues.has(PENDING),false);assert.equal(h.core.state().busy,false);assert.deepEqual(h.durable,[]);
 assert.equal(await h.core.signInWithGoogle(),true);assert.equal(onlyCalls(h,'signInWithOAuth').length,2);assert.equal(h.navigation.length,2);
 const renewed=JSON.parse(h.pendingValues.get(PENDING));assert.equal(renewed.createdAt,h.time());
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),true);assert.equal(h.success.length,1);
});

test('an expired native Google callback fails closed and releases its latch for a new verified attempt',async()=>{
 const h=fixture();assert.equal(await h.core.signInWithGoogle(),true);h.advance(600001);
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),false);
 assert.equal(onlyCalls(h,'exchangeCodeForSession').length,0);assert.equal(h.core.state().busy,false);assert.deepEqual(h.durable,[]);
 assert.equal(await h.core.signInWithGoogle(),true);assert.equal(onlyCalls(h,'signInWithOAuth').length,2);assert.equal(h.navigation.length,2);
 assert.equal(await h.core.callback({code:CODE,bb_auth:'google'}),true);assert.equal(h.success.length,1);
});
