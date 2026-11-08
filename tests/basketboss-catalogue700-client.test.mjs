import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import planning from '../bb-recipe-planning.js';
import {isCatalogueDinner} from '../tools/catalogue700/planning.mjs';
import {canonicalHash,PROTECTED500} from '../tools/catalogue700/release.mjs';
import {inlineArray,transform700Html,transform700Planning,validatePublic700Release,verify700Client} from '../tools/catalogue700/build-client.mjs';
import {stage700IOSAssets,sync700IOS} from '../tools/catalogue700/sync-ios.mjs';
import {verifyNativeWeb,buildNativeWeb,CLIENT_FILES,DATA_FILES,HTML_FILES} from '../scripts/build-native-web.mjs';
import {sha256Utf8} from '../tools/catalogue700/client-integrity.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const original=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8');
const originalPlanning=fs.readFileSync(new URL('../bb-recipe-planning.js',import.meta.url),'utf8');
const json=name=>JSON.parse(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'));
const clone=value=>JSON.parse(JSON.stringify(value));

function syntheticRecipe(id,number,role,tier='premium'){
 const name=number===501?'Crispy aromatic duck pancakes':number===641?'Southern chicken and waffles':'Synthetic '+id;
 const ingredients=[['Rice','100 g',1,'Grains'],['Onion','1 onion',0.2,'Vegetables'],['Cooking oil','10 ml',0.1,'Other']];
 return {id,name,slug:id,catalogueNumber:number,category:role==='breakfast'?'Breakfast & Brunch':'Family Meals',tag:role==='breakfast'?'BREAKFAST':'DINNER',ingredients,servings:4,baseServings:4,primaryProtein:number===501?'duck':'chicken',cheeseHeavy:false,dinnerEligible:role==='dinner',accessTier:tier,premium:tier==='premium',image:`release-assets/basketboss-v17/images/new/${id}.webp`,cost:4,mins:30};
}
function norm(recipe){return {id:recipe.id,name:recipe.name,servings:recipe.servings,ingredients:recipe.ingredients.map((row,index)=>({name:row[0],recipe_id:recipe.id,ingredient_index:index,key:row[0].toLowerCase(),quantity:100,unit:'g',price_hint:row[2]}))};}
function fixture(){
 const legacyIds=json('catalogues/700/pilot/planning-roles.json').legacyRecipeIds;
 const roles={schemaVersion:1,catalogueVersion:700,legacyCatalogueVersion:500,legacyRecipeIds:legacyIds,recipes:Array.from({length:200},(_,index)=>{const number=501+index;return {id:number===501?'crispy-aromatic-duck-pancakes':number===641?'southern-chicken-and-waffles':'synthetic-addition-'+number,catalogueNumber:number,kind:number>=502&&number<=540?'breakfast':'dinner'};})};
 const additions=roles.recipes.map((role,index)=>syntheticRecipe(role.id,role.catalogueNumber,role.kind,index<100?'free':'premium'));
 const free=[...inlineArray(original,'RECIPES').value,...additions.slice(0,100)],normal=[...inlineArray(original,'BB307_NORMALIZED').value,...additions.slice(0,100).map(norm)];
 const freeIds=new Set(free.map(r=>r.id)),premiumIds=[...legacyIds.filter(id=>!freeIds.has(id)),...roles.recipes.filter(r=>!freeIds.has(r.id)).map(r=>r.id)];
 const premium=premiumIds.map((id,index)=>index<400?syntheticRecipe(id,undefined,'dinner'):additions.find(r=>r.id===id));
 const manifest={schemaVersion:1,clientVersion:'1.0.2',catalogue_version:700,free_count:200,premium_count:500,release_id:'synthetic-complete-700',premium_rows_sha256:'a'.repeat(64),protected_rows_sha256:PROTECTED500.privateRows,free_recipes_sha256:canonicalHash(free),free_normalized_sha256:canonicalHash(normal),recipes:roles.recipes.map(r=>({id:r.id,catalogueNumber:r.catalogueNumber,name:additions.find(a=>a.id===r.id).name,image:`release-assets/basketboss-v17/images/new/${r.id}.webp`,sha256:'b'.repeat(64)}))};
 return {manifest,free,normal,roles,packs:{},premiumIds,imageRows:manifest.recipes,premium,premiumNormal:premium.map(norm)};
}

test('700 generated HTML replaces only explicit data and hydration anchors',()=>{
 const release=fixture(),source=transform700Html(original,release);
 assert.deepEqual(inlineArray(source,'RECIPES').value,release.free);assert.deepEqual(inlineArray(source,'BB307_NORMALIZED').value,release.normal);
 assert.match(source,/fetch\('\/api\/recipes\/v700\/premium\?catalogue=700'/);assert.doesNotMatch(source,/fetch\('\/api\/recipes\/premium\?catalogue=500'/);
 assert.match(source,/data\.count!==500/);assert.match(source,/data\?\.catalogueVersion!==700/);assert.match(source,/BB_CATALOGUE700_FREE_PROOF/);
 assert.equal(inlineArray(original,'RECIPES').value.length,100);assert.equal(canonicalHash(inlineArray(original,'RECIPES').value),PROTECTED500.freeRecipes);
 assert.equal(source.includes('const BB_CATALOGUE700_RELEASE='),true);
 assert.throws(()=>transform700Html(original.replace("fetch('/api/recipes/premium?catalogue=500'","fetch('/different'"),release),/anchor_premium_route/);
 assert.throws(()=>inlineArray(original+'\nconst RECIPES=[];','RECIPES'),/ambiguous_RECIPES/);
 assert.throws(()=>inlineArray('const RECIPES=["unterminated];','RECIPES'));
});

test('700 data injection cannot terminate its script through authored display text',()=>{
 const release=fixture();release.free[199].tip='Literal </script> text and a \u2028 separator';
 const source=transform700Html(original,release);
 assert.equal(inlineArray(source,'RECIPES').value[199].tip,release.free[199].tip);
 assert.ok(source.includes('Literal \\u003c/script>'));
});

test('reviewed savoury chicken waffles are dinner only for their exact new role',()=>{
 const release=fixture(),role=release.roles.recipes.find(r=>r.catalogueNumber===641),recipe=release.premium.find(r=>r.id===role.id);
 const options={catalogueVersion:700,roles:release.roles,legacyIsDinner:planning.isDinner};
 assert.equal(planning.isDinner(recipe),false);assert.equal(isCatalogueDinner(recipe,options),true);
 for(const edit of [{catalogueNumber:642},{name:'Breakfast waffles'},{primaryProtein:'eggs'},{category:'Breakfast & Brunch'},{category:'Desserts'},{dinnerEligible:false},{id:'other-waffles'}])assert.equal(isCatalogueDinner({...recipe,...edit},options),false);
 const changed=clone(release.roles);changed.recipes.find(r=>r.id===recipe.id).kind='breakfast';assert.equal(isCatalogueDinner(recipe,{...options,roles:changed}),false);
 assert.equal(isCatalogueDinner(recipe,{...options,catalogueVersion:500}),false);
});

test('generated internal planner metadata and rotation use reviewed roles and preserve every legacy classification',()=>{
 const release=fixture(),context=vm.createContext({});context.window=context;
 vm.runInContext(transform700Planning(originalPlanning,release.roles),context);
 const api=context.BBRecipePlanning;
 for(const [index,id]of release.roles.legacyRecipeIds.entries()){
  const recipe={id,name:index%3?'Old dinner':'Old waffles',category:index%2?'Family Meals':'Breakfast'};
  assert.equal(api.isDinner(recipe),planning.isDinner(recipe));assert.equal(api.metadata(recipe).dinnerEligible,planning.metadata(recipe).dinnerEligible);
 }
 const duck=release.free.find(r=>r.catalogueNumber===501),waffles=release.premium.find(r=>r.catalogueNumber===641),breakfast=release.free.find(r=>r.catalogueNumber===502);
 assert.equal(api.metadata(duck).dinnerEligible,true);assert.equal(api.metadata(waffles).dinnerEligible,true);assert.equal(api.metadata(breakfast).dinnerEligible,false);
 const storage={getItem:()=>null,setItem(){}};
 assert.equal(api.createRotation({recipes:[duck,waffles,breakfast],storage,scope:'locked'}).eligible.length,0,'meal roles do not grant recipe access');
 const rotation=api.createRotation({recipes:[duck,waffles,breakfast],storage,scope:'synthetic',isAllowed:()=>true});
 assert.deepEqual(Array.from(rotation.eligible,r=>r.id),[duck.id,waffles.id]);
 assert.equal(rotation.filter([breakfast],{day:'Monday',planned:[]}).length,0);
 assert.equal(rotation.filter([waffles],{day:'Monday',planned:[]}).length,1);
 const personal={id:'bb172-own-abcdefghijkl',name:'My household dinner',category:'Family meal',tag:'MY RECIPE',ingredients:[['Rice','100 g',0]]};
 assert.equal(api.isDinner(personal),false);assert.equal(api.registerPersonalRecipe(personal),true);assert.equal(api.isDinner(personal),planning.isDinner(personal));assert.equal(api.metadata(personal).dinnerEligible,true);
 assert.equal(api.isDinner({...personal}),false,'a matching prefix or ID does not register a different object');
 assert.equal(api.registerPersonalRecipe({...personal,id:waffles.id}),false,'registration cannot bless an official or unknown API identity');
 const personalRotation=api.createRotation({recipes:[personal],storage,scope:'personal',isAllowed:()=>true});assert.equal(personalRotation.eligible.length,1);
 assert.throws(()=>transform700Planning(originalPlanning.replace('  function isDinner(recipe){','  function other(recipe){'),release.roles),/anchor_legacy_predicate/);
});

test('additional family and manual-batch paths respect new non-dinner roles without reinterpreting legacy recipes',()=>{
 const release=fixture(),starterRole=release.roles.recipes.find(r=>r.catalogueNumber===608);starterRole.kind='starter';
 const context=vm.createContext({BB_CATALOGUE700_NEW_IDS:new Set(release.roles.recipes.map(r=>r.id))});context.window=context;
 vm.runInContext(transform700Planning(originalPlanning,release.roles),context);
 const html=transform700Html(original,release),start=html.indexOf('function bb172IsDessertOrNonDinner(recipe){'),end=html.indexOf('function bb172FamilyCandidate(',start);
 vm.runInContext(html.slice(start,end)+'\nglobalThis.nonDinner=bb172IsDessertOrNonDinner;',context);
 assert.equal(context.nonDinner({...release.premium.find(r=>r.id===starterRole.id),category:'Fakeaways · Family',dinnerEligible:false}),true);
 const duck=release.free.find(r=>r.catalogueNumber===501);assert.equal(context.nonDinner(duck),false);
 assert.equal(context.nonDinner(release.free.find(r=>r.catalogueNumber===502)),true);
 const legacy={id:release.roles.legacyRecipeIds[0],name:'Old waffles',category:'Family meal',tag:'DINNER'};
 assert.equal(context.nonDinner(legacy),false,'the older category predicate remains unchanged for legacy identities');
});

function hydrationHarness({cryptoAvailable=true,tamperPublic=false}={}){
 const release=fixture(),html=transform700Html(original,release),before='// Versioned data proof is captured before',proofAt=html.indexOf(before),proofEnd=html.indexOf('.catch(()=>false);',proofAt)+'.catch(()=>false);'.length;
 const premiumStart=html.indexOf('/* BB SECURE PREMIUM:'),premiumEnd=html.indexOf("window.addEventListener('basketboss:session-changed'",premiumStart),code=html.slice(premiumStart,premiumEnd);
 let session={user:{id:'member-a'},access_token:'token-a',expires_at:Date.now()/1000+3600},response=()=>Promise.resolve(new Response(JSON.stringify({catalogueVersion:700,releaseId:release.manifest.release_id,count:500,total:700,targetTotal:700,freeRecipesSha256:release.manifest.free_recipes_sha256,freeNormalizedSha256:release.manifest.free_normalized_sha256,recipes:release.premium,normalized:release.premiumNormal}),{status:200}));
 const publicRecipes=clone(release.free);if(tamperPublic)publicRecipes[199].name='changed public record';
 const context=vm.createContext({RECIPES:publicRecipes,BB307_NORMALIZED:clone(release.normal),BB307_SOURCE_RECIPES:clone(release.free),BB307_ORIGINAL_COSTS:new Map(release.free.map(r=>[r.id,{total:r.cost,lines:r.ingredients.map(i=>i[2])}])),BB307_VALID_IDS:new Set(release.free.map(r=>r.id)),bbVerifiedPaidRecipes:false,TextEncoder,crypto:cryptoAvailable?webcrypto:undefined,fetch:(url,args)=>{assert.equal(url,'/api/recipes/v700/premium?catalogue=700');assert.equal(args.cache,'no-store');return response(url,args);},localStorage:{getItem:()=>session?JSON.stringify(session):null},BBRecipePlanning:{metadata:()=>({})},render(){},document:{dispatchEvent(){}},Event:class{constructor(type){this.type=type;}}});
 context.window=context;
 vm.runInContext(html.slice(proofAt,proofEnd)+'\n'+code+'\nglobalThis.hydrate=bbPremiumReload;globalThis.snapshot=()=>({recipes:RECIPES.length,normalized:BB307_NORMALIZED.length,paid:bbVerifiedPaidRecipes});',context);
 return {release,context,session:value=>{session=value;},response:value=>{response=value;},reload:()=>context.hydrate(),snapshot:()=>({...context.snapshot()})};
}

test('700 hydration adopts only a complete matching release and clears private rows on sign-out',async()=>{
 const h=hydrationHarness();await h.reload();assert.deepEqual(h.snapshot(),{recipes:700,normalized:700,paid:true});
 h.session(null);await h.reload();assert.deepEqual(h.snapshot(),{recipes:200,normalized:200,paid:false});
});

test('700 hydration rejects old counts, unknown IDs, normalization drift and public-release mismatches',async()=>{
 const edits=[
  b=>{b.count=400;},b=>{b.catalogueVersion=500;},b=>{b.total=699;},b=>{b.releaseId='different-release';},
  b=>{b.freeRecipesSha256='0'.repeat(64);},b=>{b.freeNormalizedSha256='0'.repeat(64);},
  b=>{b.recipes.pop();},b=>{b.normalized.pop();},b=>{b.recipes[499].id='unexpected';},
  b=>{b.normalized[499].id=b.normalized[498].id;},b=>{b.normalized[499].ingredients[0].ingredient_index=1;}
 ];
 for(const edit of edits){
  const h=hydrationHarness();h.response(async()=>{const b={catalogueVersion:700,releaseId:h.release.manifest.release_id,count:500,total:700,targetTotal:700,freeRecipesSha256:h.release.manifest.free_recipes_sha256,freeNormalizedSha256:h.release.manifest.free_normalized_sha256,recipes:clone(h.release.premium),normalized:clone(h.release.premiumNormal)};edit(b);return new Response(JSON.stringify(b));});
  await h.reload();assert.deepEqual(h.snapshot(),{recipes:200,normalized:200,paid:false});
 }
});

test('700 hydration discards a delayed response after account or token changes',async()=>{
 const h=hydrationHarness();let finish;
 h.response(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=h.reload();h.session({user:{id:'member-b'},access_token:'token-b',expires_at:Date.now()/1000+3600});
 finish(new Response(JSON.stringify({catalogueVersion:700,releaseId:h.release.manifest.release_id,count:500,total:700,targetTotal:700,freeRecipesSha256:h.release.manifest.free_recipes_sha256,freeNormalizedSha256:h.release.manifest.free_normalized_sha256,recipes:h.release.premium,normalized:h.release.premiumNormal})));
 await pending;assert.deepEqual(h.snapshot(),{recipes:200,normalized:200,paid:false});
});

test('native digest fallback preserves the same pinned release when SubtleCrypto is unavailable',async()=>{
 const h=hydrationHarness({cryptoAvailable:false});
 await h.reload();assert.deepEqual(h.snapshot(),{recipes:700,normalized:700,paid:true});
 h.session(null);await h.reload();assert.deepEqual(h.snapshot(),{recipes:200,normalized:200,paid:false});
 const tampered=hydrationHarness({cryptoAvailable:false,tamperPublic:true});await tampered.reload();assert.deepEqual(tampered.snapshot(),{recipes:200,normalized:200,paid:false});
 const brokenNative=hydrationHarness();brokenNative.context.crypto={subtle:{digest:async()=>{throw Error('native digest unavailable');}}};await brokenNative.reload();assert.deepEqual(brokenNative.snapshot(),{recipes:700,normalized:700,paid:true});
});

test('portable catalogue digest matches standard SHA-256 vectors, UTF-8, block boundaries and large data',()=>{
 assert.equal(sha256Utf8(''),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
 assert.equal(sha256Utf8('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 for(const value of ['Salmon en croûte · £4.99 🐟','a'.repeat(55),'b'.repeat(56),'c'.repeat(63),'d'.repeat(64),'e'.repeat(65),'a'.repeat(1000000),JSON.stringify(fixture().free)])assert.equal(sha256Utf8(value),createHash('sha256').update(value).digest('hex'));
 assert.throws(()=>sha256Utf8(null),/must be text/);
});

test('the public 700 input validator binds exact Free hashes, roles and the unchanged legacy prefix',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bb700-public-'));
 try{
  const release=fixture(),write=(name,value)=>fs.writeFileSync(path.join(temp,name),JSON.stringify(value));
  write('manifest.json',release.manifest);write('free.recipes.json',release.free);write('free.normalized.json',{recipes:release.normal});write('planning-roles.json',release.roles);write('pack-additions.json',{schemaVersion:1,ingredients:{}});
  assert.equal(validatePublic700Release({directory:temp,sourceDirectory:root,verifyImages:false}).premiumIds.length,500);
  assert.throws(()=>validatePublic700Release({directory:temp,sourceDirectory:root}),/ENOENT/,'the real build cannot omit its200images');
  const edits=[
   r=>{r.manifest.free_count=199;},r=>{r.manifest.clientVersion='1.0.1';},r=>{r.manifest.protected_rows_sha256='0'.repeat(64);},
   r=>{r.free[0].name='Changed old recipe';r.manifest.free_recipes_sha256=canonicalHash(r.free);},
   r=>{r.roles.recipes[199].catalogueNumber=699;},r=>{r.roles.recipes[0].id=r.roles.legacyRecipeIds[0];},
   r=>{r.roles.recipes.find(x=>x.kind==='breakfast').kind='dinner';},
   r=>{r.manifest.recipes.pop();}
  ];
  for(const edit of edits){const next=fixture();edit(next);write('manifest.json',next.manifest);write('free.recipes.json',next.free);write('free.normalized.json',{recipes:next.normal});write('planning-roles.json',next.roles);assert.throws(()=>validatePublic700Release({directory:temp,sourceDirectory:root,verifyImages:false}));}
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

function writeSyntheticPublicRelease(directory){
 const release=fixture(),photo=fs.readFileSync(new URL('../catalogues/700/pilot/assets/release-assets/basketboss-v17/images/new/spaghetti-carbonara.webp',import.meta.url));
 fs.mkdirSync(directory,{recursive:true});
 // Test-only complete asset fixture: retain a valid WebP picture and append
 // distinct XMP bytes. This is data-flow coverage, not recipe photo approval.
 for(const [index,row]of release.manifest.recipes.entries()){
  const metadata=Buffer.from('<x:xmpmeta>synthetic-client-fixture-'+index+'</x:xmpmeta>'),header=Buffer.alloc(8);header.write('XMP ',0,'ascii');header.writeUInt32LE(metadata.length,4);
  const bytes=Buffer.concat([photo,header,metadata,...(metadata.length%2?[Buffer.alloc(1)]:[])]);bytes.writeUInt32LE(bytes.length-8,4);row.sha256=createHash('sha256').update(bytes).digest('hex');
  const file=path.join(directory,'assets',row.image);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
 }
 for(const [name,value]of [['manifest.json',release.manifest],['free.recipes.json',release.free],['free.normalized.json',{recipes:release.normal}],['planning-roles.json',release.roles],['pack-additions.json',{schemaVersion:1,ingredients:{}}]])fs.writeFileSync(path.join(directory,name),JSON.stringify(value));
 return release;
}

async function syntheticNativeBaseline(directory){
 fs.mkdirSync(directory);
 for(const name of [...CLIENT_FILES,...DATA_FILES,...HTML_FILES])fs.copyFileSync(path.join(root,name),path.join(directory,name));
 for(const name of ['native','icons','food-thumbs','photos','release-assets'])fs.cpSync(path.join(root,name),path.join(directory,name),{recursive:true});
 // This fixture checks native asset staging, not the Capacitor bridge build.
 // Build from a private source copy so CI needs no pre-existing ignored dist.
 return buildNativeWeb({root:directory,bundleRuntime:async({outfile})=>fs.writeFileSync(outfile,'globalThis.syntheticNativeBridge=true;')});
}

test('explicit700 sync stages the verified200-Free build after standard100-Free sync and preserves platform bridges',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bb700-sync-')),project=path.join(temp,'project'),publicDirectory=path.join(temp,'release'),output=path.join(temp,'native700');
 try{
  const release=writeSyntheticPublicRelease(publicDirectory),baseline=(await syntheticNativeBaseline(path.join(temp,'baseline-source'))).directory;verifyNativeWeb({directory:baseline});
  fs.mkdirSync(project);for(const name of ['app.html','basketboss-pricing-v19.js','capacitor.config.json','bb-plan-swap-core.js','bb-plan-swap-host.js','bb-plan-swap.js','bb-plan-swap.css'])fs.copyFileSync(path.join(root,name),path.join(project,name));
  const iosPublic=path.join(project,'ios/App/App/public');fs.mkdirSync(iosPublic,{recursive:true});fs.writeFileSync(path.join(iosPublic,'prior-release.txt'),'prior release');
  const originalConfig=fs.readFileSync(path.join(project,'capacitor.config.json')),calls=[];
  const result=await sync700IOS({root:project,publicRelease:publicDirectory,outputDirectory:output,platform:'darwin',runStandardSync:async cwd=>{
   calls.push('standard100');assert.equal(readFree(baseline),100);assert.equal(JSON.parse(fs.readFileSync(path.join(cwd,'capacitor.config.json'))).webDir,'dist/native');
   fs.mkdirSync(path.join(cwd,'dist'),{recursive:true});fs.cpSync(baseline,path.join(cwd,'dist/native'),{recursive:true});fs.rmSync(iosPublic,{recursive:true});fs.cpSync(baseline,iosPublic,{recursive:true});
   fs.writeFileSync(path.join(iosPublic,'cordova.js'),'/* synthetic Capacitor bridge file */');fs.writeFileSync(path.join(iosPublic,'cordova_plugins.js'),'/* synthetic plugin registry */');
  }});
  assert.deepEqual(calls,['standard100']);assert.equal(result.catalogueVersion,700);assert.equal(result.freeRecipes,200);assert.equal(result.archiveUploaded,false);assert.equal(result.xcodeBuildVerified,false);
  assert.equal(readFree(iosPublic),200);assert.equal(readFree(path.join(project,'dist/native')),100,'standard output remains the legacy catalogue');
  assert.ok(fs.readFileSync(path.join(project,'capacitor.config.json')).equals(originalConfig));assert.equal(fs.existsSync(path.join(iosPublic,'prior-release.txt')),false);
  assert.deepEqual(result.preservedPlatformFiles,['cordova_plugins.js','cordova.js'].sort((a,b)=>a.localeCompare(b,'en')));
  assert.equal(fs.readFileSync(path.join(iosPublic,'cordova.js'),'utf8'),'/* synthetic Capacitor bridge file */');
  const validated=validatePublic700Release({directory:publicDirectory,sourceDirectory:project});assert.equal(verify700Client({directory:iosPublic,release:validated}).freeRecipes,200);
  assert.throws(()=>verifyNativeWeb({directory:iosPublic}),/exactly the public 100 Free/,'the old verifier was not weakened to accept700');
  // A later accidental standard-sync copy is detectable by the explicit700
  // verifier, rather than silently passing as the release staged above.
  fs.copyFileSync(path.join(project,'dist/native/index.html'),path.join(iosPublic,'index.html'));
  assert.throws(()=>verify700Client({directory:iosPublic,release:validated}),/entrypoints_differ/);
  // A private export is rejected before the staging helper can replace native
  // assets, even if someone puts it beside a previously verified bundle.
  fs.writeFileSync(path.join(output,'mistake.private.json'),'{}');
  assert.throws(()=>stage700IOSAssets({bundleDirectory:output,baselineDirectory:path.join(project,'dist/native'),iosPublicDirectory:iosPublic,release:validated}),/forbidden_output_path/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
function readFree(directory){return JSON.parse(fs.readFileSync(path.join(directory,'recipes.json'))).length;}

test('explicit700 sync validates before native changes and restores the prior public directory if sync fails',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bb700-sync-rollback-')),project=path.join(temp,'project'),publicDirectory=path.join(temp,'release');
 try{
  const release=writeSyntheticPublicRelease(publicDirectory);fs.mkdirSync(project);for(const name of ['app.html','basketboss-pricing-v19.js','capacitor.config.json'])fs.copyFileSync(path.join(root,name),path.join(project,name));
  const iosPublic=path.join(project,'ios/App/App/public');fs.mkdirSync(iosPublic,{recursive:true});fs.writeFileSync(path.join(iosPublic,'prior-release.txt'),'keep this exact prior release');
  let called=false;
  await assert.rejects(()=>sync700IOS({root:project,publicRelease:publicDirectory,outputDirectory:path.join(temp,'out'),platform:'linux',runStandardSync:()=>{called=true;}}),/requires_macos/);assert.equal(called,false);
  fs.unlinkSync(path.join(publicDirectory,'assets',release.manifest.recipes[199].image));
  await assert.rejects(()=>sync700IOS({root:project,publicRelease:publicDirectory,outputDirectory:path.join(temp,'out'),platform:'darwin',runStandardSync:()=>{called=true;}}),/ENOENT/);assert.equal(called,false);
  // Restore that checked asset, then simulate a partially failing native sync.
  writeSyntheticPublicRelease(publicDirectory);
  await assert.rejects(()=>sync700IOS({root:project,publicRelease:publicDirectory,outputDirectory:path.join(temp,'out'),platform:'darwin',runStandardSync:()=>{called=true;fs.rmSync(iosPublic,{recursive:true});fs.mkdirSync(iosPublic);fs.writeFileSync(path.join(iosPublic,'partial.txt'),'partial sync');throw Error('simulated native sync failure');}}),/simulated native sync failure/);
  assert.equal(called,true);assert.equal(fs.readFileSync(path.join(iosPublic,'prior-release.txt'),'utf8'),'keep this exact prior release');assert.equal(fs.existsSync(path.join(iosPublic,'partial.txt')),false);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
