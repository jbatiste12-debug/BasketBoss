/* BasketBoss Premium seat guard. Opt-in, live-server only; never trusts client tier.
 * Does not invalidate Supabase refresh tokens, but rejects older sessions at
 * protected paid API routes on every request. Cloudflare secret stays server-only.
 */
// HARD RELEASE BRAKE: even Cloudflare flags cannot activate this staged code.
const RELEASE_ARMED=false;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function seatGateEnabled(env){return RELEASE_ARMED&&env.BB_PREMIUM_SINGLE_SESSION_ENABLED==='true';}
export function sessionFromVerifiedBearer(request,user){
 try{
  const bearer=request.headers.get('Authorization')||'';
  if(!/^Bearer [^\s]+$/.test(bearer)||!user?.id)return null;
  const payload=bearer.slice(7).split('.')[1];
  if(!payload||payload.length>8192)return null;
  const norm=payload.replace(/-/g,'+').replace(/_/g,'/');
  const c=JSON.parse(atob(norm.padEnd(Math.ceil(norm.length/4)*4,'=')));
  return c.sub===user.id&&UUID.test(c.session_id||'')&&
    typeof c.exp==='number'&&c.exp>Date.now()/1000?c.session_id:null;
 }catch{return null;}
}
export async function isNewestVerifiedSession(request,env,user){
 const session=sessionFromVerifiedBearer(request,user);
 const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!session||!secret||secret.length<30||
    env.SUPABASE_URL!=='https://kbhyosxuvlcazyzzinqv.supabase.co')return false;
 const headers=/^sb_secret_/.test(secret)
  ? {apikey:secret,'Content-Type':'application/json'}
  : {apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'};
 const r=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/bb_hh_service_session_ok',{
  method:'POST',headers,body:JSON.stringify({p_user:user.id,p_session:session}),
  redirect:'manual',signal:AbortSignal.timeout(6500),cache:'no-store'
 });
 if(!r.ok)throw Error('seat_session_check_unavailable');
 return await r.json()===true;
}
