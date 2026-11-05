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
 const localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value))};
 vm.runInNewContext(code,{window,document:{getElementById:node},navigator,localStorage,AbortController,Date,JSON,console,location:{hash:'',reload:()=>{reloads++;}},confirm:()=>true,setTimeout:(fn,delay)=>{timers.set(++sequence,{fn,delay});return sequence;},clearTimeout:id=>timers.delete(id),fetch:(url,input)=>{calls.push({url,input});return handler(url,input);}});
 return {window,node,store,timers,calls,navigator,get reloads(){return reloads;},setHandler:value=>{handler=value;},event:name=>{for(const fn of events.get(name)||[])fn({type:name});},expire:delay=>{const found=[...timers].find(([,timer])=>timer.delay===delay);assert.ok(found,'expected timeout '+delay);timers.delete(found[0]);found[1].fn();}};
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
