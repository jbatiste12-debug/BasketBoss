import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sendHouseholdInviteEmail,HOUSEHOLD_INVITE_ENTRY_URL} from '../bb-server-lib/bb-household-email.js';

const OWNER='11111111-1111-4111-8111-111111111111',HOUSE='22222222-2222-4222-8222-222222222222';
const INVITE='33333333-3333-4333-8333-333333333333',OTHER='44444444-4444-4444-8444-444444444444';
const NOW=Date.parse('2026-11-20T12:15:00.000Z'),EMAIL='partner@example.test';
const ready=extra=>({BB_HOUSEHOLD_INVITE_EMAIL_ENABLED:'true',RESEND_API_KEY:'re_local_test_not_a_real_key',BB_HOUSEHOLD_INVITE_EMAIL_FROM:'BasketBoss <invite@example.test>',...extra});
const record=()=>({household:{id:HOUSE,owner_user_id:OWNER,partner_user_id:null,partner_email:EMAIL,invite_status:'pending'},invite:{id:INVITE,household_id:HOUSE,partner_email:EMAIL,status:'pending',accepted_by:null,expires_at:'2026-11-27T12:15:00.000Z'}});
const input=extra=>({ownerId:OWNER,recipient:EMAIL,householdId:HOUSE,readPending:async()=>record(),...extra});
const reply=(body,status=200)=>Response.json(body,{status});
const blocked=async()=>{throw Error('Unexpected outbound request in test');};

test('optional delivery is closed unless every server setting is explicit and valid',async()=>{
 for(const config of [undefined,false,'false','TRUE','1',true]){
  let reads=0;
  const result=await sendHouseholdInviteEmail(ready({BB_HOUSEHOLD_INVITE_EMAIL_ENABLED:config}),input({readPending:async()=>{reads++;return record();}}),{fetcher:blocked,now:()=>NOW});
  assert.equal(result.email_status,'not_configured');assert.equal(result.email_available,false);assert.equal(result.email_sent,false);assert.equal(reads,0);
 }
 for(const extra of [{RESEND_API_KEY:''},{BB_HOUSEHOLD_INVITE_EMAIL_FROM:''},{BB_HOUSEHOLD_INVITE_EMAIL_FROM:'sender@example.test\r\nBcc: outsider@example.test'},{BB_HOUSEHOLD_INVITE_EMAIL_FROM:'bad address'}]){
  const result=await sendHouseholdInviteEmail(ready(extra),input(),{fetcher:blocked,now:()=>NOW});assert.equal(result.email_status,'not_configured');
 }
});

test('expired, revoked, accepted or foreign-scope readbacks cannot send an invitation email',async()=>{
 const mutations=[r=>r.household.owner_user_id=OTHER,r=>r.household.id=OTHER,r=>r.household.partner_user_id=OTHER,r=>r.household.invite_status='accepted',r=>r.household.partner_email='other@example.test',r=>r.invite.household_id=OTHER,r=>r.invite.partner_email='other@example.test',r=>r.invite.status='revoked',r=>r.invite.accepted_by=OTHER,r=>r.invite.expires_at=new Date(NOW).toISOString(),r=>r.invite.id='invalid'];
 for(const mutate of mutations){
  const saved=record();mutate(saved);
  const result=await sendHouseholdInviteEmail(ready(),input({readPending:async()=>saved}),{fetcher:blocked,now:()=>NOW});
  assert.equal(result.email_status,'not_sent');assert.equal(result.email_sent,false);assert.equal(result.invite_url,undefined);
 }
 for(const extra of [{ownerId:'browser-claim'},{householdId:'other-household'},{recipient:'OTHER@example.test'},{recipient:'a@example.test\nBcc:b@example.test'}]){
  assert.equal((await sendHouseholdInviteEmail(ready(),input(extra),{fetcher:blocked,now:()=>NOW})).email_status,'not_sent');
 }
});

test('verified pending invite sends only a plain entry link and distinguishes acceptance from delivery',async()=>{
 let sent;
 const result=await sendHouseholdInviteEmail(ready(),input(),{now:()=>NOW,fetcher:async(url,init)=>{sent={url,init,body:JSON.parse(init.body)};return reply({id:INVITE});}});
 assert.equal(sent.url,'https://api.resend.com/emails');assert.equal(sent.init.method,'POST');assert.equal(sent.init.redirect,'manual');assert.ok(sent.init.signal instanceof AbortSignal);
 assert.deepEqual(sent.body.to,[EMAIL]);assert.equal(sent.init.headers.Authorization,'Bearer '+ready().RESEND_API_KEY);
 assert.match(sent.init.headers['Idempotency-Key'],/^bb-household-invite\/[a-f0-9]{64}$/);
 assert.doesNotMatch(sent.init.headers['Idempotency-Key'],new RegExp(OWNER+'|'+EMAIL));
 assert.ok(sent.body.text.includes(HOUSEHOLD_INVITE_ENTRY_URL));assert.match(sent.body.text,/confirmed email|confirmed email address/);
 assert.doesNotMatch(sent.body.text,/token=|access_token|invite_id=|household_id=/);
 assert.equal(result.email_available,true);assert.equal(result.email_sent,true);assert.equal(result.email_status,'accepted');
 assert.equal(result.invite_url,HOUSEHOLD_INVITE_ENTRY_URL);assert.equal(result.invite_expires_at,record().invite.expires_at);
 assert.match(result.message,/accepted for sending/);assert.match(result.message,/Delivery is not yet confirmed/);assert.equal(result.id,undefined);
});

// Model the documented Resend idempotency contract, not a process-local quota.
function provider(){
 const requests=[],stored=new Map();let sends=0;
 return {requests,get sends(){return sends;},fetcher:async(url,init)=>{
  const key=init.headers['Idempotency-Key'];requests.push({key,body:init.body});
  const previous=stored.get(key);
  if(previous)return previous.body!==init.body?reply({name:'invalid_idempotent_request'},409):reply({id:INVITE});
  stored.set(key,{body:init.body});sends++;await Promise.resolve();return reply({id:INVITE});
 }};
}

test('concurrent calls and saved invite revisions use one owner/hour key and one provider email',async()=>{
 const p=provider();
 const results=await Promise.all(Array.from({length:12},()=>sendHouseholdInviteEmail(ready(),input(),{fetcher:p.fetcher,now:()=>NOW})));
 assert.equal(p.sends,1);assert.ok(results.every(value=>value.email_status==='accepted'));
 assert.equal(new Set(p.requests.map(row=>row.key)).size,1);assert.equal(new Set(p.requests.map(row=>row.body)).size,1);
 const changed=record();changed.invite.id=OTHER;changed.invite.expires_at='2026-11-27T12:30:00.000Z';
 await sendHouseholdInviteEmail(ready(),input({readPending:async()=>changed}),{fetcher:p.fetcher,now:()=>NOW+600000});assert.equal(p.sends,1,'a renewed invite does not bypass the hourly send cap');
});

test('changed recipient cannot bypass an owner hourly send cap; a new owner or next hour has its own slot',async()=>{
 const p=provider();await sendHouseholdInviteEmail(ready(),input(),{fetcher:p.fetcher,now:()=>NOW});
 const saved=record();saved.household.partner_email=saved.invite.partner_email='other@example.test';
 const limited=await sendHouseholdInviteEmail(ready(),input({recipient:'other@example.test',readPending:async()=>saved}),{fetcher:p.fetcher,now:()=>NOW+1000});
 assert.equal(limited.email_status,'rate_limited');assert.equal(limited.email_sent,false);assert.ok(limited.retry_after_seconds>0&&limited.retry_after_seconds<=3600);assert.equal(p.sends,1);
 await sendHouseholdInviteEmail(ready(),input(),{fetcher:p.fetcher,now:()=>NOW+3600000});assert.equal(p.sends,2);
 const different=record();different.household.owner_user_id=OTHER;
 await sendHouseholdInviteEmail(ready(),input({ownerId:OTHER,readPending:async()=>different}),{fetcher:p.fetcher,now:()=>NOW});assert.equal(p.sends,3);
});

test('provider concurrency conflict, failures, redirects, malformed responses and timeouts never claim delivery',async()=>{
 const failures=[async()=>reply({name:'concurrent_idempotent_requests'},409),async()=>reply({name:'validation_error'},403),async()=>reply({},429),async()=>reply({id:INVITE},302),async()=>reply({}),async()=>{throw Error('network timeout with private provider detail');}];
 for(const fetcher of failures){
  const result=await sendHouseholdInviteEmail(ready(),input(),{fetcher,now:()=>NOW});
  assert.equal(result.email_sent,false);assert.ok(['unavailable','rate_limited'].includes(result.email_status));assert.match(result.message,/Invite saved/);assert.doesNotMatch(JSON.stringify(result),/private provider|re_local_test/);
 }
 const unavailable=await sendHouseholdInviteEmail(ready(),input({readPending:async()=>{throw Error('database unavailable');}}),{fetcher:blocked,now:()=>NOW});assert.equal(unavailable.email_status,'unavailable');
});

const ORIGIN='https://basketboss.co.uk';
let actor={id:OWNER,email:'owner@example.test'},paid=true,newest=true;
globalThis.__bbInviteEmailFixture={json:reply,authenticatedUser:async()=>actor,isLive:()=>true,expectedPrice:()=>true,entitlementForStatus:()=>true,requireSameOrigin:r=>r.headers.get('Origin')===ORIGIN,livePaidBillingEnabled:()=>true,testFlightBetaEnabled:()=>false,readPersonalPaidAccess:async()=>({premiumAccess:paid}),isNewestVerifiedSession:async()=>newest};
const apiSource=fs.readFileSync(new URL('../functions/api/household/index.js',import.meta.url),'utf8')
 .replace(/import \{([^\n]+)\} from '\.\.\/\.\.\/\.\.\/bb-server-lib\/(?:bb-paid-access|bb-billing|bb-premium-seat)\.js';/g,'const {$1}=globalThis.__bbInviteEmailFixture;')
 .replace('../../../bb-server-lib/bb-household-email.js',new URL('../bb-server-lib/bb-household-email.js',import.meta.url).href);
const api=await import('data:text/javascript;base64,'+Buffer.from(apiSource.replace('../../../bb-server-lib/bb-household-auto-sync.js',new URL('../bb-server-lib/bb-household-auto-sync.js',import.meta.url).href).replace('../receipt-inventory.js',new URL('../functions/api/receipt-inventory.js',import.meta.url).href)).toString('base64'));
const serverEnv=extra=>({CF_PAGES_BRANCH:'main',BB_PARTNER_SHARING_ENABLED:'true',BB_PARTNER_PRODUCTION_READY:'true',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',SUPABASE_URL:'https://kbhyosxuvlcazyzzinqv.supabase.co',SUPABASE_PUBLISHABLE_KEY:'publishable_'+'x'.repeat(30),SUPABASE_SECRET_KEY:'sb_secret_'+'x'.repeat(40),BILLING_DB:{prepare(){}},...extra});
const request=(extra={},origin=ORIGIN)=>new Request(ORIGIN+'/api/household',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'invite',email:EMAIL,...extra})});
function serverFixture(){
 const original=globalThis.fetch,calls=[];actor={id:OWNER,email:'owner@example.test'};paid=true;newest=true;
 globalThis.fetch=async(url,init={})=>{
  const address=new URL(url),body=init.body?JSON.parse(init.body):null;calls.push({address,body});
  if(address.hostname==='api.resend.com')return reply({id:INVITE});
  if(address.pathname.endsWith('/rpc/bb_hh_service_invite'))return reply({household_id:HOUSE,status:'pending',partner_email:EMAIL});
  if(address.pathname.endsWith('/bb_household_invites'))return reply([{...record().invite,expires_at:new Date(Date.now()+86400000).toISOString()}]);
  if(address.pathname.endsWith('/bb_households'))return reply(address.searchParams.has('id')?[record().household]:[]);
  throw Error('Unexpected request in server fixture');
 };
 return {calls,restore(){globalThis.fetch=original;}};
}

test('API email uses verified actor and exact saved household, ignoring all client delivery/identity claims',async()=>{
 const f=serverFixture();try{
  const response=await api.onRequestPost({request:request({ownerId:OTHER,household_id:OTHER,invite_url:'https://evil.example',email_sent:true}),env:serverEnv(ready())});
  assert.equal(response.status,200);assert.equal((await response.json()).email_status,'accepted');
  const rpc=f.calls.find(row=>row.address.pathname.endsWith('/rpc/bb_hh_service_invite'));assert.deepEqual(rpc.body,{p_owner:OWNER,p_email:EMAIL});
  const read=f.calls.find(row=>row.address.pathname.endsWith('/bb_households')&&row.address.searchParams.has('id'));assert.equal(read.address.searchParams.get('id'),'eq.'+HOUSE);assert.equal(read.address.searchParams.get('owner_user_id'),'eq.'+OWNER);
  const sent=f.calls.find(row=>row.address.hostname==='api.resend.com');assert.deepEqual(sent.body.to,[EMAIL]);assert.doesNotMatch(JSON.stringify(sent.body),/evil\.example/);
 }finally{f.restore();}
});

test('API leaves saved invite usable when email disabled, and existing auth/origin/Premium/config gates prevent sending',async()=>{
 const f=serverFixture();try{
  let response=await api.onRequestPost({request:request(),env:serverEnv()});const result=await response.json();assert.equal(response.status,200);assert.equal(result.status,'pending');assert.equal(result.email_status,'not_configured');assert.equal(result.email_sent,false);assert.equal(f.calls.some(row=>row.address.hostname==='api.resend.com'),false);
  for(const mode of ['free','signed-out','old-session','bad-origin','disabled']){
   f.calls.length=0;actor={id:OWNER,email:'owner@example.test'};paid=mode!=='free';newest=mode!=='old-session';if(mode==='signed-out')actor=null;
   response=await api.onRequestPost({request:request({},mode==='bad-origin'?'https://evil.example':ORIGIN),env:serverEnv({...ready(),...(mode==='disabled'?{BB_PARTNER_SHARING_ENABLED:'false'}:{})})});
   assert.ok([401,403,503].includes(response.status),mode);assert.equal(f.calls.some(row=>row.address.hostname==='api.resend.com'),false,mode);assert.equal(f.calls.some(row=>row.address.pathname.endsWith('/rpc/bb_hh_service_invite')),false,mode);
  }
 }finally{f.restore();}
});
