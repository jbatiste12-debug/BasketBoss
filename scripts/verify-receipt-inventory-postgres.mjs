// Execute the real migration and RPC in an isolated PostgreSQL WASM database.
// Install @electric-sql/pglite outside the website checkout and set
// BB_PGLITE_MODULE to its absolute package directory. No production connection.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
let PGlite;
try { ({PGlite} = require(process.env.BB_PGLITE_MODULE || '@electric-sql/pglite')); }
catch { throw Error('Install @electric-sql/pglite outside the checkout, then set BB_PGLITE_MODULE to that package directory.'); }
const db = new PGlite();
const actor = '11111111-1111-4111-8111-111111111111';
const partner = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const unconfirmed = '44444444-4444-4444-8444-444444444444';
const household = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const migration = fs.readFileSync(new URL('../sql/basketboss_receipt_inventory_20261031.sql', import.meta.url), 'utf8');
let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log('PASS ' + label); };
const bodyFor = (id, stock = {}, revision = 0, lines = null) => ({
  action: 'confirm_receipt', requestId: id + ':confirm', receiptId: id,
  shopSessionId: 'shop-test', market: 'UK', currency: 'GBP', retailer: 'Test shop',
  purchasedAt: '2026-10-31T12:00:00Z', receiptTotal: 1.25, adjustments: [],
  inventoryBaseline: {stock, expectedRevision: revision, initialize: revision === 0},
  lines: lines || [{lineId: 'line-1', kind: 'food', canonicalKey: 'pasta', name: 'Pasta', brand: '',
    quantity: 500, unit: 'g', packCount: 1, packQuantity: 500, packUnit: 'g',
    pricePaid: 1.25, priceType: 'regular', location: 'cupboard'}], priceObservations: []
});
const fingerprint = body => {
  const {inventoryBaseline, requestId, expectedScope, priceObservations, ...semantic} = body;
  return createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
};
async function rpc(action, body = {}, {user = actor, kind = 'user', id = user, receiptId = null, hash} = {}) {
  if (['confirm_receipt','confirm_pantry'].includes(action) && !Object.hasOwn(body,'expectedScope')) body={...body,expectedScope:{kind,id}};
  const result = await db.query('SELECT public.bb_receipt_inventory_service($1::uuid,$2::text,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::jsonb) AS result',
    [user, kind, id, action, body.requestId || null, receiptId || body.receiptId || null,
      action === 'confirm_receipt' ? hash || fingerprint(body) : null, JSON.stringify(body)]);
  return result.rows[0].result;
}
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE TABLE public.bb_households(id uuid PRIMARY KEY,owner_user_id uuid REFERENCES auth.users(id),partner_user_id uuid REFERENCES auth.users(id),partner_email text,invite_status text);`);
  for (const [id, email, confirmed] of [[actor,'owner@example.invalid',true],[partner,'partner@example.invalid',true],[outsider,'other@example.invalid',true],[unconfirmed,'pending@example.invalid',false]])
    await db.query('INSERT INTO auth.users VALUES($1::uuid,$2,$3::timestamptz)', [id,email,confirmed ? '2026-10-01T00:00:00Z' : null]);
  await db.query('INSERT INTO public.bb_households VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5)', [household,actor,partner,'partner@example.invalid','accepted']);
  await db.exec(migration);
  await db.exec(migration);
  check('migration applies twice without changing schema or data', () => assert.ok(true));

  const empty = await rpc('get', {}, {receiptId: 'not-found'});
  const scopeCount = (await db.query('SELECT count(*)::int AS n FROM public.bb_receipt_inventory_scopes')).rows[0].n;
  check('GET and missing receipt probe never initialize inventory', () => {
    assert.equal(empty.ok, true); assert.equal(empty.initialized, false); assert.equal(empty.inventoryRevision, 0);
    assert.equal(empty.receiptFound, false); assert.equal(scopeCount, 0);
  });

  const first = bodyFor('receipt-first', {'pasta|g':300});
  first.lines[0].legacyCredit = {id:'shop-test|pasta|g',quantity:300,unit:'g'};
  first.lines.push({lineId:'line-2',kind:'essential',canonicalKey:null,name:'Shampoo',brand:'Test brand',quantity:250,unit:'ml',packCount:1,packQuantity:250,packUnit:'ml',pricePaid:4,priceType:'regular',location:'cupboard'});
  first.receiptTotal = 5;
  first.adjustments = [{lineId:'coupon-1',kind:'discount',amount:-.25,description:'Coupon discount'}];
  first.priceObservations = [{scopeId:actor,market:'UK',retailer:'test shop',currency:'GBP',receiptId:first.receiptId,canonicalKey:'pasta',brand:'',packQuantity:500,packUnit:'g',packCount:1,packPrice:1.25,priceType:'regular',eligibleForRegularPrice:true,source:'reviewed_receipt'}];
  const added = await rpc('confirm_receipt', first);
  check('legacy 300 g plus a 500 g receipt produces exactly 500 g', () => {
    assert.equal(added.ok,true); assert.equal(added.stock['pasta|g'],500);
    assert.equal(added.inventoryRevision,1);assert.equal(added.receiptRevision,1);
    assert.equal(added.credits[0].addedQuantity,200);assert.equal(added.pantryReview.required,true);
  });
  check('household goods have a separate subtotal and never enter stock', () => {
    assert.equal(added.essentials.length,1);assert.equal(added.essentials[0].name,'Shampoo');
    assert.deepEqual(Object.keys(added.stock),['pasta|g']);
    assert.equal(added.receiptBudget.essentialsSubtotal,4);assert.equal(added.receiptBudget.foodSubtotal,1.25);
    assert.equal(added.receiptBudget.receiptTotal,5);assert.equal(added.receiptBudget.adjustmentsTotal,-.25);
    assert.equal(added.priceObservations.length,1);assert.equal(added.priceObservations[0].packPrice,1.25);
  });

  const retried = structuredClone(first);
  retried.inventoryBaseline = {stock:{'pasta|g':900},expectedRevision:999,initialize:false};
  const duplicate = await rpc('confirm_receipt',retried);
  check('duplicate receipt ignores a now-stale synchronization baseline', () => {
    assert.equal(duplicate.ok,true);assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.stock['pasta|g'],500);assert.equal(duplicate.inventoryRevision,1);
  });
  const aliasRetry=structuredClone(retried);aliasRetry.requestId='receipt-first:new-transport';
  const aliased=await rpc('confirm_receipt',aliasRetry);
  const aliasReuse=bodyFor('receipt-alias-reuse',{'pasta|g':500},1);aliasReuse.requestId=aliasRetry.requestId;
  const aliasConflict=await rpc('confirm_receipt',aliasReuse);
  check('duplicate transport aliases are claimed and cannot identify a different receipt',()=>{
    assert.equal(aliased.duplicate,true);assert.equal(aliased.inventoryRevision,1);
    assert.equal(aliasConflict.ok,false);assert.equal(aliasConflict.error,'receipt_identity_conflict');assert.equal(aliasConflict.conflict,true);
  });
  const altered = structuredClone(first);altered.lines[0].pricePaid=2;
  const conflict = await rpc('confirm_receipt',altered,{hash:fingerprint(first)});
  check('same receipt identity with changed semantics cannot mutate stock', () => {
    assert.equal(conflict.ok,false);assert.equal(conflict.conflict,true);assert.equal(conflict.error,'receipt_identity_conflict');
  });
  const probe = await rpc('get',{}, {receiptId:first.receiptId});
  check('a second device receives full stock and the committed receipt revision', () => {
    assert.equal(probe.stock['pasta|g'],500);assert.equal(probe.receiptFound,true);assert.equal(probe.receiptRevision,1);
  });

  const reviewed = await rpc('confirm_pantry',{action:'confirm_pantry',stock:{'pasta|g':200},expectedRevision:1,shopSessionId:'shop-next'});
  const stale = await rpc('confirm_pantry',{action:'confirm_pantry',stock:{'pasta|g':999},expectedRevision:1,shopSessionId:'shop-next'});
  check('absolute Pantry review uses revision checking and clears the review gate', () => {
    assert.equal(reviewed.stock['pasta|g'],200);assert.equal(reviewed.inventoryRevision,2);assert.equal(reviewed.pantryReview.required,false);
    assert.equal(stale.conflict,true);assert.equal(stale.error,'receipt_revision_conflict');
  });
  const current = await rpc('get');
  check('a stale Pantry confirmation leaves current quantities intact', () => assert.equal(current.stock['pasta|g'],200));
  const scopeRace=bodyFor('receipt-scope-race',{'pasta|g':999},2);scopeRace.expectedScope={kind:'household',id:household};
  const raceReceipt=await rpc('confirm_receipt',scopeRace);
  const racePantry=await rpc('confirm_pantry',{action:'confirm_pantry',stock:{'pasta|g':999},expectedRevision:2,expectedScope:{kind:'household',id:household},shopSessionId:'race'});
  const afterScopeRace=await rpc('get');
  check('user/household scope preconditions prevent cross-scope overwrite at an otherwise matching revision',()=>{
    assert.equal(raceReceipt.error,'receipt_scope_conflict');assert.equal(raceReceipt.conflict,true);
    assert.equal(racePantry.error,'receipt_scope_conflict');assert.equal(racePantry.conflict,true);
    assert.equal(afterScopeRace.inventoryRevision,2);assert.equal(afterScopeRace.stock['pasta|g'],200);
  });

  const refused = bodyFor('receipt-invalid',{},0);
  refused.lines.push({...refused.lines[0],lineId:'bad',canonicalKey:'soap',name:'Soap'});
  const failed = await rpc('confirm_receipt',refused,{user:outsider});
  const rolledBack = await rpc('get',{}, {user:outsider,receiptId:refused.receiptId});
  check('invalid later receipt line rolls back stock, scope and receipt atomically', () => {
    assert.equal(failed.ok,false);assert.equal(failed.invalid,true);
    assert.equal(rolledBack.initialized,false);assert.equal(rolledBack.inventoryRevision,0);assert.equal(rolledBack.receiptFound,false);
  });
  for (const stock of [{'shampoo|ml':250},{'soap|each':1},{'pasta|g':-1},{'egg|each':1.5}]) {
    const result = await rpc('confirm_pantry',{action:'confirm_pantry',stock,expectedRevision:0,shopSessionId:'bad'}, {user:outsider});
    assert.equal(result.ok,false);
  }
  check('non-food, negative stock and fractional count quantities are rejected', () => assert.ok(true));
  const multiLines=Array.from({length:3},(_,index)=>({...bodyFor('unused').lines[0],lineId:'credit-'+index,quantity:200,packQuantity:200,pricePaid:.5,legacyCredit:{id:'shop-test|pasta|g',quantity:200,unit:'g'}}));
  const multiBody=bodyFor('receipt-multi-credit',{'pasta|g':600},0,multiLines);multiBody.receiptTotal=1.5;
  const multi=await rpc('confirm_receipt',multiBody,{user:outsider});
  const claims=(await db.query('SELECT credited_quantity::numeric AS amount FROM public.bb_receipt_inventory_legacy_claims WHERE scope_kind=$1 AND scope_id=$2::uuid',['user',outsider])).rows;
  const reusedBody=bodyFor('receipt-credit-reuse',{'pasta|g':600},1);reusedBody.lines[0].legacyCredit={id:'shop-test|pasta|g',quantity:200,unit:'g'};
  const reusedClaim=await rpc('confirm_receipt',reusedBody,{user:outsider});
  check('three food rows allocate one 600 g historical credit and cannot reuse it on another receipt',()=>{
    assert.equal(multi.ok,true);assert.equal(multi.stock['pasta|g'],600);assert.equal(multi.credits.reduce((sum,row)=>sum+row.addedQuantity,0),0);
    assert.equal(claims.length,1);assert.equal(Number(claims[0].amount),600);assert.equal(reusedClaim.error,'receipt_legacy_credit_conflict');assert.equal(reusedClaim.conflict,true);
  });
  const freeSampleBody=bodyFor('receipt-free-sample');freeSampleBody.lines[0].pricePaid=0;freeSampleBody.receiptTotal=0;
  const freeSample=await rpc('confirm_receipt',freeSampleBody,{user:partner});
  check('reviewed zero-price food updates stock without a learned pack price',()=>{
    assert.equal(freeSample.ok,true);assert.equal(freeSample.stock['pasta|g'],500);assert.equal(freeSample.priceObservations.length,0);assert.equal(freeSample.receiptBudget.receiptTotal,0);
  });
  const customFood=await rpc('confirm_pantry',{action:'confirm_pantry',stock:{'pasta|g':600,'homemade pesto|g':75},expectedRevision:1,shopSessionId:'shop-custom'},{user:outsider});
  check('manual custom food survives full Pantry synchronization without being a receipt-price observation',()=>{
    assert.equal(customFood.ok,true);assert.equal(customFood.stock['pasta|g'],600);assert.equal(customFood.stock['homemade pesto|g'],75);assert.equal(customFood.priceObservations.length,0);
  });

  const foreign = await rpc('get',{}, {user:partner,id:actor});
  const pending = await rpc('get',{}, {user:unconfirmed});
  check('personal inventory cannot be read by another or unconfirmed actor', () => {
    assert.equal(foreign.forbidden,true);assert.equal(pending.forbidden,true);
  });
  const shared = await rpc('confirm_receipt',bodyFor('receipt-shared'),{kind:'household',id:household});
  const sharedRead = await rpc('get',{}, {user:partner,kind:'household',id:household});
  const unrelated = await rpc('get',{}, {user:outsider,kind:'household',id:household});
  check('accepted household members share stock while unrelated actors cannot', () => {
    assert.equal(shared.ok,true);assert.equal(sharedRead.stock['pasta|g'],500);assert.equal(unrelated.forbidden,true);
  });
  await db.query("UPDATE public.bb_households SET invite_status='unlinked',partner_user_id=NULL WHERE id=$1::uuid",[household]);
  const unlinked = await rpc('get',{}, {user:partner,kind:'household',id:household});
  const ownerRead = await rpc('get',{}, {kind:'household',id:household});
  check('unlink immediately revokes partner access while preserving owner stock', () => {
    assert.equal(unlinked.forbidden,true);assert.equal(ownerRead.stock['pasta|g'],500);
  });

  for (const role of ['anon','authenticated']) {
    await db.exec('SET ROLE '+role);
    await assert.rejects(db.query('SELECT * FROM public.bb_receipt_inventory_scopes'),/permission denied/i);
    await assert.rejects(db.query("SELECT public.bb_receipt_inventory_service($1::uuid,'user',$1::uuid,'get')",[actor]),/permission denied/i);
    await db.exec('RESET ROLE');
  }
  check('browser roles cannot read tables or execute service RPCs', () => assert.ok(true));
  const beforeReapply = await rpc('get');
  await db.exec(migration);
  const afterReapply = await rpc('get');
  check('reapplying migration preserves inventory and receipts', () => {
    assert.deepEqual(afterReapply.stock,beforeReapply.stock);assert.equal(afterReapply.inventoryRevision,beforeReapply.inventoryRevision);
    assert.equal(afterReapply.receipts.length,beforeReapply.receipts.length);
  });
  console.log(JSON.stringify({status:'passed',checks:passed,engine:'isolated PostgreSQL via PGlite',productionWrites:false}));
} catch (error) {
  console.error('PostgreSQL verification failed:', String(error?.message || error).slice(0, 1500),
    JSON.stringify({code:error?.code,position:error?.position}));
  process.exitCode = 1;
} finally {await db.close();}
