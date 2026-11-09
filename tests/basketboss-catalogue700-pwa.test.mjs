import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {build700Pwa,verify700Pwa,transform700MakeAMeal,protect700EmailBody} from '../tools/catalogue700/build-pwa.mjs';
import {transform700MakeAMeal as sharedMakeTransform,pwa700Contract as sharedMakeContract} from '../tools/catalogue700/make-a-meal.mjs';
import {validatePublic700Release,inlineArray} from '../tools/catalogue700/build-client.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname),directory=path.join(root,'catalogues/700/release');
const release=validatePublic700Release({directory,sourceDirectory:root});
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));

test('generated web email protection adds only documented body comments, preserves mailto content and fails closed on ambiguous anchors',()=>{
 const source='<!doctype html><html><head><title>Contact</title></head><body class="compact"><a href="mailto:help@basketboss.co.uk">help@basketboss.co.uk</a><script>const unchanged="safe";</script></body></html>',protectedHtml=protect700EmailBody(source);
 assert.equal(protectedHtml.replace('<!--email_off-->','').replace('<!--/email_off-->',''),source);
 assert.match(protectedHtml,/<body class="compact"><!--email_off--><a href="mailto:help@basketboss\.co\.uk">help@basketboss\.co\.uk<\/a>/);
 assert.match(protectedHtml,/<!--\/email_off--><\/body>/);
 for(const invalid of [source.replace('<body class="compact">',''),source.replace('</body>',''),source.replace('</body>','</body><body></body>'),source.replace('<body','</body><body'),source.replace('</body>','<!--email_off--></body>'),source.replace('</body>','<!--/email_off--></body>'),protectedHtml])assert.throws(()=>protect700EmailBody(invalid),/catalogue700_pwa_email/);
});

test('shared companion transform preserves identical security in native and PWA outputs with an explicit public URL',()=>{
 assert.equal(sharedMakeTransform,transform700MakeAMeal,'PWA reexports the pure shared transform');
 const source=read('make-a-meal.js'),web=sharedMakeTransform(source,release),native=sharedMakeTransform(source,release,{publicRecipesUrl:'recipes.json'});
 assert.equal(native,web.replace("bbMealJSON('/pwa700/recipes.json',{cache:'no-store'})","bbMealJSON('recipes.json',{cache:'no-store'})"));
 assert.doesNotMatch(native,/\/pwa700\/recipes\.json/);assert.match(native,/bbMealJSON\('recipes\.json',\{cache:'no-store'\}\)/);
 assert.equal(sharedMakeContract(release).premiumIds.length,500);assert.throws(()=>sharedMakeTransform(source,release,{publicRecipesUrl:'https://other.invalid/private'}),/public_recipe_url/);
 new vm.Script(native,{filename:'native700-make-a-meal.js'});
});

test('isolated web700 generation preserves legacy clients and emits only public web data without StoreKit',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bb700-pwa-')),output=path.join(temp,'pwa700');
 const protectedPaths=['app.html','index.html','make-a-meal.html','tutorial.html','basketboss-latest-guide.html','pricing-sandbox.html','compare.html','subscriptions.html','recipes.json','normalized-ingredient-database.json','bb-premium-preview-config.js','bb-recipe-planning.js','basketboss-pricing-v19.js','make-a-meal.js','capacitor.config.json'];
 const before=new Map(protectedPaths.map(name=>[name,hash(read(name))]));
 try{
  const result=build700Pwa({sourceRoot:root,publicRelease:directory,outputDirectory:output,writeImageRedirects:false});
  assert.equal(result.freeRecipes,200);assert.equal(result.premiumRecipes,500);assert.equal(result.privateRecipeBundle,false);
  assert.equal(verify700Pwa({directory:output,release}).catalogueVersion,700);
  for(const [name,digest]of before)assert.equal(hash(read(name)),digest,name+' legacy bytes changed');
  const html=fs.readFileSync(path.join(output,'app.html'),'utf8');
  for(const name of ['app.html','make-a-meal.html','tutorial.html','basketboss-latest-guide.html','pricing-sandbox.html','compare.html','subscriptions.html']){
   const document=fs.readFileSync(path.join(output,name),'utf8');assert.equal(document.match(/<!--email_off-->/g)?.length,1,name);assert.equal(document.match(/<!--\/email_off-->/g)?.length,1,name);assert.match(document,/<body\b[^>]*><!--email_off-->/i);assert.match(document,/<!--\/email_off--><\/body\s*>/i);
  }
  assert.equal(inlineArray(html,'RECIPES').value.length,200);assert.match(html,/<base href="\/">/);assert.match(html,/src="\/pwa700\/bb-premium-preview-config\.js\?v=[a-f0-9]{16}"/);
  assert.doesNotMatch(html,/bb-native-runtime|basketboss-native-build|@capacitor\//);
  const context=vm.createContext({window:{},self:{}});vm.runInContext(fs.readFileSync(path.join(output,'bb-premium-preview-config.js'),'utf8'),context);
  const freeIds=context.window.BB173_FREE_RECIPE_IDS;assert.equal(freeIds.length,200);assert.deepEqual(Array.from(freeIds),release.free.map(row=>row.id));assert.equal(freeIds.some(id=>release.premiumIds.includes(id)),false);
  assert.equal(context.window.BB173_PREMIUM_PREVIEW.subscriptionVerified,false);assert.deepEqual(Array.from(context.window.BB173_PREMIUM_PREVIEW.acceptedPremiumRecipeCounts),[500]);
  context.RECIPES=[...clone(release.free),{id:release.premiumIds[499],name:'Synthetic locked card'}];context.bbVerifiedPaidRecipes=false;context.bb176IsPremiumPreview=()=>false;
  const gate=html.slice(html.indexOf('function bb176AllowedRecipe(id){'),html.indexOf('function bb176MaskPremiumPlans(app){'));
  vm.runInContext(gate+'\nglobalThis.allowed=bb176AllowedRecipe;',context);
  for(const recipe of release.free)assert.equal(context.allowed(recipe.id),true,recipe.id+' must remain usable without a subscription');
  assert.equal(context.allowed(release.premiumIds[499]),false,'public preview allowlist grants no Premium identity');assert.equal(context.allowed('unknown-catalogue-id'),false);
  vm.runInContext(fs.readFileSync(path.join(output,'precache.js'),'utf8'),context);
  const cache=Array.from(context.self.BB700_PWA_PRECACHE);assert.ok(cache.length>150);assert.ok(cache.includes('/pwa700/recipes.json'));
  assert.ok(cache.includes('/bb-receipt-inventory-core.mjs?v=20261105-business1'));assert.ok(cache.includes('/bb-pantry-policy.js'));
  assert.doesNotMatch(fs.readFileSync(path.join(output,'shopping-inventory.js'),'utf8'),/new URL\('\.\/bb-receipt-inventory-core/,'relocated pantry scripts must keep the actual shared module URL');
  assert.equal(cache.some(url=>new URL(url,'https://basketboss.co.uk').pathname.endsWith('.webmanifest')),false,'manifest stays network-only across Access installations');
  assert.match(context.self.BB700_PWA_CACHE_VERSION,/^[a-f0-9]{64}$/);
  const assetProof=cache.map(url=>{const pathname=new URL(url,'https://basketboss.co.uk').pathname;let file=pathname.startsWith('/pwa700/')?path.join(output,pathname.slice('/pwa700/'.length)):path.join(root,pathname.slice(1));if(!fs.existsSync(file))file+='.html';return {url,sha256:hash(fs.readFileSync(file))};});
  assert.equal(context.self.BB700_PWA_CACHE_VERSION,hash(JSON.stringify(assetProof)),'cache identity binds the sorted exact URLs and their actual emitted/shared bytes');
  assert.ok(cache.some(url=>/^\/pwa700\/bb-recipe-planning\.js\?v=[a-f0-9]{16}$/.test(url)));assert.ok(cache.some(url=>/^\/bb-home\.js\?v=[a-f0-9]{16}$/.test(url)));
  assert.equal(cache.some(url=>!url.startsWith('/')||/\/api\/|token|auth\/|private|\.sealed|\.sql|native-runtime/.test(url)),false);
  for(const name of fs.readdirSync(output).filter(name=>name.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(output,name),'utf8'),{filename:name});
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
  for(const row of manifest.files){assert.ok(!/private|sealed|\.sql|native/.test(row.path));if(row.path.endsWith('.json')){const value=JSON.parse(fs.readFileSync(path.join(output,row.path),'utf8'));const recipes=Array.isArray(value)?value:value.recipes;if(Array.isArray(recipes)&&recipes.some(recipe=>recipe?.ingredients))assert.equal(recipes.some(recipe=>release.premiumIds.includes(recipe.id)),false);}}
  const first=hash(fs.readFileSync(path.join(output,'manifest.json')));build700Pwa({sourceRoot:root,publicRelease:directory,outputDirectory:output,writeImageRedirects:false});assert.equal(hash(fs.readFileSync(path.join(output,'manifest.json'))),first,'same reviewed inputs generate identical web bytes');
  assert.throws(()=>build700Pwa({sourceRoot:root,publicRelease:directory,outputDirectory:path.join(root,'tools'),writeImageRedirects:false}),/output_protected/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

function premiumBody(){
 const recipes=release.premiumIds.map(id=>({id,name:'Synthetic response fixture',ingredients:[['Rice','100 g',0.2,'Grains']]}));
 return {catalogueVersion:700,releaseId:release.manifest.release_id,count:500,total:700,targetTotal:700,freeRecipesSha256:release.manifest.free_recipes_sha256,freeNormalizedSha256:release.manifest.free_normalized_sha256,recipes,normalized:recipes.map(recipe=>({id:recipe.id,ingredients:[{recipe_id:recipe.id,ingredient_index:0,name:'Rice'}]}))};
}
function makeHarness({tamperFree=false}={}){
 const source=transform700MakeAMeal(read('make-a-meal.js'),release),end=source.indexOf('function bbSecureCheckAccountChange(){');
 let session={user:{id:'member-a'},access_token:'synthetic-token-a',expires_at:Date.now()/1000+3600},perform=async()=>({response:{ok:true},data:premiumBody()}),calls=0;
 const context=vm.createContext({TextEncoder,AbortController,fetch(){throw Error('unexpected real network');},setTimeout,clearTimeout,window:{BB173_FREE_RECIPE_IDS:release.free.map(row=>row.id)},localStorage:{getItem:()=>session?JSON.stringify(session):null},bbPaidToken:()=>session?.access_token||null,renderTiles(){},perform:(...args)=>{calls++;assert.equal(args[0],'/api/recipes/v700/premium?catalogue=700');assert.equal(args[1].cache,'no-store');assert.equal(args[1].headers.Authorization,'Bearer '+session.access_token);return perform(...args);}});
 const free=clone(release.free);if(tamperFree)free[199].name='Mutated public recipe';context.publicRecipes=free;
 vm.runInContext('let recipes=[];const bbPhotoMealMode=false;\n'+source.slice("(()=>{'use strict';".length,end)+'\nbbMealJSON=(...args)=>perform(...args);bbSecureFreeRecipes=publicRecipes;globalThis.reload=bbSecureRefreshPremiumRecipes;globalThis.snapshot=()=>({recipes:recipes.length,premium:bbSecurePremiumIds.size});',context);
 return {reload:()=>context.reload(),snapshot:()=>({...context.snapshot()}),session:value=>{session=value;},respond:value=>{perform=value;},calls:()=>calls};
}

test('independent web700 pantry meal loader hydrates the exact release and clears Premium on logout',async()=>{
 const h=makeHarness();await h.reload();assert.deepEqual(h.snapshot(),{recipes:700,premium:500});h.session(null);await h.reload();assert.deepEqual(h.snapshot(),{recipes:200,premium:0});assert.equal(h.calls(),1);
});

test('web700 independent loader rejects missing auth, stale releases, identity/position drift and modified public data',async()=>{
 const edits=[body=>{body.count=400;},body=>{body.catalogueVersion=500;},body=>{body.releaseId='old-release';},body=>{body.total=500;},body=>{body.targetTotal=699;},body=>{body.freeRecipesSha256='0'.repeat(64);},body=>{body.freeNormalizedSha256='0'.repeat(64);},body=>{body.recipes.pop();},body=>{body.normalized.pop();},body=>{body.recipes[499].id='unknown-recipe';},body=>{body.recipes[1].id=body.recipes[0].id;},body=>{body.normalized[499].ingredients[0].ingredient_index=1;},body=>{body.normalized[499].ingredients[0].name='Wrong ingredient';}];
 for(const edit of edits){const h=makeHarness();h.respond(async()=>{const body=premiumBody();edit(body);return {response:{ok:true},data:body};});await h.reload();assert.deepEqual(h.snapshot(),{recipes:200,premium:0});}
 for(const session of [null,{user:{},access_token:'synthetic-no-owner'}]){const h=makeHarness();h.session(session);await h.reload();assert.deepEqual(h.snapshot(),{recipes:200,premium:0});assert.equal(h.calls(),0);}
 const altered=makeHarness({tamperFree:true});await altered.reload();assert.deepEqual(altered.snapshot(),{recipes:200,premium:0});assert.equal(altered.calls(),0);
 const denied=makeHarness();denied.respond(async()=>({response:{ok:false},data:premiumBody()}));await denied.reload();assert.deepEqual(denied.snapshot(),{recipes:200,premium:0});
});

test('web700 independent loader discards late responses after account changes and newer requests',async()=>{
 const h=makeHarness();let finish;h.respond(()=>new Promise(resolve=>{finish=resolve;}));const pending=h.reload();
 h.session({user:{id:'member-b'},access_token:'synthetic-token-b'});finish({response:{ok:true},data:premiumBody()});await pending;assert.deepEqual(h.snapshot(),{recipes:200,premium:0});
 const newer=makeHarness();let oldFinish;newer.respond(()=>new Promise(resolve=>{oldFinish=resolve;}));const old=newer.reload();newer.respond(async()=>({response:{ok:false},data:null}));await newer.reload();oldFinish({response:{ok:true},data:premiumBody()});await old;assert.deepEqual(newer.snapshot(),{recipes:200,premium:0});
});

test('image rewrites are exactly the 200 reviewed new identities and never redirect old images or use wildcards',()=>{
 const redirects=read('_redirects').trim().split('\n');assert.equal(redirects.length,200);assert.equal(new Set(redirects).size,200);
 const expected=release.imageRows.map(row=>'/'+row.image+' /catalogues/700/release/assets/'+row.image+' 200');assert.deepEqual(redirects,expected);
 assert.equal(redirects.some(rule=>rule.includes('*')||rule.includes('/images/existing/')),false);
 for(const row of release.imageRows)assert.equal(hash(fs.readFileSync(path.join(directory,'assets',row.image))),row.sha256);
});
