import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateAllocation,validateDedupReview,requirePrivateAuditPath} from '../tools/catalogue700/verify-expansion.mjs';
import {recipeChecks,briefChecks,parseSourceQuantity,noCookSafetyFailures} from '../tools/catalogue700/verify-pilot.mjs';

const read=file=>JSON.parse(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'));
const clone=value=>structuredClone(value);
const publicRecipes=read('catalogues/700/pilot/free.recipes.json');
const carbonara=publicRecipes.find(recipe=>recipe.id==='spaghetti-carbonara');
const norm=read('catalogues/700/pilot/free.normalized.json').recipes.find(recipe=>recipe.id===carbonara.id);
const imageBrief=read('catalogues/700/pilot/free.image-briefs.json').find(brief=>brief.id===carbonara.id);
const expected={id:carbonara.id,number:527,tier:'free',dinner:true,kind:'dinner'};
const options={allowedFields:new Set(Object.keys(carbonara)),allowedCategories:new Set(publicRecipes.flatMap(recipe=>recipe.ingredients.map(row=>row[3]))),allowNoCook:true,strictSourceBinding:true};
const failures=(r=clone(carbonara),n=clone(norm),expect=expected,opts=options)=>recipeChecks(r,n,expect,opts);
const updateDisplay=r=>{r.ingredient_display_lines=r.ingredients.map(row=>row[0]+' — '+row[1]);};

function plan(){
 const distribution=[{fakeaway:13,'date-night-fish':13,family:14,breakfast:10},{fakeaway:13,'date-night-fish':12,family:15,breakfast:10},{fakeaway:12,'date-night-fish':13,family:16,breakfast:9},{fakeaway:12,'date-night-fish':12,family:16,breakfast:10}],result=[];
 for(const [batch,groups]of distribution.entries()){
  let within=0;
  for(const [group,count]of Object.entries(groups))for(let i=0;i<count;i++){
   const catalogueNumber=501+batch*50+within++;
   result.push({id:'fixture-recipe-'+catalogueNumber,catalogueNumber,name:'Distinct fixture dish '+catalogueNumber,accessTier:within%2?'free':'premium',group,role:group==='breakfast'?'breakfast':'dinner',dinnerEligible:group!=='breakfast'});
  }
 }
 return result;
}

test('the exact four-batch allocation accepts 200 identities with 100 per tier and 39 optional breakfasts',()=>{
 const value=plan(),before=JSON.stringify(value);
 assert.deepEqual(validateAllocation(value),[]);assert.equal(JSON.stringify(value),before);
 const starter=value.find(recipe=>recipe.group==='fakeaway');starter.role='starter';starter.dinnerEligible=false;
 assert.deepEqual(validateAllocation(value),[],'an explicitly approved starter is not a dinner');
});
test('allocation rejects partial plans, unknown tiers, missing numbers and repeated normalized titles',()=>{
 for(const edit of [
  value=>{value.pop();},value=>{value[0].catalogueNumber=0;},value=>{value[0].catalogueNumber=value[1].catalogueNumber;},
  value=>{value[0].id=value[1].id;},value=>{value[0].id='Wrong_ID';},value=>{value[0].accessTier='trial';},
  value=>{value[0].name='Crème pie';value[1].name='Creme PIE';},value=>{value[0].group='unknown';},
  value=>{value[0].role='snack';},value=>{value[0].role='breakfast';},
  value=>{value[0].accessTier='premium';value[50].accessTier='free';}
 ]){const value=plan();edit(value);assert.ok(validateAllocation(value).length>0);}
 assert.ok(validateAllocation(undefined).length>0);
});
test('allocation requires typed nonempty IDs and titles rather than coerced or blank values',()=>{
 for(const edit of [
  value=>{delete value[0].id;},value=>{value[0].id=123;},value=>{value[0].id='';},
  value=>{delete value[0].name;},value=>{value[0].name='   ';},value=>{value[0].name=123;}
 ]){const value=plan();edit(value);assert.ok(validateAllocation(value).length>0);}
 const invalid=plan();invalid[0]=null;assert.ok(validateAllocation(invalid).length>0);
});
test('a breakfast role cannot be swapped into a family allocation while all aggregate counts remain unchanged',()=>{
 const value=plan(),family=value.find(recipe=>recipe.group==='family'),breakfast=value.find(recipe=>recipe.group==='breakfast');
 family.role='breakfast';family.dinnerEligible=false;breakfast.role='dinner';breakfast.dinnerEligible=true;
 assert.ok(validateAllocation(value).length>0,'meal group and role must agree, not merely count to 39');
});

test('recipe validation accepts the existing public pilot format without mutating it',()=>{
 const r=clone(carbonara),n=clone(norm),before=JSON.stringify({r,n});
 assert.deepEqual(failures(r,n),[]);assert.equal(JSON.stringify({r,n}),before);
 assert.deepEqual(briefChecks(r,imageBrief),[]);
});
test('recipe validation rejects positional drift, changed IDs, stale display and differing Cook steps',()=>{
 for(const edit of [
  (r,n)=>{n.ingredients[0].ingredient_index=1;},(r,n)=>{n.ingredients[0].recipe_id='other-recipe';},
  (r,n)=>{n.ingredients[0].name='Different ingredient';},(r,n)=>{n.ingredients.pop();},
  r=>{r.slug='wrong-slug';},r=>{r.catalogueNumber=700;},r=>{r.accessTier='premium';},
  r=>{r.ingredients[0].push('unexpected-position');},r=>{r.ingredient_display_lines[0]='Stale source';},
  r=>{r.steps[0]='A different sequence of Cook instructions.';},r=>{r.image='release-assets/not-the-recipe.webp';}
 ]){const r=clone(carbonara),n=clone(norm);edit(r,n);assert.ok(failures(r,n).length>0);}
});
test('recipe validation rejects invalid or unsupported normalized unit types and nonpositive quantities',()=>{
 for(const value of ['', 'packs','bottles','nonsense',null,123]){
  const n=clone(norm);n.ingredients[0].unit=value;assert.ok(failures(clone(carbonara),n).length>0);
 }
 for(const value of [0,-1,NaN,Infinity,'400']){const n=clone(norm);n.ingredients[0].quantity=value;assert.ok(failures(clone(carbonara),n).length>0);}
});
test('recipe validation compares an explicit metric source amount with its normalized quantity',()=>{
 const n=clone(norm);n.ingredients[0].quantity=40;
 assert.ok(failures(clone(carbonara),n).length>0,'400 g in the source cannot silently become 40 g in pantry and price arithmetic');
 const r=clone(carbonara);r.ingredients[0][1]='0.4 kg';updateDisplay(r);
 assert.deepEqual(failures(r,clone(norm)),[],'an exact metric conversion is accepted');
});
test('recipe validation compares a whole-item count with its normalized count',()=>{
 const n=clone(norm);n.ingredients[2].quantity=2;
 assert.ok(failures(clone(carbonara),n).length>0,'the recipe uses four eggs, including separated yolks');
});
test('normalized price hints retain the same source ingredient price',()=>{
 const n=clone(norm);n.ingredients[0].price_hint+=1;assert.ok(failures(clone(carbonara),n).length>0);
});
test('required culinary metadata cannot contain only blanks or invalid array entries',()=>{
 for(const edit of [
  r=>{r.primaryProtein=' ';},r=>{r.fingerprint.base=' ';},r=>{r.culinary_prep_notes[0]='';},
  r=>{r.coreIngredientKeys=[null];},r=>{r.flavorTokens=[123];},r=>{r.allergen_screen_possible_unverified=[null];}
 ]){const r=clone(carbonara);edit(r);assert.ok(failures(r,clone(norm)).length>0);}
});
test('unknown recipe fields and unknown ingredient categories cannot expand the existing schema accidentally',()=>{
 const r=clone(carbonara);r.inventedBatchFlag=true;assert.ok(failures(r,clone(norm)).length>0);
 const second=clone(carbonara);second.ingredients[0][3]='Special New Category';assert.ok(failures(second,clone(norm)).length>0);
});
test('optional breakfast needs an explicit breakfast category and stays outside dinner',()=>{
 const r=clone(carbonara);r.dinnerEligible=false;
 const breakfast={...expected,dinner:false,kind:'breakfast'};
 assert.ok(failures(r,clone(norm),breakfast).length>0);
 r.category='Breakfast & Brunch';r.tag='BREAKFAST';assert.deepEqual(failures(r,clone(norm),breakfast),[]);
 const noKind={...breakfast};delete noKind.kind;assert.ok(failures(r,clone(norm),noKind).length>0,'the original pilot waffle-only guard remains unchanged');
});
test('waffles retain the equipment guard when full-catalogue meal roles are supplied',()=>{
 const r=clone(carbonara),n=clone(norm);r.name='Waffle breakfast fixture';n.name=r.name;r.category='Breakfast & Brunch';r.tag='BREAKFAST';r.dinnerEligible=false;
 const breakfast={...expected,dinner:false,kind:'breakfast'};
 assert.ok(failures(r,n,breakfast).length>0);
 r.method[0]+=' Preheat the waffle iron as instructed.';r.steps=[...r.method];assert.deepEqual(failures(r,n,breakfast),[]);
});
test('no-cook timing is an explicit opt-in and never permits negative preparation or cook time',()=>{
 const r=clone(carbonara);r.cook_mins=0;r.mins=r.prep_mins;r.total_elapsed_mins=r.mins;
 assert.ok(failures(r,clone(norm),expected,{...options,allowNoCook:false}).length>0);
 for(const [field,value]of [['cook_mins',-1],['prep_mins',0],['mins',0],['prep_mins',Infinity]]){
  const invalid=clone(r);invalid[field]=value;assert.ok(failures(invalid,clone(norm)).length>0);
 }
});
test('image ledgers bind quantities as well as ingredient names and exact Cook methods',()=>{
 const brief=clone(imageBrief);brief.exactIngredientLedger=brief.exactIngredientLedger.replace('400 g','40 g');
 assert.ok(briefChecks(carbonara,brief,{strictLedger:true}).length>0,'an old quantity ledger cannot validate a new source');
 const altered=clone(imageBrief);altered.recipeMethod[0]='A stale but long cooking instruction.';assert.ok(briefChecks(carbonara,altered).length>0);
});

test('explicit source parser handles metric conversion, fractions, pack multiples and stated drained totals',()=>{
 for(const [source,unit,quantity]of [
  ['400 g','g',400],['0.4 kg, dry weight','g',400],['1½ l','ml',1500],['1/2 kg','g',500],
  ['2 x 400 g tins','g',800],['2 × 400 g tins (800 g total)','g',800],
  ['2 tins (400 g each)','g',800],['2 x 400 g tins, 480 g drained weight','g',480],
  ['2 x 400 g tins (240 g drained per tin)','g',480],
  ['4 medium eggs, using 2 whole eggs and the yolks from the other 2','each',4],
  ['2 garlic cloves','clove',2],['½ cucumber','each',.5],['2 x 4 bread rolls','each',8],
  ['1 tbsp (15 ml)','ml',15],['1 onion (about 150 g)','g',150]
 ]){const parsed=parseSourceQuantity(source,unit);assert.equal(parsed?.quantity,quantity,source);assert.equal(parsed?.unit,unit,source);}
});
test('source parser never guesses density, container weight, unstated counts or ambiguous combined amounts',()=>{
 for(const [source,unit]of [
  ['1 bottle','ml'],['1 tin','g'],['1 carrot','g'],['1 tbsp','ml'],['200 ml','g'],['200 g','ml'],
  ['2 x 400 g tins','each'],['20 g','each'],['250 g plus 50 g','g'],['some salt','g'],['1 cup','g'],
  ['-20 g','g'],['0 g','g'],['1/0 kg','g'],['2 cloves','bottles']
 ])assert.equal(parseSourceQuantity(source,unit),null,source+'/'+unit);
});
test('zero-cook animal ingredients require an explicit safe edible form; smoked bacon is not enough',()=>{
 for(const [name,category]of [['Chicken breasts','Meat'],['Eggs','Dairy'],['Smoked bacon','Meat'],['Raw prawns','Fish'],['Uncooked smoked salmon','Fish'],['Partially-cooked chicken','Meat']]){
  assert.ok(noCookSafetyFailures({id:'no-cook-fixture',cook_mins:0,ingredients:[[name,'100 g',1,category]]}).length>0,name);
 }
 for(const [name,category]of [['Cooked chicken','Meat'],['Ready-to-eat ham','Meat'],['Smoked salmon','Fish'],['Tinned tuna','Fish'],['Hard-boiled eggs','Dairy'],['Carrots','Vegetables']]){
  assert.deepEqual(noCookSafetyFailures({id:'no-cook-fixture',cook_mins:0,ingredients:[[name,'100 g',1,category]]}),[],name);
 }
 assert.deepEqual(noCookSafetyFailures({id:'cooked-fixture',cook_mins:20,ingredients:[['Chicken breast','500 g',3,'Meat']]}),[]);
});
test('no-cook canonical food names retain explicit edible-form proof in quantity or positional prep without allowing raw overrides',()=>{
 assert.deepEqual(noCookSafetyFailures({id:'crab',cook_mins:0,ingredients:[['White crab meat','120 g cooked ready-to-eat meat',4,'Meat']]}),[]);
 assert.deepEqual(noCookSafetyFailures({id:'ham',cook_mins:0,ingredients:[['Ham','200 g',2,'Meat']],culinary_prep_notes:['Use ready-to-eat cooked ham within its use-by date.']}),[]);
 for(const recipe of [
  {id:'raw',cook_mins:0,ingredients:[['Raw prawns','100 g ready-to-eat',2,'Meat']],culinary_prep_notes:['Use cooked prawns.']},
  {id:'unsafe',cook_mins:0,ingredients:[['White crab meat','100 g not ready-to-eat',2,'Meat']]},
  {id:'unknown',cook_mins:0,ingredients:[['Ham','100 g',2,'Meat']],culinary_prep_notes:['Cook before serving.']},
  {id:'negative-prep',cook_mins:0,ingredients:[['White crab meat','100 g',2,'Meat']],culinary_prep_notes:['This meat is not ready-to-eat.']}
 ])assert.ok(noCookSafetyFailures(recipe).length>0,recipe.id);
});

function dedupFixture(){
 const planned=plan(),candidates=[{candidate:planned[0].id,other:'old-recipe',title:.8,ingredientFlavor:.5,fingerprintMatch:false},{candidate:planned[2].id,other:planned[1].id,title:.2,ingredientFlavor:.9,fingerprintMatch:false}],sourceHashes={plan:'a'.repeat(64),recipes:'b'.repeat(64),normalized:'c'.repeat(64)},baselineDigest='d'.repeat(64);
 const review={schemaVersion:1,status:'reviewed',planSha256:sourceHashes.plan,recipesSha256:sourceHashes.recipes,normalizedSha256:sourceHashes.normalized,baselineSha256:baselineDigest,candidatesSha256:createHash('sha256').update(JSON.stringify(candidates)).digest('hex'),reviewedIds:planned.map(recipe=>recipe.id),reviewer:'Synthetic editorial test fixture',reviewedAt:'2026-11-08T12:00:00Z',decisions:candidates.map(pair=>({candidate:pair.candidate,other:pair.other,decision:'distinct-dish',rationale:'Synthetic case: different dish identity, preparation and serving structure are explicitly recorded.'}))};
 return {review,context:{sourceHashes,baselineDigest,plan:planned,candidates}};
}
test('culinary review binds all 200 identities and every actual candidate to exact source hashes',()=>{
 const {review,context}=dedupFixture();assert.deepEqual(validateDedupReview(review,context),[]);
 for(const field of ['planSha256','recipesSha256','normalizedSha256','baselineSha256','candidatesSha256']){
  const altered=clone(review);altered[field]='0'.repeat(64);assert.ok(validateDedupReview(altered,context).length>0,field);
 }
});
test('culinary review rejects missing, duplicate, unknown, unresolved or unexplained candidate decisions',()=>{
 const {review,context}=dedupFixture();
 for(const edit of [
  value=>{value.decisions.pop();},value=>{value.decisions.push(value.decisions[0]);},
  value=>{value.decisions[0].other='unknown-unreported-pair';},value=>{value.decisions[0].decision='needs-review';},
  value=>{value.decisions[0].decision='duplicate';},value=>{value.decisions[0].rationale='Looks different';},
  value=>{value.reviewedIds.pop();},value=>{value.reviewedIds[0]=value.reviewedIds[1];},
  value=>{value.reviewedAt='invalid';},value=>{value.reviewer='';},value=>{value.status='pending';},
  value=>{value.decisions[0]=null;}
 ]){const altered=clone(review);edit(altered);assert.ok(validateDedupReview(altered,context).length>0);}
 assert.ok(validateDedupReview(null,context).length>0);
});
test('detailed private audit reports and authoring inputs cannot resolve into public checkout paths',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bb700-audit-path-'));
 try{
  const root=path.join(temp,'public');fs.mkdirSync(root);const source=path.join(temp,'private-input.json');fs.writeFileSync(source,'{}');
  assert.equal(requirePrivateAuditPath(source,root),source);
  assert.throws(()=>requirePrivateAuditPath(path.join(root,'report.json'),root,{existing:false}));
  const alias=path.join(temp,'outside-alias');fs.symlinkSync(root,alias,'dir');assert.throws(()=>requirePrivateAuditPath(path.join(alias,'report.json'),root,{existing:false}));
  assert.throws(()=>requirePrivateAuditPath(path.join(temp,'missing.json'),root));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
