/* Authenticated Premium recipe delivery. Never served as a static JSON asset. */
import {json,authenticatedUser,isBillingEnabled,isConfigured,expectedPrice,entitlementForStatus} from '../../../bb-server-lib/bb-billing.js';
import {sharedHouseholdPremiumOwner} from '../../../bb-server-lib/bb-household-premium.js';
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
      if(!premium)premium=!!await sharedHouseholdPremiumOwner(request,env,user);
    }
    if(!premium)return json({error:'Verified Premium subscription required'},403);
    const expanded=new URL(request.url).searchParams.get('catalogue')==='500';
    let rows=null,versioned=false;
    if(expanded){
      let candidate;
      try{
        candidate=await env.BILLING_DB.prepare('SELECT recipe_id,sort_index,recipe_json,normalized_json FROM bb_private_premium_recipes_500_v1 ORDER BY sort_index').all();
      }catch(error){
        // A missing optional table is the only database error that permits a
        // legacy fallback. Network, permission and schema errors fail closed.
        if(!/\bno such table:\s*["'`]?bb_private_premium_recipes_500_v1["'`]?(?:\s|:|$)/i.test(String(error?.message||'')))throw error;
        candidate={results:[]};
      }
      if(!Array.isArray(candidate?.results))return json({error:'Premium catalogue invalid'},503);
      if(candidate.results.length){
        if(candidate.results.length!==400)return json({error:'Premium catalogue incomplete'},503);
        rows=candidate;versioned=true;
      }
    }
    if(!rows)rows=await env.BILLING_DB.prepare('SELECT recipe_json,normalized_json FROM bb_private_premium_recipes ORDER BY sort_index').all();
    // Accept only complete, approved releases while the expanded catalogue is staged.
    if(!Array.isArray(rows?.results)||![221,400].includes(rows.results.length))return json({error:'Premium catalogue incomplete'},503);
    const recipes=[],normalized=[],ids=new Set();
    for(const row of rows.results){
      const recipe=JSON.parse(row.recipe_json),norm=JSON.parse(row.normalized_json);
      if(typeof recipe?.id!=='string'||!recipe.id||recipe.id!==norm?.id||ids.has(recipe.id))return json({error:'Premium catalogue invalid'},503);
      if(versioned&&(row.recipe_id!==recipe.id||row.sort_index!==recipes.length))return json({error:'Premium catalogue invalid'},503);
      ids.add(recipe.id);recipes.push(recipe);normalized.push(norm);
    }
    // Old installed clients require exactly 221 Premium records. The import
    // preserves those legacy rows first; only versioned new clients opt in to
    // the expanded response. Authenticate and validate the full release first.
    const count=expanded?recipes.length:221;
    return json({recipes:recipes.slice(0,count),normalized:normalized.slice(0,count),count,total:100+count,targetTotal:500});
  }catch(error){console.error('Premium catalogue unavailable',error);return json({error:'Premium catalogue unavailable'},503);}
}
export function onRequestPost(){return json({error:'Method not allowed'},405);}
