/* Authenticated Premium recipe delivery. Never served as a static JSON asset. */
import {json,authenticatedUser,isBillingEnabled,isConfigured,expectedPrice,entitlementForStatus} from '../../../bb-server-lib/bb-billing.js';
export async function onRequestGet({request,env}){
  if(!isConfigured(env))return json({error:'Premium catalogue unavailable'},503);
  const user=await authenticatedUser(request,env);
  if(!user)return json({error:'Sign in with a verified account'},401);
  const owner=!!env.BB_OWNER_USER_ID&&user.id===env.BB_OWNER_USER_ID;
  if(!owner&&!isBillingEnabled(env))return json({error:'Premium catalogue unavailable'},503);
  try{
    let premium=owner;
    if(!premium){
      const row=await env.BILLING_DB.prepare('SELECT status,price_id,plan FROM bb_paid_entitlements WHERE user_id=? ORDER BY updated_at_ms DESC LIMIT 1').bind(user.id).first();
      premium=!!row&&entitlementForStatus(row.status)&&expectedPrice(env,row.plan)===row.price_id;
    }
    if(!premium)return json({error:'Verified Premium subscription required'},403);
    const rows=await env.BILLING_DB.prepare('SELECT recipe_json,normalized_json FROM bb_private_premium_recipes ORDER BY sort_index').all();
    if(!Array.isArray(rows?.results)||rows.results.length!==221)return json({error:'Premium catalogue incomplete'},503);
    const recipes=[],normalized=[],ids=new Set();
    for(const row of rows.results){
      const recipe=JSON.parse(row.recipe_json),norm=JSON.parse(row.normalized_json);
      if(!recipe?.id||recipe.id!==norm?.id||ids.has(recipe.id))return json({error:'Premium catalogue invalid'},503);
      ids.add(recipe.id);recipes.push(recipe);normalized.push(norm);
    }
    return json({recipes,normalized,count:recipes.length});
  }catch(error){console.error('Premium catalogue unavailable',error);return json({error:'Premium catalogue unavailable'},503);}
}
export function onRequestPost(){return json({error:'Method not allowed'},405);}
