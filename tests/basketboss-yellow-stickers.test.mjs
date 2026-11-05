import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),api=require('../bb-yellow-stickers.js'),ui=require('../bb-yellow-stickers-ui.js');

test('all supplied chains have regional estimates without inventing a US or unsupported chain schedule',()=>{
 for(const region of ['UK','Guernsey','Jersey'])for(const store of api.regions[region]){
  const rows=api.windows(region,store,Date.parse('2026-11-05T12:00:00Z'));
  assert.ok(rows.length>0);assert.ok(rows.every(row=>row.estimated&&row.timeZone==='Europe/London'&&row.endAt>row.startAt));
 }
 assert.equal(api.resolveStore('US','Waitrose'),null);assert.deepEqual(api.windows('US','Aldi'),[]);
 assert.equal(api.resolveStore('UK','Channel Islands Coop'),null);assert.equal(api.resolveStore('UK','Co-op'),null);assert.equal(api.resolveStore('Guernsey','Tesco'),null);
 assert.equal(api.resolveStore('UK','Ocado'),null);assert.equal(api.resolveStore('__proto__','Waitrose'),null);
});

test('store aliases and branch labels resolve to the existing regional chain identity',()=>{
 for(const [region,name,id]of [['Guernsey','Waitrose - Rohais','waitrose'],['Guernsey','Waitrose & Partners - Admiral Park','waitrose'],['Jersey','Waitrose - St Hélier','waitrose'],['Jersey','Channel Islands Coop','ci-coop'],['Jersey','Grand Marché','ci-coop'],['Guernsey','Locale','ci-coop'],['Guernsey','M&S Food','marks-spencer'],['Jersey','SandpiperCI','morrisons-daily'],['UK',"Sainsbury's",'sainsburys']])assert.equal(api.resolveStore(region,name)?.id,id,name);
});

test('baseline windows retain the requested times and Sunday variation',()=>{
 const weekday=Date.parse('2026-11-05T12:00:00Z'),sunday=Date.parse('2026-11-08T12:00:00Z'),times=(region,store,date=weekday)=>api.windows(region,store,date).map(row=>[row.start,row.end]);
 assert.deepEqual(times('UK','waitrose'),[['10:00','11:30'],['17:30','18:30']]);
 assert.deepEqual(times('Jersey','waitrose',sunday),[['10:00','11:30'],['15:00','15:45']]);
 assert.deepEqual(times('Guernsey','ci-coop'),[['08:30','09:30'],['17:00','18:30']]);
 assert.match(api.windows('Guernsey','ci-coop',sunday)[1].note,/may be earlier/);
 assert.deepEqual(times('UK','marks-spencer'),[['12:30','13:30'],['16:30','17:30']]);
 assert.deepEqual(times('Jersey','alliance'),[['09:00','10:30'],['16:00','17:30']]);
 assert.deepEqual(times('Guernsey','morrisons-daily'),[['17:00','18:30']]);
 assert.deepEqual(times('Jersey','iceland'),[['09:00','10:30'],['17:00','18:00']]);
 assert.deepEqual(times('UK','tesco'),[['08:00','10:00'],['13:00','15:00'],['18:00','19:30']]);
 assert.deepEqual(times('UK','aldi'),[['07:30','08:30'],['16:00','17:30']]);
 assert.deepEqual(times('UK','lidl',sunday),[['07:30','08:30'],['14:30','15:30']]);
});

test('local next/active windows handle UK daylight saving, Sunday overlap, midnight and end boundaries',()=>{
 const summer=api.nextWindow({region:'UK',store:'waitrose',now:Date.parse('2026-07-13T16:45:00Z')});
 assert.equal(summer.active,true);assert.equal(new Date(summer.startAt).toISOString(),'2026-07-13T16:30:00.000Z');
 const spring=api.nextWindow({region:'Jersey',store:'waitrose',now:Date.parse('2026-03-29T14:05:00Z')});assert.equal(spring.active,true);assert.equal(spring.start,'15:00');
 const autumn=api.nextWindow({region:'Guernsey',store:'waitrose',now:Date.parse('2026-10-25T15:05:00Z')});assert.equal(autumn.active,true);assert.equal(autumn.start,'15:00');
 const overlap=api.nextWindow({region:'UK',store:'tesco',now:Date.parse('2026-11-08T14:45:00Z')});assert.equal(overlap.label,'Final clearance');
 const ended=api.nextWindow({region:'UK',store:'waitrose',now:Date.parse('2026-11-05T18:30:00Z')});assert.equal(ended.active,false);assert.equal(ended.tomorrow,true);assert.match(api.typicalLabel(ended),/typically.*tomorrow/);
 assert.equal(api.nextWindow({region:'UK',store:'waitrose',now:NaN}),null);
 assert.equal(api.localDate('2026-07-13T23:30:00Z'),'2026-07-14');
});

test('sightings expire at exactly 90 minutes and never turn a local fallback into a crowd claim',()=>{
 const now=Date.parse('2026-11-05T17:45:00Z');assert.match(api.sightingLabel(now-60000,{now}),/Live:.*1 min ago/);
 assert.match(api.sightingLabel(now,{now,local:true}),/^On this device:.*just now/);
 assert.equal(api.sightingLabel(now-api.TTL,{now}),'');assert.equal(api.sightingLabel(now+60000,{now}),'');assert.equal(api.sightingLabel('bad',{now}),'');
});

function fixture(settings={}){
 const values=new Map(),calls=[];let at=Date.parse('2026-11-05T17:45:00Z'),premium=true,offline=false,blocked=false;
 const context={region:'UK',retailer:'Waitrose & Partners',actor:'tester-actor'};
 let sequence=0,handler=async(_url,request)=>({ok:true,status:200,json:async()=>({ok:true,region:context.region,store:api.resolveStore(context.region,context.retailer).id,lastSpottedAt:request.method==='POST'&&JSON.parse(request.body).status==='spotted'?new Date(at).toISOString():null,latestNotYetAt:null})});
 const options={api,now:()=>at,storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))},getContext:()=>({...context}),isPremium:()=>premium,isBlocked:()=>blocked,isOffline:()=>offline,getSession:async()=>({user:{id:context.actor},access_token:'synthetic-token'}),uuid:()=> 'test-report-'+(++sequence),fetch:async(url,request)=>{calls.push({url,request});return handler(url,request);},...settings};
 const controller=ui.createController(options);
 return {controller,values,calls,context,get at(){return at;},advance:delta=>{at+=delta;},setPremium:value=>{premium=value;},setOffline:value=>{offline=value;},setBlocked:value=>{blocked=value;},setHandler:value=>{handler=value;}};
}

test('verified Premium can share one sighting and authenticated reads retain only matching remote context',async()=>{
 const f=fixture();await f.controller.refresh();assert.equal(f.calls[0].request.headers.Authorization,'Bearer synthetic-token');assert.match(f.calls[0].url,/region=UK&store=waitrose/);
 const result=await f.controller.report('spotted');assert.equal(result.shared,true);assert.match(f.controller.snapshot().label,/Live:.*just now/);
 const body=JSON.parse(f.calls[1].request.body);assert.deepEqual(body,{region:'UK',store:'waitrose',status:'spotted',requestId:'test-report-1'});
 f.advance(api.TTL);assert.match(f.controller.snapshot().label,/typically/);assert.equal(f.controller.snapshot().live,false);
});

test('free accounts only receive a locked teaser and cannot fetch, report, receipt-ping or save local state',async()=>{
 const f=fixture();f.setPremium(false);assert.equal(f.controller.snapshot().locked,true);assert.equal(f.controller.snapshot().label,'🏷️ Yellow sticker helper · Premium');
 await f.controller.refresh();assert.equal((await f.controller.report('spotted')).locked,true);
 await f.controller.reportReceipt({receiptId:'receipt-1',region:'UK',retailer:'Waitrose',source:'receipt',reduced:true,purchasedAt:'2026-11-05',confirmedAt:f.at});
 assert.equal(f.calls.length,0);assert.equal(f.values.size,0);
});

test('offline observations are explicit on-device only and cannot be reported twice during the cooldown',async()=>{
 const f=fixture();f.setOffline(true);assert.equal((await f.controller.report('spotted')).local,true);
 assert.match(f.controller.snapshot().label,/^On this device:/);assert.equal(f.controller.snapshot().live,false);assert.equal(f.calls.length,0);
 assert.equal((await f.controller.report('not_yet')).cooldown,true);assert.equal(f.values.size,1);
 f.advance(api.TTL);assert.match(f.controller.snapshot().label,/typically/);
});

test('an explicit server rejection never becomes a local bypass or a fake Live report',async()=>{
 for(const status of [400,401,403,429]){
  const f=fixture();f.setHandler(async()=>({ok:false,status,json:async()=>({ok:false,error:status===403?'yellow_sticker_premium_required':'rejected'})}));
  const result=await f.controller.report('spotted');assert.equal(result.ok,false);assert.equal(f.values.size,0);assert.equal(f.controller.snapshot().live,false);
  if(status===403){assert.equal(f.controller.snapshot().locked,true);await f.controller.refresh();await f.controller.report('spotted');assert.equal(f.calls.length,1);}
 }
 const f=fixture();f.setHandler(async()=>({ok:false,status:503,json:async()=>({ok:false})}));assert.equal((await f.controller.report('spotted')).local,true);assert.match(f.controller.snapshot().label,/^On this device:/);
});

test('a rejected Premium read locks the feature and prevents subsequent requests',async()=>{
 const f=fixture();f.setHandler(async()=>({ok:false,status:403,json:async()=>({ok:false,error:'yellow_sticker_premium_required'})}));
 await f.controller.refresh();assert.equal(f.controller.snapshot().locked,true);await f.controller.refresh({force:true});assert.equal((await f.controller.report('spotted')).locked,true);assert.equal(f.calls.length,1);assert.equal(f.values.size,0);
});

test('Not yet keeps an earlier positive report until it expires, and malformed/mismatched responses cannot claim live',async()=>{
 const f=fixture();f.setHandler(async()=>({ok:true,status:200,json:async()=>({ok:true,region:'UK',store:'waitrose',lastSpottedAt:new Date(f.at-60000).toISOString(),latestNotYetAt:new Date(f.at).toISOString()})}));
 await f.controller.report('not_yet');assert.equal(f.controller.snapshot().live,true);assert.match(f.controller.snapshot().label,/1 min ago/);
 for(const bad of [{region:'Jersey',store:'waitrose',lastSpottedAt:new Date(f.at).toISOString()},{region:'UK',store:'tesco',lastSpottedAt:new Date(f.at).toISOString()},{region:'UK',store:'waitrose',lastSpottedAt:'invalid'}]){
  const next=fixture();next.setHandler(async()=>({ok:true,status:200,json:async()=>({ok:true,...bad})}));await next.controller.refresh();assert.equal(next.controller.snapshot().live,false);
 }
});

test('account, region, store and Premium changes invalidate an in-flight report before any local save',async()=>{
 for(const mutate of [f=>{f.context.actor='other-actor';},f=>{f.context.region='Jersey';},f=>{f.context.retailer='Tesco';},f=>{f.setPremium(false);},f=>{f.setBlocked(true);}]){
  const f=fixture();let release;f.setHandler(()=>new Promise(resolve=>{release=()=>resolve({ok:false,status:503,json:async()=>({ok:false})});}));
  const pending=f.controller.report('spotted');await new Promise(resolve=>setImmediate(resolve));mutate(f);release();assert.equal((await pending).ignored,true);assert.equal(f.values.size,0);
 }
});

test('simultaneous taps share a loading lock and only one report is posted',async()=>{
 const f=fixture();let release;f.setHandler(()=>new Promise(resolve=>{release=()=>resolve({ok:true,status:200,json:async()=>({ok:true,region:'UK',store:'waitrose',lastSpottedAt:new Date(f.at).toISOString()})});}));
 const first=f.controller.report('spotted'),second=await f.controller.report('spotted');assert.equal(second.busy,true);await new Promise(resolve=>setImmediate(resolve));release();await first;assert.equal(f.calls.length,1);
});

test('fresh reduced receipt pings are stable and deduplicated after their live status expires',async()=>{
 const f=fixture(),packet={receiptId:'receipt-123',region:'UK',retailer:'Waitrose & Partners',reduced:true,source:'receipt',purchasedAt:'2026-11-05',confirmedAt:f.at};
 assert.equal((await f.controller.reportReceipt(packet)).shared,true);assert.equal(JSON.parse(f.calls[0].request.body).requestId,'receipt:receipt-123');
 f.advance(api.TTL);assert.equal((await f.controller.reportReceipt({...packet,confirmedAt:f.at})).duplicate,true);assert.equal(f.calls.length,1);
});

test('historic, unconfirmed, ordinary promotion and wrong-store receipts never create fresh sightings',async()=>{
 const f=fixture(),packet={receiptId:'receipt-123',region:'UK',retailer:'Waitrose',reduced:true,source:'receipt',purchasedAt:'2026-11-05',confirmedAt:f.at};
 for(const changes of [{purchasedAt:'2026-11-04'},{purchasedAt:'2026-11-05T08:00:00Z'},{confirmedAt:f.at-api.TTL},{confirmedAt:undefined},{reduced:false},{source:'scan'},{retailer:'Tesco'},{region:'Jersey'}])assert.equal((await f.controller.reportReceipt({...packet,...changes})).ignored,true);
 assert.equal(f.calls.length,0);assert.equal(f.values.size,0);
});

test('a late read cannot erase a more recent successful sighting',async()=>{
 const f=fixture();let release;
 f.setHandler(async(_url,request)=>request.method==='GET'?new Promise(resolve=>{release=()=>resolve({ok:true,status:200,json:async()=>({ok:true,region:'UK',store:'waitrose',lastSpottedAt:null})});}):{ok:true,status:200,json:async()=>({ok:true,region:'UK',store:'waitrose',lastSpottedAt:new Date(f.at).toISOString()})});
 const read=f.controller.refresh();await new Promise(resolve=>setImmediate(resolve));await f.controller.report('spotted');release();await read;assert.equal(f.controller.snapshot().live,true);
});
