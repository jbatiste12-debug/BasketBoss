/* Production Premium API session boundary, disabled until explicitly activated.
 * Keep subscription status and Paddle management available from every valid
 * authenticated session. Those endpoints independently authenticate and
 * authorize; neither grants access to paid recipes or AI.
 * Leave Free, webhooks, public pages, and checkout unchanged.
 * Enforces at most one CURRENT server-authorized paid-device session per user.
 */
import {authenticatedUser,json,isLive} from '../../bb-server-lib/bb-billing.js';
import {livePaidBillingEnabled,testFlightBetaEnabled} from '../../bb-server-lib/bb-paid-access.js';
import {seatGateEnabled,isNewestVerifiedSession} from '../../bb-server-lib/bb-premium-seat.js';
import {nativeCorsResponse,nativePreflightResponse} from '../../bb-server-lib/bb-request-origin.js';
import {ensureDeletionSchema,isAccountDeleting} from '../../bb-server-lib/bb-account-deletion.js';
import {logCookDiagnostic} from '../../bb-server-lib/bb-cook-service-error.js';
const PROTECTED=[
 /^\/api\/apple\/testflight-beta\/?$/,
 /^\/api\/tts\/?$/,
 /^\/api\/cook-assistant\/?$/,
 /^\/api\/recipes\/premium\/?$/,
 /^\/api\/bb173\/(?:generate|scan|meal-image)\/?$/,
 /^\/api\/household\/?$/,
 /^\/api\/receipt-inventory\/?$/
];
function boundaryFailure(request,payload,status,stage,code){
 if(!/^\/api\/(?:tts|cook-assistant)\/?$/.test(new URL(request.url).pathname))return json(payload,status);
 if(code!=='BB_COOK_AUTH_REQUIRED'||/^Bearer [^\s]+$/.test(request.headers.get('Authorization')||''))logCookDiagnostic(stage,code,status);
 return json({...payload,code},status);
}
async function enforcePremiumSession({request,env,next},verifiedUser){
 const url=new URL(request.url);
 // Availability exposes no inventory; the endpoint independently authenticates
 // before reporting Premium readiness and never initializes stock in this mode.
 if(/^\/api\/receipt-inventory\/?$/.test(url.pathname)&&request.method==='GET'&&url.searchParams.get('mode')==='status')return next();
 if(!PROTECTED.some(re=>re.test(url.pathname))||!seatGateEnabled(env))return next();
 // Prevent a session-setting mistake from enabling this on QA/sandbox tenants.
 const liveHosts=new Set(['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev']);
 if(url.protocol!=='https:'||!liveHosts.has(url.hostname)||!(livePaidBillingEnabled(env)||testFlightBetaEnabled(env))||
    (env.CF_PAGES_BRANCH&&env.CF_PAGES_BRANCH!=='main')||
    env.SUPABASE_URL!=='https://kbhyosxuvlcazyzzinqv.supabase.co')
  return boundaryFailure(request,{error:'Premium session verification misconfigured'},503,'session_config','BB_COOK_SESSION_MISCONFIGURED');
 const user=verifiedUser===undefined?await authenticatedUser(request,env):verifiedUser;
 if(!user)return boundaryFailure(request,{error:'Sign in with a confirmed email'},401,'authorization','BB_COOK_AUTH_REQUIRED');
 try{
  if(!await isNewestVerifiedSession(request,env,user))
   return boundaryFailure(request,{error:'This Premium account has a newer sign-in on another device. Sign in here again to continue.'},403,'session_verification','BB_COOK_SESSION_REPLACED');
 }catch{return boundaryFailure(request,{error:'Premium device verification temporarily unavailable'},503,'session_verification','BB_COOK_SESSION_UNAVAILABLE');}
 return next();
}
async function enforceDeletionState(context){
 const {request,env}=context,path=new URL(request.url).pathname;
 // A pending delete must remain resumable, independent of paid-device state.
 // Paddle is signature-authenticated and has its own atomic deletion guards.
 if(!env.BILLING_DB||/^\/api\/(?:account\/delete|paddle\/webhook)\/?$/.test(path)||
    !/^Bearer [^\s]+$/.test(request.headers.get('Authorization')||''))
  return enforcePremiumSession(context);
 const user=await authenticatedUser(request,env);
 if(!user)return boundaryFailure(request,{error:'Sign in with a confirmed email'},401,'authorization','BB_COOK_AUTH_REQUIRED');
 try{
  await ensureDeletionSchema(env);
  if(await isAccountDeleting(env,user.id))
   return boundaryFailure(request,{ok:false,pending:true,error:'Account deletion is in progress. Retry Delete Account & Data to finish.'},409,'authorization','BB_COOK_ACCOUNT_PENDING');
 }catch{return boundaryFailure(request,{error:'Account state verification temporarily unavailable'},503,'authorization','BB_COOK_ACCOUNT_UNAVAILABLE');}
 return enforcePremiumSession(context,user);
}
export async function onRequest(context){
 // Preflight has no Bearer token and exposes no account data. Actual requests
 // still pass the same authenticated/current-session/entitlement checks below.
 const preflight=nativePreflightResponse(context.request);
 if(preflight)return preflight;
 return nativeCorsResponse(context.request,await enforceDeletionState(context));
}
