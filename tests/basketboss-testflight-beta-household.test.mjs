import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {persistTestFlightBetaGrant} from '../bb-server-lib/bb-testflight-beta.js';
import {readPersonalPaidAccess,readMemberPaidAccess} from '../bb-server-lib/bb-paid-access.js';
import {digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';
import {sharedHouseholdPremiumOwner} from '../bb-server-lib/bb-household-premium.js';
import {onRequestGet as householdGet,onRequestPost as householdPost} from '../functions/api/household/index.js';
import {onRequestGet as receiptGet,onRequestPost as receiptPost} from '../functions/api/receipt-inventory.js';

const OWNER='11111111-1111-4111-8111-111111111111',PARTNER='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
const HH='44444444-4444-4444-8444-444444444444',SID='55555555-5555-4555-8555-555555555555';
const NOW=Date.parse('2026-11-03T12:00:00Z'),ORIGIN='https://basketboss.co.uk',LIVE='https://kbhyosxuvlcazyzzinqv.supabase.co';
const email=id=>id===OWNER?'owner@example.test':id===PARTNER?'partner@example.test':'other@example.test';
function request(id,path='/api/household',body,origin=ORIGIN){
 const jwt='header.'+Buffer.from(JSON.stringify({sub:id,session_id:SID,exp:NOW/1000+3600})).toString('base64url')+'.signature';
 return new Request(ORIGIN+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+jwt,Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
async function fixture({linked=false,current=true}={}){
 const realFetch=globalThis.fetch,realNow=Date.now;Date.now=()=>NOW;
 const sql=new DatabaseSync(':memory:');
 const db={prepare(query){let values=[];const statement={bind(...args){values=args;return statement;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const result=sql.prepare(query).run(...values);return {success:true,meta:{changes:Number(result.changes)}};}};return statement;},async batch(list){sql.exec('BEGIN');try{const values=[];for(const statement of list)values.push(await statement.run());sql.exec('COMMIT');return values;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const env={BILLING_DB:db,BB_BILLING_ENABLED:'false',APPLE_BILLING_ENABLED:'false',BB_TESTFLIGHT_BETA_ENABLED:'true',BB_PARTNER_SHARING_ENABLED:'true',BB_PARTNER_PRODUCTION_READY:'true',BB_PREMIUM_SINGLE_SESSION_ENABLED:'true',BB_RECEIPT_INVENTORY_ENABLED:'true',CF_PAGES_BRANCH:'main',SUPABASE_URL:LIVE,SUPABASE_PUBLISHABLE_KEY:'public_'+'p'.repeat(30),SUPABASE_SECRET_KEY:'sb_secret_'+'s'.repeat(40)};
 const calls=[];let household=linked?{id:HH,owner_user_id:OWNER,partner_user_id:PARTNER,partner_email:email(PARTNER),invite_status:'accepted'}:null;
 globalThis.fetch=async(url,init={})=>{
  const address=new URL(String(url)),body=init.body?JSON.parse(init.body):null;calls.push({url:address,body});
  if(address.pathname==='/auth/v1/user'){
   const actor=JSON.parse(Buffer.from(init.headers.Authorization.slice(7).split('.')[1],'base64url')).sub;
   return Response.json({id:actor,email:email(actor),email_confirmed_at:'2026-11-01T00:00:00Z'});
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
  if(address.pathname.endsWith('/bb_household_invites'))return Response.json(household?.invite_status==='pending'?[{id:'invite',household_id:HH,partner_email:email(PARTNER),expires_at:'2026-11-05T12:00:00Z'}]:[]);
  if(address.pathname.endsWith('/rpc/bb_hh_service_invite')){household={id:HH,owner_user_id:body.p_owner,partner_user_id:null,partner_email:body.p_email,invite_status:'pending'};return Response.json({household_id:HH,status:'pending'});}
  if(address.pathname.endsWith('/rpc/bb_hh_service_accept')){household={...household,partner_user_id:body.p_user,invite_status:'accepted'};return Response.json({household_id:HH,status:'accepted'});}
  if(address.pathname.endsWith('/bb_household_entries'))return Response.json([]);
  if(address.pathname.endsWith('/rpc/bb_receipt_inventory_service'))return Response.json({ok:true,autoStockReady:true,scope:{kind:body.p_scope_kind,id:body.p_scope_id},initialized:false,inventoryRevision:0,stock:{},inventory:[],essentials:[],priceObservations:[]});
  throw Error('Unexpected outbound request '+address.pathname);
 };
 await persistTestFlightBetaGrant(env,OWNER,{receiptType:'Sandbox',bundleId:'uk.co.basketboss.app',appTransactionId:'1234567890',applicationVersion:'8',receiptCreationDate:NOW-1000},{now:NOW});
 return {env,sql,calls,get household(){return household;},set household(value){household=value;},restore(){globalThis.fetch=realFetch;Date.now=realNow;sql.close();}};
}

test('Beta owner can create a household and accepted partner inherits one owner allocation without paid billing',async()=>{
 const f=await fixture();try{
  assert.equal((await readPersonalPaidAccess(f.env,OWNER,{productionOnly:true})).premiumAccess,false,'ordinary production-only checks retain the payment policy');
  assert.equal((await readPersonalPaidAccess(f.env,OWNER,{productionOnly:true,includeTestFlightBeta:true})).provider,'testflight_beta');
  const invited=await householdPost({request:request(OWNER,'/api/household',{action:'invite',email:email(PARTNER)}),env:f.env});assert.equal(invited.status,200);assert.equal((await invited.json()).email_sent,false);
  const pending=await (await householdGet({request:request(PARTNER),env:f.env})).json();assert.equal(pending.invite.household_id,HH);
  const accepted=await householdPost({request:request(PARTNER,'/api/household',{action:'accept',household_id:HH}),env:f.env});assert.equal(accepted.status,200);
  const member={id:PARTNER,email:email(PARTNER)};
  assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,member),OWNER);
  const access=await readMemberPaidAccess(request(PARTNER),f.env,member);assert.equal(access.householdOwnerId,OWNER);assert.equal(access.provider,'household');
  const state=await (await householdGet({request:request(PARTNER),env:f.env})).json();assert.equal(state.premium,true);assert.equal(state.role,'partner');assert.equal(state.household_id,HH);
 }finally{f.restore();}
});

test('Beta owner and accepted partner use the same server-selected receipt household scope',async()=>{
 const f=await fixture({linked:true});try{
  for(const actor of [OWNER,PARTNER]){
   const response=await receiptGet({request:request(actor,'/api/receipt-inventory'),env:f.env});assert.equal(response.status,200);assert.deepEqual((await response.json()).scope,{kind:'household',id:HH});
   const last=f.calls.findLast(row=>row.url.pathname.endsWith('/rpc/bb_receipt_inventory_service'));assert.equal(last.body.p_actor,actor);assert.equal(last.body.p_scope_kind,'household');assert.equal(last.body.p_scope_id,HH);
  }
  const wrong=await receiptPost({request:request(PARTNER,'/api/receipt-inventory',{action:'confirm_pantry',stock:{},expectedRevision:0,expectedScope:{kind:'household',id:OTHER},shopSessionId:null}),env:f.env});assert.equal(wrong.status,409);
 }finally{f.restore();}
});

test('owner expiry, revocation and deletion immediately remove inherited household and receipt access',async()=>{
 for(const change of ['expiry','revocation','deletion']){
  const f=await fixture({linked:true});try{
   assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,{id:PARTNER,email:email(PARTNER)}),OWNER);
   if(change==='expiry')f.sql.prepare('UPDATE bb_testflight_beta_grants SET expires_at_ms=?').run(NOW-1);
   if(change==='revocation')f.sql.prepare('UPDATE bb_testflight_beta_grants SET revoked_at_ms=?').run(NOW);
   if(change==='deletion')f.sql.prepare('INSERT INTO bb_account_deletions(actor_hash,retry_hash,started_at_ms) VALUES(?,?,?)').run(await digestDeletionActor(OWNER),'retry',NOW);
   assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,{id:PARTNER,email:email(PARTNER)}),null,change);
   assert.equal((await (await householdGet({request:request(PARTNER),env:f.env})).json()).premium,false,change);
   assert.equal((await householdGet({request:request(PARTNER,'/api/household?mode=entries'),env:f.env})).status,403,change);
   assert.equal((await receiptGet({request:request(PARTNER,'/api/receipt-inventory'),env:f.env})).status,403,change);
  }finally{f.restore();}
 }
});

test('beta access cannot skip confirmed partner identity, accepted invitation or newest-device guards',async()=>{
 for(const mode of ['pending','email','unlinked','foreign','stale']){
  const f=await fixture({linked:true,current:mode!=='stale'});try{
   if(mode==='pending')f.household={...f.household,invite_status:'pending'};
   if(mode==='email')f.household={...f.household,partner_email:'someone@example.test'};
   if(mode==='unlinked')f.household={...f.household,invite_status:'unlinked'};
   if(mode==='foreign')f.household={...f.household,partner_user_id:OTHER};
   if(mode!=='stale')assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,{id:PARTNER,email:email(PARTNER)}),null,mode);
   const response=await receiptGet({request:request(PARTNER,'/api/receipt-inventory'),env:f.env});assert.ok(mode==='foreign'?[403,503].includes(response.status):response.status===403,mode);
   assert.equal(f.calls.filter(row=>row.url.pathname.endsWith('/rpc/bb_receipt_inventory_service')).length,0,mode);
  }finally{f.restore();}
 }
});

test('beta grants retain production host, tenant, release branch and explicit sharing/seat configuration gates',async()=>{
 for(const patch of [{BB_PARTNER_SHARING_ENABLED:'false'},{BB_PARTNER_PRODUCTION_READY:'false'},{BB_PREMIUM_SINGLE_SESSION_ENABLED:'false'},{BB_TESTFLIGHT_BETA_ENABLED:'false'},{CF_PAGES_BRANCH:'preview'},{SUPABASE_URL:'https://untrusted.supabase.co'}]){
  const f=await fixture({linked:true});try{
   Object.assign(f.env,patch);const before=f.calls.length;
   const response=await householdGet({request:request(PARTNER),env:f.env});assert.equal((await response.json()).configured,false,JSON.stringify(patch));assert.equal(f.calls.length,before);
   assert.equal(await sharedHouseholdPremiumOwner(request(PARTNER),f.env,{id:PARTNER,email:email(PARTNER)}),null);
  }finally{f.restore();}
 }
});
