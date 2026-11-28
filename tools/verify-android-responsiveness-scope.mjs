#!/usr/bin/env node
// Independent change-scope check against the already published Android 1.0.11.
// This checks exact source bytes; it never invokes an auth/purchase/state action.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {transform700Presentation} from './catalogue700/presentation.mjs';
import {verify700Pwa} from './catalogue700/build-pwa.mjs';
import {validatePublic700Release} from './catalogue700/build-client.mjs';
import {verifyAndroidWeb} from '../scripts/build-android-web.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const base='c05180b1d28b4c30d2ae7b272faeab0f0565e546';
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16e6});
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const old=name=>git(['show',base+':'+name]);
const sha=value=>createHash('sha256').update(value).digest('hex');
const exact=(text,from,to,label)=>{assert.equal(text.split(from).length,2,label+' must have exactly one reviewed anchor');return text.replace(from,to);};

const originalNumber=" const number=value=>{const text=new Intl.NumberFormat(market==='US'?'en-US':'en-GB',{maximumFractionDigits:6,useGrouping:false}).format(value);return value>0&&Number(text)===0?value.toExponential(2):text;};";
const reviewedNumber=` const number=value=>{
  // Cache only immutable display formatters; every quantity is still formatted
  // from the current input and market with the original precision rules.
  const locale=market==='US'?'en-US':'en-GB';
  const formatters=bbShopExactQuantity.displayFormatters||(bbShopExactQuantity.displayFormatters=Object.create(null));
  const formatter=formatters[locale]||(formatters[locale]=Object.freeze(new Intl.NumberFormat(locale,{maximumFractionDigits:6,useGrouping:false})));
  const text=formatter.format(value);return value>0&&Number(text)===0?value.toExponential(2):text;
 };`;
const retiredGate=" // The current owners hide this retired meter with their existing CSS.\n // Keep the original fallback until the current Plan budget is actually present.\n if(tab==='week'&&(app.classList.contains('bb1748-plan-active')||app.classList.contains('bb1756-planner-flow'))&&app.querySelector('.bb1748-planner-budget,.bbnext-plan-budget'))return;\n if(tab==='shop'&&app.classList.contains('bb1756-cupboard-only'))return;\n";
const reviewedClean={"bb-household-aliases.js":{"old":" const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\\u0000-\\u001f\\u007f]/g,' ').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/\\s+/g,' ').trim():'';","new":" // Bounded primitive normalization only; callbacks and matching stay live.\n const cleanStrings=new Map();\n const clean=value=>{\n  if(typeof value!=='string')return '';\n  if(value.length<=256){const cached=cleanStrings.get(value);if(cached!==undefined)return cached;}\n  const result=value.normalize('NFKC').replace(/[\\u0000-\\u001f\\u007f]/g,' ').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/\\s+/g,' ').trim();\n  if(value.length<=256){\n   if(cleanStrings.size===512)cleanStrings.delete(cleanStrings.keys().next().value);\n   cleanStrings.set(value,result);\n  }\n  return result;\n };","nativeBaselineSha256":"e661be8bd0f2cf19f395f70a337c0689080ac142f7f4ad01ac3201facdb64651"},"bb-pantry-policy.js":{"old":" const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/[\\u0000-\\u001f\\u007f]/g,' ').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/\\s+/g,' ').trim():'';","new":" // Bounded primitive normalization only; callbacks and matching stay live.\n const cleanStrings=new Map();\n const clean=value=>{\n  if(typeof value!=='string')return '';\n  if(value.length<=256){const cached=cleanStrings.get(value);if(cached!==undefined)return cached;}\n  const result=value.normalize('NFKC').replace(/[\\u0000-\\u001f\\u007f]/g,' ').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/\\s+/g,' ').trim();\n  if(value.length<=256){\n   if(cleanStrings.size===512)cleanStrings.delete(cleanStrings.keys().next().value);\n   cleanStrings.set(value,result);\n  }\n  return result;\n };","nativeBaselineSha256":"085205ffb0aacf65f5f0303f4100faed291ea879b5eaf7b09c92419bc1322fbc"},"basketboss-pricing-v19.js":{"old":"const clean=s=>String(s||'').toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/,/g,' ').replace(/\\s+/g,' ').trim();","new":"// Bounded primitive normalization only; callbacks and matching stay live.\nconst cleanStrings=new Map();\nconst clean=s=>{\n const value=String(s||'');\n if(value.length<=256){const cached=cleanStrings.get(value);if(cached!==undefined)return cached;}\n const result=value.toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/,/g,' ').replace(/\\s+/g,' ').trim();\n if(value.length<=256){\n  if(cleanStrings.size===512)cleanStrings.delete(cleanStrings.keys().next().value);\n  cleanStrings.set(value,result);\n }\n return result;\n};","nativeBaselineSha256":"cfa61b2696731ec6cc6f82025ee48a7fda694781b50ac1ecb3bd31e42a74cbb6"}};
const reverseClean=(name,text)=>exact(text,reviewedClean[name].new,reviewedClean[name].old,'only primitive normalization cache '+name);
for(const name of Object.keys(reviewedClean))assert.equal(reverseClean(name,read(name)),old(name),'All matching/callback/config/calculation bytes remain identical: '+name);
const assetNames=['bb-plan-premium-polish.js','bb-pantry-inline.js','bb-pantry-stock-levels-ui.js','bb-us-market.js',...Object.keys(reviewedClean)];
function versions(text){
 for(const name of assetNames){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');text=text.replace(new RegExp('('+escaped+'\\?v=)[^"\\s]+','g'),'$1REVIEWED_ASSET_VERSION');}
 return text;
}
function originalHtml(text){return versions(exact(exact(text,reviewedNumber,originalNumber,'immutable display formatter'),retiredGate,'','hidden retired meter gate'));}
for(const name of ['app.html','index.html','pwa700/app.html'])assert.equal(originalHtml(read(name)),versions(old(name)),'All other HTML, inline scripts, calculations, routing and actions must be byte-identical: '+name);
assert.equal(versions(read('pwa700/make-a-meal.html')),versions(old('pwa700/make-a-meal.html')),'Generated make-a-meal permits only the reviewed presentation asset digest');
assert.equal(read('app.html'),read('index.html'),'Legacy public entrypoints remain equal');

// Complete presentation-module identities pinned after independent diff review.
// Explicit rows live only within a synchronous valid pantry refresh; actions,
// actor/deletion guards, matching/editor conflict validation keep their owner reads.
const reviewedModules={
 'bb-pantry-inline.js':'5923ab22916f9cc81a1f982ec1f29fe3c579ae11258962c0f43ccaf8c68ecba4',
 'bb-plan-premium-polish.js':'d5920cf22ef4a3912eb1de234f8f691fcca14029ddbee08c04238220cbc36927',
 'bb-pantry-stock-levels-ui.js':'a50ecbce8187afaeaccdf7ef3b6712a6cea01a027730cd6811528965b422681c',
 'bb-us-market.js':'eb155bdcd7f9d42e63219eb3e3c5136709c80319e90858f962ca7c0fa5a680c5'
};
for(const [name,hash]of Object.entries(reviewedModules))assert.equal(sha(read(name)),hash,'Unexpected change outside reviewed presentation patch: '+name);
assert.equal(read('pwa700/bb-plan-premium-polish.js'),transform700Presentation(read('bb-plan-premium-polish.js')),'Generated popover script must exactly match current source transform');
assert.equal(reverseClean('basketboss-pricing-v19.js',read('pwa700/basketboss-pricing-v19.js')),old('pwa700/basketboss-pricing-v19.js'),'All generated pricing packs, math and metadata remain identical outside pure normalization');

const fixture=JSON.parse(read('tests/fixtures/android-ios-baseline.json')),oldFixture=JSON.parse(old('tests/fixtures/android-ios-baseline.json'));
for(const name of ['app.html','index.html']){
 assert.equal(fixture.files[name],sha(read(name)),'Baseline records exact reviewed public HTML');
 delete fixture.files[name];delete oldFixture.files[name];
 assert.ok(fixture.reviewedOverrides[name].startsWith(oldFixture.reviewedOverrides[name]),'Prior baseline rationale must be retained');
 assert.match(fixture.reviewedOverrides[name].slice(oldFixture.reviewedOverrides[name].length),/Android loading follow-up:/);
 delete fixture.reviewedOverrides[name];delete oldFixture.reviewedOverrides[name];
}
assert.deepEqual(fixture,oldFixture,'All other iOS/native/math/auth baseline values must remain exact');

const currentManifest=JSON.parse(read('pwa700/manifest.json')),oldManifest=JSON.parse(old('pwa700/manifest.json'));
const generatedChanges=new Set(['app.html','bb-plan-premium-polish.js','make-a-meal.html','precache.js','basketboss-pricing-v19.js']);
const declared=currentManifest.files.map(row=>row.path);
assert.deepEqual(declared,oldManifest.files.map(row=>row.path),'No generated file additions/removals');
for(let i=0;i<currentManifest.files.length;i++){
 const row=currentManifest.files[i];assert.equal(row.bytes,Buffer.byteLength(read('pwa700/'+row.path)));assert.equal(row.sha256,sha(read('pwa700/'+row.path)));
 if(!generatedChanges.has(row.path))assert.deepEqual(row,oldManifest.files[i],'Unrelated generated asset changed: '+row.path);
}
currentManifest.files=[];oldManifest.files=[];assert.deepEqual(currentManifest,oldManifest,'Catalogue/API/access/recipe metadata must stay unchanged');
const normalizePrecache=text=>versions(text.replace(/self\.BB700_PWA_CACHE_VERSION="[a-f0-9]{64}";/,'self.BB700_PWA_CACHE_VERSION="REVIEWED_CACHE_HASH";'));
assert.equal(normalizePrecache(read('pwa700/precache.js')),normalizePrecache(old('pwa700/precache.js')),'Only changed presentation asset digests and cache version may differ');

const sourceScope=new Set(['app.html','index.html',...Object.keys(reviewedModules),...Object.keys(reviewedClean),'pwa700/app.html','pwa700/basketboss-pricing-v19.js','pwa700/bb-plan-premium-polish.js','pwa700/make-a-meal.html','pwa700/manifest.json','pwa700/precache.js','tests/fixtures/android-ios-baseline.json']);
const toolingScope=new Set([
 'tests/basketboss-plan-popover-hotpath-browser.test.mjs','tests/basketboss-shop-quantity-format-performance.test.mjs','tests/basketboss-legacy-budget-render-performance.test.mjs','tests/basketboss-pantry-refresh-snapshot-browser.test.mjs','tests/basketboss-stock-banner-layout-browser.test.mjs','tests/basketboss-us-market-lazy-display.test.mjs','tests/basketboss-normalization-performance.test.mjs',
 'tools/verify-android-responsiveness-scope.mjs','tools/audit-android-responsiveness.mjs','tools/audit-android-state-equivalence.mjs',
 '.github/workflows/android-build.yml','android/app/build.gradle','scripts/verify-android.mjs','scripts/verify-android-aab.mjs','tests/basketboss-android-package.test.mjs','tests/basketboss-android-aab.test.mjs','tests/basketboss-android-release11-launcher.test.mjs','tests/basketboss-android-release12-launcher.test.mjs','release-assets/prepare-android-mac.command'
]);
const changed=[...new Set([...git(['diff','--no-renames','--name-only',base]).trim().split('\n'),...git(['ls-files','--others','--exclude-standard']).trim().split('\n')].filter(Boolean))].sort();
for(const name of changed)assert.ok(sourceScope.has(name)||toolingScope.has(name)||/^release-assets\/android12-[\w.-]+\.(?:json|txt|md)$/.test(name),'Unexpected changed file outside targeted UI/test/release scope: '+name);
const nativeChanged=changed.filter(name=>/^(?:native|ios|functions|supabase)\//.test(name));assert.deepEqual(nativeChanged,[],'All native safety/auth/deletion/billing/server/schema source remains frozen');
const originalFiles=git(['ls-tree','-r','--name-only',base]).trim().split('\n');
const inlineCount=text=>[...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match=>!/(?:^|\s)src\s*=/.test(match[1])).length;
const release=validatePublic700Release({directory:path.join(root,'catalogues/700/release'),sourceDirectory:root});
const pwa=verify700Pwa({directory:path.join(root,'pwa700'),release,sourceRoot:root});
const android=fs.existsSync(path.join(root,'dist/android/native-web-manifest.json'))?verifyAndroidWeb({root}):null;
if(android)for(const name of Object.keys(reviewedModules))assert.equal(read('dist/android/'+name),transform700Presentation(read(name)),'Generated Android presentation asset must be current: '+name);
if(android)for(const name of Object.keys(reviewedClean))assert.equal(sha(reverseClean(name,read('dist/android/'+name))),reviewedClean[name].nativeBaselineSha256,'All native generated matching/calculation/pack bytes remain identical outside primitive normalization: '+name);
const report={ok:true,baseline:base,reviewedPresentationFiles:[...sourceScope].sort(),changedFiles:changed,frozenTrackedFiles:originalFiles.filter(name=>!changed.includes(name)).length,inlineBodies:{source:inlineCount(read('app.html')),generated:inlineCount(read('pwa700/app.html'))},protectedRulesAndSafetyUnchanged:true,protectedNativeBackendSourceUnchanged:true,normalizerImplementationsChanged:Object.keys(reviewedClean),quantityAndBudgetBodiesReverseNormalizeExactly:true,normalizationModulesReverseNormalizeExactly:true,pwa,android,releaseToolingRequiresVersionAndSigningChecks:true};
if(process.argv.includes('--report')){const index=process.argv.indexOf('--report'),target=process.argv[index+1];assert.ok(target);fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report));
