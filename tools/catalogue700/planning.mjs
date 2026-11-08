// Staged catalogue-700 policy only. This module is deliberately not imported
// by app.html, native bundles, the current API, or the catalogue-500 planner.
// The reviewed role manifest is data, never a Free/Premium entitlement grant.
const text=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
const NON_DINNER=/\b(?:desserts?|baking|breakfast|brunch|sweet treats?|snacks?|side dishes?|lunch(?:box)?|drinks?|smoothies?)\b|after.school/;
const SWEET_NAME=/\b(?:brownies?|cookies?|muffins?|cupcakes?|waffles?|porridge|granola|overnight oats|french toast)\b/;
const ID=/^[a-z0-9][a-z0-9._-]{0,255}$/i;

export function isCatalogueDinner(recipe,{catalogueVersion=500,roles,legacyIsDinner}={}){
 if(typeof legacyIsDinner!=='function')return false;
 // No new interpretation is introduced for any existing client/catalogue.
 if(catalogueVersion!==700)return legacyIsDinner(recipe)===true;
 if(!recipe||typeof recipe.id!=='string'||!ID.test(recipe.id))return false;
 if(roles?.schemaVersion!==1||roles.catalogueVersion!==700||roles.legacyCatalogueVersion!==500||!Array.isArray(roles.legacyRecipeIds)||roles.legacyRecipeIds.length!==500||new Set(roles.legacyRecipeIds).size!==500||roles.legacyRecipeIds.some(id=>typeof id!=='string'||!ID.test(id))||!Array.isArray(roles.recipes))return false;
 // Existing IDs always use the exact old predicate, including old objects
 // with no catalogueNumber. Unknown IDs cannot masquerade as such objects.
 if(roles.legacyRecipeIds.includes(recipe.id))return legacyIsDinner(recipe)===true;
 if(new Set(roles.recipes.map(role=>role?.id)).size!==roles.recipes.length||new Set(roles.recipes.map(role=>role?.catalogueNumber)).size!==roles.recipes.length||roles.recipes.some(role=>!role||typeof role.id!=='string'||!ID.test(role.id)||roles.legacyRecipeIds.includes(role.id)||!Number.isInteger(role.catalogueNumber)||role.catalogueNumber<501||role.catalogueNumber>700||!['dinner','breakfast','dessert','starter','side'].includes(role.kind)))return false;
 const number=recipe.catalogueNumber;
 if(!Number.isInteger(number)||number<501||number>700)return false;
 const matches=roles.recipes.filter(role=>role?.id===recipe.id);
 if(matches.length!==1)return false;
 const role=matches[0];
 if(role.catalogueNumber!==number||role.kind!=='dinner'||recipe.dinnerEligible!==true)return false;
 // Even an explicit dinner flag cannot route a labelled breakfast/dessert
 // into Auto-fill. Reviewed savoury duck pancakes remain a valid dinner.
 const category=[recipe.category,recipe.tag,recipe.mealType].map(text).join(' ');
 const reviewedSavouryWaffles=recipe.id==='southern-chicken-and-waffles'&&number===641&&text(recipe.name)==='southern chicken and waffles'&&recipe.primaryProtein==='chicken';
 return !NON_DINNER.test(category)&&(!SWEET_NAME.test(text(recipe.name))||reviewedSavouryWaffles);
}
