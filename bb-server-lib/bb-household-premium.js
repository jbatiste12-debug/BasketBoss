/* BasketBoss verified partner Premium benefits: never a client-tier shortcut.
 * This grants a verified partner only the subscribed owner's *access*, not
 * ownership, billing rights or a second AI allocation. No browser database access.
 * Separate literal brake prevents benefits from going live before the
 * Household API and premium-seat guards receive a reviewed activation commit.
 */
import {isLive,expectedPrice,entitlementForStatus} from './bb-billing.js';
import {seatGateEnabled} from './bb-premium-seat.js';
const PARTNER_PREMIUM_ARMED=true;
const LIVE='https://kbhyosxuvlcazyzzinqv.supabase.co';
const HOSTS=new Set(['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function partnerBenefitsEnabled(request,env){
  const url=new URL(request.url);
  return PARTNER_PREMIUM_ARMED && seatGateEnabled(env) &&
    url.protocol==='https:'&&HOSTS.has(url.hostname)&&
    (!env.CF_PAGES_BRANCH||env.CF_PAGES_BRANCH==='main')&&
    env.BB_PARTNER_SHARING_ENABLED==='true'&&
    env.BB_PARTNER_PRODUCTION_READY==='true'&&
    env.BB_PREMIUM_SINGLE_SESSION_ENABLED==='true'&&
    ((env.BB_LIVE_WEBHOOK_ENABLED==='true'&&isLive(env)&&
      !!expectedPrice(env,'founder')&&!!expectedPrice(env,'standard'))||
     (env.APPLE_BILLING_ENABLED==='true'&&env.APPLE_ENVIRONMENT==='Production'))&&
    env.SUPABASE_URL===LIVE&&
    typeof env.SUPABASE_PUBLISHABLE_KEY==='string'&&
    env.SUPABASE_PUBLISHABLE_KEY.length>20&&
    typeof (env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY)==='string'&&
    (env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY).length>30&&
    typeof env.BILLING_DB?.prepare==='function';
}
function serviceHeaders(env){
  const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  return /^sb_secret_/.test(key)
    ? {apikey:key,'Content-Type':'application/json'}
    : {apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
}
// A null result is a genuine denial; thrown errors indicate unverified backend
// state and must NOT be interpreted as a successful Premium subscription.
export async function sharedHouseholdPremiumOwner(request,env,user){
  if(!partnerBenefitsEnabled(request,env)||!UUID.test(user?.id||'')||
     typeof user?.email!=='string'||user.email.trim().length<3)return null;
  const email=user.email.trim().toLowerCase();
  // PostgREST returns at most 2 rows. Require EXACTLY one accepted partner
  // membership, with matching authenticated user ID AND confirmed email.
  const url=LIVE+'/rest/v1/bb_households?select=owner_user_id,partner_user_id,partner_email,invite_status'+
    '&partner_user_id=eq.'+encodeURIComponent(user.id)+
    '&invite_status=eq.accepted&limit=2';
  const response=await fetch(url,{
    headers:{...serviceHeaders(env),'Cache-Control':'no-store'},
    redirect:'manual',signal:AbortSignal.timeout(6500),cache:'no-store'
  });
  if(!response.ok)throw Error('household_partner_lookup_unavailable');
  const rows=await response.json();
  if(!Array.isArray(rows))throw Error('household_partner_response_invalid');
  if(rows.length!==1)return null;
  const h=rows[0];
  if(h?.partner_user_id!==user.id||h?.invite_status!=='accepted'||
     typeof h.partner_email!=='string'||h.partner_email.trim().toLowerCase()!==email||
     !UUID.test(h.owner_user_id||'')||h.owner_user_id===user.id)return null;
  // Only a verified production payment is inherited. No BB_OWNER_USER_ID
  // bypass, no pending checkout, no browser claim, and no Apple Sandbox access.
  const row=isLive(env)?await env.BILLING_DB.prepare(
    `SELECT status,price_id,plan FROM bb_paid_entitlements WHERE user_id=?
     ORDER BY CASE WHEN status IN ('active','trialing') AND
      ((plan='founder' AND price_id=?) OR (plan='standard' AND price_id=?))
      THEN 0 ELSE 1 END,updated_at_ms DESC LIMIT 1`
  ).bind(h.owner_user_id,expectedPrice(env,'founder'),expectedPrice(env,'standard')).first():null;
  const expected=row?expectedPrice(env,row.plan):null;
  if(row&&expected&&entitlementForStatus(row.status)&&expected===row.price_id)return h.owner_user_id;
  if(env.APPLE_BILLING_ENABLED!=='true')return null;
  const {readPersonalPaidAccess}=await import('./bb-paid-access.js');
  const access=await readPersonalPaidAccess(env,h.owner_user_id,{productionOnly:true,paddleRow:row});
  return access.premiumAccess?h.owner_user_id:null;
}
