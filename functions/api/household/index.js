/* BasketBoss Household Sharing — closed-by-default Cloudflare Pages API.
   D1 remains the ONLY payment entitlement authority. Supabase's service-role
   secret is server-only. No legacy basketboss_data restore is called here. */
import {json,authenticatedUser,isLive,expectedPrice,entitlementForStatus,requireSameOrigin} from '../../../bb-server-lib/bb-billing.js';
import {isNewestVerifiedSession} from '../../../bb-server-lib/bb-premium-seat.js';
const SECTIONS=new Set(['planned_day','servings','pantry_item','kitchen_item','shopping_checked','budget_target','household_servings']);
function privateKey(env){return env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';}
// Four independent gates. This never accepts the QA tenant or test-owner entitlement.
// "Configured" means permitted to attempt status reads, not that any user is paid.
// HARD RELEASE BRAKE: separate security-reviewed activation commit required.
const RELEASE_ARMED=false;
const LIVE_SUPABASE='https://kbhyosxuvlcazyzzinqv.supabase.co';
const LIVE_HOSTS=new Set(['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev']);
function configured(env,request){
 const url=new URL(request.url);
 return RELEASE_ARMED&&url.protocol==='https:'&&LIVE_HOSTS.has(url.hostname)&&
  (!env.CF_PAGES_BRANCH||env.CF_PAGES_BRANCH==='main')&&
  env.BB_PARTNER_SHARING_ENABLED==='true'&&
  env.BB_PARTNER_PRODUCTION_READY==='true'&&
  env.BB_PREMIUM_SINGLE_SESSION_ENABLED==='true'&&
  isLive(env)&&env.BB_LIVE_WEBHOOK_ENABLED==='true'&&
  env.SUPABASE_URL===LIVE_SUPABASE&&
  typeof env.SUPABASE_PUBLISHABLE_KEY==='string'&&env.SUPABASE_PUBLISHABLE_KEY.length>20&&
  typeof privateKey(env)==='string'&&privateKey(env).length>30&&
  typeof env.BILLING_DB?.prepare==='function'&&
  !!expectedPrice(env,'founder')&&!!expectedPrice(env,'standard');
}
function serviceHeaders(env){
 const secret=privateKey(env);
 // Current sb_secret_* keys belong ONLY in `apikey`; they are not JWTs.
 // Support legacy service_role JWTs solely for existing installations.
 return /^sb_secret_/.test(secret)
  ? {'apikey':secret,'Content-Type':'application/json'}
  : {'apikey':secret,'Authorization':'Bearer '+secret,'Content-Type':'application/json'};
}
async function supa(env,path,method='GET',data){
 const response=await fetch(String(env.SUPABASE_URL).replace(/\/$/,'')+'/rest/v1/'+path,{
  method,headers:{...serviceHeaders(env),'Cache-Control':'no-store'},
  body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(8000),redirect:'manual'
 });
 const parsed=await response.json().catch(()=>null);
 if(!response.ok){console.warn('BB household Supabase operation failed',response.status);throw Error('household_database_unavailable');}
 return parsed;
}
const eq=(field,v)=>`${field}=eq.${encodeURIComponent(v)}`;
async function first(env,table,filter,select='*'){
 const rows=await supa(env,`${table}?select=${encodeURIComponent(select)}&${filter}&limit=1`);
 return Array.isArray(rows)?rows[0]||null:null;
}
async function premium(env,userId){
 if(!isLive(env)||!env.BILLING_DB?.prepare)return false;
 const row=await env.BILLING_DB.prepare('SELECT status,price_id,plan FROM bb_paid_entitlements WHERE user_id=? ORDER BY updated_at_ms DESC LIMIT 1').bind(userId).first();
 return !!row&&entitlementForStatus(row.status)&&expectedPrice(env,row.plan)===row.price_id;
}
async function householdForUser(env,user){
 const owner=await first(env,'bb_households',eq('owner_user_id',user.id));
 if(owner)return {household:owner,role:'owner'};
 const partner=await first(env,'bb_households',`${eq('partner_user_id',user.id)}&invite_status=eq.accepted`);
 if(partner)return {household:partner,role:'partner'};
 return {household:null,role:'free'};
}
async function getPending(env,user){
 const rows=await supa(env,`bb_household_invites?select=id,household_id,partner_email,status,expires_at&${eq('partner_email',user.email.toLowerCase())}&status=eq.pending&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=2`);
 if(!Array.isArray(rows)||rows.length!==1)return null; // ambiguous invites fail closed
 const h=await first(env,'bb_households',eq('id',rows[0].household_id),'id,owner_user_id,invite_status');
 if(!h||h.invite_status!=='pending'||!await premium(env,h.owner_user_id))return null;
 return {household_id:h.id,expires_at:rows[0].expires_at};
}
async function authorized(request,env){
 if(!configured(env,request))return {error:json({error:'Partner Sharing not configured'},503)};
 const user=await authenticatedUser(request,env);
 if(!user)return {error:json({error:'Sign in with a confirmed email'},401)};
 try{
  if(!await isNewestVerifiedSession(request,env,user))
   return {error:json({error:'Another device has a newer session. Sign in again on this device to use Household Sharing.'},403)};
 }catch{return {error:json({error:'Device session verification is temporarily unavailable'},503)};}
 return {user};
}
export async function onRequestGet({request,env}){
 // A gated-off production feature is a supported, non-error state. Do not emit 503
 // network noise or touch local data merely because the migration is absent.
 if(!configured(env,request))return json({configured:false,premium:false,role:'unavailable',household_id:null,invite:null});
 const auth=await authorized(request,env);if(auth.error)return auth.error;
 try{
  const {household,role}=await householdForUser(env,auth.user);
  const entitled=household?await premium(env,household.owner_user_id):await premium(env,auth.user.id);
  const mode=new URL(request.url).searchParams.get('mode')||'status';
  if(mode==='entries'){
   if(!household||!entitled)return json({error:'Verified Premium shared household required'},403);
   const rows=await supa(env,`bb_household_entries?select=section,entry_key,value,revision,updated_at&${eq('household_id',household.id)}&order=section.asc,entry_key.asc&limit=1000`);
   if(!Array.isArray(rows)||rows.length>=1000)return json({error:'Household data too large; manual review required'},409);
   return json({household_id:household.id,role,entries:rows});
  }
  if(mode!=='status')return json({error:'Invalid mode'},400);
  const pending=!household?await getPending(env,auth.user):null;
  return json({configured:true,premium:entitled,role,household_id:household?.id||null,
   invite_status:household?.invite_status||'none',partner_email:role==='owner'?household?.partner_email||null:null,
   invite:pending,entitlement_scope:'shared_household_only'});
 }catch(e){console.warn('Household read unavailable',e.message);return json({error:'Partner Sharing temporarily unavailable'},503);}
}
export async function onRequestPost({request,env}){
 const auth=await authorized(request,env);if(auth.error)return auth.error;
 if(!requireSameOrigin(request))return json({error:'Origin not allowed'},403);
 let data;try{const raw=await request.text();if(raw.length>12000)throw Error();data=JSON.parse(raw);}catch{return json({error:'Invalid request body'},400);}
 if(!data||typeof data!=='object'||Array.isArray(data))return json({error:'Invalid input'},400);
 const actor=auth.user;
 try{
  const {household,role}=await householdForUser(env,actor);
  if(data.action==='invite'){
   if(role==='partner'||!await premium(env,actor.id))return json({error:'Owner Premium required'},403);
   const email=String(data.email||'').trim().toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return json({error:'Invalid partner email'},400);
   const result=await supa(env,'rpc/bb_hh_service_invite','POST',{p_owner:actor.id,p_email:email});
   return json({...result,email_sent:false,message:'Invite saved. Ask your partner to sign in using their confirmed email.'});
  }
  if(data.action==='accept'){
   if(household)return json({error:'Already linked to a household'},409);
   const pending=await getPending(env,actor);
   if(!pending||pending.household_id!==data.household_id)return json({error:'No eligible invitation'},403);
   const result=await supa(env,'rpc/bb_hh_service_accept','POST',{p_user:actor.id,p_email:actor.email,p_household:pending.household_id});
   return json(result);
  }
  if(data.action==='unlink'){
   if(role!=='owner')return json({error:'Owner only'},403);
   return json(await supa(env,'rpc/bb_hh_service_unlink','POST',{p_owner:actor.id}));
  }
  if(data.action==='patch'){
   if(!household||!await premium(env,household.owner_user_id))return json({error:'Verified Premium household required'},403);
   if(!SECTIONS.has(data.section)||typeof data.key!=='string'||data.key.length<1||data.key.length>180||
      !Number.isSafeInteger(data.expected)||data.expected<0||data.value===undefined||JSON.stringify(data.value).length>8192)
     return json({error:'Invalid section patch'},400);
   const result=await supa(env,'rpc/bb_hh_service_patch','POST',{
    p_actor:actor.id,p_household:household.id,p_section:data.section,p_key:data.key,
    p_value:data.value,p_expected:data.expected
   });
   return json(result,result?.conflict?409:200);
  }
  return json({error:'Unknown action'},400);
 }catch(e){console.warn('Household operation unavailable',e.message);return json({error:'Partner Sharing temporarily unavailable'},503);}
}
