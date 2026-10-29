/* Production fail-closed placeholder. No billing, Supabase or partner data access.
 * Do not enable Household Sharing without a separately security-reviewed
 * entitlement-checked server implementation, production migration and
 * a server-side one-active-Premium-session safeguard.
 */
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Vary':'Authorization'
}});
export function onRequestGet(){return json({configured:false,premium:false,role:'unavailable',household_id:null,invite:null});}
export function onRequestPost(){return json({error:'Household Sharing is not enabled on this site'},403);}
