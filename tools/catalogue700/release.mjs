#!/usr/bin/env node
// Private, non-networked assembly and UPSERT generation for catalogue 700.
// The existing 221/400 delivery routes, importers and source files are untouched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ID=/^[a-z0-9][a-z0-9._-]{0,255}$/i;
const HEX=/^[a-f0-9]{64}$/;
export const TABLE700='bb_private_premium_recipes_700_v1';
export const RELEASE_TABLE700='bb_recipe_catalogue_releases_v1';
export const PROTECTED500=Object.freeze({
 privateRows:'f89eaecc9b2ca71fbd8018c7f733e51c630f6992e5ad5def902f609a71fcbc2e',
 freeRecipes:'6fd57db6d082ec4d73900175cf4bffd486673c37f23ff3e4546941f206c691bb',
 freeNormalized:'d9fbaf85f7fb717c44235a02c60a9a80c2fbb50d5e497fd58edd7dedffe9fc58'
});
export const canonicalHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const assert=(value,label)=>{if(!value)throw Error('catalogue700_'+label);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const records=value=>Array.isArray(value)?value:value?.recipes;

function checkPair(recipe,norm,{newRecipe=false}={}){
 assert(object(recipe)&&typeof recipe.id==='string'&&ID.test(recipe.id)&&object(norm)&&norm.id===recipe.id,'recipe_pair');
 assert(Array.isArray(recipe.ingredients)&&Array.isArray(norm.ingredients)&&recipe.ingredients.length===norm.ingredients.length,'ingredient_alignment');
 if(!newRecipe)return;
 assert(recipe.slug===recipe.id&&Number.isInteger(recipe.catalogueNumber)&&recipe.catalogueNumber>=501&&recipe.catalogueNumber<=700,'new_identity');
 assert(['free','premium'].includes(recipe.accessTier)&&recipe.premium===(recipe.accessTier==='premium'),'access_tier');
 assert(Number.isSafeInteger(recipe.servings)&&recipe.servings>0&&recipe.servings<=12&&recipe.baseServings===recipe.servings&&norm.servings===recipe.servings,'servings');
 assert(Array.isArray(recipe.method)&&recipe.method.length>=3&&recipe.method.every(step=>typeof step==='string'&&step.trim().length>=15)&&JSON.stringify(recipe.method)===JSON.stringify(recipe.steps),'method');
 assert(recipe.image===`release-assets/basketboss-v17/images/new/${recipe.id}.webp`,'image_path');
 assert(Number.isFinite(recipe.cost)&&recipe.cost>0&&Number.isFinite(recipe.mins)&&recipe.mins>0,'cost_time');
 for(const market of ['UK','Guernsey','Jersey','US'])assert(Number.isFinite(recipe.ci_estimates?.[market]?.estimate)&&recipe.ci_estimates[market].estimate>0&&recipe.ci_estimates[market].confidence==='INDICATIVE_UNVERIFIED','regional_estimate');
 for(const [index,row]of recipe.ingredients.entries()){
  const n=norm.ingredients[index];
  assert(Array.isArray(row)&&row.length===4&&typeof row[0]==='string'&&row[0].trim()&&typeof row[1]==='string'&&row[1].trim()&&Number.isFinite(row[2])&&row[2]>=0&&typeof row[3]==='string','ingredient_schema');
  assert(n?.name===row[0]&&n.recipe_id===recipe.id&&n.ingredient_index===index&&typeof n.key==='string'&&n.key.trim()&&Number.isFinite(n.quantity)&&n.quantity>0&&typeof n.unit==='string'&&n.unit,'normalization');
 }
}

export function assembleCatalogue700({freeRecipes,freeNormalized,privateRows,additions,additionNormalized,protectedHashes=PROTECTED500}){
 freeNormalized=records(freeNormalized);additionNormalized=records(additionNormalized);
 assert(Array.isArray(freeRecipes)&&freeRecipes.length===100&&Array.isArray(freeNormalized)&&freeNormalized.length===100,'protected_free_count');
 assert(Array.isArray(privateRows)&&privateRows.length===400,'protected_premium_count');
 assert(object(protectedHashes)&&['privateRows','freeRecipes','freeNormalized'].every(key=>HEX.test(protectedHashes[key]||'')),'protected_hashes');
 assert(canonicalHash(freeRecipes)===protectedHashes.freeRecipes&&canonicalHash(freeNormalized)===protectedHashes.freeNormalized&&canonicalHash(privateRows)===protectedHashes.privateRows,'protected_input_changed');
 assert(Array.isArray(additions)&&additions.length===200&&Array.isArray(additionNormalized)&&additionNormalized.length===200,'addition_count');
 const ids=new Set(),numbers=new Set(),legacyRecipes=[],legacyNormalized=[],normalById=new Map(additionNormalized.map(row=>[row?.id,row]));
 assert(normalById.size===200,'duplicate_normalization');
 const freeNormById=new Map(freeNormalized.map(row=>[row?.id,row]));
 assert(freeNormById.size===100,'duplicate_free_normalization');
 for(const recipe of freeRecipes){checkPair(recipe,freeNormById.get(recipe.id));assert(!ids.has(recipe.id),'duplicate_legacy');ids.add(recipe.id);}
 for(const [index,row]of privateRows.entries()){
  assert(object(row)&&Object.keys(row).length===4&&['recipe_id','sort_index','recipe_json','normalized_json'].every(key=>Object.hasOwn(row,key))&&row.sort_index===index&&typeof row.recipe_json==='string'&&typeof row.normalized_json==='string','protected_row');
  const recipe=JSON.parse(row.recipe_json),norm=JSON.parse(row.normalized_json);
  checkPair(recipe,norm);assert(row.recipe_id===recipe.id&&!ids.has(recipe.id),'duplicate_legacy');ids.add(recipe.id);legacyRecipes.push(recipe);legacyNormalized.push(norm);
 }
 const ordered=[...additions].sort((a,b)=>a.catalogueNumber-b.catalogueNumber);
 for(const [index,recipe]of ordered.entries()){
  checkPair(recipe,normalById.get(recipe.id),{newRecipe:true});
  assert(recipe.catalogueNumber===501+index&&!numbers.has(recipe.catalogueNumber)&&!ids.has(recipe.id),'addition_identity_collision');
  ids.add(recipe.id);numbers.add(recipe.catalogueNumber);
 }
 const newFree=ordered.filter(recipe=>recipe.accessTier==='free'),newPremium=ordered.filter(recipe=>recipe.accessTier==='premium');
 assert(newFree.length===100&&newPremium.length===100,'addition_tiers');
 const free=[...clone(freeRecipes),...clone(newFree)],freeNorm=[...clone(freeNormalized),...newFree.map(recipe=>clone(normalById.get(recipe.id)))];
 const premiumRows=[...clone(privateRows),...newPremium.map((recipe,index)=>({recipe_id:recipe.id,sort_index:400+index,recipe_json:JSON.stringify(recipe),normalized_json:JSON.stringify(normalById.get(recipe.id))}))];
 assert(premiumRows.length===500&&ids.size===700&&canonicalHash(premiumRows.slice(0,400))===protectedHashes.privateRows,'assembled_counts');
 return {schemaVersion:1,catalogueVersion:700,activationEligible:false,free,freeNormalized:freeNorm,premiumRows,catalogue:[...clone(freeRecipes),...legacyRecipes,...clone(ordered)],normalized:[...clone(freeNormalized),...legacyNormalized,...ordered.map(recipe=>clone(normalById.get(recipe.id)))],protectedHashes:{...protectedHashes},hashes:{premiumRows:canonicalHash(premiumRows),protectedRows:protectedHashes.privateRows,freeRecipes:canonicalHash(free),freeNormalized:canonicalHash(freeNorm)}};
}

function checkedBundle(bundle){
 assert(bundle?.catalogueVersion===700&&bundle.activationEligible===false&&Array.isArray(bundle.free)&&bundle.free.length===200&&Array.isArray(bundle.freeNormalized)&&bundle.freeNormalized.length===200&&Array.isArray(bundle.premiumRows)&&bundle.premiumRows.length===500,'bundle');
 assert(canonicalHash(bundle.free)===bundle.hashes?.freeRecipes&&canonicalHash(bundle.freeNormalized)===bundle.hashes?.freeNormalized&&canonicalHash(bundle.premiumRows)===bundle.hashes?.premiumRows&&canonicalHash(bundle.premiumRows.slice(0,400))===bundle.hashes?.protectedRows,'bundle_hashes');
 const ids=new Set();
 for(const [index,row]of bundle.premiumRows.entries()){
  assert(row.sort_index===index&&typeof row.recipe_id==='string'&&ID.test(row.recipe_id)&&!ids.has(row.recipe_id),'bundle_rows');ids.add(row.recipe_id);
  const recipe=JSON.parse(row.recipe_json),norm=JSON.parse(row.normalized_json);checkPair(recipe,norm,{newRecipe:index>=400});assert(recipe.id===row.recipe_id,'bundle_row_id');
 }
}

export function catalogue700Metadata(bundle,{releaseId}={}){
 checkedBundle(bundle);assert(typeof releaseId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(releaseId),'release_id');
 return {catalogue_version:700,release_id:releaseId,free_count:200,premium_count:500,premium_rows_sha256:bundle.hashes.premiumRows,protected_rows_sha256:bundle.hashes.protectedRows,free_recipes_sha256:bundle.hashes.freeRecipes,free_normalized_sha256:bundle.hashes.freeNormalized};
}

export function catalogue700UpsertSql(bundle,options={}){
 const metadata=catalogue700Metadata(bundle,options);
 const quote=value=>{assert(typeof value==='string'&&!value.includes('\0'),'sql_text');return "'"+value.replaceAll("'","''")+"'";};
 const guard=condition=>`SELECT CASE WHEN ${condition} THEN 1 ELSE abs(-9223372036854775808) END;`;
 const match=(table,row)=>`EXISTS(SELECT 1 FROM ${table} WHERE recipe_id=${quote(row.recipe_id)} AND sort_index=${row.sort_index} AND recipe_json=${quote(row.recipe_json)} AND normalized_json=${quote(row.normalized_json)})`;
 const schema=[
  `CREATE TABLE IF NOT EXISTS ${TABLE700} (recipe_id TEXT PRIMARY KEY,sort_index INTEGER NOT NULL UNIQUE CHECK(sort_index BETWEEN 0 AND 499),recipe_json TEXT NOT NULL,normalized_json TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS ${RELEASE_TABLE700} (catalogue_version INTEGER PRIMARY KEY CHECK(catalogue_version=700),release_id TEXT NOT NULL,free_count INTEGER NOT NULL CHECK(free_count=200),premium_count INTEGER NOT NULL CHECK(premium_count=500),premium_rows_sha256 TEXT NOT NULL,protected_rows_sha256 TEXT NOT NULL,free_recipes_sha256 TEXT NOT NULL,free_normalized_sha256 TEXT NOT NULL);`
 ];
 const statements=[
  '-- PRIVATE catalogue-700 review import. Never publish this SQL or its recipe contents.',
  '-- Import the WHOLE file atomically with Wrangler d1 execute --remote --file.',
  '-- No BEGIN/COMMIT: D1 file import owns the transaction. Never execute piecemeal.',
  '-- Legacy 221 and versioned-500 tables are read-only. No DELETE or REPLACE is used.',
  ...schema,
  guard('(SELECT COUNT(*) FROM bb_private_premium_recipes_500_v1)=400'),
  ...bundle.premiumRows.slice(0,400).map(row=>guard(match('bb_private_premium_recipes_500_v1',row))),
  ...bundle.premiumRows.map((row,index)=>`INSERT INTO ${TABLE700} (recipe_id,sort_index,recipe_json,normalized_json) VALUES (${quote(row.recipe_id)},${index},${quote(row.recipe_json)},${quote(row.normalized_json)}) ON CONFLICT(recipe_id) ${index<400?'DO NOTHING':`DO UPDATE SET sort_index=excluded.sort_index,recipe_json=excluded.recipe_json,normalized_json=excluded.normalized_json WHERE ${TABLE700}.sort_index>=400`};`),
  ...bundle.premiumRows.map(row=>guard(match(TABLE700,row))),
  guard(`(SELECT COUNT(*) FROM ${TABLE700})=500`),
  `INSERT INTO ${RELEASE_TABLE700} (${Object.keys(metadata).join(',')}) VALUES (${Object.values(metadata).map(value=>typeof value==='number'?value:quote(value)).join(',')}) ON CONFLICT(catalogue_version) DO UPDATE SET ${Object.keys(metadata).filter(key=>key!=='catalogue_version').map(key=>`${key}=excluded.${key}`).join(',')};`,
  ''
 ];
 assert(statements.every(statement=>Buffer.byteLength(statement,'utf8')<=100000),'sql_statement_size');
 return statements.join('\n');
}

export function private700OutputDirectory(directory,publicRoot=ROOT){
 const resolved=path.resolve(directory),root=fs.realpathSync(publicRoot);
 assert(resolved!==root&&!resolved.startsWith(root+path.sep),'private_output_under_public_root');
 let ancestor=resolved;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
 const actualAncestor=fs.realpathSync(ancestor);assert(actualAncestor!==root&&!actualAncestor.startsWith(root+path.sep),'private_output_symlink');
 fs.mkdirSync(resolved,{recursive:true,mode:0o700});
 const actual=fs.realpathSync(resolved);assert(actual!==root&&!actual.startsWith(root+path.sep),'private_output_under_public_root');return actual;
}

async function main(){
 const args=process.argv.slice(2),value=name=>{const at=args.indexOf(name);assert(at>=0&&args[at+1]&&!args[at+1].startsWith('--'),'missing_'+name.slice(2));return args[at+1];};
 // Inputs contain private recipe records. Inputs and outputs must both stay
 // outside the public checkout; this tool does not apply SQL or use network.
 const inputPath=fs.realpathSync(value('--staged-inputs')),root=fs.realpathSync(ROOT);assert(inputPath!==root&&!inputPath.startsWith(root+path.sep),'private_input_under_public_root');
 const inputs=JSON.parse(fs.readFileSync(inputPath,'utf8'));
 // The function's explicit hash parameter supports isolated synthetic tests;
 // a real command-line import can never replace the protected release pins.
 assert(!Object.hasOwn(inputs,'protectedHashes'),'protected_hash_override');
 const bundle=assembleCatalogue700(inputs),releaseId=value('--release-id'),out=private700OutputDirectory(value('--output-dir'));
 const metadata=catalogue700Metadata(bundle,{releaseId}),write=(name,data)=>{const file=path.join(out,name);fs.writeFileSync(file,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.chmodSync(file,0o600);};
 write('premium-500.upsert.private.sql',catalogue700UpsertSql(bundle,{releaseId}));
 write('catalogue700.private.json',bundle);
 write('catalogue700.release-metadata.json',metadata);
 console.log(JSON.stringify({status:'STAGED_FILES_ONLY',activationEligible:false,outputDirectory:out,counts:{free:200,premium:500,total:700},hashes:bundle.hashes,networkUsed:false,databaseWritten:false}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
