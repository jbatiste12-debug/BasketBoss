/* Explicit catalogue-700 delivery. The installed catalogue-500 route is unchanged. */
import {json,authenticatedUser,isConfigured,digestHex} from '../../../../bb-server-lib/bb-billing.js';
import {paidBillingEnabled,readMemberPaidAccess} from '../../../../bb-server-lib/bb-paid-access.js';

const HEX=/^[a-f0-9]{64}$/;
const RELEASE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ID=/^[a-z0-9][a-z0-9._-]{0,255}$/i;
const PROTECTED_ROWS_SHA256='f89eaecc9b2ca71fbd8018c7f733e51c630f6992e5ad5def902f609a71fcbc2e';
const PRIVATE_TABLE='bb_private_premium_recipes_700_v1';
const RELEASE_TABLE='bb_recipe_catalogue_releases_v1';
const unavailable=()=>json({error:'Premium catalogue unavailable'},503);
const invalid=()=>json({error:'Premium catalogue invalid'},503);

export async function onRequestGet({request,env}){
 const params=new URL(request.url).searchParams;
 if(params.getAll('catalogue').length!==1||params.get('catalogue')!=='700'||[...params.keys()].some(key=>key!=='catalogue'))return json({error:'Request catalogue 700 explicitly'},400);
 // A new route cannot silently change an installed client's catalogue. The
 // release remains unavailable until a complete import and explicit pinning.
 if(env.BB_CATALOGUE700_ENABLED!=='true'||!isConfigured(env)||!RELEASE.test(env.BB_CATALOGUE700_RELEASE_ID||'')||!HEX.test(env.BB_CATALOGUE700_ROWS_SHA256||'')||!HEX.test(env.BB_CATALOGUE700_FREE_SHA256||'')||!HEX.test(env.BB_CATALOGUE700_NORMALIZED_SHA256||''))return unavailable();
 const user=await authenticatedUser(request,env);
 if(!user)return json({error:'Sign in with a verified account'},401);
 const owner=!!env.BB_OWNER_USER_ID&&user.id===env.BB_OWNER_USER_ID;
 if(!owner&&!paidBillingEnabled(env))return unavailable();
 try{
  if(!owner&&(await readMemberPaidAccess(request,env,user)).premiumAccess!==true)return json({error:'Verified Premium subscription required'},403);
  const release=await env.BILLING_DB.prepare(`SELECT catalogue_version,release_id,free_count,premium_count,premium_rows_sha256,protected_rows_sha256,free_recipes_sha256,free_normalized_sha256 FROM ${RELEASE_TABLE} WHERE catalogue_version=?`).bind(700).first();
  if(!release||release.catalogue_version!==700||release.free_count!==200||release.premium_count!==500||release.release_id!==env.BB_CATALOGUE700_RELEASE_ID||release.premium_rows_sha256!==env.BB_CATALOGUE700_ROWS_SHA256||release.free_recipes_sha256!==env.BB_CATALOGUE700_FREE_SHA256||release.free_normalized_sha256!==env.BB_CATALOGUE700_NORMALIZED_SHA256||release.protected_rows_sha256!==PROTECTED_ROWS_SHA256)return invalid();
  const result=await env.BILLING_DB.prepare(`SELECT recipe_id,sort_index,recipe_json,normalized_json FROM ${PRIVATE_TABLE} ORDER BY sort_index`).all();
  if(!Array.isArray(result?.results)||result.results.length!==500)return json({error:'Premium catalogue incomplete'},503);
  const rows=[],recipes=[],normalized=[],ids=new Set(),numbers=new Set();
  for(const [index,row]of result.results.entries()){
   if(typeof row?.recipe_id!=='string'||!ID.test(row.recipe_id)||row.sort_index!==index||typeof row.recipe_json!=='string'||typeof row.normalized_json!=='string')return invalid();
   const recipe=JSON.parse(row.recipe_json),norm=JSON.parse(row.normalized_json);
   if(recipe?.id!==row.recipe_id||norm?.id!==row.recipe_id||ids.has(row.recipe_id))return invalid();
   if(index>=400){
    if(recipe.accessTier!=='premium'||recipe.premium!==true||!Number.isInteger(recipe.catalogueNumber)||recipe.catalogueNumber<501||recipe.catalogueNumber>700||numbers.has(recipe.catalogueNumber)||!Array.isArray(recipe.ingredients)||!Array.isArray(norm.ingredients)||recipe.ingredients.length!==norm.ingredients.length)return invalid();
    numbers.add(recipe.catalogueNumber);
   }
   // Reconstruct exact ordered fields before hashing: database column order
   // and D1 response metadata cannot change the release digest.
   rows.push({recipe_id:row.recipe_id,sort_index:row.sort_index,recipe_json:row.recipe_json,normalized_json:row.normalized_json});
   ids.add(row.recipe_id);recipes.push(recipe);normalized.push(norm);
  }
  if(await digestHex(JSON.stringify(rows))!==release.premium_rows_sha256||await digestHex(JSON.stringify(rows.slice(0,400)))!==release.protected_rows_sha256)return invalid();
  return json({catalogueVersion:700,releaseId:release.release_id,recipes,normalized,count:500,total:700,targetTotal:700,freeRecipesSha256:release.free_recipes_sha256,freeNormalizedSha256:release.free_normalized_sha256});
 }catch{
  // Do not log private recipe JSON, row contents or entitlement credentials.
  return unavailable();
 }
}
export function onRequestPost(){return json({error:'Method not allowed'},405);}
