import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import planning from '../bb-recipe-planning.js';
import {isCatalogueDinner} from '../tools/catalogue700/planning.mjs';
import {webpDimensions} from '../scripts/verify-recipe-expansion.mjs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url));
const json=name=>JSON.parse(read(name));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const base='catalogues/700/pilot/',manifest=json(base+'manifest.json'),roles=json(base+'planning-roles.json');

test('the five-recipe pilot cannot be mistaken for a complete or active 700 release',()=>{
 assert.equal(manifest.activationEligible,false);
 assert.deepEqual(manifest.counts,{protectedExisting:500,pilot:5,newFree:2,newPremium:3,target:700,remainingNew:195});
 assert.equal(manifest.planning.wiredIntoCurrentClient,false);
 assert.equal(manifest.packOverlay.appliedToProduction,false);
 for(const [name,value]of Object.entries(json(base+'validation-summary.json').protectedFiles)){
  assert.equal(hash(read(name)),value.sha256,name+' is protected from pilot authoring');
 }
 assert.match(read('functions/api/recipes/premium.js').toString(),/searchParams\.get\('catalogue'\)==='500'/);
 assert.doesNotMatch(read('functions/api/recipes/premium.js').toString(),/catalogue700|catalogue=700|recipes_700/);
});

test('Free recipes retain exact aligned source, normalized and Cook arrays',()=>{
 const recipes=json(base+'free.recipes.json'),normal=json(base+'free.normalized.json').recipes;
 assert.equal(recipes.length,2);assert.equal(normal.length,2);
 for(const recipe of recipes){
  assert.equal(recipe.accessTier,'free');assert.equal(recipe.premium,false);
  const nr=normal.find(row=>row.id===recipe.id);assert.ok(nr);assert.equal(nr.servings,recipe.servings);
  assert.deepEqual(recipe.method,recipe.steps);
  assert.equal(nr.ingredients.length,recipe.ingredients.length);
  recipe.ingredients.forEach((row,index)=>{
   assert.equal(row.length,4);assert.equal(typeof row[0],'string');assert.equal(typeof row[1],'string');assert.ok(Number.isFinite(row[2])&&row[2]>=0);
   assert.equal(recipe.ingredient_display_lines[index],row[0]+' — '+row[1]);
   assert.equal(nr.ingredients[index].name,row[0]);assert.equal(nr.ingredients[index].ingredient_index,index);assert.equal(nr.ingredients[index].recipe_id,recipe.id);
  });
 }
});

test('Premium pilot records are encrypted, separate from Free exports and not importable as a live catalogue',()=>{
 const sealed=json(manifest.premiumData.sealed);
 assert.equal(sealed.suite,'X25519-HKDF-SHA256-AES-256-GCM');
 assert.equal(sealed.metadata.releaseId,'catalogue700-pilot-20261108');
 assert.equal(hash(read(manifest.premiumData.sealed)),manifest.premiumData.sealedSha256);
 assert.equal(sealed.metadata.plaintextSha256,manifest.premiumData.plaintextSha256);
 assert.ok(Buffer.from(sealed.ciphertext,'base64').length>10000);
 for(const field of ['recipes','normalized','rows','method','ingredients'])assert.equal(Object.hasOwn(sealed,field),false);
 const freeIds=new Set(json(base+'free.recipes.json').map(row=>row.id));
 for(const recipe of manifest.recipes.filter(row=>row.accessTier==='premium'))assert.equal(freeIds.has(recipe.id),false);
});

test('each new thumbnail is a unique exact-size WebP with a hash-bound visual review',()=>{
 const reviews=json(base+'image-naturalness-review.json').images,hashes=new Set();
 assert.equal(manifest.recipes.length,5);
 for(const recipe of manifest.recipes){
  assert.equal(recipe.image,'release-assets/basketboss-v17/images/new/'+recipe.id+'.webp');
  const bytes=read(manifest.assetsRoot+'/'+recipe.image),digest=hash(bytes),size=webpDimensions(bytes);
  assert.equal(size.width,1448);assert.equal(size.height,1086);assert.equal(digest,recipe.sha256);assert.equal(hashes.has(digest),false);hashes.add(digest);
  const review=reviews.find(row=>row.id===recipe.id);assert.equal(review.image,recipe.image);assert.equal(review.sha256,digest);assert.equal(review.naturalnessReview,'passed');
 }
 assert.equal(manifest.recipes.filter(row=>row.photoServings===4).length,2,'family-sharing photographs are mixed with individual plates');
 assert.match(manifest.recipes.find(row=>row.catalogueNumber===501).composition,/overhead/i);
 assert.match(manifest.recipes.find(row=>row.catalogueNumber===545).composition,/low/i);
});

test('all legacy identities preserve the exact predicate and recipe reference under both catalogue versions',()=>{
 const current=new Map(json('recipes.json').map(recipe=>[recipe.id,recipe]));
 assert.equal(roles.legacyRecipeIds.length,500);
 for(const [index,id]of roles.legacyRecipeIds.entries()){
  const recipe=current.get(id)||{id,category:index%2?'Breakfast':'Family Meals'};
  const legacy=value=>{assert.equal(value,recipe);return planning.isDinner(value);};
  for(const version of [500,700])assert.equal(isCatalogueDinner(recipe,{catalogueVersion:version,roles,legacyIsDinner:legacy}),planning.isDinner(recipe));
 }
});

test('savoury duck pancakes become dinner only through the explicit future-700 role',()=>{
 const recipe={...manifest.recipes.find(row=>row.catalogueNumber===501),category:'Family Meals · Fakeaways'};
 assert.equal(planning.isDinner(recipe),false,'the shared legacy rule remains unchanged');
 assert.equal(isCatalogueDinner(recipe,{catalogueVersion:500,roles,legacyIsDinner:planning.isDinner}),false);
 assert.equal(isCatalogueDinner(recipe,{catalogueVersion:700,roles,legacyIsDinner:planning.isDinner}),true);
 assert.equal(isCatalogueDinner({...recipe,catalogueNumber:502},{catalogueVersion:700,roles,legacyIsDinner:planning.isDinner}),false);
});

test('unknown IDs and breakfast or dessert flags cannot become automatic dinners',()=>{
 const options={catalogueVersion:700,roles,legacyIsDinner:()=>true};
 assert.equal(isCatalogueDinner({id:'unknown-new-pancakes',catalogueNumber:501,name:'Pancakes',dinnerEligible:true},options),false);
 const recipe=manifest.recipes.find(row=>row.catalogueNumber===528);
 assert.equal(isCatalogueDinner({...recipe,dinnerEligible:true,category:'Breakfast & Brunch'},options),false);
 const duck=manifest.recipes.find(row=>row.catalogueNumber===501);
 assert.equal(isCatalogueDinner({...duck,category:'Breakfast & Brunch'},options),false);
 assert.equal(isCatalogueDinner(duck,{...options,roles:{...roles,recipes:[...roles.recipes,roles.recipes[0]]}}),false);
});

test('the two new pack guides stay explicit, separate and unverified',()=>{
 const packs=json(base+'pack-additions.json').ingredients;
 assert.deepEqual(Object.keys(packs).sort(),['hoisin sauce|g','pork spare ribs|g']);
 for(const pack of Object.values(packs)){
  assert.equal(pack.needs_review,true);assert.equal(pack.evidence_status,'ILLUSTRATIVE_UNVERIFIED');assert.equal(pack.standard_pack_unit,'g');
 }
 assert.match(packs['pork spare ribs|g'].reason,/raw bone-in/i);
});

test('a future starter or side role stays out of dinner without invalidating other reviewed dishes',()=>{
 const duck={...manifest.recipes.find(row=>row.catalogueNumber===501),category:'Family Meals · Fakeaways'};
 for(const kind of ['starter','side']){
  const updated={...roles,recipes:[...roles.recipes,{id:'future-reviewed-starter',catalogueNumber:503,kind}]};
  const options={catalogueVersion:700,roles:updated,legacyIsDinner:planning.isDinner};
  assert.equal(isCatalogueDinner(duck,options),true);
  assert.equal(isCatalogueDinner({id:'future-reviewed-starter',catalogueNumber:503,name:'Savoury starter',dinnerEligible:true},options),false);
 }
});
