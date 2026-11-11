import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {isHousehold} from '../bb-kitchen-choice-rules.mjs';
const require=createRequire(import.meta.url),review=require('../bb-household-stock-review.js'),policy=require('../bb-pantry-policy.js');
const weekly={};vm.runInNewContext(fs.readFileSync(new URL('../bb-weekly-essentials.js',import.meta.url),'utf8'),weekly);
const keys=review.keys,options={isHousehold,canonicalize:policy.canonicalName,reconcile:weekly.BBWeeklyEssentials.reconcile};
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const value={actor:'household-review-user',trip:'shop-review-1',session:'session-one',stock:{'toilet rolls|each':16,'rice|g':450},inventory:{
  toilet:{name:'Toilet rolls',loc:'cupboard',qty:16,unit:'each',selected:true,bb173StockKey:'toilet rolls|each',bb173StockValue:16,notes:'Keep purchase history'},
  rice:{name:'Rice',loc:'cupboard',qty:450,unit:'g',selected:true,bb173StockKey:'rice|g',bb173StockValue:450}
 },features:{version:1,essentials:[{id:'toilet-essential',name:'Toilet rolls',unit:'each',qty:5,targetQty:5,ownedQty:2,selected:true,manualPending:true,owned:false,brand:'Usual brand'},{id:'soap-essential',name:'Soap',unit:'each',qty:3,targetQty:3,ownedQty:1,selected:true}]}};
 value.expected={[keys.stock]:JSON.stringify(value.stock),[keys.inventory]:JSON.stringify(value.inventory),[keys.features]:JSON.stringify(value.features),basketboss_cloud_session_v1:value.session,receipt_owner:'owner-1'};return value;
}
const choose=(snapshot,totalOwned=16)=>{const candidate=review.scan(snapshot,options)[0];return {id:candidate.id,fingerprint:candidate.fingerprint,totalOwned};};

test('scan identifies household stock using the existing hard classifier and performs no migration',()=>{
 const s=fixture();s.stock['bread rolls|each']=4;s.stock['milk|ml']=600;s.stock['rice paper|each']=2;const before=JSON.stringify(s),rows=review.scan(s,options);
 assert.equal(rows.length,1);assert.equal(rows[0].sourceQuantity,16);assert.equal(rows[0].existingOwned,2);assert.equal(rows[0].defaultTotal,16);assert.equal(rows[0].combinedQuantity,18);assert.equal(rows[0].essentialId,'toilet-essential');assert.equal(JSON.stringify(s),before);
});
test('confirmed actual total replaces the household balance without blindly adding both records',()=>{
 const s=fixture(),before=JSON.stringify(s),p=review.proposal(s,choose(s),options),row=p.updates[keys.features].essentials[0];
 assert.equal(row.ownedQty,16);assert.equal(row.targetQty,5);assert.equal(row.qty,5);assert.equal(row.brand,'Usual brand');assert.equal(row.owned,true);assert.equal(p.toBuy,0);assert.equal(row.id,'toilet-essential');
 assert.deepEqual(p.stock,{'rice|g':450});assert.equal(Object.hasOwn(p.stock,'toilet rolls|each'),false);assert.deepEqual(p.updates[keys.features].essentials[1],s.features.essentials[1]);assert.equal(JSON.stringify(s),before);
});
test('combining separate physical amounts is possible only through the explicit selected total',()=>{
 const s=fixture(),p=review.proposal(s,choose(s,18),options);assert.equal(p.ownedQty,18);assert.equal(p.updates[keys.features].essentials[0].ownedQty,18);
});
test('a chosen lower total uses the existing household reconciliation formula and preserves its target',()=>{
 const s=fixture(),p=review.proposal(s,choose(s,3),options),row=p.updates[keys.features].essentials[0];assert.equal(row.targetQty,5);assert.equal(row.ownedQty,3);assert.equal(row.owned,false);assert.equal(p.toBuy,2);
});
test('only linked household inventory is retired and its stock association is detached',()=>{
 const s=fixture(),p=review.proposal(s,choose(s),options),inventory=p.updates[keys.inventory];
 assert.equal(inventory.toilet.selected,false);assert.equal(inventory.toilet.qty,0);assert.equal(inventory.toilet.notes,'Keep purchase history');assert.equal('bb173StockKey' in inventory.toilet,false);assert.equal('bb173StockValue' in inventory.toilet,false);assert.deepEqual(inventory.rice,s.inventory.rice);
 assert.deepEqual(Object.keys(p.updates).sort(),Object.values(keys).sort(),'receipt proofs and unrelated ledgers are outside this proposal');assert.deepEqual(p.expected,s.expected);
});
test('a new household row is created only when no matching name and unit exists',()=>{
 const s=fixture();s.features.essentials=s.features.essentials.filter(row=>row.id!=='toilet-essential');const p=review.proposal(s,choose(s),options),row=p.updates[keys.features].essentials.find(row=>row.name==='toilet rolls');
 assert.ok(row);assert.equal(row.ownedQty,16);assert.equal(row.targetQty,0);assert.equal(row.owned,true);assert.equal(p.toBuy,0);assert.equal(p.updates[keys.features].essentials.length,2);
});
test('review reuses an inactive matching household record and preserves its target, id and metadata',()=>{
 const s=fixture();s.features.essentials[0].selected=false;const p=review.proposal(s,choose(s),options),row=p.updates[keys.features].essentials[0];
 assert.equal(row.id,'toilet-essential');assert.equal(row.targetQty,5);assert.equal(row.brand,'Usual brand');assert.equal(row.selected,true);assert.equal(row.ownedQty,16);assert.equal(p.updates[keys.features].essentials.length,2);
});
test('zero household food keys are removed after review while the valid existing total is the default',()=>{
 const s=fixture();s.stock['toilet rolls|each']=0;const rows=review.scan(s,options);assert.equal(rows[0].sourceQuantity,0);assert.equal(rows[0].defaultTotal,2);
 const p=review.proposal(s,choose(s,2),options);assert.equal(p.updates[keys.features].essentials[0].ownedQty,2);assert.equal('toilet rolls|each' in p.stock,false);
});
test('actor, trip, session, stock, inventory and target changes invalidate an open review',()=>{
 for(const change of [s=>s.actor='another-user',s=>s.trip='another-trip',s=>s.session='rotated-session',s=>s.stock['rice|g']=500,s=>s.inventory.toilet.qty=17,s=>s.features.essentials[0].targetQty=6,s=>s.expected.receipt_owner='owner-2']){
  const s=fixture(),choice=choose(s);change(s);assert.throws(()=>review.proposal(s,choice,options),/changed/);
 }
});
test('unsafe totals and fractional counts fail before any saved proposal is made',()=>{
 for(const total of [-1,NaN,Infinity,1000001,16.5,'16',null]){const s=fixture(),before=JSON.stringify(s);assert.throws(()=>review.proposal(s,choose(s,total),options),/valid total/);assert.equal(JSON.stringify(s),before);}
});
test('ambiguous matching rows and incompatible household units require review instead of conversion or duplication',()=>{
 const s=fixture();s.features.essentials.push({...s.features.essentials[0],id:'duplicate'});assert.match(review.scan(s,options)[0].problem,/More than one/);assert.throws(()=>review.proposal(s,choose(s),options),/More than one/);
 const different=fixture();different.features.essentials[0].unit='pack';assert.match(review.scan(different,options)[0].problem,/different unit/);assert.throws(()=>review.proposal(different,choose(different),options),/different unit/);
});
test('an unknown previous owned amount can be replaced by the reviewed actual total without inventing a sum',()=>{
 const s=fixture();s.features.essentials[0].ownedQty=null;const candidate=review.scan(s,options)[0];assert.equal(candidate.existingOwned,null);assert.equal(candidate.combinedQuantity,null);assert.equal(review.proposal(s,choose(s),options).ownedQty,16);
});
test('repeat review after the host commits cannot move the same household stock twice',()=>{
 const s=fixture(),choice=choose(s),p=review.proposal(s,choice,options);s.stock=p.updates[keys.stock];s.inventory=p.updates[keys.inventory];s.features=p.updates[keys.features];assert.equal(review.scan(s,options).length,0);assert.throws(()=>review.proposal(s,choice,options),/changed/);
});

let chromium,browser;try{({chromium}=require(process.env.BB_PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}catch{}
before(async()=>{if(chromium)browser=await chromium.launch({headless:true,executablePath:process.env.BB_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
async function uiFixture(width,run){
 const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'}),page=await context.newPage();
 try{
  await context.route('**/*',route=>route.fulfill({status:403,body:''}));await page.setContent('<main id="review"></main>');
  await page.addScriptTag({path:new URL('../bb-weekly-essentials.js',import.meta.url).pathname});await page.addScriptTag({path:new URL('../bb-household-stock-review.js',import.meta.url).pathname});
  await page.evaluate(({snapshot,keys})=>{
   window.qa={snapshot,keys,writes:[],queues:[],fail:false,queuedFailure:false};
   qa.controller=BBHouseholdStockReview.createController({document,read:()=>structuredClone(qa.snapshot),keys,isHousehold:name=>/^toilet rolls?$/i.test(name),canonicalize:name=>name.toLowerCase(),reconcile:BBWeeklyEssentials.reconcile,
    preparePurchasedPantry:entry=>{qa.queues.push(entry);return {updates:{purchase_sync:{stock:entry.stock}},expected:{receipt_owner:qa.queuedFailure?'changed-owner':'owner-1'}};},
    write:(updates,expected)=>{qa.writes.push({updates,expected});if(qa.fail)return false;for(const key of [keys.stock,keys.inventory,keys.features]){const field=Object.keys(keys).find(name=>keys[name]===key);qa.snapshot[field]=structuredClone(updates[key]);qa.snapshot.expected[key]=JSON.stringify(updates[key]);}return true;}
   });qa.controller.render(document.getElementById('review'));
  },{snapshot:fixture(),keys});
  await run(page);
 }finally{await context.close();}
}
for(const width of [320,390])test('household review is explicit, readable and one atomic host write at '+width+'px',{skip:!chromium},()=>uiFixture(width,async page=>{
 const card=page.getByRole('region',{name:'Review household stock'});await card.waitFor();assert.match(await card.innerText(),/Recorded with food: 16 each/);assert.match(await card.innerText(),/Already in Weekly essentials: 2 each/);assert.equal(await page.getByRole('spinbutton').inputValue(),'16');assert.equal(await page.evaluate(()=>qa.writes.length),0);
 const buttons=await card.locator('button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));assert.ok(buttons.every(height=>height>=44));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:'Combine to 18 each total',exact:true}).click();assert.equal(await page.getByRole('spinbutton').inputValue(),'18');assert.equal(await page.evaluate(()=>qa.writes.length),0);
 await page.getByRole('button',{name:'Move to Weekly essentials',exact:true}).click();await card.waitFor({state:'detached'});
 const result=await page.evaluate(()=>({writes:qa.writes,queues:qa.queues,snapshot:qa.snapshot}));assert.equal(result.writes.length,1);assert.equal(result.snapshot.features.essentials[0].ownedQty,18);assert.equal(result.snapshot.features.essentials[0].targetQty,5);assert.deepEqual(result.snapshot.stock,{'rice|g':450});assert.deepEqual(result.queues[0].beforeStock,{'toilet rolls|each':16,'rice|g':450});assert.deepEqual(result.writes[0].updates.purchase_sync.stock,{'rice|g':450});
}));
test('cancel, failed host writes and a changed CAS owner never automatically sum or move stock',{skip:!chromium},()=>uiFixture(390,async page=>{
 await page.evaluate(()=>qa.queuedFailure=true);await page.getByRole('button',{name:'Move to Weekly essentials',exact:true}).click();assert.equal(await page.evaluate(()=>qa.writes.length),0);assert.equal(await page.evaluate(()=>qa.snapshot.stock['toilet rolls|each']),16);
 await page.evaluate(()=>{qa.queuedFailure=false;qa.fail=true;});await page.getByRole('button',{name:'Move to Weekly essentials',exact:true}).click();assert.equal(await page.evaluate(()=>qa.snapshot.features.essentials[0].ownedQty),2);assert.equal(await page.evaluate(()=>qa.snapshot.stock['toilet rolls|each']),16);
 await page.getByRole('button',{name:'Not now',exact:true}).click();assert.equal(await page.locator('.bb-household-stock-review').count(),0);assert.equal(await page.evaluate(()=>qa.snapshot.stock['toilet rolls|each']),16);
}));
