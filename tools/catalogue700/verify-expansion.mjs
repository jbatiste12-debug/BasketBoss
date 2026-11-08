#!/usr/bin/env node
// Owner-side, read-only checks for the complete 200-record addition.
// Premium authoring inputs and detailed reports must stay outside public git.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {recipeChecks,briefChecks,runtime} from './verify-pilot.mjs';
import {isCatalogueDinner} from './planning.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const BASE='b3ee36c3e115844684b24482c7de7026d9064f27';
const PRIVATE_HASH='f89eaecc9b2ca71fbd8018c7f733e51c630f6992e5ad5def902f609a71fcbc2e';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const rows=value=>Array.isArray(value)?value:value?.recipes;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fold=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const MARKETS=['UK','Guernsey','Jersey','US'];

export function validateAllocation(plan){
 const failures=[],check=(value,message)=>{if(!value)failures.push(message);return Boolean(value);};
 check(Array.isArray(plan)&&plan.length===200,'The addition must contain exactly 200 planned identities');
 if(!Array.isArray(plan))return failures;
 if(!check(plan.every(object),'Planned identities must be non-null objects'))return failures;
 check(new Set(plan.map(r=>r.id)).size===200&&plan.every(r=>nonempty(r.id)&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.id)),'New IDs must be unique kebab-case strings');
 check(new Set(plan.map(r=>r.catalogueNumber)).size===200&&plan.every(r=>Number.isInteger(r.catalogueNumber)&&r.catalogueNumber>=501&&r.catalogueNumber<=700),'Catalogue numbers must cover exactly 501–700');
 check(plan.every(r=>nonempty(r.name))&&new Set(plan.map(r=>fold(r.name))).size===200,'New recipe titles must be unique nonempty strings');
 for(const tier of ['free','premium'])check(plan.filter(r=>r.accessTier===tier).length===100,'Expected exactly 100 new '+tier+' recipes');
 const expected=[{fakeaway:13,'date-night-fish':13,family:14,breakfast:10},{fakeaway:13,'date-night-fish':12,family:15,breakfast:10},{fakeaway:12,'date-night-fish':13,family:16,breakfast:9},{fakeaway:12,'date-night-fish':12,family:16,breakfast:10}];
 for(let batch=0;batch<4;batch++){
  const selected=plan.filter(r=>r.catalogueNumber>=501+batch*50&&r.catalogueNumber<=550+batch*50);
  check(selected.length===50,'Each batch must contain exactly 50 recipes');
  check(selected.filter(r=>r.accessTier==='free').length===25&&selected.filter(r=>r.accessTier==='premium').length===25,'Each batch must contain 25 Free and 25 Premium recipes');
  for(const [group,count]of Object.entries(expected[batch]))check(selected.filter(r=>r.group===group).length===count,`Batch ${batch+1} must contain ${count} ${group} recipes`);
 }
 check(plan.filter(r=>r.role==='breakfast'&&r.dinnerEligible===false).length===39,'Exactly 39 additional breakfasts must be excluded from dinner Auto-Fill');
 check(plan.every(r=>(r.group==='breakfast')===(r.role==='breakfast')),'Breakfast allocation and explicit meal role must agree for every identity');
 check(plan.every(r=>['dinner','breakfast','dessert','starter','side'].includes(r.role)&&r.dinnerEligible===(r.role==='dinner')),'Meal roles and dinner eligibility must agree');
 return failures;
}

/** Candidate decisions are actual editorial attestations, never generated passes. */
export function validateDedupReview(review,{sourceHashes,baselineDigest,plan,candidates}={}){
 const failures=[],check=(value,message)=>{if(!value)failures.push(message);return Boolean(value);};
 check(object(review)&&review.schemaVersion===1&&review.status==='reviewed','A completed culinary concept review is required');
 if(!object(review))return failures;
 check(review.planSha256===sourceHashes?.plan&&review.recipesSha256===sourceHashes?.recipes&&review.normalizedSha256===sourceHashes?.normalized&&review.baselineSha256===baselineDigest&&review.candidatesSha256===hash(JSON.stringify(candidates)),'Culinary review is not bound to all actual source records and candidate pairs');
 check(nonempty(review.reviewer)&&nonempty(review.reviewedAt)&&Number.isFinite(Date.parse(review.reviewedAt)),'Culinary review requires a reviewer and timestamp');
 const plannedIds=plan.map(row=>row.id),reviewed=review.reviewedIds;
 check(Array.isArray(reviewed)&&reviewed.length===200&&new Set(reviewed).size===200&&plannedIds.every(id=>reviewed.includes(id)),'Culinary review must explicitly cover all 200 planned identities');
 if(!check(Array.isArray(review.decisions),'Culinary candidate decisions must be an array'))return failures;
 const key=(first,second)=>[first,second].sort().join('\0'),expected=new Set(candidates.map(pair=>key(pair.candidate,pair.other))),seen=new Set();
 for(const decision of review.decisions){
  if(!object(decision)){check(false,'Culinary candidate decision is malformed');continue;}
  const pair=key(decision.candidate,decision.other);
  check(nonempty(decision.candidate)&&nonempty(decision.other)&&decision.candidate!==decision.other&&expected.has(pair)&&!seen.has(pair),'Culinary review contains an unknown or duplicate candidate pair');
  seen.add(pair);
  check(decision.decision==='distinct-dish'&&nonempty(decision.rationale)&&decision.rationale.trim().length>=40,'Every candidate requires a specific distinct-dish rationale; duplicates or unresolved decisions must be replaced');
 }
 check(seen.size===expected.size&&[...expected].every(pair=>seen.has(pair)),'Culinary review does not resolve every actual similarity candidate');
 return failures;
}

export function requirePrivateAuditPath(file,root=ROOT,{existing=true}={}){
 const resolved=path.resolve(file),publicRoot=fs.realpathSync(root);
 const within=value=>value===publicRoot||value.startsWith(publicRoot+path.sep);
 if(within(resolved))throw Error('Premium authoring inputs and reports must stay outside the public checkout');
 let ancestor=resolved;while(!fs.existsSync(ancestor)){if(existing)throw Error('Private audit input does not exist');ancestor=path.dirname(ancestor);}
 if(within(fs.realpathSync(ancestor)))throw Error('Private audit path resolves into the public checkout');
 return resolved;
}

export async function validateExpansion({root=ROOT,baselineFile,planFile,recipesFile,normalizedFile,briefsFile,packFile,rolesFile,imageRoot,reviewFile,dedupReviewFile,contentOnly=false}={}){
 const failures=[],warnings=[],check=(value,message)=>{if(!value)failures.push(message);return Boolean(value);};
 const sourceFiles={plan:planFile,recipes:recipesFile,normalized:normalizedFile,briefs:briefsFile,packs:packFile,roles:rolesFile};
 const sourceHashes=Object.fromEntries(Object.entries(sourceFiles).map(([key,file])=>[key,hash(fs.readFileSync(file))]));
 const privateRows=read(baselineFile).rows;
 const free=read(path.join(root,'recipes.json')),baseline=[...free,...privateRows.map(row=>JSON.parse(row.recipe_json))];
 check(free.length===100&&privateRows.length===400&&baseline.length===500,'Protected baseline must remain 100 Free and 400 Premium');
 check(hash(JSON.stringify(privateRows))===PRIVATE_HASH,'Protected 400-row snapshot changed');
 check(new Set(baseline.map(r=>r.id)).size===500,'Protected baseline IDs are not unique');
 const baselineDigest=hash(JSON.stringify(baseline));
 const plan=read(planFile),recipes=rows(read(recipesFile)),normalized=rows(read(normalizedFile)),briefs=rows(read(briefsFile)),packInput=read(packFile),packs=packInput.ingredients||packInput,roles=read(rolesFile);
 failures.push(...validateAllocation(plan));
 for(const [label,list]of Object.entries({recipes,normalized,briefs}))check(Array.isArray(list)&&list.length===200&&new Set(list.map(r=>r.id)).size===200,'Expected exactly 200 unique '+label+' records');
 const nm=new Map(normalized.map(r=>[r.id,r])),bm=new Map(briefs.map(r=>[r.id,r])),pm=new Map(plan.map(r=>[r.id,r]));
 const allowedFields=new Set(baseline.flatMap(Object.keys)),allowedCategories=new Set(baseline.flatMap(r=>r.ingredients.map(i=>i[3]))),baselineIds=new Set(baseline.map(r=>r.id)),baselineTitles=new Set(baseline.map(r=>fold(r.name)));
 for(const recipe of recipes){
  const planned=pm.get(recipe.id);if(!check(planned,'Unplanned recipe ID: '+recipe.id))continue;
  failures.push(...recipeChecks(recipe,nm.get(recipe.id),{id:planned.id,number:planned.catalogueNumber,tier:planned.accessTier,dinner:planned.dinnerEligible,kind:planned.role},{allowedFields,allowedCategories,allowNoCook:true,strictSourceBinding:true}),...briefChecks(recipe,bm.get(recipe.id),{strictLedger:true}));
  check(recipe.name===planned.name,'Approved recipe title changed: '+recipe.id);
  check(!baselineIds.has(recipe.id)&&!baselineTitles.has(fold(recipe.name)),'Existing recipe identity/title repeated: '+recipe.id);
 }
 for(const planned of plan)check(recipes.some(r=>r.id===planned.id),'Missing planned recipe: '+planned.id);
 const protectedFiles={};
 for(const file of ['recipes.json','normalized-ingredient-database.json','ingredient-pack-catalog.json','dessert_recipes.json','app.html','index.html','bb-recipe-planning.js','functions/api/recipes/premium.js']){
  const original=execFileSync('git',['show',BASE+':'+file],{cwd:root,maxBuffer:10*1024*1024}),current=fs.readFileSync(path.join(root,file));
  protectedFiles[file]={unchanged:original.equals(current),sha256:hash(current)};check(original.equals(current),'Protected production source changed: '+file);
 }
 check(roles.schemaVersion===1&&roles.catalogueVersion===700&&roles.legacyCatalogueVersion===500&&equal(roles.legacyRecipeIds,baseline.map(r=>r.id)),'Planning roles must bind the exact legacy 500 identities');
 check(Array.isArray(roles.recipes)&&roles.recipes.length===200&&plan.every(p=>roles.recipes.filter(r=>r.id===p.id&&r.catalogueNumber===p.catalogueNumber&&r.kind===p.role).length===1),'Planning roles must contain all 200 exact identities');
 const canonical=runtime(root,normalized,recipes,{},'UK').context.BBPriceV19,coverage=[];
 for(const [key,value]of Object.entries(packs)){
  check(!Object.hasOwn(canonical.catalog,key),'Staged pack cannot overwrite a current production pair: '+key);
  check(value&&key===value.ingredient+'|'+value.unit&&canonical.canonical(value.ingredient)===value.ingredient&&positive(value.standard_pack_size)&&value.standard_pack_unit===value.unit&&positive(value.uk_pack_price)&&value.needs_review===true&&/unverified|illustrative|indicative/i.test(JSON.stringify(value)),'New pack requires canonical exact units and honest indicative provenance: '+key);
 }
 for(const recipe of normalized)for(const ingredient of recipe.ingredients){
  const amount=canonical.normalizeUnit(ingredient.key,ingredient.quantity,ingredient.unit),key=canonical.canonical(ingredient.key)+'|'+amount?.unit;
  check(ingredient.key===canonical.canonical(ingredient.name)&&ingredient.key===canonical.canonical(ingredient.key),'Noncanonical pantry key: '+recipe.id+'/'+ingredient.key);
  check(['g','ml','each','clove'].includes(ingredient.unit),'New normalized unit is outside the existing format: '+recipe.id+'/'+ingredient.unit);
  coverage.push({recipeId:recipe.id,key,productionExactPack:!!canonical.catalog[key],stagedExactPack:!!packs[key]});
  check(!!canonical.catalog[key]||!!packs[key],'No exact production or staged pack: '+recipe.id+'/'+key);
 }
 const planning={legacyComparisons:0,newComparisons:0,wiredIntoCurrentClient:false};
 const oldDinner=runtime(root,normalized,recipes,{},'UK').context.BBRecipePlanning.isDinner;
 for(const recipe of baseline)for(const version of [500,700]){check(isCatalogueDinner(recipe,{catalogueVersion:version,roles,legacyIsDinner:oldDinner})===oldDinner(recipe),'Legacy dinner classification changed: '+recipe.id);planning.legacyComparisons++;}
 for(const recipe of recipes){check(isCatalogueDinner(recipe,{catalogueVersion:700,roles,legacyIsDinner:oldDinner})===pm.get(recipe.id)?.dinnerEligible,'Versioned dinner classification mismatch: '+recipe.id);planning.newComparisons++;}
 const prices=[],pantry=[];
 for(const market of MARKETS){
  const h=runtime(root,normalized,recipes,packs,market);
  for(const recipe of recipes){
   // The shipped household/optional-meal contract accepts integer headcounts
   // 1–12. Test that complete domain; a 12-portion bake is not an instruction
   // to pass an unsupported 24-person headcount to a single-meal adapter.
   for(let servings=1;servings<=12;servings++){
    const factor=servings/recipe.servings;
    check(h.context.BBServing.count(servings)===servings,'Unsupported audit headcount: '+servings);
    const first=h.context.bb307MealEstimate(recipe,servings),second=h.context.bbRecipeMealEstimate(recipe,servings);
    check(first.pending===0&&second.pending===0&&positive(first.amount)&&first.amount===second.amount,`Unresolved/divergent app price: ${recipe.id}/${market}/${factor}`);
    for(const [adapter,quote]of [['bb307MealEstimate',first],['bbRecipeMealEstimate',second]])prices.push({id:recipe.id,market,servings,factor,adapter,amount:quote.amount,pending:quote.pending});
    if(factor===1){const stored=recipe.ci_estimates?.[market];check(stored&&stored.currency===(market==='US'?'USD':'GBP')&&stored.confidence==='INDICATIVE_UNVERIFIED'&&Math.abs(stored.estimate-first.amount)<.005,'Regional price drift: '+recipe.id+'/'+market);if(market==='UK')check(Math.abs(recipe.cost-first.amount)<.005,'UK cost drift: '+recipe.id);}
    if(market==='UK'){
     const reqs=h.context.bbHomeRecipeIngredients(recipe.id,factor),id=h.context.BB307Pantry.pantryId,stock={};
     for(const row of reqs){check(positive(row.required)&&typeof row.unit==='string','Unknown pantry amount: '+recipe.id+'/'+row.name);if(positive(row.required)){const key=id(row.key,row.unit);stock[key]=(stock[key]||0)+2*row.required;}}
     const before=JSON.stringify(stock),result=h.context.BBPantryDeduction.proposal({stock,ingredients:reqs,id,conversion:{pantryMode:true,market:'UK',measuredFoods:reqs.map(row=>row.name),measuredStockKeys:Object.keys(stock),foods:{},stock:{},basis:{wholeProduce:false,spoons:false}}});
     check(JSON.stringify(stock)===before,'Audit mutated pantry stock: '+recipe.id);check(result.issues.length===0,'Measured pantry needs review: '+recipe.id+'/'+factor);
     for(const row of result.rows)check(Math.abs(row.deduct-row.required)<.000001,'Pantry shortfall: '+recipe.id+'/'+row.name);
     pantry.push({id:recipe.id,servings,factor,rows:result.rows.length,issues:result.issues.length,readOnly:before===JSON.stringify(stock)});
    }
   }
  }
  check(h.writes()===0,'Audit wrote storage');
 }
 const {compareRecipes,webpDimensions}=await import(pathToFileURL(path.join(root,'scripts/verify-recipe-expansion.mjs')).href);
 const allCandidates=compareRecipes(recipes,baseline),newIds=new Set(recipes.map(r=>r.id));
 const similarityCandidates=allCandidates.filter(pair=>!newIds.has(pair.other)),internalCandidates=allCandidates.filter(pair=>newIds.has(pair.other));
 // Similarity is an editorial flag, never an automatic ingredient-only merge.
 const dedup=dedupReviewFile?read(dedupReviewFile):null;
 failures.push(...validateDedupReview(dedup,{sourceHashes,baselineDigest,plan,candidates:allCandidates}));
 if(similarityCandidates.length||internalCandidates.length)warnings.push('Similarity candidates are reported for culinary review; common ingredients alone do not define the same dish.');
 const imageChecks=[],seenImages=new Set(),baseImages=new Set(baseline.map(r=>path.resolve(root,r.image)).filter(f=>fs.existsSync(f)).map(f=>hash(fs.readFileSync(f))));
 const review=reviewFile?read(reviewFile):null,reviewMap=new Map((review?.images||[]).map(i=>[i.id,i]));
 if(contentOnly)warnings.push('Content-only run: image completeness is not approved for release.');
 else for(const recipe of recipes){
  const file=path.resolve(imageRoot,recipe.image);if(!check(file.startsWith(path.resolve(imageRoot)+path.sep)&&fs.existsSync(file),'Missing or unsafe image path: '+recipe.id))continue;
  try{
   const bytes=fs.readFileSync(file),dims=webpDimensions(bytes),sha256=hash(bytes),qa=reviewMap.get(recipe.id);
   check(dims.width===1448&&dims.height===1086,'Image dimensions drift: '+recipe.id);
   check(!baseImages.has(sha256)&&!seenImages.has(sha256),'Duplicate image: '+recipe.id);seenImages.add(sha256);
   check(review?.schemaVersion===1&&qa?.sha256===sha256&&qa.image===recipe.image&&qa.naturalnessReview==='passed'&&Number.isFinite(Date.parse(qa.reviewedAt)),'Missing/stale visual review: '+recipe.id);
   imageChecks.push({id:recipe.id,...dims,sha256,naturalnessReview:qa?.naturalnessReview});
  }catch(error){failures.push('Invalid image: '+recipe.id+': '+error.message);}
 }
 check(hash(JSON.stringify(baseline))===baselineDigest,'Validation mutated protected recipe objects');
 for(const [key,file]of Object.entries(sourceFiles))check(hash(fs.readFileSync(file))===sourceHashes[key],'Input changed during validation: '+key);
 return {schemaVersion:1,catalogueVersion:700,status:failures.length?'failed':contentOnly?'content-checks-passed':'automated-checks-passed',activationEligible:false,counts:{protectedExisting:500,addition:recipes.length,newFree:recipes.filter(r=>r.accessTier==='free').length,newPremium:recipes.filter(r=>r.accessTier==='premium').length,total:500+recipes.length,newBreakfasts:plan.filter(r=>r.role==='breakfast').length},protectedPrivateRowsSha256:PRIVATE_HASH,protectedFiles,sourceHashes,coverage,prices,pantry,planning,similarityCandidates,internalCandidates,images:imageChecks,warnings,failures};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),opt=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];},stage=opt('--staging-dir',process.env.BB_RECIPE700_STAGING_DIR||path.join(ROOT,'.local-private','recipe700-release'));
 const root=opt('--root',ROOT),out=requirePrivateAuditPath(opt('--out',path.join(stage,'validation.json')),root,{existing:false});
 const input=(option,fallback)=>requirePrivateAuditPath(opt(option,fallback),root);
 const report=await validateExpansion({root,baselineFile:input('--baseline',process.env.BB_RECIPE700_BASELINE_FILE||path.join(ROOT,'.local-private','catalogue500-baseline.json')),planFile:input('--plan',path.join(stage,'catalogue-plan.json')),recipesFile:input('--recipes',path.join(stage,'addition.recipes.json')),normalizedFile:input('--normalized',path.join(stage,'addition.normalized.json')),briefsFile:input('--briefs',path.join(stage,'addition.image-briefs.json')),packFile:input('--packs',path.join(stage,'pack-additions.json')),rolesFile:input('--roles',path.join(stage,'planning-roles.json')),dedupReviewFile:input('--dedup-review',path.join(stage,'dedup-review.json')),reviewFile:input('--image-review',path.join(stage,'image-naturalness-review.json')),imageRoot:opt('--image-root',path.join(ROOT,'catalogues/700/release/assets')),contentOnly:args.includes('--content-only')});
 fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});fs.chmodSync(out,0o600);
 console.log(JSON.stringify({out,status:report.status,counts:report.counts,pricingCases:report.prices.length,pantryCases:report.pantry.length,imageCases:report.images.length,failures:report.failures},null,2));if(report.failures.length)process.exitCode=1;
}
