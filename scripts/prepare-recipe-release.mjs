#!/usr/bin/env node
// Prepare a private import/review bundle. This script never connects to D1 or deploys.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyLegacyOverrides,culinaryConcept} from './verify-recipe-expansion.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BASELINE='9458903c4ba06fc54a558fbe05886bfa5326ab98';
export const VERSIONED_PREMIUM_TABLE='bb_private_premium_recipes_500_v1';
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const records=value=>Array.isArray(value)?value:value.recipes;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});

export function privateOutputDirectory(directory,publicRoot=ROOT){
 const resolved=path.resolve(directory),root=fs.realpathSync(publicRoot);
 assert(resolved!==root&&!resolved.startsWith(root+path.sep),'Private recipes cannot be written under the public checkout');
 fs.mkdirSync(resolved,{recursive:true});
 const actual=fs.realpathSync(resolved);
 assert(actual!==root&&!actual.startsWith(root+path.sep),'Private output resolves into the public checkout');
 return actual;
}

export function premiumImportSql(rows){
 assert(Array.isArray(rows)&&rows.length===400,'Versioned Premium import requires exactly 400 rows');
 const quote=value=>{
  assert(typeof value==='string'&&!value.includes('\0'),'SQL values must be text without NUL bytes');
  return "'"+value.replaceAll("'","''")+"'";
 };
 const ids=new Set();
 const inserts=rows.map((row,index)=>{
  assert(row?.sort_index===index,'Premium sort indexes must cover 0–399 in order');
  const recipe=JSON.parse(row.recipe_json),normalized=JSON.parse(row.normalized_json),id=recipe?.id;
  assert(typeof id==='string'&&/^[a-z0-9][a-z0-9._-]{0,255}$/i.test(id)&&id===normalized?.id&&!ids.has(id),'Invalid or duplicate Premium recipe ID');
  assert(row.recipe_id===undefined||row.recipe_id===id,'Premium row ID must match its recipe');
  ids.add(id);
  const sql=`INSERT INTO ${VERSIONED_PREMIUM_TABLE} (recipe_id,sort_index,recipe_json,normalized_json) VALUES (${quote(id)},${index},${quote(row.recipe_json)},${quote(row.normalized_json)});`;
  assert(Buffer.byteLength(sql,'utf8')<=100000,'A Premium row exceeds the D1 SQL statement size limit');
  return sql;
 });
 return [
  '-- BasketBoss private 400-record Premium catalogue. Never publish this file.',
  '-- Import the WHOLE file with Wrangler d1 execute <database> --remote --file <this-file>.',
  '-- D1 file import applies the file atomically and rolls back failed imports.',
  '-- Do not run statements separately. The existing legacy table is untouched.',
  '-- No BEGIN/COMMIT statements: the D1 import service owns the transaction.',
  `CREATE TABLE IF NOT EXISTS ${VERSIONED_PREMIUM_TABLE} (recipe_id TEXT PRIMARY KEY,sort_index INTEGER NOT NULL UNIQUE,recipe_json TEXT NOT NULL,normalized_json TEXT NOT NULL);`,
  `DELETE FROM ${VERSIONED_PREMIUM_TABLE};`,
  ...inserts,
  ''
 ].join('\n');
}

export function assembleCatalogue({baseline,legacyNormalized,freeIds,additions,additionNormalized,planning,pricing}){
 assert(baseline.length===321&&freeIds.size===100,'Expected authoritative 321 baseline and 100 Free IDs');
 assert(additions.length===179&&additionNormalized.length===179,'A complete release requires all 179 additions');
 const newNumbers=additions.map(r=>r.catalogueNumber).sort((a,b)=>a-b);
 assert(newNumbers.every((n,i)=>n===322+i),'New catalogue numbers must cover 322–500 exactly');
 const all=[...baseline,...additions],allNorm=[...legacyNormalized,...additionNormalized];
 assert(all.length===500&&allNorm.length===500,'Recipe and normalized catalogues must each contain 500 records');
 const ids=all.map(r=>r.id),normById=new Map(allNorm.map(r=>[r.id,r]));
 assert(new Set(ids).size===500&&normById.size===500,'Recipe IDs must remain unique');
 assert([...freeIds].every(id=>ids.includes(id)),'A Free baseline recipe is missing');
 const catalogue=all.map((original,index)=>{
  const r=JSON.parse(JSON.stringify(original)),nr=normById.get(r.id);
  assert(typeof r.id==='string'&&nr&&nr.ingredients.length===r.ingredients.length,'Missing or misaligned normalized record: '+r.id);
  Object.assign(r,planning.metadata(r));
  r.fingerprint=r.fingerprint||r.culinaryFingerprint||culinaryConcept(r);
  r.accessTier=freeIds.has(r.id)?'free':'premium';
  r.premium=r.accessTier==='premium';
  r.catalogueNumber=index<321?index+1:r.catalogueNumber;
  r.ci_estimates={};
  for(const market of ['UK','Guernsey','Jersey','US']){
   const estimate=pricing.estimateMeal({ingredients:nr.ingredients,market});
   assert(!estimate.pending&&Number.isFinite(estimate.amount)&&estimate.amount>=0,'Unresolved estimate '+r.id+'/'+market);
   const currency=market==='US'?'USD':'GBP',servings=Number(r.baseServings||r.servings||nr.servings);
   assert(Number.isFinite(servings)&&servings>0,'Invalid servings: '+r.id);
   r.ci_estimates[market]={estimate:estimate.amount,currency,per_serving_estimate:round(estimate.amount/servings),confidence:'INDICATIVE_UNVERIFIED',cost_basis:'Regional fresh-item packs plus fractional pantry usage.',[market==='US'?'estimate_usd':'estimate_gbp']:estimate.amount};
  }
  r.cost=r.ci_estimates.UK.estimate;
  return r;
 });
 const premium=catalogue.filter(r=>r.premium),free=catalogue.filter(r=>!r.premium);
 assert(premium.length===400&&free.length===100,'Expected 400 Premium and 100 Free recipes');
 assert(baseline.every((r,i)=>catalogue[i].id===r.id),'A legacy saved-plan ID was changed');
 return {catalogue,normalized:allNorm,free,premium,premiumRows:premium.map((r,i)=>({recipe_id:r.id,sort_index:i,recipe_json:JSON.stringify(r),normalized_json:JSON.stringify(normById.get(r.id))}))};
}

async function main(){
 const stage=path.resolve(option('--staging-dir',path.resolve(ROOT,'../basketboss-expansion-staging')));
 const pending=args.includes('--allow-pending-images');
 const reportFile=path.resolve(option('--verification-report',path.join(stage,'gate',pending?'full-500-content.verification.json':'full-500.verification.json')));
 const report=read(reportFile);
 assert(report.mode==='full'&&report.counts?.total===500&&report.failures?.length===0,'A passing full-500 verification report is required');
 assert(report.status===(pending?'content-checks-passed':'automated-checks-passed'),'Verification status does not match the requested release stage');
 const files={recipes:path.join(stage,'recipes-322-500.json'),normalized:path.join(stage,'recipes-322-500.normalized.json'),imageBriefs:path.join(stage,'image-briefs-322-500.json')};
 for(const [field,file]of Object.entries(files))assert(report.sourceHashes?.[field]===digest(fs.readFileSync(file)),'Verified source changed: '+field);
 const gitJSON=file=>JSON.parse(execFileSync('git',['show',BASELINE+':'+file],{cwd:ROOT,encoding:'utf8',maxBuffer:20*1024*1024}));
 const legacy=applyLegacyOverrides(records(gitJSON('recipes.json')),records(gitJSON('normalized-ingredient-database.json')),{recipeFile:path.join(stage,'legacy-recipe-overrides.json'),normalizedFile:path.join(stage,'legacy-normalization-overrides.json')});
 const context={};context.window=context;context.globalThis=context;vm.createContext(context);
 for(const file of ['basketboss-aisles-v20.js','basketboss-pricing-v19.js','bb-recipe-planning.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),context);
 const bundle=assembleCatalogue({baseline:legacy.recipes,legacyNormalized:legacy.normalized,freeIds:new Set(read(path.join(ROOT,'recipes.json')).map(r=>r.id)),additions:records(read(files.recipes)),additionNormalized:records(read(files.normalized)),planning:context.BBRecipePlanning,pricing:context.BBPriceV19});
 const out=privateOutputDirectory(option('--output-dir',path.join(stage,pending?'release-draft':'release-ready')));
 const payloads={'recipes-500.private.json':bundle.catalogue,'normalized-500.private.json':{count_recipes:500,recipes:bundle.normalized},'premium-400.private.json':bundle.premium,'premium-400.import-rows.private.json':bundle.premiumRows};
 for(const [name,data]of Object.entries(payloads))write(path.join(out,name),data);
 const sqlName='premium-400.versioned-import.private.sql',fileNames=Object.keys(payloads);
 if(!pending){
  const sqlFile=path.join(out,sqlName);
  fs.writeFileSync(sqlFile,premiumImportSql(bundle.premiumRows),{mode:0o600});
  fs.chmodSync(sqlFile,0o600);fileNames.push(sqlName);
 }
 const manifest={schemaVersion:2,status:pending?'CONTENT_COMPLETE_IMAGES_PENDING':'VERIFIED_FILES_READY_FOR_RELEASE_REVIEW',published:false,d1Imported:false,baselineCommit:BASELINE,counts:{free:100,premium:400,total:500,additions:179},originalSlugIdsPreserved:true,legacyQuantityClarifications:legacy.applied,verificationReport:reportFile,pricingSourceHash:digest(fs.readFileSync(path.join(ROOT,'basketboss-pricing-v19.js'))),files:Object.fromEntries(fileNames.map(name=>[name,{sha256:digest(fs.readFileSync(path.join(out,name))),bytes:fs.statSync(path.join(out,name)).size}])),versionedPremiumTable:VERSIONED_PREMIUM_TABLE,sqlImportFile:pending?null:sqlName,importNote:'Import the complete private SQL file atomically using Wrangler remote file import (or an equivalent transactional file-import facility). It creates and replaces only bb_private_premium_recipes_500_v1; it never changes the legacy table. New clients opt into catalogue=500, while legacy clients retain their existing catalogue. No network operation or database write has been performed.'};
 write(path.join(out,'manifest.json'),manifest);
 console.log(JSON.stringify({outputDirectory:out,status:manifest.status,counts:manifest.counts,published:false,d1Imported:false}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
