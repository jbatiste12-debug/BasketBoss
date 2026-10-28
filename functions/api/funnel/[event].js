/* Anonymous conversion events. This endpoint intentionally never reads, stores
 * or logs credentials, cookies, email addresses, recipe IDs, bodies, or IPs.
 * Aggregate counts appear in Cloudflare HTTP Analytics under /api/funnel/*.
 * Requests are not unique people and can include automated traffic.
 */
const ALLOWED=new Set(['landing','free_click','recipe_open','nudge_shown','nudge_account','account_open','signup_click','signup_valid','confirmation_message','signed_in']);
export async function onRequestPost({params}){
  if(!ALLOWED.has(params.event))return new Response(null,{status:404});
  return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
}
export async function onRequestGet(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
