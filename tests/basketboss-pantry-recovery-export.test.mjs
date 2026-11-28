import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{collect}=require('../release-assets/export-pantry-recovery.js');
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const AUTH='basketboss_cloud_session_v1',STOCK='basketboss_321_v7_measured_pantry',KITCHEN='basketboss_makeameal_v1_inventory';
function fixture(extra={}){const values=new Map(Object.entries({[AUTH]:JSON.stringify({user:{id:ACTOR},access_token:'must-never-export',refresh_token:'must-never-export-refresh'}),[STOCK]:'{}',[KITCHEN]:'{}',...extra}));return {values,storage:{get length(){return values.size;},key:index=>[...values.keys()][index],getItem:key=>values.get(key)??null,setItem(){throw Error('export must never write');},removeItem(){throw Error('export must never remove');}}};}
test('exports the affected actor’s physical scope recovery copies without session or receipt accounting',()=>{
 const key='basketboss_pantry_scope_backup_v1:'+ACTOR+':user:'+ACTOR+':123:1';
 const stock={'pasta|g':500},kitchen={'cupboard|pasta':{name:'Pasta',loc:'cupboard',qty:500,unit:'g',selected:true}};
 const f=fixture({[key]:JSON.stringify({actorId:ACTOR,createdAt:123,pantry:{actorId:ACTOR,values:{[STOCK]:stock,[KITCHEN]:kitchen,basketboss_purchase_receipts_v1:{secretLedger:'not-a-recovery-write'}}}})});
 const before=[...f.values],result=collect(f.storage),copy=result.copies.find(row=>row.source===key);
 assert.equal(result.ok,true);assert.equal(copy.stockItems,1);assert.equal(copy.kitchenItems,1);assert.deepEqual(copy.values[STOCK],stock);assert.deepEqual(copy.values[KITCHEN],kitchen);
 assert.deepEqual([...f.values],before);assert.doesNotMatch(JSON.stringify(result),/must-never-export|secretLedger|access_token|refresh_token/);
});
test('excludes other actors, unassociated premerge copies and guest history not claimed by this actor',()=>{
 const f=fixture({['basketboss_pantry_scope_backup_v1:'+OTHER+':1']:JSON.stringify({actorId:OTHER,pantry:{actorId:OTHER,values:{[STOCK]:{'private|each':1}}}}),bb_partner_premerge_12:JSON.stringify({[STOCK]:'{"private|each":1}'}),'basketboss_receipt_host_snapshot_v1:guest':JSON.stringify({actorId:'guest',claimedBy:OTHER,claimedValues:{[STOCK]:'{"private|each":1}'}})});
 assert.deepEqual(collect(f.storage).copies.map(row=>row.source),['current-pantry']);
});
test('finds actor-pinned legacy premerge and raw actor archives, retaining raw saved quantities',()=>{
 const f=fixture({bb_partner_premerge_123:JSON.stringify({['bb_partner_baseline_v1_house_'+ACTOR]:'{}',[STOCK]:'{"pasta|g":500}'}),['basketboss_receipt_host_snapshot_v1:'+ACTOR]:JSON.stringify({actorId:ACTOR,values:{[STOCK]:'{"milk|ml":250}',[KITCHEN]:'{}'}})});
 const result=collect(f.storage);assert.equal(result.copies.length,3);assert.equal(result.copies[1].values[STOCK]['pasta|g'],500);assert.equal(result.copies[2].values[STOCK]['milk|ml'],250);
});
test('unreadable backups are reported rather than treated as empty or modified',()=>{
 const key='basketboss_pantry_scope_backup_v1:'+ACTOR+':broken',f=fixture({[key]:'broken-json'}),before=[...f.values];
 const result=collect(f.storage);assert.deepEqual(result.unreadable,[key]);assert.deepEqual([...f.values],before);
});
test('requires the signed-in actor and makes no network requests',()=>{
 const f=fixture({[AUTH]:'null'});assert.equal(collect(f.storage).ok,false);
 const good=fixture();const prior=globalThis.fetch;globalThis.fetch=()=>{throw Error('recovery must not contact any server');};
 try{assert.equal(collect(good.storage).ok,true);}finally{globalThis.fetch=prior;}
});
