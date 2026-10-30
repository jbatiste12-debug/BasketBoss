/* Production Premium API session boundary, disabled until explicitly activated.
 * Keep subscription status and Paddle management available from every valid
 * authenticated session. Those endpoints independently authenticate and
 * authorize; neither grants access to paid recipes or AI.
 * Leave Free, webhooks, public pages, and checkout unchanged.
 * Enforces at most one CURRENT server-authorized paid-device session per user.
 */
import {authenticatedUser,json,isLive} from '../../bb-server-lib/bb-billing.js';
import {seatGateEnabled,isNewestVerifiedSession} from '../../bb-server-lib/bb-premium-seat.js';
const PROTECTED=[
 /^\/api\/recipes\/premium\/?$/,
 /^\/api\/bb173\/(?:generate|scan)\/?$/,
 /^\/api\/household\/?$/
];
export async function onRequest({request,env,next}){
 const url=new URL(request.url);
 if(!PROTECTED.some(re=>re.test(url.pathname))||!seatGateEnabled(env))return next();
 // Prevent a session-setting mistake from enabling this on QA/sandbox tenants.
 const liveHosts=new Set(['basketboss.co.uk','www.basketboss.co.uk','basketboss-site.pages.dev']);
 if(url.protocol!=='https:'||!liveHosts.has(url.hostname)||!isLive(env)||
    (env.CF_PAGES_BRANCH&&env.CF_PAGES_BRANCH!=='main')||
    env.SUPABASE_URL!=='https://kbhyosxuvlcazyzzinqv.supabase.co')
  return json({error:'Premium session verification misconfigured'},503);
 const user=await authenticatedUser(request,env);
 if(!user)return json({error:'Sign in with a confirmed email'},401);
 try{
  if(!await isNewestVerifiedSession(request,env,user))
   return json({error:'This Premium account has a newer sign-in on another device. Sign in here again to continue.'},403);
 }catch{return json({error:'Premium device verification temporarily unavailable'},503);}
 return next();
}
