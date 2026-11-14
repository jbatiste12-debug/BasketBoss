/* Anonymous conversion events. This endpoint intentionally never reads, stores
 * or logs credentials, cookies, email addresses, recipe IDs, bodies, or IPs.
 * Aggregate counts appear in Cloudflare HTTP Analytics under /api/funnel/*.
 * Requests are not unique people and can include automated traffic. Signup
 * confirmation pending and verified signup completion have separate names;
 * neither this anonymous endpoint nor an HTTP count proves a new Auth record.
 */
const ALLOWED=new Set(['landing','free_click','recipe_open','nudge_shown','nudge_account','account_open','signup_click','signup_valid','confirmation_message','signed_in',
  'first_app_open','onboarding_viewed','signup_screen_viewed','signup_method_selected','signup_method_email','signup_method_apple','signup_attempted','signup_confirmation_pending','signup_succeeded','signup_failed',
  'signup_failed_network','signup_failed_rate_limited','signup_failed_validation','signup_failed_unavailable','signup_failed_verification','signup_failed_unknown','first_meal_plan_created','first_shopping_list_created']);
export async function onRequestPost({params}){
  if(!ALLOWED.has(params.event))return new Response(null,{status:404});
  return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
}
export async function onRequestGet(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
