import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditCatalogue} from '../scripts/audit-ingredient-units.mjs';
import {auditPrivateIngredientUnits} from '../scripts/audit-private-ingredient-units-ci.mjs';
import {PRIVATE_RECIPE_SELECT} from '../scripts/load-private-recipe-audit.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env={GITHUB_REPOSITORY:'jbatiste12-debug/BasketBoss',GITHUB_REF:'refs/heads/fix/ingredient-unit-standardisation',GITHUB_EVENT_NAME:'push',CLOUDFLARE_API_TOKEN:'synthetic-token-'.repeat(4),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)};
const database='01234567-89ab-cdef-0123-456789abcdef';
const rows=()=>Array.from({length:400},(_,index)=>{
 const id='private_recipe_identity_'+index,recipe={id,premium:true,accessTier:'premium',name:'PRIVATE RECIPE TITLE',method:['PRIVATE METHOD TEXT'],ingredients:[['Carrots','PRIVATE ORIGINAL AMOUNT',0,'Produce']]},normalized={id,ingredients:[{name:'Carrots',key:'carrots',quantity:index%2?250:2,unit:index%2?'g':'each',status:'PARSED'}]};
 return {recipe_id:id,sort_index:index,recipe_json:JSON.stringify(recipe),normalized_json:JSON.stringify(normalized)};
});
function harness({projectChange=()=>{},badPrivateRows=false}={}){
 const calls=[],project={name:'basketboss-site',production_branch:'main',domains:['basketboss.co.uk'],deployment_configs:{production:{d1_databases:{BILLING_DB:{id:database}}}}};projectChange(project);
 return {calls,perform:async(url,options={})=>{
  calls.push({url:String(url),method:options.method||'GET',body:options.body});
  if(String(url).endsWith('/pages/projects/basketboss-site'))return Response.json({success:true,result:project});
  assert.equal(String(url),'https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/d1/database/'+database+'/query');
  assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{sql:PRIVATE_RECIPE_SELECT});
  return Response.json({success:true,result:[{results:badPrivateRows?rows().slice(1):rows()}]});
 }};
}

test('read-only production audit makes only a fixed Pages GET and fixed catalogue SELECT and exports no private recipe content',async()=>{
 const h=harness(),report=await auditPrivateIngredientUnits({env,perform:h.perform,root});
 assert.equal(h.calls.length,2);assert.equal(report.current500FullyAudited,true);
 const premium=report.reports.find(item=>item.name==='current-private-premium-400');assert.equal(premium.recipes,400);assert.equal(premium.ingredientLines,400);
 const carrot=premium.mixedUnits.find(item=>item.key==='carrot');assert.equal(carrot.occurrences,400);assert.deepEqual(carrot.units,['each','g']);
 const serialized=JSON.stringify(report);for(const forbidden of ['PRIVATE RECIPE TITLE','PRIVATE METHOD TEXT','PRIVATE ORIGINAL AMOUNT','private_recipe_identity_','recipe_json','normalized_json',env.CLOUDFLARE_API_TOKEN])assert(!serialized.includes(forbidden),forbidden);
 for(const item of report.reports)for(const group of [...item.mixedUnits,...item.namingVariants])assert.equal(group.examples,undefined);
});

test('audit rejects foreign repository, branch and event contexts before any network request',async()=>{
 for(const change of [{GITHUB_REPOSITORY:'attacker/BasketBoss'},{GITHUB_REF:'refs/heads/main'},{GITHUB_EVENT_NAME:'pull_request'}]){
  const h=harness();await assert.rejects(auditPrivateIngredientUnits({env:{...env,...change},perform:h.perform,root}),/ingredient_audit_context_invalid/);assert.equal(h.calls.length,0);
 }
});

test('audit refuses an unexpected project, production branch, domain or binding without reading recipe rows',async()=>{
 for(const projectChange of [project=>{project.name='other';},project=>{project.production_branch='preview';},project=>{project.domains=['attacker.invalid'];},project=>{project.deployment_configs.production.d1_databases.BILLING_DB.id='invalid';}]){
  const h=harness({projectChange});await assert.rejects(auditPrivateIngredientUnits({env,perform:h.perform,root}),/^Error: ingredient_audit_(project_invalid|binding_invalid)$/);assert.equal(h.calls.length,1);
 }
 const broken=harness({badPrivateRows:true});await assert.rejects(auditPrivateIngredientUnits({env,perform:broken.perform,root}),/private_recipe_audit_row_count/);
});

test('mixed-unit audit preserves prepared, preserved and variety identities and does not rewrite source amounts',()=>{
 const recipe={id:'forms',ingredients:[['Carrots','2 each'],['Carrot','250 g'],['Frozen carrots','100 g'],['Red onion','1 each'],['Onion','150 g'],['Canned carrots','200 g']]};
 const normalized={recipes:[{id:'forms',ingredients:recipe.ingredients.map(([name],index)=>({key:name.toLowerCase(),quantity:index===0?2:100,unit:index===0||index===3?'each':'g'}))}]};
 const before=JSON.stringify({recipe,normalized}),report=auditCatalogue('fixture',[recipe],normalized,{canonical:name=>name.toLowerCase(),category:()=> 'Produce'});
 assert.equal(report.mixedUnitGroups,1);assert.equal(report.mixedUnits[0].key,'carrot');assert.equal(report.mixedUnits[0].occurrences,2);assert.equal(JSON.stringify({recipe,normalized}),before);
});

test('trusted audit workflow grants read-only repository access, uses existing environment secrets and retains aggregates only',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/ingredient-unit-audit.yml'),'utf8');
 assert.match(workflow,/contents: read/);assert.match(workflow,/environment: github-pages/);assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/fetch-depth: 0/);assert.match(workflow,/retention-days: 1/);
 assert.doesNotMatch(workflow,/pull_request_target|contents: write|wrangler|d1 execute|secrets: inherit/);
});
