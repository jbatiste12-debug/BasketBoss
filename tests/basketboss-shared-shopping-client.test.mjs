import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {create,KEY,ENDPOINT,creatorLabel,validItem}=createRequire(import.meta.url)('../bb-shared-shopping.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',H='33333333-3333-4333-8333-333333333333',H2='44444444-4444-4444-8444-444444444444',ID='55555555-5555-4555-8555-555555555555';
const session=(actor=A,token='synthetic-a')=>({user:{id:actor},access_token:token,expires_at:Math.floor(Date.now()/1000)+3600});
const item=(extra={})=>({id:ID,household_id:H,name:'Milk',quantity:1,unit:'l',created_by:A,added_by_name:'Alex',created_at:'2026-11-02T10:00:00Z',updated_at:'2026-11-02T10:00:00Z',completed:false,completed_at:null,completed_by:null,revision:1,...extra});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const status=(extra={})=>response({configured:true,premium:true,role:'owner',household_id:H,...extra});
const listing=(items=[],hid=H)=>response({ok:true,configured:true,migration_ready:true,household_id:hid,items});
const mutation=entry=>response({ok:true,household_id:entry.household_id,item:entry});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(){const h={session:session(),store:new Map(),calls:[],replies:[],records:[],changes:[],uuids:0,blocked:false,recordResult:true};
 h.options={getSession:()=>h.session,isBlocked:()=>h.blocked,uuid:()=>{h.uuids++;return ID;},storage:{getItem:key=>h.store.get(key)??null,setItem:(key,value)=>h.store.set(key,value)},fetch:(url,init)=>{h.calls.push({url,init,stored:h.store.get(KEY+':'+h.session?.user.id)});const next=h.replies.shift();assert.ok(next,'Every request has an explicit isolated reply');return typeof next==='function'?next(url,init):Promise.resolve(next);},recordPurchase:(entry,checked,pin)=>{h.records.push({entry,checked,pin});return h.recordResult;},onChange:value=>h.changes.push(value)};
 h.client=create(h.options);h.load=async(entries=[])=>{h.replies.push(status(),listing(entries));await h.client.refresh({force:true});};return h;
}

test('signed-out and gated-off accounts cannot create shared rows or make purchase records',async()=>{
 const h=fixture();h.session=null;await h.client.refresh();assert.equal(h.client.snapshot().phase,'signed-out');assert.equal(await h.client.add({name:'Milk',quantity:1,unit:'l'}),false);assert.equal(h.calls.length,0);assert.equal(h.records.length,0);
 h.session=session();h.replies.push(status({configured:false,premium:false,household_id:null,role:'unavailable'}));await h.client.refresh();assert.equal(h.client.snapshot().phase,'unavailable');assert.equal(await h.client.add({name:'Milk',quantity:1,unit:'l'}),false);assert.equal(h.calls.length,1);
});
test('only the server supplies attribution; add retries persist an ID before sending',async()=>{
 const h=fixture();await h.load();const wait=deferred();h.replies.push(wait.promise);const adding=h.client.add({name:' Milk ',quantity:1,unit:'l',added_by_name:'Not trusted',created_by:B});await Promise.resolve();
 const sent=h.calls.at(-1);assert.equal(sent.url,ENDPOINT);assert.deepEqual(JSON.parse(sent.init.body),{action:'shopping_add',id:ID,name:'Milk',quantity:1,unit:'l'});assert.equal(JSON.parse(sent.stored).adds[0].id,ID);assert.equal(sent.init.headers.Authorization,'Bearer synthetic-a');assert.equal(sent.init.redirect,'manual');
 assert.equal(h.client.snapshot().items.length,0,'an unconfirmed add never appears as shared');wait.resolve(mutation(item({added_by_name:'Server Alex'})));assert.equal(await adding,true);assert.equal(h.client.snapshot().items[0].added_by_name,'Server Alex');assert.equal(h.records.length,0);
});
test('two immediate add taps coalesce instead of creating duplicate extras',async()=>{
 const h=fixture();await h.load();const wait=deferred();h.replies.push(wait.promise);const one=h.client.add({name:'Milk',quantity:1,unit:'l'}),two=h.client.add({name:'Milk',quantity:1,unit:'l'});assert.equal(one,two);await Promise.resolve();assert.equal(h.uuids,1);assert.equal(h.calls.filter(x=>x.init.method==='POST').length,1);wait.resolve(mutation(item()));await one;
});
test('a lost add response retries the same request after reconnecting',async()=>{
 const h=fixture();await h.load();h.replies.push(()=>Promise.reject(Error('network')));assert.equal(await h.client.add({name:'Milk',quantity:1,unit:'l'}),false);assert.equal(h.client.snapshot().pendingAdds.length,1);
 h.replies.push(mutation(item()));assert.equal(await h.client.retry(ID),true);assert.equal(h.uuids,1);assert.equal(h.client.snapshot().pendingAdds.length,0);assert.deepEqual(h.calls.filter(x=>x.init.method==='POST').map(x=>JSON.parse(x.init.body).id),[ID,ID]);
});
test('pending extras from a prior week stay visible until explicitly completed',async()=>{
 const h=fixture();await h.load([item({created_at:'2026-01-01T10:00:00Z'})]);assert.equal(h.client.snapshot().items.length,1);assert.equal(h.client.snapshot().items[0].completed,false);assert.equal(h.records.length,0);
});
test('reaching the shared-list bound preserves the draft and gives a useful message',async()=>{
 const h=fixture();await h.load();h.replies.push(response({ok:false,limit_reached:true,household_id:H},409));assert.equal(await h.client.add({name:'Milk',quantity:1,unit:'l'}),false);assert.match(h.client.snapshot().notice,/Complete some shared items/);assert.equal(h.client.snapshot().pendingAdds.length,1);
});
test('an old refresh response cannot erase a newly acknowledged addition',async()=>{
 const h=fixture();await h.load();const old=deferred();h.replies.push(status(),old.promise);const refreshing=h.client.refresh({force:true});await new Promise(resolve=>setTimeout(resolve,0));
 h.replies.push(mutation(item()));assert.equal(await h.client.add({name:'Milk',quantity:1,unit:'l'}),true);h.replies.push(status(),listing([item()]));old.resolve(listing([]));await refreshing;await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.client.snapshot().items[0]?.id,ID);
});
test('switching accounts rejects an in-flight add without leaking its rows or names',async()=>{
 const h=fixture();await h.load();const wait=deferred();h.replies.push(wait.promise);const adding=h.client.add({name:'Milk',quantity:1,unit:'l'});await Promise.resolve();h.session=session(B,'synthetic-b');h.replies.push(status({household_id:H2,role:'partner'}),listing([],H2));await h.client.refresh({force:true});wait.resolve(mutation(item()));assert.equal(await adding,false);assert.equal(h.client.snapshot().household_id,H2);assert.deepEqual(h.client.snapshot().items,[]);assert.deepEqual(h.client.snapshot().pendingAdds,[]);assert.equal(h.records.length,0);
});
test('a different household does not replay a previous household add',async()=>{
 const h=fixture();await h.load();h.replies.push(()=>Promise.reject(Error('network')));await h.client.add({name:'Milk',quantity:1,unit:'l'});h.replies.push(status({household_id:H2}),listing([],H2),status({household_id:H2}),listing([],H2));await h.client.refresh({force:true});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.client.snapshot().household_id,H2);assert.equal(h.client.snapshot().pendingAdds.length,0);assert.equal(await h.client.retry(ID),false);assert.equal(h.calls.filter(row=>row.init.method==='POST').length,1);
});
test('Bought reaches the existing purchase owner only after server acknowledgement',async()=>{
 const h=fixture();await h.load([item()]);const wait=deferred();h.replies.push(wait.promise);const completing=h.client.complete(ID);await Promise.resolve();assert.equal(h.records.length,0);assert.equal(h.client.snapshot().items[0].completed,false);
 wait.resolve(mutation(item({completed:true,completed_by:A,completed_at:'2026-11-02T11:00:00Z',revision:2})));assert.equal(await completing,true);assert.equal(h.records.length,1);assert.equal(h.records[0].entry.quantity,1);assert.equal(h.records[0].pin.actor,A);assert.equal(h.records[0].pin.household_id,H);assert.equal(h.client.snapshot().pendingCompletions.length,0);
});
test('a local purchase-save failure remains retryable without another remote completion',async()=>{
 const h=fixture();await h.load([item()]);h.recordResult=false;h.replies.push(mutation(item({completed:true,completed_by:A,revision:2})));assert.equal(await h.client.complete(ID),false);assert.equal(h.client.snapshot().pendingCompletions[0].serverAck,true);assert.match(h.client.snapshot().notice,/saved online/);h.recordResult=true;assert.equal(await h.client.retry(ID),true);assert.equal(h.calls.filter(row=>row.init.method==='POST').length,1);assert.equal(h.client.snapshot().pendingCompletions.length,0);
});
test('a lost completion response is recovered from the confirmed shared record',async()=>{
 const h=fixture();await h.load([item()]);h.replies.push(()=>Promise.reject(Error('network')));assert.equal(await h.client.complete(ID),false);assert.equal(h.records.length,0);h.replies.push(status(),listing([item({completed:true,completed_by:A,revision:2})]));await h.client.refresh({force:true});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.records.length,1);assert.equal(h.client.snapshot().pendingCompletions.length,0);
});
test('another member completing first never becomes a second local purchase',async()=>{
 const h=fixture();await h.load([item()]);h.replies.push(mutation(item({completed:true,completed_by:B,revision:2})));assert.equal(await h.client.complete(ID),true);assert.equal(h.records.length,0);assert.equal(h.client.snapshot().pendingCompletions.length,0);assert.match(h.client.snapshot().notice,/another household member/);
});
test('storage failure before an add leaves the remote household untouched',async()=>{
 const h=fixture();await h.load();h.options.storage.setItem=()=>{throw Error('full');};assert.equal(await h.client.add({name:'Milk',quantity:1,unit:'l'}),false);assert.equal(h.calls.filter(row=>row.init.method==='POST').length,0);assert.match(h.client.snapshot().notice,/Nothing was added online/);
});
test('foreign household rows and malformed attribution responses are not adopted',async()=>{
 const h=fixture();h.replies.push(status(),listing([item({household_id:H2})]));assert.equal(await h.client.refresh(),false);assert.deepEqual(h.client.snapshot().items,[]);
 assert.equal(validItem(item({created_by:'not-an-authenticated-user'})),false);assert.equal(creatorLabel(item({created_by:null,added_by_name:null})),'Former household member');
});
test('a revision conflict keeps the checkbox unconfirmed and cannot credit stock',async()=>{
 const h=fixture();await h.load([item()]);h.replies.push(response({ok:false,conflict:true,household_id:H,item:item({revision:2})},409),status(),listing([item({revision:2})]));assert.equal(await h.client.complete(ID),false);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.records.length,0);assert.equal(h.client.snapshot().items[0].completed,false);
});

test('an explicit At home count can acknowledge known completed revisions without trusting device clocks',async()=>{
 const h=fixture();await h.load([item()]);h.recordResult=false;const done=item({completed:true,completed_by:A,completed_at:'2026-11-02T11:00:00Z',revision:2});h.replies.push(mutation(done));assert.equal(await h.client.complete(ID),false);assert.equal(h.client.knownCompletedItems()[0].revision,2);
 const cold=create(h.options);assert.equal(cold.knownCompletedItems()[0].revision,2,'the server-acknowledged revision survives a cold restart before household refresh');h.session=session(B,'synthetic-b');assert.deepEqual(cold.knownCompletedItems(),[],'another account cannot acknowledge the first member purchase');
});
