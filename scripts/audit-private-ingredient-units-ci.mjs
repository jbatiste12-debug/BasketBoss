#!/usr/bin/env node
// Fixed read-only production catalogue inspection. Private recipes stay only
// in memory; outputs contain ingredient identities, units and aggregate counts.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchPrivateRecipeRows} from './load-private-recipe-audit.mjs';
import {auditCatalogue,auditPricing,auditIngredientUnits} from './audit-ingredient-units.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const REPOSITORY='jbatiste12-debug/BasketBoss',REF='refs/heads/main',PROJECT='basketboss-site';
const fail=code=>{throw Error('ingredient_audit_'+code);};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function aggregates(report){
 const {invalid,sourceUnitMismatches,withinRecipeDuplicates,sourceIdentityMismatches,...safe}=report;
 for(const key of ['mixedUnits','namingVariants'])safe[key]=safe[key].map(({examples,...group})=>group);
 return safe;
}
export async function auditPrivateIngredientUnits({env,perform=fetch,root=ROOT}={}){
 if(env?.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_REF!==REF||!['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))fail('context_invalid');
 const account=env.CLOUDFLARE_ACCOUNT_ID?.trim(),token=env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||'')||typeof token!=='string'||!/^[\x21-\x7e]{32,4096}$/.test(token))fail('credentials_unavailable');
 let response;
 try{response=await perform(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT}`,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});}catch{fail('project_unavailable');}
 if(!response?.ok){await response?.body?.cancel?.().catch(()=>{});fail('project_unavailable');}
 let project;
 try{const declared=response.headers.get('content-length');if(declared&&Number(declared)>262144)fail('project_invalid');const text=await response.text();if(text.length>262144)fail('project_invalid');const body=JSON.parse(text);if(body.success!==true||!plain(body.result))fail('project_invalid');project=body.result;}catch{fail('project_invalid');}
 if(project.name!==PROJECT||project.production_branch!=='main'||!Array.isArray(project.domains)||!project.domains.includes('basketboss.co.uk'))fail('project_invalid');
 const database=project.deployment_configs?.production?.d1_databases?.BILLING_DB?.id;if(!uuid.test(database||''))fail('binding_invalid');
 // Existing loader permits exactly one fixed SELECT against the versioned
 // 400-recipe table and validates every row before returning it.
 const fetched=await fetchPrivateRecipeRows({env:{CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_DATABASE_ID:database},perform});
 const recipes=fetched.rows.map(row=>JSON.parse(row.recipe_json)),normalized={recipes:fetched.rows.map(row=>JSON.parse(row.normalized_json))};
 const local=auditIngredientUnits({root}),premium=auditCatalogue('current-private-premium-400',recipes,normalized,auditPricing(root),{privateData:true});
 const report={...local,privateStatus:'validated_production_d1_read',current500FullyAudited:true,reports:[...local.reports,premium].map(aggregates)};
 if(JSON.stringify(report).length>512*1024)fail('report_limit');
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const report=await auditPrivateIngredientUnits({env:process.env}),temp=process.env.RUNNER_TEMP;
  if(!temp||!path.isAbsolute(temp))fail('runner_temp_unavailable');
  fs.writeFileSync(path.join(temp,'basketboss-ingredient-unit-audit.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  const counts=report.reports.map(({name,recipes,ingredientLines,mixedUnitGroups,mixedProduceGroups,invalidQuantityLines})=>({name,recipes,ingredientLines,mixedUnitGroups,mixedProduceGroups,invalidQuantityLines}));
  const message=JSON.stringify({readOnly:true,current500FullyAudited:true,catalogues:counts});
  console.log('::notice title=Ingredient unit audit::'+message);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'Read-only ingredient/unit audit complete. No catalogue or pantry writes.\n\n```json\n'+JSON.stringify(counts,null,2)+'\n```\n');
 }catch(error){console.error(/^ingredient_audit_[a-z_]+$/.test(error?.message||'')?error.message:'ingredient_audit_unavailable');process.exitCode=1;}
}
