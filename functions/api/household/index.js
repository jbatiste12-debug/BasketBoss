import {livePaidBillingEnabled,readPersonalPaidAccess,testFlightBetaEnabled} from '../../../bb-server-lib/bb-paid-access.js';
/* BasketBoss Household Sharing — closed-by-default Cloudflare Pages API.
   D1 remains the ONLY payment entitlement authority. Supabase's service-role
   secret is server-only. No legacy basketboss_data restore is called here. */
import {json,authenticatedUser,isLive,expectedPrice,entitlementForStatus,requireSameOrigin} from '../../../bb-server-lib/bb-billing.js';
import {isNewestVerifiedSession} from '../../../bb-server-lib/bb-premium-seat.js';
import {sendHouseholdInviteEmail} from '../../../bb-server-lib/bb-household-email.js';
const SECTIONS=new Set(['planned_day','servings','pantry_item','kitchen_item','shopping_checked','budget_target','household_servings']);
const SHOP_UNITS=new Set(['g','kg','ml','l','each','pack','clove','tin','loaf','slice','bulb']);
const SHOP_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// A separate metadata namespace uses the existing per-leaf CAS transport.
// It can never contain a pantry balance or an entire Kitchen record.
const PANTRY_PACK_PREFIX='pantry-pack-v1:';
const packObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const packFields=(value,allowed)=>packObject(value)&&Object.keys(value).every(key=>allowed.includes(key));
const packAmount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000;
const packUnit=value=>['g','ml','each'].includes(value);
function packHash(value,seed){let result=seed;for(let index=0;index<value.length;index++){result^=value.charCodeAt(index);result=Math.imul(result,16777619);}return (result>>>0).toString(16).padStart(8,'0');}
function pantryPackValue(value,key,household){
 if(!packFields(value,['version','name','loc','stockLevel','pack'])||!Object.hasOwn(value,'stockLevel')||value.version!==1||typeof value.name!=='string'||value.name!==value.name.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase()||!value.name||value.name.length>160||/[|\u0000-\u001f\u007f]/.test(value.name)||['__proto__','prototype','constructor'].includes(value.name)||!['cupboard','fridge','freezer'].includes(value.loc))return false;
 const identity=value.loc+'|'+value.name;
 if(key!==PANTRY_PACK_PREFIX+value.loc+':'+packHash(identity,2166136261)+packHash(identity,2246822507))return false;
 const level=value.stockLevel;
 if(Object.hasOwn(value,'pack')){
  const pack=value.pack;
  if(!packFields(pack,['quantity','unit','estimated','source'])||Object.keys(pack).length!==4||!packAmount(pack.quantity)||pack.quantity<=0||!packUnit(pack.unit)||typeof pack.estimated!=='boolean'||!['label','receipt','catalogue','photo'].includes(pack.source))return false;
  if(level&&(pack.quantity!==level.capacity||pack.unit!==level.unit||level.capacityEstimated&&!pack.estimated))return false;
 }
 if(level===null)return true;
 if(!packFields(level,['version','capacity','unit','spares','portion','source','estimated','capacityEstimated','confirmedQuantity','confirmedUnit','scope','confirmedAt'])||level.version!==1||!packAmount(level.capacity)||level.capacity<=0||!packUnit(level.unit)||!Number.isInteger(level.spares)||level.spares<0||level.spares>100||!['full','half','low','out'].includes(level.portion)||!['label','receipt','catalogue','photo'].includes(level.source)||typeof level.estimated!=='boolean'||typeof level.capacityEstimated!=='boolean'||!packAmount(level.confirmedQuantity)||level.confirmedUnit!==level.unit)return false;
 const quantity=Math.round(level.capacity*(level.spares+({full:1,half:.5,low:.25,out:0})[level.portion])*1000000)/1000000;
 if(!packAmount(quantity)||quantity!==level.confirmedQuantity||quantity===0&&level.portion!=='out'||!level.estimated&&(level.capacityEstimated||['half','low'].includes(level.portion)))return false;
 if(level.scope!==undefined&&(!packFields(level.scope,['kind','id'])||Object.keys(level.scope).length!==2||level.scope.kind!=='household'||level.scope.id!==household))return false;
 return level.confirmedAt===undefined||typeof level.confirmedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(level.confirmedAt)&&Number.isFinite(Date.parse(level.confirmedAt))&&new Date(level.confirmedAt).toISOString()===level.confirmedAt;
}
function shoppingInput(data){return SHOP_UUID.test(data.id||'')&&typeof data.name==='string'&&data.name.trim().length>=1&&data.name.trim().length<=70&&!/[\u0000-\u001f\u007f]/.test(data.name)&&typeof data.quantity==='number'&&Number.isFinite(data.quantity)&&data.quantity>0&&data.quantity<=1000000&&Math.abs(data.quantity*1000000-Math.round(data.quantity*1000000))<0.0001&&SHOP_UNITS.has(data.unit)&&(data.unit!=='pack'||Number.isInteger(data.quantity));}
function shoppingRow(row,household){return row&&typeof row==='object'&&!Array.isArray(row)&&row.household_id===household&&SHOP_UUID.test(row.id||'')&&shoppingInput(row)&&typeof row.completed==='boolean'&&Number.isSafeInteger(row.revision)&&row.revision>=1&&(row.created_by===null||SHOP_UUID.test(row.created_by||''))&&(row.completed_by===null||SHOP_UUID.test(row.completed_by||''))&&(row.added_by_name===null||typeof row.added_by_name==='string'&&row.added_by_name.length>=1&&row.added_by_name.length<=60);}
function privateKey(env){return env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';}
// Four independent gates. No QA tenant or browser-provided entitlement.
// "Configured" means permitted to attempt status reads, not that any user is paid.
// HARD RELEASE BRAKE: separate security-reviewed activation commit required.
const RELEASE_ARMED=true;
const LIVE_SUPABASE='https://kbhyosxuvlcazyzzinqv.supabase.co';
const LIVE_HOSTS=new Set(['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev']);
function configured(env,request){
 const url=new URL(request.url);
 return RELEASE_ARMED&&url.protocol==='https:'&&LIVE_HOSTS.has(url.hostname)&&
  (!env.CF_PAGES_BRANCH||env.CF_PAGES_BRANCH==='main')&&
  env.BB_PARTNER_SHARING_ENABLED==='true'&&
  env.BB_PARTNER_PRODUCTION_READY==='true'&&
  env.BB_PREMIUM_SINGLE_SESSION_ENABLED==='true'&&
  (livePaidBillingEnabled(env)||testFlightBetaEnabled(env))&&
  ((isLive(env)&&env.BB_LIVE_WEBHOOK_ENABLED==='true'&&!!expectedPrice(env,'founder')&&!!expectedPrice(env,'standard'))||
   (env.APPLE_BILLING_ENABLED==='true'&&env.APPLE_ENVIRONMENT==='Production')||
   (env.GOOGLE_PLAY_BILLING_ENABLED==='true'&&env.GOOGLE_PLAY_BILLING_MODE==='live'&&env.GOOGLE_PLAY_LIVE_BILLING_ENABLED==='true')||
   testFlightBetaEnabled(env))&&
  env.SUPABASE_URL===LIVE_SUPABASE&&
  typeof env.SUPABASE_PUBLISHABLE_KEY==='string'&&env.SUPABASE_PUBLISHABLE_KEY.length>20&&
  typeof privateKey(env)==='string'&&privateKey(env).length>30&&
  typeof env.BILLING_DB?.prepare==='function';
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
 if(!(livePaidBillingEnabled(env)||testFlightBetaEnabled(env))||!env.BILLING_DB?.prepare)return false;
 return (await readPersonalPaidAccess(env,userId,{productionOnly:true,includeTestFlightBeta:true,includeOwnerHousehold:true})).premiumAccess;
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
  const mode=new URL(request.url).searchParams.get('mode')||'status';
  // A pending partner needs the owner's verified access, not a personal
  // subscription. Keep review available if unrelated personal billing fails.
  const pending=mode==='status'&&!household?await getPending(env,auth.user):null;
  const entitled=pending?false:household?await premium(env,household.owner_user_id):await premium(env,auth.user.id);
  if(mode==='shopping'){
   if(!household||!entitled)return json({error:'Verified Premium shared household required'},403);
   const result=await supa(env,'rpc/bb_hh_service_shopping_list','POST',{p_actor:auth.user.id,p_household:household.id});
   if(result?.ok!==true||result.household_id!==household.id||!Array.isArray(result.items)||result.items.length>250||!result.items.every(row=>shoppingRow(row,household.id)))throw Error('shared_shopping_response_invalid');
   return json({...result,configured:true,migration_ready:true,household_id:household.id,role});
  }
  if(mode==='entries'){
   if(!household||!entitled)return json({error:'Verified Premium shared household required'},403);
   // Keep the dedicated namespace out of older clients' whole-Kitchen merge.
   const rows=await supa(env,`bb_household_entries?select=section,entry_key,value,revision,updated_at&${eq('household_id',household.id)}&or=(section.neq.kitchen_item,entry_key.not.like.${encodeURIComponent(PANTRY_PACK_PREFIX+'*')})&order=section.asc,entry_key.asc&limit=1000`);
   if(!Array.isArray(rows)||rows.length>=1000)return json({error:'Household data too large; manual review required'},409);
   return json({household_id:household.id,role,entries:rows.filter(row=>row?.section!=='kitchen_item'||!String(row.entry_key).startsWith(PANTRY_PACK_PREFIX))});
  }
  if(mode==='pantry_packs'){
   if(!household||!entitled)return json({error:'Verified Premium shared household required'},403);
   const rows=await supa(env,`bb_household_entries?select=section,entry_key,value,revision&${eq('household_id',household.id)}&section=eq.kitchen_item&entry_key=like.${encodeURIComponent(PANTRY_PACK_PREFIX+'*')}&order=entry_key.asc&limit=501`);
   if(!Array.isArray(rows)||rows.length>500)return json({error:'Pack metadata too large; review required'},409);
   if(!rows.every(row=>packFields(row,['section','entry_key','value','revision'])&&row.section==='kitchen_item'&&Number.isSafeInteger(row.revision)&&row.revision>=1&&pantryPackValue(row.value,row.entry_key,household.id))||new Set(rows.map(row=>row.entry_key)).size!==rows.length)throw Error('pack_metadata_response_invalid');
   return json({household_id:household.id,entries:rows});
  }
  if(mode!=='status')return json({error:'Invalid mode'},400);
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
   const delivery=await sendHouseholdInviteEmail(env,{
    ownerId:actor.id,recipient:email,householdId:result?.household_id,
    readPending:async()=>({
     household:await first(env,'bb_households',`${eq('id',result.household_id)}&${eq('owner_user_id',actor.id)}`,'id,owner_user_id,partner_user_id,partner_email,invite_status'),
     invite:await first(env,'bb_household_invites',`${eq('household_id',result.household_id)}&${eq('partner_email',email)}&status=eq.pending`,'id,household_id,partner_email,status,accepted_by,expires_at')
    })
   });
   return json({...result,...delivery});
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
  if(data.action==='shopping_add'||data.action==='shopping_complete'){
   if(!household||!await premium(env,household.owner_user_id))return json({error:'Verified Premium shared household required'},403);
   if(!SHOP_UUID.test(data.id||''))return json({error:'Invalid shopping item ID'},400);
   let result;
   if(data.action==='shopping_add'){
    if(!shoppingInput(data))return json({error:'Enter an item, valid extra quantity and unit'},400);
    // Creator and display name always come from the verified server identity.
    // No client household/creator/name attribution is forwarded to SQL.
    result=await supa(env,'rpc/bb_hh_service_shopping_add','POST',{p_actor:actor.id,p_household:household.id,p_id:data.id,p_name:data.name.trim(),p_quantity:data.quantity,p_unit:data.unit});
   }else{
    if(!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<1||typeof data.completed!=='boolean')return json({error:'Invalid shopping completion'},400);
    result=await supa(env,'rpc/bb_hh_service_shopping_complete','POST',{p_actor:actor.id,p_household:household.id,p_id:data.id,p_expected:data.expectedRevision,p_completed:data.completed});
   }
   if(!result||typeof result.ok!=='boolean'||result.household_id!==household.id||result.item&&!shoppingRow(result.item,household.id)||result.ok&&!result.item)throw Error('shared_shopping_response_invalid');
   return json({...result,household_id:household.id},result?.conflict||result?.limit_reached?409:result?.not_found?404:200);
  }
  if(data.action==='patch'){
   if(!household||!await premium(env,household.owner_user_id))return json({error:'Verified Premium household required'},403);
   if(!SECTIONS.has(data.section)||typeof data.key!=='string'||data.key.length<1||data.key.length>180||
      !Number.isSafeInteger(data.expected)||data.expected<0||data.value===undefined||JSON.stringify(data.value).length>8192)
     return json({error:'Invalid section patch'},400);
   const pantryPack=data.key.startsWith(PANTRY_PACK_PREFIX);
   if(pantryPack){
    if(!SHOP_UUID.test(data.expectedHouseholdId||'')||data.expectedHouseholdId!==household.id)return json({error:'Pack metadata household changed',conflict:true},409);
    if(data.section!=='kitchen_item'||!Object.keys(data).every(key=>['action','section','key','value','expected','expectedHouseholdId'].includes(key))||!pantryPackValue(data.value,data.key,household.id))return json({error:'Invalid pack metadata'},400);
   }
   const result=await supa(env,'rpc/bb_hh_service_patch','POST',{
    p_actor:actor.id,p_household:household.id,p_section:data.section,p_key:data.key,
    p_value:data.value,p_expected:data.expected
   });
   return json(pantryPack?{...result,household_id:household.id}:result,result?.conflict?409:200);
  }
  return json({error:'Unknown action'},400);
 }catch(e){console.warn('Household operation unavailable',e.message);return json({error:'Partner Sharing temporarily unavailable'},503);}
}
