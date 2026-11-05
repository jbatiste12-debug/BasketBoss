import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8'),start=html.indexOf('const config=window.BASKETBOSS_CLOUD_CONFIG||{};');
const code=html.slice(html.lastIndexOf('(function(){',start),html.indexOf('</script>',start));
const SESSION='basketboss_cloud_session_v1',STATE='basketboss_321_unified_state_v1',tick=()=>new Promise(resolve=>setImmediate(resolve));
const plan=name=>JSON.stringify({version:2,planned:[{recipeId:name,day:'Monday'}],pantry:{}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const store=new Map([[SESSION,JSON.stringify({access_token:'synthetic-backup-token',expires_at:Date.now()/1000+3600,user:{id:'backup-test-actor',email:'test@example.invalid'}})],[STATE,plan('first')]]),nodes=new Map(),events=new Map(),timers=new Map(),calls=[];
 let sequence=0,reloads=0,handler=async()=>new Response('',{status:200});
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,textContent:'',disabled:false,hidden:false,value:'',classList:{add(){},remove(){}}});return nodes.get(id);};
 const navigator={onLine:true},window={BASKETBOSS_CLOUD_CONFIG:{url:'https://fixture.supabase.co',anonKey:'public-fixture'},addEventListener:(name,fn)=>{const rows=events.get(name)||[];rows.push(fn);events.set(name,rows);},BasketBossSession:{state:()=>({remembered:false}),ensureFresh:async()=>JSON.parse(store.get(SESSION)||'null')}};
 const localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)};
 vm.runInNewContext(code,{window,document:{getElementById:node},navigator,localStorage,AbortController,Date,JSON,console,location:{hash:'',reload:()=>{reloads++;}},confirm:()=>true,setTimeout:(fn,delay)=>{timers.set(++sequence,{fn,delay});return sequence;},clearTimeout:id=>timers.delete(id),fetch:(url,input)=>{calls.push({url,input});return handler(url,input);}});
 return {window,node,store,storage:localStorage,timers,calls,navigator,get reloads(){return reloads;},setHandler:value=>{handler=value;},event:(name,payload={})=>{for(const fn of events.get(name)||[])fn({type:name,...payload});},expire:delay=>{const found=[...timers].find(([,timer])=>timer.delay===delay);assert.ok(found,'expected timeout '+delay);timers.delete(found[0]);found[1].fn();}};
}

test('upload and restore lock in the first tap and automatic upload serially drains newer edits',async()=>{
 const h=fixture(),first=deferred(),second=deferred();h.setHandler(()=>h.calls.length===1?first.promise:second.promise);
 const uploading=h.node('cloud-upload').onclick();assert.equal(h.node('cloud-upload').disabled,true);assert.equal(h.node('cloud-download').disabled,true);
 const duplicate=h.node('cloud-upload').onclick(),restore=h.node('cloud-download').onclick();await tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].input.method,'POST');
 h.store.set(STATE,plan('edited-during-upload'));h.window.BasketBossCloud.scheduleSave();h.expire(1400);await tick();assert.equal(h.calls.length,1,'autosave cannot race the active POST');
 first.resolve(new Response('',{status:200}));await tick();assert.equal(h.calls.length,2);assert.equal(JSON.parse(h.calls[1].input.body).data.planned[0].recipeId,'edited-during-upload');
 second.resolve(new Response('',{status:200}));await Promise.all([uploading,duplicate,restore]);assert.equal(h.node('cloud-upload').disabled,false);assert.equal(h.node('cloud-download').disabled,false);assert.equal(h.reloads,0);assert.match(h.node('cloud-message').textContent,/Synced securely/);
 h.event('online');await tick();assert.equal(h.calls.length,2,'the latest successful snapshot clears the dirty state');assert.equal(h.timers.size,0);
});

test('offline upload preserves local data and syncs once after reconnection',async()=>{
 const h=fixture(),saved=h.store.get(STATE);h.navigator.onLine=false;await h.node('cloud-upload').onclick();
 assert.equal(h.calls.length,0);assert.equal(h.store.get(STATE),saved);assert.match(h.node('cloud-message').textContent,/offline/);assert.equal(h.node('cloud-upload').disabled,false);
 h.navigator.onLine=true;h.event('online');await tick();assert.equal(h.calls.length,1);assert.equal(h.store.get(STATE),saved);assert.match(h.node('cloud-message').textContent,/Synced securely/);
});

test('the cloud deadline covers a stalled response body and releases both controls for retry',async()=>{
 const h=fixture(),saved=h.store.get(STATE);h.setHandler(async(_url,input)=>({ok:true,text:()=>new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(Error('synthetic stalled body')),{once:true}))}));
 const uploading=h.node('cloud-upload').onclick();await tick();h.expire(20000);await uploading;
 assert.equal(h.node('cloud-upload').disabled,false);assert.equal(h.node('cloud-download').disabled,false);assert.match(h.node('cloud-message').textContent,/timed out.*saved on this device/);assert.equal(h.store.get(STATE),saved);assert.equal(h.timers.size,0);
 h.setHandler(async()=>new Response('',{status:200}));await h.node('cloud-upload').onclick();assert.equal(h.calls.length,2);assert.match(h.node('cloud-message').textContent,/Synced securely/);
});

test('restoring a slow cloud copy cannot overwrite local edits made while it was loading',async()=>{
 const h=fixture(),reply=deferred();h.setHandler(()=>reply.promise);const restoring=h.node('cloud-download').onclick();await tick();
 h.store.set(STATE,plan('new-local-edit'));h.window.BasketBossCloud.scheduleSave();reply.resolve(Response.json([{data:JSON.parse(plan('old-remote'))}]));await restoring;
 assert.equal(h.store.get(STATE),plan('new-local-edit'));assert.equal(h.reloads,0);assert.match(h.node('cloud-message').textContent,/latest changes have been kept/);assert.equal(h.node('cloud-download').disabled,false);assert.equal(h.calls.length,1);assert.equal([...h.timers.values()].filter(timer=>timer.delay===1400).length,1);
});

test('a rejected account-connected backup probe settles locally instead of rejecting unhandled',async()=>{
 const h=fixture();h.setHandler(async()=>{throw Error('synthetic no supermarket signal');});await assert.doesNotReject(h.window.BasketBossCloud.connected());
 assert.equal(h.store.get(STATE),plan('first'));assert.match(h.node('cloud-message').textContent,/synthetic no supermarket signal/);assert.equal(h.timers.size,0);
});
test('same-account token refresh preserves cloud agreement and autosaves new edits with the refreshed token',async()=>{
 for(const event of ['basketboss:session-changed','storage']){
  const h=fixture();await h.node('cloud-upload').onclick();assert.equal(h.calls.length,1);
  const refreshed={...JSON.parse(h.store.get(SESSION)),access_token:'refreshed-same-account-token'};h.store.set(SESSION,JSON.stringify(refreshed));h.event(event,{key:SESSION});await tick();
  h.window.BasketBossCloud.scheduleSave();h.expire(1400);await tick();assert.equal(h.calls.length,1,'an unchanged snapshot stays synced after '+event);
  h.store.set(STATE,plan('edited-after-refresh'));h.window.BasketBossCloud.scheduleSave();h.expire(1400);await tick();
  const posts=h.calls.filter(call=>call.input.method==='POST');assert.equal(posts.length,2);assert.equal(h.calls.length,2,'same-account refresh never introduces a manual-copy GET/choice');
  assert.equal(posts[1].input.headers.Authorization,'Bearer refreshed-same-account-token');assert.equal(JSON.parse(posts[1].input.body).data.planned[0].recipeId,'edited-after-refresh');
 }
});
test('a same-account refresh during an upload queues a safe retry after the old-token response is discarded',async()=>{
 const h=fixture(),pending=deferred();h.setHandler(()=>h.calls.length===1?pending.promise:new Response('',{status:200}));
 const upload=h.node('cloud-upload').onclick();await tick();const refreshed={...JSON.parse(h.store.get(SESSION)),access_token:'refreshed-during-upload'};
 h.store.set(SESSION,JSON.stringify(refreshed));h.event('basketboss:session-changed');pending.resolve(new Response('',{status:200}));await upload;
 h.expire(1400);await tick();const posts=h.calls.filter(call=>call.input.method==='POST');assert.equal(posts.length,2);assert.equal(posts[1].input.headers.Authorization,'Bearer refreshed-during-upload');assert.match(h.node('cloud-message').textContent,/Synced securely/);
});

// The real host's validation and conflict rules have their own tests. This
// contract double verifies that the shipped cloud controller uses its proposal
// atomically and never sends a plan-only snapshot over a newer Kitchen edit.
function kitchen(h){
 let restores=0;
 const values=()=>({stock:JSON.parse(h.store.get('stock')||'null'),prices:JSON.parse(h.store.get('prices')||'null')});
 const hasLocalData=()=>Object.values(values().stock||{}).some(value=>value>0)||Object.keys(values().prices||{}).length>0;
 const api={hasLocalData,exportBackup:()=>({version:1,actorId:'backup-test-actor',values:values(),essentials:[],home:{},hasData:hasLocalData()}),prepareBackupRestore(payload){
  restores++;if(payload.actorId!=='backup-test-actor')throw Error('pantry_backup_wrong_actor');
  if(hasLocalData())return {updates:{},expected:{},requiresReview:true,restored:false};
  const updates={...payload.values,owner:null},expected=Object.fromEntries(Object.keys(updates).map(key=>[key,h.store.get(key)??null]));expected[SESSION]=h.store.get(SESSION);
  return {updates,expected,requiresReview:false,restored:true};
 }};
 h.window.BBReceiptHost=api;return {api,get restores(){return restores;}};
}
const remoteKitchen=()=>({version:2,planned:[{recipeId:'remote-meal',day:'Tuesday'}],pantry:{},atHomeBackup:{version:1,actorId:'backup-test-actor',values:{stock:{'rice|g':500},prices:{rice:3.75}},essentials:[],home:{},hasData:true}});
test('a fresh confirmed device loads its plan, absolute pantry and prices before any automatic upload',async()=>{
 const h=fixture();h.store.set(STATE,JSON.stringify({version:2,planned:[],pantry:{}}));const k=kitchen(h),remote=remoteKitchen();h.setHandler(async()=>Response.json([{data:remote}]));
 await h.window.BasketBossCloud.connected();assert.equal(h.reloads,1);assert.equal(k.restores,1);
 assert.deepEqual(JSON.parse(h.store.get('stock')),{'rice|g':500});assert.deepEqual(JSON.parse(h.store.get('prices')),{rice:3.75});assert.equal(h.store.get('owner'),undefined);
 assert.equal(JSON.parse(h.store.get(STATE)).planned[0].recipeId,'remote-meal');assert.equal(Object.hasOwn(JSON.parse(h.store.get(STATE)),'atHomeBackup'),false);
 assert.ok(h.calls.every(call=>call.input.method==='GET'),'an empty device never overwrites the remote account');
});
test('pantry-only edits made during upload drain into a second complete account snapshot',async()=>{
 const h=fixture();h.store.set('stock',JSON.stringify({'rice|g':100}));kitchen(h);const first=deferred(),second=deferred();h.setHandler(()=>h.calls.length===1?first.promise:second.promise);
 const uploading=h.node('cloud-upload').onclick();await tick();assert.equal(JSON.parse(h.calls[0].input.body).data.atHomeBackup.values.stock['rice|g'],100);
 h.store.set('stock',JSON.stringify({'rice|g':200}));h.window.BasketBossCloud.scheduleSave();h.expire(1400);await tick();assert.equal(h.calls.length,1);
 first.resolve(new Response('',{status:200}));await tick();assert.equal(h.calls.length,2);assert.equal(JSON.parse(h.calls[1].input.body).data.atHomeBackup.values.stock['rice|g'],200);
 second.resolve(new Response('',{status:200}));await uploading;assert.equal(h.node('cloud-upload').disabled,false);
});
test('a slow Restore cannot replace pantry edits even when the meal plan bytes did not change',async()=>{
 const h=fixture();h.store.set('stock',JSON.stringify({'rice|g':100}));const k=kitchen(h),reply=deferred(),savedPlan=h.store.get(STATE);h.setHandler(()=>reply.promise);
 const restoring=h.node('cloud-download').onclick();await tick();h.store.set('stock',JSON.stringify({'rice|g':200}));reply.resolve(Response.json([{data:remoteKitchen()}]));await restoring;
 assert.equal(h.reloads,0);assert.equal(k.restores,0);assert.equal(h.store.get(STATE),savedPlan);assert.equal(JSON.parse(h.store.get('stock'))['rice|g'],200);assert.match(h.node('cloud-message').textContent,/latest changes have been kept/);
});
test('conflicting local pantry and prices remain intact until the existing explicit restore choice',async()=>{
 const h=fixture();h.store.set('stock',JSON.stringify({'rice|g':99}));h.store.set('prices',JSON.stringify({rice:8.88}));kitchen(h);h.setHandler(async()=>Response.json([{data:remoteKitchen()}]));
 await h.window.BasketBossCloud.connected();assert.equal(h.reloads,0);assert.match(h.node('cloud-message').textContent,/Cloud backup found/);
 h.window.BasketBossCloud.scheduleSave();h.expire(1400);await tick();await tick();assert.ok(h.calls.every(call=>call.input.method==='GET'),'automatic writes pause while copies differ');
 await h.node('cloud-download').onclick();assert.equal(h.reloads,1);assert.equal(JSON.parse(h.store.get('stock'))['rice|g'],99);assert.equal(JSON.parse(h.store.get('prices')).rice,8.88);assert.match(h.node('cloud-message').textContent,/local kitchen amounts were kept/);
});
test('a failed multi-key Kitchen restore rolls back before replacing the meal plan',async()=>{
 const h=fixture();h.store.set(STATE,JSON.stringify({version:2,planned:[],pantry:{}}));const before=h.store.get(STATE);kitchen(h);h.setHandler(async()=>Response.json([{data:remoteKitchen()}]));
 const write=h.storage.setItem;let fail=true;h.storage.setItem=(key,value)=>{if(key==='prices'&&fail){fail=false;throw Error('synthetic storage full');}return write(key,value);};
 await h.node('cloud-download').onclick();assert.equal(h.reloads,0);assert.equal(h.store.get('stock'),undefined);assert.equal(h.store.get('prices'),undefined);assert.equal(h.store.get(STATE),before);assert.equal(h.node('cloud-download').disabled,false);
});
test('wrong-account backup payloads cannot replace the plan or any Kitchen values',async()=>{
 const h=fixture();h.store.set(STATE,JSON.stringify({version:2,planned:[],pantry:{}}));const before=h.store.get(STATE);kitchen(h);const remote=remoteKitchen();remote.atHomeBackup.actorId='another-account';h.setHandler(async()=>Response.json([{data:remote}]));
 await h.node('cloud-download').onclick();assert.equal(h.reloads,0);assert.equal(h.store.get(STATE),before);assert.equal(h.store.get('stock'),undefined);assert.match(h.node('cloud-message').textContent,/kept on this device/);
});
test('explicit Upload after a conflicting Restore uploads the retained local Kitchen',async()=>{
 const h=fixture();h.store.set('stock',JSON.stringify({'rice|g':99}));h.store.set('prices',JSON.stringify({rice:8.88}));kitchen(h);
 h.setHandler(async(_url,input)=>input.method==='GET'?Response.json([{data:remoteKitchen()}]):new Response('',{status:200}));
 await h.node('cloud-download').onclick();assert.equal(h.reloads,1);assert.equal(JSON.parse(h.store.get('stock'))['rice|g'],99);
 await h.node('cloud-upload').onclick();const posts=h.calls.filter(call=>call.input.method==='POST');assert.equal(posts.length,1);
 assert.equal(JSON.parse(posts[0].input.body).data.atHomeBackup.values.stock['rice|g'],99);assert.equal(JSON.parse(posts[0].input.body).data.atHomeBackup.values.prices.rice,8.88);
});
test('a concurrent stock change during a later restore write aborts and rolls back only its own bytes',async()=>{
 const h=fixture();h.store.set(STATE,JSON.stringify({version:2,planned:[],pantry:{}}));const before=h.store.get(STATE);kitchen(h);h.setHandler(async()=>Response.json([{data:remoteKitchen()}]));
 const write=h.storage.setItem;let interleave=true;h.storage.setItem=(key,value)=>{const result=write(key,value);if(key==='prices'&&interleave){interleave=false;write('stock',JSON.stringify({'rice|g':123}));}return result;};
 await h.node('cloud-download').onclick();assert.equal(h.reloads,0);assert.equal(JSON.parse(h.store.get('stock'))['rice|g'],123);
 assert.equal(h.store.get('prices'),undefined);assert.equal(h.store.get(STATE),before);assert.match(h.node('cloud-message').textContent,/saved data changed/);
});
test('a concurrent account deletion cannot resurrect pantry or plan bytes during restore rollback',async()=>{
 const h=fixture();h.store.set(STATE,JSON.stringify({version:2,planned:[],pantry:{}}));kitchen(h);h.setHandler(async()=>Response.json([{data:remoteKitchen()}]));
 const write=h.storage.setItem;let deleting=true;h.storage.setItem=(key,value)=>{const result=write(key,value);if(key==='prices'&&deleting){deleting=false;write('basketboss_account_deletion_v1',JSON.stringify({actorId:'backup-test-actor',phase:'deleting'}));h.store.delete('stock');h.store.delete(STATE);}return result;};
 await h.node('cloud-download').onclick();assert.equal(h.reloads,0);assert.equal(h.store.get('stock'),undefined);assert.equal(h.store.get(STATE),undefined,'rollback must not restore the pre-deletion plan');
 assert.equal(JSON.parse(h.store.get('basketboss_account_deletion_v1')).phase,'deleting');assert.equal(h.node('cloud-download').disabled,false);
});
