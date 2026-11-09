import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../bb-reduced-purchases.js',import.meta.url),'utf8');
function harness(initialZone='America/New_York'){
 let zone=initialZone,constructions=0,zoneReads=0;
 function DateTimeFormat(locale,options){
  if(!options){zoneReads++;return {resolvedOptions:()=>({timeZone:zone})};}
  constructions++;return new Intl.DateTimeFormat(locale,options);
 }
 const context=vm.createContext({Intl:{DateTimeFormat},module:{exports:{}}});
 vm.runInContext(source,context);
 return {api:context.module.exports,setZone:value=>{zone=value;},get constructions(){return constructions;},get zoneReads(){return zoneReads;}};
}
function baseline(at,timeZone){
 const date=new Date(at);if(!Number.isFinite(date.getTime()))return null;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),get=key=>parts.find(part=>part.type===key)?.value;
 const day=new Date(get('year')+'-'+get('month')+'-'+get('day')+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);
}

test('UK and island week boundaries preserve the London calendar across both DST changes',()=>{
 const h=harness(),cases=[
  ['2026-03-29T00:30:00Z','2026-03-23'],['2026-03-29T01:30:00Z','2026-03-23'],
  ['2026-03-29T22:59:59Z','2026-03-23'],['2026-03-29T23:00:00Z','2026-03-30'],
  ['2026-10-25T00:30:00Z','2026-10-19'],['2026-10-25T01:30:00Z','2026-10-19'],
  ['2026-10-25T23:59:59Z','2026-10-19'],['2026-10-26T00:00:00Z','2026-10-26']
 ];
 for(const market of ['UK','Jersey','Guernsey',undefined])for(const [at,expected]of cases)assert.equal(h.api.week(at,market),expected,market+': '+at);
 assert.equal(h.constructions,1,'only the formatter is reused across dates and markets');assert.equal(h.zoneReads,0);
});

test('US weeks retain local Mondays across spring and autumn DST transitions',()=>{
 const h=harness(),cases=[
  ['2026-03-08T06:59:59Z','2026-03-02'],['2026-03-08T07:00:00Z','2026-03-02'],
  ['2026-03-09T03:59:59Z','2026-03-02'],['2026-03-09T04:00:00Z','2026-03-09'],
  ['2026-11-01T05:59:59Z','2026-10-26'],['2026-11-01T06:00:00Z','2026-10-26'],
  ['2026-11-02T04:59:59Z','2026-10-26'],['2026-11-02T05:00:00Z','2026-11-02']
 ];
 for(const [at,expected]of cases)assert.equal(h.api.week(at,'US'),expected,at);
 assert.equal(h.constructions,1);assert.equal(h.zoneReads,cases.length,'current US device zone is read every time');
});

test('a device time-zone change changes the next week calculation immediately',()=>{
 const h=harness(),at='2026-11-09T06:00:00Z';
 assert.equal(h.api.week(at,'US'),'2026-11-09');
 h.setZone('America/Los_Angeles');assert.equal(h.api.week(at,'US'),'2026-11-02');
 h.setZone('America/New_York');assert.equal(h.api.week(at,'US'),'2026-11-09');
 assert.equal(h.constructions,2,'returning to a zone reuses its formatter, not its old week result');assert.equal(h.zoneReads,3);
});

test('formatter reuse matches the original calculation across time zones and dates',()=>{
 const h=harness(),zones=['Europe/London','America/New_York','America/Los_Angeles','America/Phoenix','Pacific/Honolulu','Pacific/Guam','Europe/Paris','Australia/Sydney'];
 const dates=['2026-01-01T00:01:00Z','2026-03-29T23:00:00Z','2026-07-05T23:59:59Z','2026-10-25T01:30:00Z','2026-11-09T06:00:00Z','2026-12-31T23:59:59Z'];
 for(const zone of zones){h.setZone(zone);for(const at of dates)assert.equal(h.api.week(at,'US'),baseline(at,zone),zone+': '+at);}
 assert.equal(h.constructions,zones.length);
});

test('the formatter cache is bounded while retained zones remain reusable',()=>{
 const h=harness(),zones=['Europe/London','America/New_York','America/Los_Angeles','America/Denver','America/Chicago','America/Phoenix','America/Anchorage','Pacific/Honolulu','Pacific/Guam','Asia/Tokyo','Europe/Paris','Australia/Sydney'],at='2026-11-09T06:00:00Z';
 for(const zone of zones){h.setZone(zone);assert.equal(h.api.week(at,'US'),baseline(at,zone));}
 assert.equal(h.constructions,12);
 for(const zone of zones.slice(-8)){h.setZone(zone);assert.equal(h.api.week(at,'US'),baseline(at,zone));}
 assert.equal(h.constructions,12,'the last eight zone formatters are retained');
 h.setZone(zones[0]);h.api.week(at,'US');assert.equal(h.constructions,13,'older formatter is evicted instead of retaining unlimited zones');
});

test('invalid dates and unsupported zones preserve failure behavior without poisoning existing formatters',()=>{
 const h=harness();
 for(const at of ['invalid',NaN,Infinity])assert.equal(h.api.week(at,'US'),null);
 assert.equal(h.zoneReads,0);assert.equal(h.constructions,0);
 const at='2026-11-09T06:00:00Z';assert.equal(h.api.week(at,'US'),'2026-11-09');
 h.setZone('Invalid/Timezone');assert.throws(()=>h.api.week(at,'US'),/time zone/i);
 h.setZone('America/New_York');assert.equal(h.api.week(at,'US'),'2026-11-09');assert.equal(h.constructions,2);
});
