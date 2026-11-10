import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureDeletionSchema,digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';
import {readPersonalPaidAccess,readMemberPaidAccess} from '../bb-server-lib/bb-paid-access.js';
import {sharedHouseholdPremiumOwner} from '../bb-server-lib/bb-household-premium.js';
import {onRequestGet as householdGet,onRequestPost as householdPost} from '../functions/api/household/index.js';
import {onRequestGet as receiptGet,onRequestPost as receiptPost} from '../functions/api/receipt-inventory.js';
import {onRequestGet as membershipGet} from '../functions/api/subscription/status.js';
import {onRequestGet as portalGet} from '../functions/api/subscription/portal.js';
import {onRequest as ai} from '../functions/api/bb173/[action].js';

const OWNER='11111111-1111-4111-8111-111111111111',PARTNER='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
const HH='44444444-4444-4444-8444-444444444444',SID='55555555-5555-4555-8555-555555555555';
const ORIGIN='https://basketboss.co.uk',LIVE='https://kbhyosxuvlcazyzzinqv.supabase.co';
const PRICE='pri_'+'p'.repeat(26),FOUNDER_PRICE='pri_'+'f'.repeat(26);
const email=id=>id===OWNER?'owner@example.test':id===PARTNER?'partner@example.test':'other@example.test';
function request(id,path='/api/household',body,origin=ORIGIN){
 const jwt='header.'+Buffer.from(JSON.stringify({sub:id,session_id:SID,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
 return new Request(ORIGIN+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+jwt,Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
async function fixture({linked=false,current=true,confirmed=true,enabled='true'}={}){
 const realFetch=globalThis.fetch,sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE bb_paid_entitlements(user_id TEXT,status TEXT,price_id TEXT,plan TEXT,updated_at_ms INTEGER,paddle_subscription_id TEXT,paddle_customer_id TEXT,trial_ends_at TEXT,current_period_ends_at TEXT,cancellation_effective_at TEXT,cancel_at_period_end INTEGER);`);
 const db={prepare(query){let values=[];const statement={bind(...args){values=args;return statement;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const result=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(result.changes)}};}};return statement;},async batch(list){sql.exec('BEGIN');try{const values=[];for(const statement of list)values.push(await statement.run());sql.exec('COMMIT');return values;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const env={BILLING_DB:db,BB_BILLING_MODE:'live',BB_BILLING_ENABLED:'true',BB_LIVE_WEBHOOK_ENABLED:'true',PADDLE_LIVE_STANDARD_PRICE_ID:PRICE,PADDLE_LIVE_FOUNDER_PRICE_ID:FOUNDER_PRICE,
  APPLE_BILLING_ENABLED:'false',BB_TESTFLIGHT_BETA_ENABLED:'false',BB_OWNER_USER_ID:OWNER,BB_OWNER_HOUSEHOLD_ENABLED:enabled,
  BB_PARTNER_SHARING_ENABLED:'true',BB_PARTNER_PRODUCTION_READY:'true',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_RECEIPT_INVENTORY_ENABLED:'true',CF_PAGES_BRANCH:'main',
  SUPABASE_URL:LIVE,SUPABASE_PUBLISHABLE_KEY:'public_'+'p'.repeat(30),SUPABASE_SECRET_KEY:'sb_secret_'+'s'.repeat(40),
  BB_PREMIUM_AI_ENABLED:'true',GEMINI_API_KEY:'local-test',TURNSTILE_SITE_KEY:'local-test',TURNSTILE_SECRET_KEY:'local-test',BB_AI_GLOBAL_DAILY_CAP:'20'};
 await ensureDeletionSchema(env);
 let household=linked?{id:HH,owner_user_id:OWNER,partner_user_id:PARTNER,partner_email:email(PARTNER),invite_status:'accepted'}:null;
 const calls=[];
 globalThis.fetch=async(url,init={})=>{
  const address=new URL(String(url)),body=init.body?JSON.parse(init.body):null;calls.push({url:address,body});
  if(address.pathname==='/auth/v1/user'){
   const actor=JSON.parse(Buffer.from(init.headers.Authorization.slice(7).split('.')[1],'base64url')).sub;
   return Response.json({id:actor,email:email(actor),...(confirmed?{email_confirmed_at:'2026-11-01T00:00:00Z'}:{})});
  }
  if(address.pathname.endsWith('/rpc/bb_hh_service_session_ok'))return Response.json(current);
  if(address.pathname.endsWith('/bb_households')){
   if(!household)return Response.json([]);
   const owner=address.searchParams.get('owner_user_id'),partner=address.searchParams.get('partner_user_id');
   if(owner&&owner!=='eq.'+household.owner_user_id)return Response.json([]);
   if(partner&&partner!=='eq.'+household.partner_user_id)return Response.json([]);
   if(address.searchParams.get('invite_status')==='eq.accepted'&&household.invite_status!=='accepted')return Response.json([]);
   return Response.json([household]);
  }
  if(address.pathname.endsWith('/bb_household_invites'))return Response.json(household?.invite_status==='pending'?[{id:'invite',household_id:HH,partner_email:email(PARTNER),expires_at:new Date(Date.now()+86400000).toISOString()}]:[]);
  if(address.pathname.endsWith('/rpc/bb_hh_service_invite')){household={id:HH,owner_user_id:body.p_owner,partner_user_id:null,partner_email:body.p_email,invite_status:'pending'};return Response.json({household_id:HH,status:'pending'});}
  if(address.pathname.endsWith('/rpc/bb_hh_service_accept')){household={...household,partner_user_id:body.p_user,invite_status:'accepted'};return Response.json({household_id:HH,status:'accepted'});}
  if(address.pathname.endsWith('/bb_household_entries'))return Response.json([]);
  if(address.pathname.endsWith('/rpc/bb_receipt_inventory_service'))return Response.json({ok:true,autoStockReady:true,scope:{kind:body.p_scope_kind,id:body.p_scope_id},initialized:false,inventoryRevision:0,stock:{},inventory:[],essentials:[],priceObservations:[]});
  if(address.hostname==='generativelanguage.googleapis.com')return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({items:[{name:'apple',estimatedQuantity:'one',confidence:'high',notes:'visible'}],caution:''})}]}}]});
  throw Error('Unexpected outbound request '+address.origin+address.pathname);
 };
 return {env,sql,calls,get household(){return household;},set household(value){household=value;},restore(){globalThis.fetch=realFetch;sql.close();}};
}
const options={productionOnly:true,includeOwnerHousehold:true};
const user=id=>({id,email:email(id)});
async function deleteOwner(f){f.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(OWNER),'retry',Date.now());}
function paid(f,id=OWNER){f.sql.prepare('INSERT INTO bb_paid_entitlements(user_id,status,price_id,plan,updated_at_ms) VALUES(?,?,?,?,?)').run(id,'active',PRICE,'standard',Date.now());}

test('owner sharing needs the exact server string flag and explicit production household opt-in',async()=>{
 for(const enabled of [undefined,false,true,'false','TRUE','1','true']){
  const f=await fixture({enabled});try{
   if(enabled===undefined)delete f.env.BB_OWNER_HOUSEHOLD_ENABLED;
   assert.equal((await readPersonalPaidAccess(f.env,OWNER,options)).premiumAccess,enabled==='true',String(enabled));
   assert.equal((await readPersonalPaidAccess(f.env,OWNER)).premiumAccess,false,'ordinary payment checks stay unchanged');
   assert.equal((await readPersonalPaidAccess(f.env,OWNER,{includeOwnerHousehold:true})).premiumAccess,false,'household option alone does not permit sandbox/personal checks');
  }finally{f.restore();}
 }
});
test('a nonowner or malformed configured identity cannot claim complimentary sharing',async()=>{
 const f=await fixture();try{
  for(const actor of [PARTNER,OTHER,'owner'])assert.equal((await readPersonalPaidAccess(f.env,actor,options)).premiumAccess,false);
  await assert.rejects(readPersonalPaidAccess(f.env,undefined,options),'an absent caller identity must never grant access');
  for(const id of ['',OTHER,'owner',null]){f.env.BB_OWNER_USER_ID=id;assert.equal((await readPersonalPaidAccess(f.env,OWNER,options)).premiumAccess,false);}
 }finally{f.restore();}
});
test('default-OFF owner membership remains separate from a sharing or paid subscription entitlement',async()=>{
 const f=await fixture({enabled:'false'});try{
  assert.equal((await (await membershipGet({request:request(OWNER,'/api/subscription/status'),env:f.env})).json()).tier,'owner');
  assert.equal((await (await householdGet({request:request(OWNER),env:f.env})).json()).premium,false);
  assert.equal((await householdPost({request:request(OWNER,'/api/household',{action:'invite',email:email(PARTNER)}),env:f.env})).status,403);
  assert.equal(f.calls.some(call=>call.url.pathname.endsWith('/rpc/bb_hh_service_invite')),false);
 }finally{f.restore();}
});
test('enabled owner can invite one partner, who inherits access but no subscription management rights',async()=>{
 const f=await fixture();try{
  assert.equal((await householdPost({request:request(OWNER,'/api/household',{action:'invite',email:email(PARTNER)}),env:f.env})).status,200);
  assert.equal((await householdGet({request:request(PARTNER),env:f.env})).status,200);
  assert.equal((await householdPost({request:request(PARTNER,'/api/household',{action:'accept',household_id:HH}),env:f.env})).status,200);
  const access=await readMemberPaidAccess(request(PARTNER),f.env,user(PARTNER));
  assert.equal(access.premiumAccess,true);assert.equal(access.provider,'household');assert.equal(access.householdOwnerId,OWNER);assert.equal(access.paddleRow,null);
  const state=await (await householdGet({request:request(PARTNER),env:f.env})).json();assert.equal(state.premium,true);assert.equal(state.role,'partner');
  assert.equal((await portalGet({request:request(PARTNER,'/api/subscription/portal'),env:f.env})).status,404);
  assert.equal((await householdPost({request:request(PARTNER,'/api/household',{action:'invite',email:email(OTHER)}),env:f.env})).status,403);
 }finally{f.restore();}
});
test('owner and accepted partner use the same server-selected receipt scope and cannot select another household',async()=>{
 const f=await fixture({linked:true});try{
  for(const actor of [OWNER,PARTNER]){
   const response=await receiptGet({request:request(actor,'/api/receipt-inventory'),env:f.env});assert.equal(response.status,200);
   assert.deepEqual((await response.json()).scope,{kind:'household',id:HH});
  }
  const wrong=await receiptPost({request:request(PARTNER,'/api/receipt-inventory',{action:'confirm_pantry',stock:{},expectedRevision:0,expectedScope:{kind:'household',id:OTHER},shopSessionId:null}),env:f.env});assert.equal(wrong.status,409);
  f.env.BB_OWNER_HOUSEHOLD_ENABLED='false';
  assert.deepEqual((await (await receiptGet({request:request(OWNER,'/api/receipt-inventory'),env:f.env})).json()).scope,{kind:'user',id:OWNER});
 }finally{f.restore();}
});
test('inherited owner access still requires the matching accepted partner identity and newest session',async()=>{
 for(const mode of ['pending','email','unlinked','foreign','stale']){
  const f=await fixture({linked:true,current:mode!=='stale'});try{
   if(mode==='pending')f.household={...f.household,invite_status:'pending'};
   if(mode==='email')f.household={...f.household,partner_email:'someone@example.test'};
   if(mode==='unlinked')f.household={...f.household,invite_status:'unlinked'};
   if(mode==='foreign')f.household={...f.household,partner_user_id:OTHER};
   if(mode!=='stale')assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,user(PARTNER)),null,mode);
   const response=await receiptGet({request:request(PARTNER,'/api/receipt-inventory'),env:f.env});assert.ok(mode==='foreign'?[403,503].includes(response.status):response.status===403,mode);
   assert.equal(f.calls.filter(call=>call.url.pathname.endsWith('/rpc/bb_receipt_inventory_service')).length,0);
  }finally{f.restore();}
 }
});
test('server opt-in never bypasses existing release, production tenant, confirmed-email or session guards',async()=>{
 for(const patch of [{BB_PARTNER_SHARING_ENABLED:'false'},{BB_PARTNER_PRODUCTION_READY:'false'},{BB_PREMIUM_SINGLE_SESSION_ENABLED:'false'},{CF_PAGES_BRANCH:'preview'},{SUPABASE_URL:'https://untrusted.supabase.co'}]){
  const f=await fixture({linked:true});try{Object.assign(f.env,patch);assert.equal((await (await householdGet({request:request(PARTNER),env:f.env})).json()).configured,false);assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,user(PARTNER)),null);}finally{f.restore();}
 }
 for(const settings of [{confirmed:false},{current:false}]){const f=await fixture(settings);try{assert.ok([401,403].includes((await householdGet({request:request(OWNER),env:f.env})).status));}finally{f.restore();}}
 const f=await fixture();try{assert.equal((await householdPost({request:request(OWNER,'/api/household',{action:'invite',email:email(PARTNER)},'https://elsewhere.example'),env:f.env})).status,403);}finally{f.restore();}
});
test('revocation or deletion removes complimentary household and inherited receipt access',async()=>{
 for(const change of ['flag','deletion']){
  const f=await fixture({linked:true});try{
   assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,user(PARTNER)),OWNER);
   if(change==='flag')f.env.BB_OWNER_HOUSEHOLD_ENABLED='false';else await deleteOwner(f);
   assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,user(PARTNER)),null);
   assert.equal((await (await householdGet({request:request(PARTNER),env:f.env})).json()).premium,false);
   assert.equal((await receiptGet({request:request(PARTNER,'/api/receipt-inventory'),env:f.env})).status,403);
  }finally{f.restore();}
 }
});
test('a lingering paid row cannot bypass deletion for an explicitly opted-in owner',async()=>{
 const f=await fixture({linked:true});try{
  paid(f);assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,user(PARTNER)),OWNER);
  await deleteOwner(f);
  assert.equal((await readPersonalPaidAccess(f.env,OWNER,options)).premiumAccess,false);
  assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,user(PARTNER)),null);
  assert.equal((await (await householdGet({request:request(OWNER),env:f.env})).json()).premium,false);
  assert.equal((await (await householdGet({request:request(PARTNER),env:f.env})).json()).premium,false);
  assert.equal((await receiptGet({request:request(PARTNER,'/api/receipt-inventory'),env:f.env})).status,403);
 }finally{f.restore();}
});
test('existing production payment access remains valid for ordinary members and sandbox billing alone grants no owner sharing',async()=>{
 const f=await fixture();try{
  paid(f,OTHER);assert.equal((await readPersonalPaidAccess(f.env,OTHER,options)).provider,'paddle');
  f.env.BB_BILLING_MODE='sandbox';f.env.PADDLE_SANDBOX_STANDARD_PRICE_ID=PRICE;
  assert.equal((await readPersonalPaidAccess(f.env,OWNER,options)).premiumAccess,false);
 }finally{f.restore();}
});
test('owner and partner consume one shared five-scan allocation without creating another pool',async()=>{
 const f=await fixture({linked:true});try{
  const imageBase64=Buffer.from([0xff,0xd8,0xff,...Array(70).fill(4)]).toString('base64');
  for(let i=0;i<6;i++){
   const actor=i%2===0?OWNER:PARTNER;
   const response=await ai({request:request(actor,'/api/bb173/scan',{mimeType:'image/jpeg',imageBase64}),env:f.env,params:{action:'scan'}});
   assert.equal(response.status,i<5?200:429,JSON.stringify(await response.json()));
  }
  const usage=f.sql.prepare("SELECT actor,used FROM bb_ai_daily_usage WHERE action='scan'").all();
  assert.deepEqual(usage.map(row=>({...row})),[{actor:'user:'+OWNER,used:5}]);
  assert.equal(f.calls.filter(call=>call.url.hostname==='generativelanguage.googleapis.com').length,5);
 }finally{f.restore();}
});
