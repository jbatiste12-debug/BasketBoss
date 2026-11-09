// Shared isolated catalogue-700 loader for the pantry/photo companion.
// Pure transforms only: native and PWA builders provide their own public URL.
import {sha256Utf8} from './client-integrity.mjs';
import {transform700Presentation} from './presentation.mjs';
const assert=(value,label)=>{if(!value)throw Error('catalogue700_make_'+label);};
const literal=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
function once(source,from,to,label){const at=source.indexOf(from);assert(at>=0&&source.indexOf(from,at+from.length)<0,'anchor_'+label);return source.slice(0,at)+to+source.slice(at+from.length);}

export function pwa700Contract(release){return {catalogueVersion:700,clientVersion:'1.0.2',releaseId:release.manifest.release_id,freeRecipesSha256:release.manifest.free_recipes_sha256,freeNormalizedSha256:release.manifest.free_normalized_sha256,premiumIds:release.premiumIds};}

// The pantry/photo page has an independent loader. It uses the same exact
// public proof, release pins, positional identities and account fence as Plan.
export function transform700MakeAMeal(source,release,{publicRecipesUrl='/pwa700/recipes.json'}={}){
 assert(['recipes.json','/pwa700/recipes.json'].includes(publicRecipesUrl),'public_recipe_url');
 const contract=pwa700Contract(release),portable=sha256Utf8.toString().replace('function sha256Utf8(','function bbPwa700Digest(');
 source=once(source,"(()=>{'use strict';","(()=>{'use strict';\n"+portable+'\nconst BB_PWA700_RELEASE=Object.freeze('+literal(contract)+');\nlet bbPwa700PremiumRequest=0;\nfunction bbPwa700Identity(){try{const session=JSON.parse(localStorage.getItem(\'basketboss_cloud_session_v1\')||\'null\');return typeof session?.user?.id===\'string\'&&session.user.id&&session.access_token===bbPaidToken()?session.user.id+\'|\'+session.access_token:null;}catch{return null;}}\n','make_contract');
 const start=source.indexOf('async function bbSecureRefreshPremiumRecipes(){'),end=source.indexOf('function bbSecureCheckAccountChange(){',start);assert(start>=0&&end>start,'make_loader');
 source=source.slice(0,start)+`async function bbSecureRefreshPremiumRecipes(){
 const revision=++bbPwa700PremiumRequest,token=bbPaidToken(),identity=bbPwa700Identity();
 bbSecureLastToken=token;
 if(bbPhotoMealMode)return;
 bbSecurePremiumIds=new Set();recipes=bbSecureFreeRecipes.slice();renderTiles();
 if(!token||!identity||bbSecureFreeRecipes.length!==200||bbPwa700Digest(JSON.stringify(bbSecureFreeRecipes))!==BB_PWA700_RELEASE.freeRecipesSha256)return;
 try{
  const {response,data}=await bbMealJSON('/api/recipes/v700/premium?catalogue=700',{cache:'no-store',credentials:'same-origin',redirect:'manual',headers:{Accept:'application/json',Authorization:'Bearer '+token}});
  if(!response.ok||data?.catalogueVersion!==700||data.releaseId!==BB_PWA700_RELEASE.releaseId||data.count!==500||data.total!==700||data.targetTotal!==700||data.freeRecipesSha256!==BB_PWA700_RELEASE.freeRecipesSha256||data.freeNormalizedSha256!==BB_PWA700_RELEASE.freeNormalizedSha256||!Array.isArray(data.recipes)||data.recipes.length!==500||!Array.isArray(data.normalized)||data.normalized.length!==500)return;
  const ids=new Set();
  for(let index=0;index<500;index++){const recipe=data.recipes[index],normal=data.normalized[index];if(recipe?.id!==BB_PWA700_RELEASE.premiumIds[index]||ids.has(recipe.id)||bbSecureFreeIds.has(recipe.id)||normal?.id!==recipe.id||!Array.isArray(recipe.ingredients)||!Array.isArray(normal.ingredients)||normal.ingredients.length!==recipe.ingredients.length||normal.ingredients.some((row,slot)=>row?.recipe_id!==recipe.id||row.ingredient_index!==slot||row.name!==recipe.ingredients[slot]?.[0]))return;ids.add(recipe.id);}
  if(revision!==bbPwa700PremiumRequest||bbPwa700Identity()!==identity)return;
  bbSecurePremiumIds=ids;recipes=bbSecureFreeRecipes.concat(data.recipes);renderTiles();
 }catch{ /* A missing, stale or unverified response never grants Premium. */ }
}
`+source.slice(end);
 source=once(source,"bbMealJSON('recipes.json',{cache:'no-store'})","bbMealJSON('"+publicRecipesUrl+"',{cache:'no-store'})",'make_public_route');
 source=once(source,'data.length!==100||bbSecureFreeIds.size!==100||','data.length!==200||bbSecureFreeIds.size!==200||','make_free_count');
 source=once(source,'new Set(data.map(r=>r.id)).size!==100)','new Set(data.map(r=>r.id)).size!==200||bbPwa700Digest(JSON.stringify(data))!==BB_PWA700_RELEASE.freeRecipesSha256)','make_free_integrity');
 source=once(source,'function isDinner(r){const category=',"function isDinner(r){if(window.BBRecipePlanning)return window.BBRecipePlanning.isDinner(r);return false;}\nfunction bbPwa700LegacyDinnerUnused(r){const category=",'make_roles');
 return transform700Presentation(source);
}
