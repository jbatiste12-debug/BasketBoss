import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as Core from '../bb-receipt-inventory-core.mjs';
const reducedStock = createRequire(import.meta.url)('../bb-reduced-stock.js');

const adapterSource = await readFile(new URL('../bb-receipt-inventory.js', import.meta.url), 'utf8');
const CATALOG = { 'pasta|g': {}, 'rice|g': {}, 'milk|ml': {}, 'egg|each': {}, 'chopped tomatoes|g': {} };
const ACTOR = 'user_00000001';
const clone = value => JSON.parse(JSON.stringify(value));
class MemoryStorage {
  data = new Map(); failKey = null;
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { if (this.failKey === key) { this.failKey = null; throw Error('storage quota'); } this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
// This models the proposed atomic API contract, not an implemented production backend.
class FullInventoryServer {
  initialized = false; revision = 0; stock = {}; essentials = []; receipts = new Map(); claims = new Set(); afterPost = null; posts = 0;
  scope = { kind: 'user', id: ACTOR };
  snapshot(extra = {}) {
    return { ok: true, initialized: this.initialized, inventoryRevision: this.revision, scope: clone(this.scope), stock: clone(this.stock),
      inventory: Object.entries(this.stock).map(([stockKey, quantity]) => { const i = stockKey.lastIndexOf('|'); return { stockKey, canonicalKey: stockKey.slice(0, i), unit: stockKey.slice(i + 1), quantity, location: 'cupboard', revision: this.revision }; }),
      essentials: clone(this.essentials), priceObservations: [], pantryReview: { required: true, shopSessionId: 'shop-1', confirmedAt: null }, ...extra };
  }
  fetch = async (url, options) => {
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
    const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => clone(value) });
    if (options.method === 'GET') {
      const receiptId = new URL(url, 'https://basketboss.example').searchParams.get('receiptId');
      const receipt = this.receipts.get(receiptId);
      return response(this.snapshot(receiptId ? { receiptId, receiptFound: !!receipt, ...(receipt ? { receiptRevision: receipt.revision } : {}) } : {}));
    }
    let body = JSON.parse(options.body); this.posts++;
    let expectedScope;
    try { expectedScope = Core.normalizeInventoryScope(body.expectedScope); } catch (error) { return response({ error: error.message }, 400); }
    if (expectedScope.kind !== this.scope.kind || expectedScope.id !== this.scope.id) return response({ error: 'inventory_scope_conflict' }, 409);
    if (body.action === 'confirm_pantry') {
      if (body.expectedRevision !== this.revision) return response({ error: 'inventory_revision_conflict' }, 409);
      this.stock = clone(body.stock); this.initialized = true; this.revision++;
      return response(this.snapshot({ pantryReview: { required: false, confirmedAt: '2026-10-31T12:00:00Z' } }));
    }
    try { body = Core.validateReceiptConfirmation(body, { catalog: CATALOG }); }
    catch (error) { return response({ error: error.message }, 400); }
    const { inventoryBaseline, requestId, ...semantic } = body;
    const digest = JSON.stringify(semantic), prior = this.receipts.get(body.receiptId);
    if (prior) {
      if (prior.digest !== digest) return response({ error: 'receipt_identity_conflict' }, 409);
      return response(this.snapshot({ duplicate: true, receiptId: body.receiptId, receiptRevision: prior.revision }));
    }
    if (inventoryBaseline.expectedRevision !== this.revision || inventoryBaseline.initialize !== !this.initialized) return response({ error: 'inventory_revision_conflict' }, 409);
    const next = clone(inventoryBaseline.stock), claims = new Set(), credits = [];
    for (const line of body.lines) {
      if (line.kind !== 'food' || body.addToPantry === false) continue;
      const id = `${line.canonicalKey}|${line.unit}`, credit = line.legacyCredit;
      const priorCreditedQuantity = credit && !this.claims.has(credit.id) ? Math.min(line.quantity, credit.quantity) : 0;
      if (credit && priorCreditedQuantity) claims.add(credit.id);
      const addedQuantity = line.quantity - priorCreditedQuantity;
      next[id] = (next[id] || 0) + addedQuantity;
      credits.push({ lineId: line.lineId, purchasedQuantity: line.quantity, priorCreditedQuantity, addedQuantity });
    }
    this.essentials.push(...body.lines.filter(x => x.kind === 'essential').map(x => ({...x, id: body.receiptId + ':' + x.lineId, receiptId: body.receiptId, addToPantry: body.addToPantry === true})));
    this.stock = next; this.initialized = true; this.revision++;
    for (const id of claims) this.claims.add(id);
    this.receipts.set(body.receiptId, { digest, revision: this.revision });
    this.afterPost?.(body);
    return response(this.snapshot({ duplicate: false, receiptId: body.receiptId, receiptRevision: this.revision, credits }));
  };
}
function fixture({ store = new MemoryStorage(), server = new FullInventoryServer(), actor = ACTOR, fetch } = {}) {
  const events = new Map();
  const root = { localStorage: store, crypto: { randomUUID: () => 'test-random-id' }, addEventListener(name, handler) {const handlers = events.get(name) || [];handlers.push(handler);events.set(name, handlers);} };
  vm.runInNewContext(adapterSource, { window: root, URL, console, Date });
  const session = { value: { access_token: `token-${actor}`, user: { id: actor }, expires_at: 4_000_000_000 } };
  const context = { value: { market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-1' } };
  const adapter = root.BBReceiptInventoryFactory({ core: Core, storage: store, fetch: fetch || server.fetch, getSession: () => session.value, getContext: () => context.value, getCatalog: () => CATALOG, createId: () => 'test-random-id' });
  return { adapter, store, server, session, context, keys: adapter.keys, root, event(name) {for (const handler of events.get(name) || []) handler();} };
}

test('legacy Finish then scan accepts only the verified archived trip and nets its original stock once',async()=>{
 const f=fixture(),closed='shop-1';f.context.value.shopSessionId='shop-next';f.store.setItem(f.keys.stock,JSON.stringify({'pasta|g':500}));
 f.store.setItem(f.keys.finishShop,JSON.stringify({[closed+'|pasta|g']:{name:'pasta',unit:'g',credited:500,week:closed}}));
 f.adapter.configure({getArchivedShop:id=>id===closed?{version:7,id,closedAt:'2026-11-05T12:00:00Z',receiptContext:{actorId:ACTOR,market:'UK',retailer:'Tesco'}}:null});
 const packet={receiptId:'after-finish-archived',market:'UK',retailer:'Tesco',shopSessionId:closed,stockPantry:true,items:[{key:'pasta',name:'Pasta',classification:'food',quantity:500,unit:'g',price:2}]};
 assert.equal((await f.adapter.commitLocalReceipt(packet)).ok,true);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],500);
 const credits=JSON.parse(f.store.getItem(f.keys.finishShop));assert.equal(credits[closed+'|pasta|g'].receiptInventoryReceiptId,packet.receiptId);assert.equal(credits['shop-next|pasta|g'],undefined);
 assert.equal((await f.adapter.commitLocalReceipt(packet)).duplicate,true);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],500);
});
test('legacy archived receipt rejects unknown or different actor, region and store proofs without writes',async()=>{
 for(const invalid of [null,{}, {actorId:'other-user',market:'UK',retailer:'Tesco'},{actorId:ACTOR,market:'US',retailer:'Tesco'},{actorId:ACTOR,market:'UK',retailer:'Aldi'}]){
  const f=fixture();f.context.value.shopSessionId='shop-next';f.adapter.configure({getArchivedShop:id=>invalid===null?null:{version:7,id,closedAt:'2026-11-05T12:00:00Z',receiptContext:invalid}});const before=new Map(f.store.data);
  await assert.rejects(f.adapter.commitLocalReceipt({receiptId:'unverified-old-trip',market:'UK',retailer:'Tesco',shopSessionId:'shop-1',items:[{key:'pasta',name:'Pasta',classification:'food',quantity:500,unit:'g',price:2}]}),/receipt_context_changed/);assert.deepEqual(f.store.data,before);
 }
});
test('an explicitly unlinked legacy receipt adds new stock without spending another trip credit',async()=>{
 const f=fixture();f.store.setItem(f.keys.stock,JSON.stringify({'pasta|g':500}));const credits={'shop-1|pasta|g':{name:'pasta',unit:'g',credited:500,week:'shop-1'}};f.store.setItem(f.keys.finishShop,JSON.stringify(credits));
 await f.adapter.commitLocalReceipt({receiptId:'unlinked-new-purchase',market:'UK',retailer:'Tesco',shopSessionId:null,items:[{key:'pasta',name:'Pasta',classification:'food',quantity:500,unit:'g',price:2}]});
 assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],1000);assert.deepEqual(JSON.parse(f.store.getItem(f.keys.finishShop)),credits);
});
async function draft(f, { receiptId = 'receipt-1', quantity = 500 } = {}) {
  const value = await f.adapter.normalizeDraft({ receiptId, currency: 'GBP', retailer: 'Tesco', shopSessionId: 'shop-1', items: [{ lineId: 'line-1', name: 'Pasta', kind: 'food', canonicalKey: 'pasta', quantity, unit: 'g', packCount: 1, packQuantity: quantity, packUnit: 'g', pricePaid: 1.5, priceType: 'regular' }] });
  value.lines[0].reviewed = true; return value;
}

test('actual receipt projection preserves freezer buckets across refresh, new purchases and later usage',async()=>{
 const f=fixture();f.root.BBReducedStock=reducedStock;
 f.server.stock={'pasta|g':300};f.server.initialized=true;await f.adapter.synchronize();
 f.store.setItem(f.keys.kitchen,JSON.stringify({
  frozen:{name:'Pasta',loc:'freezer',qty:200,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:200,bbReduced:{version:1,actor:ACTOR,urgent:false,at:1,frozenAt:2,sources:['prior']}},
  fresh:{name:'Pasta',loc:'cupboard',qty:100,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:100}
 }));
 const rows=()=>JSON.parse(f.store.getItem(f.keys.kitchen));
 await f.adapter.synchronize();assert.equal(rows().frozen.qty,200);assert.equal(rows().frozen.loc,'freezer');assert.equal(rows().fresh.qty,100);
 f.server.stock={'pasta|g':500};f.server.revision++;await f.adapter.synchronize();assert.equal(rows().frozen.qty,200);assert.equal(rows().fresh.qty,300);
 f.root.BBReducedFoodHost={isPremium:()=>true};const reduced=await draft(f,{receiptId:'fresh-reduced-after-freezing'});reduced.lines[0].reduced=true;reduced.lines[0].priceType='promotion';
 await f.adapter.commitReviewedReceipt(reduced);assert.equal(rows().frozen.qty,200);assert.equal(rows().frozen.bbReduced.urgent,false);assert.equal(rows().fresh.qty,300);assert.equal(rows().fresh.bbReduced,undefined,'existing ordinary food retains its own portion');
 const purchased=Object.values(rows()).filter(row=>row.selected&&row.loc!=='freezer'&&row.bbReduced?.urgent===true);assert.equal(purchased.length,1);assert.equal(purchased[0].qty,500);
 f.server.stock={'pasta|g':150};f.server.revision++;await f.adapter.synchronize();assert.equal(rows().frozen.qty,150);assert.equal(rows().fresh.selected,false);
 assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],150);
});

test('a normal receipt preserves ordinary freezer stock without requiring reduced-food metadata',async()=>{
 const f=fixture();f.root.BBReducedStock=reducedStock;f.server.stock={'pasta|g':300};f.server.initialized=true;await f.adapter.synchronize();
 f.store.setItem(f.keys.kitchen,JSON.stringify({
  frozen:{name:'Pasta',loc:'freezer',qty:200,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:200},
  fresh:{name:'Pasta',loc:'cupboard',qty:100,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:100}
 }));
 const value=await draft(f,{receiptId:'ordinary-freezer-receipt',quantity:300});assert.equal((await f.adapter.commitReviewedReceipt(value)).localApplied,true);
 const rows=Object.values(JSON.parse(f.store.getItem(f.keys.kitchen))).filter(row=>row.selected);
 assert.equal(rows.filter(row=>row.loc==='freezer').reduce((sum,row)=>sum+row.qty,0),200);
 assert.equal(rows.filter(row=>row.loc==='cupboard').reduce((sum,row)=>sum+row.qty,0),400);
 assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],600);
});

test('a receipt after Finish and its replay retain reduced and ordinary portions without double credit',async()=>{
 const f=fixture();f.root.BBReducedStock=reducedStock;f.server.stock={'pasta|g':500};f.server.initialized=true;await f.adapter.synchronize();
 const portions={reduced:{name:'Pasta',loc:'cupboard',qty:200,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:200,notes:'Use first',bbReduced:{version:1,actor:ACTOR,urgent:true,at:1,sources:['shop:reduced-portion']}},ordinary:{name:'Pasta',loc:'cupboard',qty:300,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:300,notes:'Keep for lunch'}};
 f.store.setItem(f.keys.kitchen,JSON.stringify(portions));f.store.setItem(f.keys.finishShop,JSON.stringify({'shop-1|pasta|g':{name:'pasta',unit:'g',credited:500,qty:500,week:'shop-1',stockBasis:'full-purchase'}}));
 const rows=()=>JSON.parse(f.store.getItem(f.keys.kitchen)),receipt=await draft(f,{receiptId:'after-mixed-finish',quantity:500});
 assert.equal((await f.adapter.commitReviewedReceipt(receipt)).localApplied,true);assert.equal(f.server.stock['pasta|g'],500);assert.equal(rows().reduced.qty,200);assert.equal(rows().ordinary.qty,300);assert.equal(rows().ordinary.bbReduced,undefined);
 await f.adapter.commitReviewedReceipt(receipt);await f.adapter.synchronize();assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],500);assert.equal(rows().reduced.qty,200);assert.equal(rows().ordinary.qty,300);
 const next=await draft(f,{receiptId:'later-ordinary-portion',quantity:250});assert.equal((await f.adapter.commitReviewedReceipt(next)).localApplied,true);assert.equal(rows().reduced.qty,200);assert.equal(rows().reduced.notes,'Use first');assert.equal(rows().ordinary.qty,550);assert.equal(rows().ordinary.notes,'Keep for lunch');assert.equal(rows().ordinary.bbReduced,undefined);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],750);
});

test('the receipt transaction passes the verified actor to the shared price journal',async()=>{
 const f=fixture();let received;f.adapter.configure({prepareReceiptSave:packet=>{received=packet;return {changes:{},expected:{}};}});
 await f.adapter.commitReviewedReceipt(await draft(f));assert.equal(received.actorId,ACTOR);
});

for(const source of ['cloud','legacy'])test(source+' household reconciliation receives the prepared food credit ledger without altering HTTP payloads',async()=>{
 const f=fixture(),householdId='shop-1|ess:soap',foodId='shop-1|pasta|g',prior={[householdId]:{name:'Soap',unit:'each',credited:2,stockBasis:'household-purchase',week:'shop-1'}};
 f.store.setItem(f.keys.finishShop,JSON.stringify(prior));let received;
 f.adapter.configure({receiptSaveKeys:[f.keys.finishShop],prepareReceiptSave(packet){
  if(!packet.receiptId)return {changes:{},expected:{}};
  received=packet;
  assert.deepEqual(JSON.parse(f.store.getItem(f.keys.finishShop)),prior,'receipt preparation must not publish food proofs early');
  assert.equal(packet.finishShopCredits[foodId].receiptInventoryReceiptId,'receipt-household-journal');
  const credits=clone(packet.finishShopCredits);credits[householdId].receiptLegacyCreditById={'receipt-household-journal':2};
  return {changes:{[f.keys.finishShop]:credits},expected:{[f.keys.finishShop]:f.store.getItem(f.keys.finishShop)}};
 }});
 if(source==='cloud'){
  f.adapter.configure({fetch:async(address,input)=>{if(input.body)assert.equal(Object.hasOwn(JSON.parse(input.body),'finishShopCredits'),false,'internal ledger does not become receipt HTTP input');return f.server.fetch(address,input);}});
  const value=await draft(f,{receiptId:'receipt-household-journal'});
  value.lines.push(Core.normalizeReceiptLine({description:'Soap',classification:'essential',quantity:2,unit:'each',pricePaid:3,reviewed:true},{market:'UK'},1));
  assert.equal((await f.adapter.commitReviewedReceipt(value)).localApplied,true);
 }else{
  const value={receiptId:'receipt-household-journal',market:'UK',retailer:'Tesco',shopSessionId:'shop-1',stockPantry:true,items:[{key:'pasta',name:'Pasta',classification:'food',quantity:500,unit:'g',price:1.5},{key:'soap',name:'Soap',classification:'essential',quantity:2,unit:'each',price:3}]};
  assert.equal((await f.adapter.commitLocalReceipt(value)).ok,true);
 }
 assert.equal(received.finishShopCredits[householdId].credited,2);
 const saved=JSON.parse(f.store.getItem(f.keys.finishShop));assert.equal(saved[foodId].receiptInventoryReceiptId,'receipt-household-journal');assert.equal(saved[householdId].receiptLegacyCreditById['receipt-household-journal'],2);
});
test('a Premium change after cloud confirmation retains the already reviewed stock annotation',async()=>{
 const f=fixture();let premium=true;f.root.BBReducedStock=reducedStock;f.root.BBReducedFoodHost={isPremium:()=>premium};
 const value=await draft(f);value.lines[0].reduced=true;value.lines[0].priceType='promotion';f.server.afterPost=()=>{premium=false;};
 const saved=await f.adapter.commitReviewedReceipt(value);assert.equal(saved.ok,true);
 const owned=Object.values(JSON.parse(f.store.getItem(f.keys.kitchen))).find(row=>row.selected!==false&&row.name.toLowerCase()==='pasta');
 assert.equal(owned.bbReduced.urgent,true);assert.equal(owned.bbReduced.actor,ACTOR);
});

test('explicit pack counts, measured totals and metric units normalize without inventing unknown contents', () => {
  assert.deepEqual(Core.normalizePack({ packCount: 2, packQuantity: .5, packUnit: 'kg' }), { quantity: 1000, unit: 'g', packCount: 2, packQuantity: 500, packUnit: 'g', issue: null });
  assert.equal(Core.normalizePack({ description: 'Pasta 2x500g' }).quantity, 1000);
  assert.equal(Core.normalizePack({ quantity: 2, unit: 'pack', packQuantity: 500, packUnit: 'g' }).quantity, 1000);
  assert.equal(Core.normalizePack({ packQuantity: 500, packUnit: 'g' }).quantity, null);
  assert.equal(Core.normalizePack({ quantity: 2, unit: 'pack' }).unit, 'pack');
  assert.equal(Core.normalizeMeasuredQuantity(1.5, 'each'), null);
  assert.equal(Core.normalizePack({ quantity: 300, unit: 'g', packCount: 1, packQuantity: 500, packUnit: 'g' }).issue, 'conflicting_pack_and_total');
  assert.equal(Core.normalizeMeasuredQuantity(1, 'l').quantity, 1000);
});
test('household products are hard excluded and adjustments cannot become food stock', () => {
  for (const name of ['Soap', 'Laundry detergent', 'Kitchen roll', 'Toilet paper', 'Dog food', 'Facial tissues', 'Razors', 'Sanitary pads', 'Tampons']) assert.equal(Core.classifyReceiptLine({ name, kind: 'food', canonicalKey: 'pasta', pricePaid: 2 }).classification, 'essential');
  assert.throws(() => Core.normalizeStockMap({ 'soap|each': 1 }), /invalid_inventory/);
  for (const name of ['Coconut milk', 'Paper-thin rice noodles']) assert.equal(Core.classifyReceiptLine({ name, kind: 'food', canonicalKey: 'pasta', pricePaid: 2 }).classification, 'food');
  assert.equal(Core.classifyReceiptLine({ name: 'Pasta refund', kind: 'food', pricePaid: -2 }).classification, 'ignore');
  assert.equal(Core.classifyReceiptLine({ name: 'TOTAL', pricePaid: 25 }).sourceKind, 'total');
  const totals = Core.receiptTotals([{ classification: 'food', sourceKind: 'purchase', lineTotal: 20 }, { classification: 'essential', sourceKind: 'purchase', lineTotal: 5 }, { sourceKind: 'total', lineTotal: 25 }], 25);
  assert.equal(totals.reviewedSpend, 25); assert.equal(totals.essentials, 5); assert.equal(totals.difference, 0);
});
test('unknown measured food, unreviewed lines, wrong canonical units and currency mismatch are rejected', () => {
  const d = Core.normalizeReceiptDraft({ receiptId: 'r1', items: [{ name: 'Pasta', kind: 'food', canonicalKey: 'pasta', pricePaid: 2 }] }, { market: 'UK', catalog: CATALOG });
  d.lines[0].reviewed = true;
  assert.throws(() => Core.prepareReceiptConfirmation(d, { requestId: 'rq1', catalog: CATALOG }), /measured_quantity_required/);
  assert.throws(() => Core.normalizeReceiptDraft({ currency: 'USD' }, { market: 'UK' }), /currency/);
  const wrong = Core.normalizeReceiptLine({ name: 'Pasta', kind: 'food', canonicalKey: 'pasta', quantity: 1, unit: 'pack' }, { catalog: CATALOG });
  assert.ok(wrong.issues.includes('canonical_unit_not_in_catalog'));
});
test('FinishShop credit is exact-session/canonical/unit scoped and allocates across duplicate product lines', () => {
  const credits = { 'shop-1|pasta|g': { name: 'pasta', unit: 'g', credited: 600, week: 'shop-1' } };
  const input = { receiptId: 'r1', shopSessionId: 'shop-1', market: 'UK', retailer: 'Tesco', currency: 'GBP', lines: [1, 2, 3].map(n => ({ id: `line-${n}`, name: 'Pasta', classification: 'food', canonicalKey: 'pasta', quantity: 200, unit: 'g', pricePaid: 1, reviewed: true })) };
  const body = Core.prepareReceiptConfirmation(input, { requestId: 'rq1', catalog: CATALOG, finishShopCredits: credits });
  assert.equal(body.lines.reduce((n, x) => n + x.legacyCredit.quantity, 0), 600);
  assert.equal(Core.computeReceiptCredit({ canonicalKey: 'pasta', quantity: 500, unit: 'g' }, credits, { shopSessionId: 'other-shop' }).addedQuantity, 500);
  assert.equal(Core.computeReceiptCredit({ canonicalKey: 'rice', quantity: 500, unit: 'g' }, credits, { shopSessionId: 'shop-1' }).addedQuantity, 500);
});
test('learned prices are explicit pack observations, scoped and promotion-separated', () => {
  const line = { name: 'Pasta', kind: 'food', canonicalKey: 'pasta', packCount: 2, packQuantity: 500, packUnit: 'g', pricePaid: 3, priceType: 'promotion' };
  const value = Core.normalizePriceObservation(line, { scope: { id: ACTOR }, market: 'UK', retailer: 'Tesco', currency: 'GBP', receiptId: 'r1' });
  assert.equal(value.packPrice, 1.5); assert.equal(value.eligibleForRegularPrice, false); assert.equal(value.scopeId, ACTOR);
  assert.equal(Core.normalizePriceObservation({ ...line, packCount: null }, { scope: ACTOR, market: 'UK', retailer: 'Tesco', currency: 'GBP' }), null);
  assert.equal(Core.normalizePriceObservation(line, { scope: ACTOR, market: 'US', retailer: 'Tesco', currency: 'GBP' }), null);
});
test('reviewed actual receipt total and adjustments survive without adding discount inventory', () => {
  const raw = { receiptId: 'budget-receipt', currency: 'GBP', receiptTotal: 4, market: 'UK', retailer: 'Tesco', lines: [
    { id: 'food', name: 'Pasta', kind: 'food', canonicalKey: 'pasta', quantity: 500, unit: 'g', pricePaid: 3, reviewed: true },
    { id: 'essential', name: 'Soap', kind: 'essential', pricePaid: 2, reviewed: true },
    { id: 'discount', name: 'Coupon discount', kind: 'discount', pricePaid: -1, reviewed: true },
    { id: 'total', name: 'TOTAL', pricePaid: 4, reviewed: true }
  ] };
  const body = Core.prepareReceiptConfirmation(raw, { requestId: 'budget-request', catalog: CATALOG });
  assert.equal(body.receiptTotal, 4); assert.equal(body.lines.length, 2); assert.equal(body.lines.filter(x => x.kind === 'food').length, 1);
  assert.deepEqual(body.adjustments, [{ lineId: 'discount', kind: 'discount', amount: -1, description: 'Coupon discount' }]);
});
test('shared HTTP validator accepts confirmed protocol rows without UI flags and rejects unsafe extras', () => {
  const raw = { receiptId: 'api-receipt', currency: 'GBP', market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-1', lines: [{ id: 'food', name: 'Pasta', kind: 'food', canonicalKey: 'pasta', quantity: 500, unit: 'g', pricePaid: 3, reviewed: true }] };
  const body = Core.prepareReceiptConfirmation(raw, { requestId: 'api-request', catalog: CATALOG });
  body.expectedScope = { kind: 'user', id: ACTOR };
  body.inventoryBaseline = { stock: { 'pasta|g': 300 }, expectedRevision: 0, initialize: true };
  assert.equal(body.lines[0].reviewed, undefined);
  const valid = Core.validateReceiptConfirmation(body, { catalog: CATALOG }); assert.equal(valid.lines[0].quantity, 500);
  assert.throws(() => Core.validateReceiptConfirmation({ ...body, actorId: 'another-account' }, { catalog: CATALOG }), /body_shape/);
  assert.throws(() => Core.validateReceiptConfirmation({ ...body, imageBase64: 'not allowed' }, { catalog: CATALOG }), /body_shape/);
  const household = clone(body); household.lines[0].name = 'Laundry detergent';
  assert.throws(() => Core.validateReceiptConfirmation(household, { catalog: CATALOG }), /classification_conflict/);
  const credit = clone(body); credit.lines[0].legacyCredit = { id: 'shop-1|rice|g', quantity: 300, unit: 'g' };
  assert.throws(() => Core.validateReceiptConfirmation(credit, { catalog: CATALOG }), /legacy_credit/);
  const coercion = clone(body); coercion.lines[0].quantity = '500';
  assert.throws(() => Core.validateReceiptConfirmation(coercion, { catalog: CATALOG }), /numeric_quantity/);
});
test('full-inventory bootstrap: transferred300 plus purchased500 nets200 locally and cloud500 on another device', async () => {
  const f = fixture(); f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 300, 'rice|g': 100 }));
  f.store.setItem(f.keys.finishShop, JSON.stringify({ 'shop-1|pasta|g': { name: 'pasta', unit: 'g', credited: 300, week: 'shop-1' } }));
  const result = await f.adapter.commitReviewedReceipt(await draft(f));
  assert.equal(result.committed, true); assert.equal(result.localApplied, true);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500); assert.equal(f.server.stock['pasta|g'], 500); assert.equal(f.server.stock['rice|g'], 100);
  const second = fixture({ server: f.server }); const sync = await second.adapter.synchronize();
  assert.equal(sync.localApplied, true); assert.equal(JSON.parse(second.store.getItem(second.keys.stock))['pasta|g'], 500);
  assert.equal(JSON.parse(second.store.getItem(second.keys.stock))['rice|g'], 100);
});
test('duplicate confirm and GET-then-retry cannot add the same receipt twice', async () => {
  const f = fixture(), d = await draft(f); const first = await f.adapter.commitReviewedReceipt(d);
  assert.equal(first.localApplied, true); await f.adapter.synchronize();
  const again = await f.adapter.commitReviewedReceipt(d); assert.equal(again.duplicate, true); assert.equal(again.localApplied, true);
  assert.equal(f.server.stock['pasta|g'], 500); assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500);
});
test('manual edits are revision-checked into the full baseline and retained on a second device', async () => {
  const f = fixture(); await f.adapter.commitReviewedReceipt(await draft(f));
  f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 550, 'rice|g': 120 }));
  await f.adapter.commitReviewedReceipt(await draft(f, { receiptId: 'receipt-2', quantity: 100 }));
  assert.equal(f.server.stock['pasta|g'], 650); assert.equal(f.server.stock['rice|g'], 120);
  const other = fixture({ server: f.server }); await other.adapter.synchronize(); assert.equal(JSON.parse(other.store.getItem(other.keys.stock))['pasta|g'], 650);
});
test('storage failure after cloud commit rolls back local keys and retry applies exactly once', async () => {
  const f = fixture(); f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 300 }));
  f.store.setItem(f.keys.finishShop, JSON.stringify({ 'shop-1|pasta|g': { name: 'pasta', unit: 'g', credited: 300, week: 'shop-1' } }));
  f.server.afterPost = () => { f.store.failKey = f.keys.kitchen; f.server.afterPost = null; };
  const d = await draft(f), result = await f.adapter.commitReviewedReceipt(d);
  assert.equal(result.committed, true); assert.equal(result.localApplied, false); assert.equal(f.server.stock['pasta|g'], 500);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 300);
  const retried = await f.adapter.commitReviewedReceipt(d); assert.equal(retried.duplicate, true); assert.equal(retried.localApplied, true);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500);
});
test('cancelled drafts and foreign-account drafts produce no POST or inventory mutation', async () => {
  const f = fixture(), d = await draft(f); f.adapter.cancelDraft(d);
  await assert.rejects(f.adapter.commitReviewedReceipt(d), /draft_not_owned/); assert.equal(f.server.posts, 0);
  const next = await draft(f); f.session.value = { ...f.session.value, user: { id: 'user_00000002' } };
  await assert.rejects(f.adapter.commitReviewedReceipt(next), /draft_not_owned/); assert.equal(f.server.posts, 0);
  assert.equal(f.store.getItem(f.keys.stock), null);
});
test('new device with overlapping local/cloud stock requires explicit merge and never adds both', async () => {
  const server = new FullInventoryServer(); server.initialized = true; server.stock = { 'pasta|g': 500 }; server.revision = 1;
  const f = fixture({ server }); f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 300 }));
  const result = await f.adapter.synchronize(); assert.equal(result.localApplied, false); assert.match(result.localError, /initial_pantry_merge/);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 300);
  const confirmed = await f.adapter.confirmPantry({ stock: { 'pasta|g': 500 }, expectedRevision: 1, shopSessionId: 'shop-1', expectedScope: server.scope });
  assert.equal(confirmed.localApplied, true); assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500);
});
test('stale cross-device baseline returns409 without losing local manual edits', async () => {
  const f = fixture(); await f.adapter.commitReviewedReceipt(await draft(f));
  const other = fixture({ server: f.server }); await other.adapter.synchronize();
  await other.adapter.confirmPantry({ stock: { 'pasta|g': 400 }, expectedRevision: 1 });
  f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 550 }));
  await assert.rejects(f.adapter.commitReviewedReceipt(await draft(f, { receiptId: 'receipt-2', quantity: 100 })), /revision_conflict/);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 550); assert.equal(f.server.stock['pasta|g'], 400);
});
test('new cache strips photos and tokens, and receipt-before-FinishShop writes a coverage guard', async () => {
  const f = fixture(); const d = await f.adapter.normalizeDraft({ receiptId: 'r-photo', currency: 'GBP', shopSessionId: 'shop-1', imageBase64: 'data:image/jpeg;base64,SECRET', items: [{ name: 'Pasta', kind: 'food', canonicalKey: 'pasta', quantity: 500, unit: 'g', pricePaid: 1 }] });
  d.lines[0].reviewed = true; await f.adapter.commitReviewedReceipt(d);
  const raw = [...f.store.data.values()].join('\n'); assert.ok(!raw.includes('base64')); assert.ok(!raw.includes('token-user'));
  const guard = JSON.parse(f.store.getItem(f.keys.finishShop))['shop-1|pasta|g']; assert.equal(guard.credited, 0); assert.equal(guard.receiptCoveredQuantity, 500);
});
test('stock normalization rejects prototype keys, non-food, coercion tricks and quantity/payload limits', () => {
  const polluted = JSON.parse('{"__proto__|g":500}');
  assert.throws(() => Core.normalizeStockMap(polluted), /invalid_inventory/);
  assert.throws(() => Core.normalizeStockMap({ 'laundry detergent|ml': 500 }), /invalid_inventory/);
  assert.throws(() => Core.normalizeStockMap({ 'pasta|g': '500' }), /invalid_inventory/);
  assert.deepEqual(Core.normalizeStockMap({ 'egg|each': 1.5 }), { 'egg|each': 1.5 });
  assert.equal(Core.normalizeMeasuredQuantity(1.5, 'each'), null);
  assert.throws(() => Core.normalizeStockMap({ 'pasta|g': 1000001 }), /invalid_inventory/);
  assert.equal(Core.normalizeMeasuredQuantity([500], 'g'), null);
  assert.equal(Core.normalizeMeasuredQuantity('0x100', 'g'), null);
  assert.equal(Core.normalizeMeasuredQuantity('Infinity', 'g'), null);
  assert.throws(() => Core.normalizeReceiptDraft({ items: Array.from({ length: 201 }, () => ({})) }, { market: 'UK' }), /too_many/);
  assert.throws(() => Core.normalizeReceiptDraft({ total: 100001 }, { market: 'UK' }), /total_limit/);
  assert.equal({}.polluted, undefined);
});
test('explicit Pantry plural aliases resolve actual catalogue pairs without inventing a unit', () => {
  const line = Core.normalizeReceiptLine({ name: 'Mushrooms', kind: 'food', canonicalKey: 'mushrooms', quantity: 300, unit: 'g' }, { catalog: { 'mushrooms|g': {} } });
  assert.equal(line.canonicalKey, 'mushroom'); assert.equal(line.issues.length, 0);
  const wrong = Core.normalizeReceiptLine({ name: 'Mushrooms', kind: 'food', canonicalKey: 'mushrooms', quantity: 300, unit: 'ml' }, { catalog: { 'mushrooms|g': {} } });
  assert.ok(wrong.issues.includes('canonical_unit_not_in_catalog'));
});
test('unreviewed input fails before even an initial cloud projection writes local inventory', async () => {
  let requests = 0;
  const f = fixture({ fetch: async () => { requests++; throw Error('must not request'); } }), d = await draft(f);
  d.lines[0].reviewed = false;
  await assert.rejects(f.adapter.commitReviewedReceipt(d), /review_receipt_line/);
  assert.equal(requests, 0); assert.equal(f.store.getItem(f.keys.stock), null);
});
test('concurrent duplicate confirmation shares one POST and stock increment', async () => {
  const f = fixture(), d = await draft(f);
  const values = await Promise.all([f.adapter.commitReviewedReceipt(d), f.adapter.commitReviewedReceipt(d)]);
  assert.ok(values.every(x => x.localApplied)); assert.equal(f.server.posts, 1); assert.equal(f.server.stock['pasta|g'], 500);
});
test('changed receipt semantics conflict while baseline-only retry changes remain idempotent', async () => {
  const f = fixture(), d = await draft(f); await f.adapter.commitReviewedReceipt(d);
  d.lines[0].lineTotal = 9; d.lines[0].pricePaid = 9;
  await assert.rejects(f.adapter.commitReviewedReceipt(d), /identity_conflict/);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500);
});
test('idempotency metadata uses the same normalized request identity sent to the server', async () => {
  const f = fixture(), d = await draft(f);
  await f.adapter.commitReviewedReceipt(d, { idempotencyKey: '  stable-request  ' });
  const repeated = await f.adapter.commitReviewedReceipt(d, { idempotencyKey: 'stable-request' });
  assert.equal(repeated.duplicate, true); assert.equal(repeated.localApplied, true); assert.equal(f.server.stock['pasta|g'], 500);
});
test('storage failure followed by GET recovery uses accepted baseline, not stale cloud delta', async () => {
  const f = fixture(); f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 300 }));
  f.store.setItem(f.keys.finishShop, JSON.stringify({ 'shop-1|pasta|g': { name: 'pasta', unit: 'g', credited: 300, week: 'shop-1' } }));
  f.server.afterPost = () => { f.store.failKey = f.keys.kitchen; f.server.afterPost = null; };
  const result = await f.adapter.commitReviewedReceipt(await draft(f)); assert.equal(result.localApplied, false);
  const reloaded = fixture({ store: f.store, server: f.server });
  const recovered = await reloaded.adapter.synchronize(); assert.equal(recovered.localApplied, true);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500); assert.equal(reloaded.adapter.getPendingConfirmation().receiptId, undefined);
});
test('a failed local write after manual baseline reconciliation recovers650, never700', async () => {
  const f = fixture(); await f.adapter.commitReviewedReceipt(await draft(f));
  f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 550 }));
  f.server.afterPost = () => { f.store.failKey = f.keys.kitchen; f.server.afterPost = null; };
  const result = await f.adapter.commitReviewedReceipt(await draft(f, { receiptId: 'receipt-2', quantity: 100 }));
  assert.equal(result.localApplied, false); assert.equal(f.server.stock['pasta|g'], 650);
  const recovered = await f.adapter.synchronize(); assert.equal(recovered.localApplied, true);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 650);
});
test('locally dirty inventory plus a newer remote absolute inventory requires an explicit merge', async () => {
  const f = fixture(); await f.adapter.commitReviewedReceipt(await draft(f));
  f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 550 }));
  const other = fixture({ server: f.server }); await other.adapter.synchronize();
  await other.adapter.confirmPantry({ stock: { 'pasta|g': 400 }, expectedRevision: 1 });
  const result = await f.adapter.synchronize(); assert.equal(result.localApplied, false); assert.match(result.localError, /local_remote_pantry_merge/);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 550);
});
test('network loss after server commit keeps a token-free pending intent and can recover after reload', async () => {
  const f = fixture(); f.server.afterPost = () => { f.server.afterPost = null; throw Error('connection lost'); };
  await assert.rejects(f.adapter.commitReviewedReceipt(await draft(f)), error => error.commitUnknown === true);
  assert.equal(f.server.stock['pasta|g'], 500); assert.equal(f.adapter.getPendingConfirmation().receiptId, 'receipt-1');
  const reloaded = fixture({ store: f.store, server: f.server }); await reloaded.adapter.synchronize();
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500);
  assert.ok(![...f.store.data.values()].join('').includes('token-user'));
});
test('stale server revisions and mismatched actor projections cannot overwrite local stock', async () => {
  const f = fixture(); await f.adapter.commitReviewedReceipt(await draft(f));
  f.adapter.configure({ fetch: async () => ({ ok: true, json: async () => f.server.snapshot({ inventoryRevision: 0, stock: {} }) }) });
  const stale = await f.adapter.synchronize(); assert.equal(stale.localApplied, false); assert.match(stale.localError, /stale_server/);
  f.adapter.configure({ fetch: async () => ({ ok: true, json: async () => f.server.snapshot({ scope: { kind: 'user', id: 'user_00000002' } }) }) });
  const foreign = await f.adapter.synchronize(); assert.equal(foreign.localApplied, false); assert.match(foreign.localError, /actor_mismatch|scope_changed/);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500);
});
test('recovery journal cannot overwrite unrelated authentication keys', () => {
  const f = fixture(), key = `basketboss_receipt_inventory_journal_v1:${ACTOR}`;
  f.store.setItem(key, JSON.stringify({ version: 1, actorId: ACTOR, before: { [f.keys.session]: null }, after: { [f.keys.session]: 'poison' } }));
  assert.throws(() => f.adapter.recoverLocalTransaction(), /invalid_receipt_recovery_journal/);
  assert.equal(f.store.getItem(f.keys.session), null);
});
test('cancelling the draft while a confirmed request completes defers local stock until recovery', async () => {
  const f = fixture(), d = await draft(f); f.server.afterPost = () => f.adapter.cancelDraft(d);
  const result = await f.adapter.commitReviewedReceipt(d);
  assert.equal(result.committed, true); assert.equal(result.localApplied, false);
  assert.equal(f.server.stock['pasta|g'], 500); assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], undefined);
  await f.adapter.synchronize(); assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500);
});
test('a shared Web Locks host serializes two tabs and preserves both distinct receipts', async () => {
  const queues = new Map(), locks = { request(name, options, work) {
    assert.equal(options.mode, 'exclusive');
    const result = (queues.get(name) || Promise.resolve()).then(work);
    queues.set(name, result.catch(() => {})); return result;
  } };
  const first = fixture(), second = fixture({ store: first.store, server: first.server });
  first.adapter.configure({ locks }); second.adapter.configure({ locks });
  const one = await draft(first), two = await draft(second, { receiptId: 'receipt-2', quantity: 100 });
  const outcomes = await Promise.all([first.adapter.commitReviewedReceipt(one), second.adapter.commitReviewedReceipt(two)]);
  assert.ok(outcomes.every(x => x.localApplied)); assert.equal(first.server.stock['pasta|g'], 600);
  assert.equal(JSON.parse(first.store.getItem(first.keys.stock))['pasta|g'], 600);
});
test('cosmetic stock-key order differences do not create a false cross-device merge conflict', async () => {
  const f = fixture(); f.store.setItem(f.keys.stock, JSON.stringify({ 'rice|g': 100, 'pasta|g': 300 }));
  await f.adapter.commitReviewedReceipt(await draft(f));
  f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 800, 'rice|g': 100 }));
  f.server.revision++; // Remote revision changed without a quantity change.
  const result = await f.adapter.synchronize(); assert.equal(result.localApplied, true);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 800);
});
test('household scope change at the same numeric revision cannot accept the old baseline', async () => {
  const f = fixture(); await f.adapter.commitReviewedReceipt(await draft(f));
  f.server.scope = { kind: 'household', id: 'household_00001' }; f.server.stock = { 'pasta|g': 900 };
  await assert.rejects(f.adapter.commitReviewedReceipt(await draft(f, { receiptId: 'receipt-2', quantity: 100 })), /scope_conflict/);
  assert.equal(f.server.stock['pasta|g'], 900); assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500);
});
test('explicit Pantry scope adoption uses verified new scope and retains the old scoped cache', async () => {
  const f = fixture(); await f.adapter.commitReviewedReceipt(await draft(f));
  const oldOwner = JSON.parse(f.store.getItem(f.keys.owner));
  f.server.scope = { kind: 'household', id: 'household_00001' }; f.server.stock = { 'pasta|g': 900 };
  const outcome = await f.adapter.confirmPantry({ stock: { 'pasta|g': 600 }, expectedRevision: 1, expectedScope: f.server.scope });
  assert.equal(outcome.localApplied, true); assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 600);
  assert.ok(f.store.getItem(oldOwner.cacheKey)); assert.equal(f.adapter.getCachedProjection().scope.kind, 'household');
});
test('pending not-found confirmation can be retried after reload with its exact saved identity', async () => {
  const server = new FullInventoryServer(); let offline = true;
  const f = fixture({ server, fetch: async (url, settings) => { if (settings.method === 'POST' && offline) { offline = false; throw Error('network lost before request'); } return server.fetch(url, settings); } });
  f.store.setItem(f.keys.stock, JSON.stringify({ 'pasta|g': 300 }));
  f.store.setItem(f.keys.finishShop, JSON.stringify({ 'shop-1|pasta|g': { name: 'pasta', unit: 'g', credited: 300, week: 'shop-1' } }));
  await assert.rejects(f.adapter.commitReviewedReceipt(await draft(f)), error => error.commitUnknown === true);
  const reloaded = fixture({ server, store: f.store });
  assert.equal((await reloaded.adapter.synchronize()).pendingReceipt, true);
  const result = await reloaded.adapter.retryPendingConfirmation(); assert.equal(result.localApplied, true); assert.equal(server.stock['pasta|g'], 500);
  assert.equal(reloaded.adapter.getPendingConfirmation().receiptId, undefined);
});
test('pending retry preserves old expected scope and cannot migrate into a newly joined household', async () => {
  const server = new FullInventoryServer(), f = fixture({ server, fetch: async (url, settings) => { if (settings.method === 'POST') throw Error('offline'); return server.fetch(url, settings); } });
  await assert.rejects(f.adapter.commitReviewedReceipt(await draft(f)), error => error.commitUnknown === true);
  server.scope = { kind: 'household', id: 'household_00001' };
  const reloaded = fixture({ server, store: f.store });
  await assert.rejects(reloaded.adapter.retryPendingConfirmation(), /scope_conflict/);
  assert.equal(server.initialized, false); assert.deepEqual(server.stock, {});
});
test('approved essential pack/session fields and actual receipt summaries survive safe projection', async () => {
  const f = fixture(), base = f.server.snapshot.bind(f.server);
  f.server.snapshot = extra => base({ essentials: [{ id: 'e1', kind:'essential', name: 'Soap', productName: 'Soap 4 pack', brand: 'Own label', packQuantity: 4, packUnit: 'each', packCount: 1, pricePaid: 2, priceType:'regular',eligibleForRegularPrice:true,shopSessionId: 'shop-1', confirmedAt: '2026-10-31T12:00:00Z', purchasedAt: '2026-10-31', imageBase64: 'discard me' }], receipts: [{ receiptId: 'receipt-1', market: 'UK', currency: 'GBP', retailer: 'Tesco', shopSessionId: 'shop-1', foodSubtotal: 1.5, essentialsSubtotal: 2, receiptTotal: 3.5, adjustmentTotal: 0, photo: 'discard me' }], ...extra });
  await f.adapter.commitReviewedReceipt(await draft(f)); const cached = f.adapter.getCachedProjection();
  assert.equal(cached.essentials[0].packQuantity, 4); assert.equal(cached.essentials[0].shopSessionId, 'shop-1'); assert.equal(cached.essentials[0].brand, 'Own label');
  assert.equal(cached.receipts[0].receiptTotal, 3.5); assert.equal(cached.essentials[0].imageBase64, undefined); assert.equal(cached.receipts[0].photo, undefined);
  assert.equal(cached.essentials[0].kind,'essential');assert.equal(cached.essentials[0].priceType,'regular');assert.equal(cached.essentials[0].eligibleForRegularPrice,true);
});

test('learned food prices use the newest matching regular observations, not the oldest projection tail',async()=>{
 const f=fixture(),base=f.server.snapshot.bind(f.server);
 const observations=Array.from({length:46},(_,index)=>({id:'price-'+index,scopeId:ACTOR,canonicalKey:'pasta',brand:'',packQuantity:500,packUnit:'g',packCount:1,packPrice:index>=25?5:1,priceType:'regular',eligibleForRegularPrice:true,source:'reviewed_receipt',market:'UK',retailer:'Tesco',currency:'GBP',observedAt:new Date(Date.UTC(2026,8,1)+index*86400000).toISOString()})).reverse();
 observations.unshift({...observations[0],id:'promotion',priceType:'promotion',eligibleForRegularPrice:false,packPrice:.5,observedAt:'2026-12-01T00:00:00Z'});
 f.server.snapshot=extra=>base({priceObservations:observations,...extra});
 await f.adapter.commitReviewedReceipt(await draft(f));
 const request={canonicalKey:'pasta',market:'UK',retailer:'Tesco',currency:'GBP',packQuantity:500,packUnit:'g'};
 const price=f.adapter.getLearnedPrice(request);assert.equal(price.packPrice,5);assert.equal(price.samples,21);
 for(const patch of[{market:'US'},{retailer:'Aldi'},{currency:'USD'},{packQuantity:1000},{packUnit:'ml'},{brand:'Other'}])assert.equal(f.adapter.getLearnedPrice({...request,...patch}),null);
 f.session.value={...f.session.value,user:{id:'user_00000002'}};assert.equal(f.adapter.getLearnedPrice(request),null);
});

test('classified household receipt metadata reaches the real future-pack estimator',async()=>{
 const f=fixture(),base=f.server.snapshot.bind(f.server),context=vm.createContext({});
 vm.runInContext(await readFile(new URL('../bb-weekly-essentials.js',import.meta.url),'utf8'),context);
 f.server.snapshot=extra=>base({essentials:[{id:'shampoo-price',kind:'essential',name:'Family Shampoo 250ml',productName:'Family Shampoo 250ml',brand:'Family',quantity:500,unit:'ml',packQuantity:250,packUnit:'ml',packCount:2,pricePaid:7.98,priceType:'regular',eligibleForRegularPrice:true,market:'UK',retailer:'Tesco',currency:'GBP',purchasedAt:'2026-10-31'}],...extra});
 await f.adapter.commitReviewedReceipt(await draft(f));
 const observations=f.adapter.getCachedProjection().essentials,item={name:'Shampoo',productName:'Family Shampoo 250ml',brand:'Family',qty:1,unit:'pack',packQuantity:250,packUnit:'ml'};
 const quote=context.BBWeeklyEssentials.quote(item,{market:'UK',retailer:'Tesco',receiptObservations:observations});assert.equal(quote.amount,3.99);assert.equal(quote.receiptLearned,true);
 for(const priceType of['promotion','unknown',null,undefined])assert.equal(context.BBWeeklyEssentials.quote(item,{market:'UK',retailer:'Tesco',receiptObservations:observations.map(row=>({...row,priceType}))}).amount,null);
});


test('deletion blocks a receipt confirmation already in flight from projecting saved pantry data', async () => {
  const server = new FullInventoryServer();let release, posted;
  const waiting = new Promise(resolve => {release = resolve;});
  const postStarted = new Promise(resolve => {posted = resolve;});
  const f = fixture({server, fetch: async (url, options) => {
    const result = await server.fetch(url, options);
    if (options.method === 'POST') {posted();await waiting;}
    return result;
  }});
  const reviewed = await draft(f), pending = f.adapter.commitReviewedReceipt(reviewed);
  await postStarted;
  const before = [...f.store.data];
  f.event('basketboss:account-deletion-started');release();
  const result = await pending;
  assert.equal(result.committed, true);assert.equal(result.localApplied, false);
  assert.deepEqual([...f.store.data], before, 'pending confirmation is retained while deletion is unresolved');
  assert.deepEqual(JSON.parse(f.store.getItem(f.keys.stock) || '{}'), {});
});

test('deletion pauses new receipt requests and local recovery without removing a pending journal', async () => {
  let requests = 0;
  const f = fixture({fetch: async () => {requests++;throw Error('unexpected network');}}), journalKey = 'basketboss_receipt_inventory_journal_v1:' + ACTOR;
  f.store.setItem(journalKey, 'keep for deletion retry');
  f.event('basketboss:account-deletion-started');
  await assert.rejects(f.adapter.synchronize(), /account_deletion_in_progress/);
  assert.throws(() => f.adapter.recoverLocalTransaction(), /account_deletion_in_progress/);
  assert.equal(requests, 0);assert.equal(f.store.getItem(journalKey), 'keep for deletion retry');
});

test('canceling a deletion does not revive a receipt response captured before the deletion began', async () => {
  const server = new FullInventoryServer();let release, began;
  const waiting = new Promise(resolve => {release = resolve;});
  const started = new Promise(resolve => {began = resolve;});
  const f = fixture({server, fetch: async (url, options) => {const response = await server.fetch(url, options);began();await waiting;return response;}});
  const pending = f.adapter.synchronize();await started;
  f.event('basketboss:account-deletion-started');f.event('basketboss:account-deletion-cancelled');release();
  await assert.rejects(pending, /receipt_context_changed/);
  assert.equal(f.store.data.size, 0);
});

test('legacy reviewed receipt atomically stocks metric food, measured essentials hook and FinishShop coverage once', async () => {
  const f = fixture(), key = 'basketboss_receipt_test_app_values', seen = [];
  f.store.setItem(f.keys.stock, JSON.stringify({'pasta|g': 250}));
  f.adapter.configure({receiptSaveKeys: [key], prepareReceiptSave(packet) {
    seen.push(packet);
    return {changes: {[key]: {saved: packet.receiptId, essentialQuantity: packet.essentials[0]?.quantity}}, expected: {[key]: f.store.getItem(key)}};
  }});
  const packet = {receiptId: 'local-receipt-1', market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-1', stockPantry: true, items: [
    {key: 'pasta', name: 'Pasta', classification: 'food', quantity: 1, unit: 'kg', guidePackQuantity: 500, guidePackUnit: 'g', price: 2},
    {key: 'soap', name: 'Soap', classification: 'essential', quantity: 6, unit: 'each', price: 3}
  ], priceUpdates: [{name: 'pasta', price: 2, guidePackQuantity: 500, guidePackUnit: 'g'}]};
  const result = await f.adapter.commitLocalReceipt(packet);
  assert.equal(result.ok, true);assert.equal(result.stocked, 2);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 1250);
  assert.equal(seen[0].stockAfter['pasta|g'], 1250);assert.equal(seen[0].items[0].quantity, 1000);assert.equal(seen[0].essentials[0].quantity, 6);
  const coverage = JSON.parse(f.store.getItem(f.keys.finishShop))['shop-1|pasta|g'];
  assert.equal(coverage.receiptCoveredQuantity, 1000);assert.equal(coverage.mode, 'receipt_inventory');
  const kitchen = Object.values(JSON.parse(f.store.getItem(f.keys.kitchen)));assert.equal(kitchen[0].qty, 1250);
  f.store.setItem(f.keys.stock, JSON.stringify({'pasta|g': 650})); // Later Cook deduction must survive retry.
  const replay = await f.adapter.commitLocalReceipt(packet);assert.equal(replay.duplicate, true);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 650);assert.equal(seen.length, 1);
  await assert.rejects(f.adapter.commitLocalReceipt({...packet, stockPantry: false}), /identity_conflict/);
});

test('legacy receipt opt-out learns reviewed prices without stock, essential or FinishShop updates', async () => {
  const f = fixture(), key = 'basketboss_receipt_test_app_values';let seen;
  f.store.setItem(f.keys.stock, JSON.stringify({'pasta|g': 250}));
  f.adapter.configure({receiptSaveKeys: [key], prepareReceiptSave(packet) {seen = packet;return {changes: {[key]: {saved: true}}, expected: {[key]: null}};}});
  await f.adapter.commitLocalReceipt({receiptId: 'local-price-only', market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-1', stockPantry: false, items: [{key: 'pasta', name: 'Pasta', classification: 'food', quantity: null, unit: null, price: 2}]});
  assert.equal(seen.stockPantry, false);assert.equal(seen.essentials.length, 0);assert.equal(JSON.parse(f.store.getItem(key)).saved, true);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 250);assert.equal(f.store.getItem(f.keys.finishShop), null);assert.equal(f.store.getItem(f.keys.kitchen), null);
});

test('legacy receipt storage failure rolls back app prices, stock and replay checkpoint before retry', async () => {
  const f = fixture(), key = 'basketboss_receipt_test_app_values';
  f.adapter.configure({receiptSaveKeys: [key], prepareReceiptSave() {return {changes: {[key]: {saved: true}}, expected: {[key]: f.store.getItem(key)}};}});
  const packet = {receiptId: 'local-receipt-rollback', market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-1', stockPantry: true, items: [{key: 'pasta', name: 'Pasta', classification: 'food', quantity: 500, unit: 'g', price: 2}]};
  f.store.failKey = f.keys.stock;
  await assert.rejects(f.adapter.commitLocalReceipt(packet), /quota/);
  assert.equal(f.store.getItem(key), null);assert.equal(f.store.getItem(f.keys.stock), null);assert.equal(f.store.getItem('basketboss_receipt_local_saves_v1:' + ACTOR), null);
  assert.equal((await f.adapter.commitLocalReceipt(packet)).duplicate, undefined);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 500);
});

test('legacy receipt rejects app changes outside allowlist or account changes during preparation', async () => {
  const f = fixture(), key = 'basketboss_receipt_test_app_values';
  const packet = {receiptId: 'local-receipt-account', market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-1', stockPantry: true, items: [{key: 'pasta', name: 'Pasta', classification: 'food', quantity: 500, unit: 'g', price: 2}]};
  f.adapter.configure({receiptSaveKeys: [key], prepareReceiptSave() {return {changes: {[f.keys.session]: {access_token: 'forged'}}, expected: {[f.keys.session]: null}};}});
  await assert.rejects(f.adapter.commitLocalReceipt(packet), /invalid_receipt_app_transaction/);assert.equal(f.store.getItem(f.keys.stock), null);
  f.adapter.configure({prepareReceiptSave() {f.session.value = {...f.session.value, user: {id: 'user_00000002'}};return {changes: {[key]: {}}, expected: {[key]: null}};}});
  await assert.rejects(f.adapter.commitLocalReceipt(packet), /receipt_account_changed/);assert.equal(f.store.getItem(key), null);assert.equal(f.store.getItem(f.keys.stock), null);
});

test('cloud stock policy opt-out remains price/spend only and essential projection credits the app once', async () => {
  const f = fixture(), seen = [];
  f.adapter.configure({prepareReceiptSave(packet) {seen.push(packet);return {changes: {}, expected: {}};}});
  let value = await f.adapter.normalizeDraft({receiptId: 'cloud-policy-1', addToPantry: false, items: [{name: 'Pasta', kind: 'food', canonicalKey: 'pasta', quantity: 500, unit: 'g', pricePaid: 2}, {name: 'Soap', kind: 'essential', quantity: 6, unit: 'each', pricePaid: 3}]});
  value.lines.forEach(x => x.reviewed = true);
  let result = await f.adapter.commitReviewedReceipt(value);assert.equal(result.localApplied, true);
  assert.deepEqual(f.server.stock, {});assert.equal(f.store.getItem(f.keys.finishShop), null);
  assert.equal(seen.at(-1).stockPantry, false);assert.equal(seen.at(-1).essentials.length, 0);
  value = await f.adapter.normalizeDraft({receiptId: 'cloud-policy-2', addToPantry: true, items: [{name: 'Pasta', kind: 'food', canonicalKey: 'pasta', quantity: 1, unit: 'kg', pricePaid: 2}, {name: 'Soap', kind: 'essential', quantity: 6, unit: 'each', pricePaid: 3}]});
  value.lines.forEach(x => x.reviewed = true);
  result = await f.adapter.commitReviewedReceipt(value);assert.equal(result.localApplied, true);
  assert.equal(seen.at(-1).stockAfter['pasta|g'], 1000);assert.equal(seen.at(-1).essentials.length, 1);assert.equal(seen.at(-1).essentials[0].quantity, 6);
  await f.adapter.synchronize();assert.equal(seen.at(-1).essentials.length, 0);assert.equal(seen.at(-1).items.length, 0);
  result = await f.adapter.commitReviewedReceipt(value);assert.equal(result.duplicate, true);assert.equal(result.localApplied, true);assert.equal(seen.at(-1).items.length, 0);assert.equal(seen.at(-1).essentials.length, 0);
  assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'], 1000);
});

test('cloud projection merges duplicate kitchen locations into one authoritative measured balance', async () => {
  const f = fixture();
  f.store.setItem(f.keys.kitchen, JSON.stringify({cupboard: {name: 'pasta', qty: 200, unit: 'g', selected: true, loc: 'cupboard'}, freezer: {name: 'pasta', qty: 300, unit: 'g', selected: true, loc: 'freezer'}}));
  const value = await draft(f);assert.equal((await f.adapter.commitReviewedReceipt(value)).localApplied, true);
  const selected = Object.values(JSON.parse(f.store.getItem(f.keys.kitchen))).filter(x => x.selected);
  assert.equal(selected.length, 1);assert.equal(selected[0].qty, 500);assert.equal(selected[0].bb173StockValue, 500);
});

test('a later receipt cannot reuse the first receipt netting of FinishShop surplus credit', async () => {
  const f = fixture();
  f.store.setItem(f.keys.stock, JSON.stringify({'pasta|g': 300}));
  f.store.setItem(f.keys.finishShop, JSON.stringify({'shop-1|pasta|g': {name: 'pasta', unit: 'g', credited: 300, week: 'shop-1'}}));
  const one = await draft(f, {receiptId: 'receipt-first'});assert.equal((await f.adapter.commitReviewedReceipt(one)).localApplied, true);
  assert.equal(f.server.stock['pasta|g'], 500);
  const two = await draft(f, {receiptId: 'receipt-second'});assert.equal((await f.adapter.commitReviewedReceipt(two)).localApplied, true);
  assert.equal(f.server.stock['pasta|g'], 1000);
  assert.equal((await f.adapter.commitReviewedReceipt(one)).duplicate, true);assert.equal(f.server.stock['pasta|g'], 1000);
});

test('pantry balances preserve partial items, fractional packs and tiny residuals while purchase counts stay strict', () => {
  const stock = {'eggs|pieces': 1.5, 'rice|packs': 1/3, 'milk|litres': .0000001, 'herbs|g': 1e-9};
  const normalized = Core.normalizeStockMap(stock);
  assert.equal(normalized['egg|each'], 1.5);assert.equal(normalized['rice|pack'], 1/3);assert.equal(normalized['herbs|g'], 1e-9);
  assert.ok(Math.abs(normalized['milk|ml']-.0001)<1e-19);
  assert.deepEqual(Core.normalizeStockMap(normalized), normalized);
  assert.equal(Core.normalizeMeasuredQuantity(1.5, 'each'), null);
  assert.equal(Core.normalizePack({quantity: .5, unit: 'pack'}).quantity, null);
  assert.deepEqual(Core.normalizeStockQuantity(.5, 'packs'), {quantity: .5, unit: 'pack'});
  assert.equal(Core.normalizeStockQuantity(.5, 'unknown'), null);
  assert.deepEqual(Core.projectReceiptInventory(normalized, normalized, normalized), normalized);
  assert.deepEqual(Core.projectReceiptInventory({'rice|pack': .5}, {'rice|pack': .5}, {'rice|pack': 1/3}), {'rice|pack': 1/3});
});

test('cloud pantry confirmation and later receipts retain fractional physical balances and Kitchen location', async () => {
  const f = fixture();
  f.store.setItem(f.keys.stock, JSON.stringify({'egg|each': 1.5, 'rice|pack': .5, 'herbs|g': 1e-9}));
  f.store.setItem(f.keys.kitchen, JSON.stringify({'fridge|egg': {name:'Eggs',qty:1.5,unit:'each',loc:'fridge',selected:true}}));
  const result = await f.adapter.confirmPantry({stock: {'egg|each':1.5,'rice|pack':.5,'herbs|g':1e-9}, expectedRevision:0, expectedScope:f.server.scope, shopSessionId:'shop-1'});
  assert.equal(result.localApplied, true);
  const expected = {'egg|each':1.5,'rice|pack':.5,'herbs|g':1e-9};
  assert.deepEqual(JSON.parse(f.store.getItem(f.keys.stock)), expected);assert.deepEqual(f.server.stock, expected);
  assert.equal(JSON.parse(f.store.getItem(f.keys.kitchen))['fridge|egg'].qty, 1.5);
  await f.adapter.commitReviewedReceipt(await draft(f));
  assert.deepEqual(JSON.parse(f.store.getItem(f.keys.stock)), {...expected,'pasta|g':500});
  assert.equal(JSON.parse(f.store.getItem(f.keys.kitchen))['fridge|egg'].selected, true);
});

test('unsupported pantry units fail sync without removing local stock or writing a server replacement', async () => {
  const f = fixture();const stock={'herbs|handful':2,'rice|pack':.5};f.store.setItem(f.keys.stock,JSON.stringify(stock));
  await assert.rejects(f.adapter.confirmPantry({stock,expectedRevision:0,expectedScope:f.server.scope}), /invalid_inventory/);
  assert.deepEqual(JSON.parse(f.store.getItem(f.keys.stock)),stock);assert.deepEqual(f.server.stock,{});assert.equal(f.server.posts,0);
});

test('canonical package-source collisions fail before pantry POST and preserve original physical data', async () => {
 const stock={'rice|pack':1,'Rice|packs':1,'rice|g':20};
 assert.throws(()=>Core.normalizeStockMap(stock),/ambiguous_package_sources/);
 const f=fixture();f.store.setItem(f.keys.stock,JSON.stringify(stock));
 const kitchen={a:{name:'Rice',qty:1,unit:'pack',selected:true,packReviewed:true,packQuantity:500,packUnit:'g'},b:{name:'Rice',qty:1,unit:'packs',selected:true,packReviewed:true,packQuantity:250,packUnit:'g'}};
 f.store.setItem(f.keys.kitchen,JSON.stringify(kitchen));
 await assert.rejects(f.adapter.confirmPantry({stock,expectedRevision:0,expectedScope:f.server.scope}),/ambiguous_package_sources/);
 assert.equal(f.server.posts,0);assert.deepEqual(JSON.parse(f.store.getItem(f.keys.stock)),stock);assert.deepEqual(JSON.parse(f.store.getItem(f.keys.kitchen)),kitchen);
 await assert.rejects(f.adapter.commitReviewedReceipt(await draft(f)),/ambiguous_package_sources/);assert.equal(f.server.posts,0);assert.deepEqual(JSON.parse(f.store.getItem(f.keys.stock)),stock);
 assert.deepEqual(Core.normalizeStockMap({'rice|kg':1,'Rice|grams':250}),{'rice|g':1250});
 assert.deepEqual(Core.normalizeStockMap({'eggs|pieces':2,'egg|each':1}),{'egg|each':3});
});

test('cloud projection invalidates conflicting duplicate Kitchen conversion reviews without dropping the balance', async () => {
 for(const second of [{packReviewed:true,packQuantity:250,packUnit:'g',measurementReviewed:true,gramsPerEach:90},{packReviewed:false,packQuantity:500,packUnit:'g',measurementReviewed:false}]){
  const f=fixture(),stock={'rice|pack':2};f.store.setItem(f.keys.stock,JSON.stringify(stock));
  f.store.setItem(f.keys.kitchen,JSON.stringify({a:{name:'Rice',qty:1,unit:'pack',loc:'cupboard',selected:true,packReviewed:true,packQuantity:500,packUnit:'g',measurementReviewed:true,gramsPerEach:80},b:{name:'Rice',qty:1,unit:'pack',loc:'freezer',selected:true,...second}}));
  const result=await f.adapter.confirmPantry({stock,expectedRevision:0,expectedScope:f.server.scope});assert.equal(result.localApplied,true);
  assert.deepEqual(JSON.parse(f.store.getItem(f.keys.stock)),stock);
  const entries=Object.values(JSON.parse(f.store.getItem(f.keys.kitchen))),selected=entries.filter(x=>x.selected);assert.equal(selected.length,1);assert.equal(selected[0].qty,2);
  assert.ok(entries.every(x=>x.packReviewed===false&&x.measurementReviewed===false&&x.conversionNeedsReview===true));assert.equal(selected[0].packQuantity,500);assert.ok(entries.every(x=>x.conversionReviewSource.quantity===1));assert.equal(entries[1].conversionReviewSource.packQuantity,second.packQuantity);
 }
});

test('markdown suggestions exclude nutritional labels, loyalty offers, essentials and receipt adjustments', () => {
  const item = {kind: 'food', canonicalKey: 'pasta', pricePaid: 1};
  for (const name of ['Pasta REDUCED', 'Yellow sticker pasta', 'Pasta clearance', 'Pasta marked down']) assert.equal(Core.reducedReceiptSuggestion({...item, name}), true, name);
  for (const name of ['Reduced-salt soy sauce', 'Reduced sugar yoghurt', 'Reduced fat cheese', 'Sugar-reduced cereal', 'Pasta multibuy', 'Pasta Clubcard offer', 'Coupon discount', 'Laundry detergent REDUCED']) assert.equal(Core.reducedReceiptSuggestion({...item, name}), false, name);
  assert.equal(Core.reducedReceiptSuggestion({...item, name: 'Reduced-fat cheese yellow sticker'}), true);
  const scanned = Core.normalizeReceiptLine({...item, name: 'Pasta REDUCED', quantity: 500, unit: 'g', priceType: 'regular'}, {catalog: CATALOG});
  assert.equal(scanned.reducedSuggested, true);assert.equal(scanned.reduced, false);assert.equal(scanned.reviewed, false);
  const ordinary = Core.normalizeReceiptLine({...item, name: 'Pasta', quantity: 500, unit: 'g', priceType: 'promotion'}, {catalog: CATALOG});
  assert.equal(ordinary.reducedSuggested, false);assert.equal(ordinary.reduced, false);
});

test('reviewed reduced receipts stay outside standard-price learning and the strict HTTP shape remains unchanged', async () => {
  const f=fixture();const value=await draft(f);value.lines[0].reduced=true;value.lines[0].priceType='regular';
  const body=Core.prepareReceiptConfirmation(value,{requestId:'reduced-confirm',catalog:CATALOG});
  assert.equal(body.lines[0].priceType,'promotion');assert.equal(Object.hasOwn(body.lines[0],'reduced'),false);assert.equal(Object.hasOwn(body.lines[0],'reducedSuggested'),false);
  const observation=Core.normalizePriceObservation(body.lines[0],{scope:f.server.scope,market:'UK',retailer:'Tesco',currency:'GBP',receiptId:value.receiptId});
  assert.equal(observation.priceType,'promotion');assert.equal(observation.eligibleForRegularPrice,false);
  await assert.rejects(f.adapter.commitReviewedReceipt(value),/premium_reduced_food_required/);
  assert.equal(f.server.posts,0);assert.equal(f.store.getItem(f.keys.stock),null);
});

function enableReduced(f){
  const reports=[];f.root.BBReducedFoodHost={isPremium:()=>true};f.root.BBReducedStock=reducedStock;f.root.BBYellowStickersUI={reportReceipt:value=>{reports.push(clone(value));return Promise.resolve({ok:true});}};return reports;
}

for(const source of ['cloud','legacy'])test(source+' reviewed receipt cannot guess an unknown Finish tin size and known contents net exactly once',async()=>{
 for(const contents of ['unknown','reviewed','prices-only']){
  const f=fixture();f.adapter.configure({pantryPolicy:true});
  const stock={'chopped tomatoes|tin':2},tins={name:'Chopped tomatoes',qty:2,unit:'tin',loc:'cupboard',selected:true,bb173StockKey:'chopped tomatoes|tin',bb173StockValue:2,...(contents==='reviewed'?{packReviewed:true,packQuantity:300,packUnit:'g'}:{})};
  f.store.setItem(f.keys.stock,JSON.stringify(stock));f.store.setItem(f.keys.kitchen,JSON.stringify({tins}));f.store.setItem(f.keys.finishShop,JSON.stringify({'shop-1|chopped tomatoes|tin':{name:'chopped tomatoes',qty:2,unit:'tin',credited:2,week:'shop-1',stockBasis:'full-purchase'}}));
  const food={name:'Chopped tomatoes',kind:'food',classification:'food',canonicalKey:'chopped tomatoes',key:'chopped tomatoes',quantity:600,unit:'g',packCount:2,packQuantity:300,packUnit:'g',pricePaid:2,reviewed:true};
  const value=source==='cloud'?await f.adapter.normalizeDraft({receiptId:'reviewed-small-tomato-tins',currency:'GBP',retailer:'Tesco',shopSessionId:'shop-1',addToPantry:contents!=='prices-only',items:[food]}):{receiptId:'reviewed-small-tomato-tins',market:'UK',retailer:'Tesco',shopSessionId:'shop-1',stockPantry:contents!=='prices-only',items:[food]};
  if(source==='cloud')value.lines[0].reviewed=true;
  const before=new Map(f.store.data),commit=()=>source==='cloud'?f.adapter.commitReviewedReceipt(value):f.adapter.commitLocalReceipt(value);
  if(contents==='unknown'){await assert.rejects(commit(),/Confirm saved pack contents in At home/);assert.deepEqual(f.store.data,before);assert.equal(f.server.posts,0);continue;}
  const result=await commit();assert.equal(result.ok,true);if(source==='cloud')assert.equal(result.localApplied,true);
  if(contents==='reviewed'){assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['chopped tomatoes|g'],600);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['chopped tomatoes|tin'],undefined);if(source==='cloud')assert.equal(f.server.stock['chopped tomatoes|g'],600);}
  else{assert.deepEqual(JSON.parse(f.store.getItem(f.keys.stock)),stock);assert.equal(JSON.parse(f.store.getItem(f.keys.kitchen)).tins.qty,2);assert.equal(JSON.parse(f.store.getItem(f.keys.kitchen)).tins.unit,'tin');}
 }
});

for (const source of ['cloud','legacy']) test(source+' ambiguous reduced Finish credit saves once and surfaces review without changing existing lot labels',async()=>{
 const f=fixture();enableReduced(f);
 if(source==='cloud'){f.server.stock={'pasta|g':600};f.server.initialized=true;await f.adapter.synchronize();}
 const row=(qty,extra={})=>({name:'Pasta',loc:'cupboard',qty,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:qty,...extra});
 const portions={first:row(200,{notes:'Use first',bbReduced:{version:1,actor:ACTOR,urgent:true,at:1,sources:['old-first']}}),ordinary:row(400,{notes:'Lunch reserve'})};
 f.store.setItem(f.keys.stock,JSON.stringify({'pasta|g':600}));f.store.setItem(f.keys.kitchen,JSON.stringify(portions));f.store.setItem(f.keys.finishShop,JSON.stringify({'shop-1|pasta|g':{name:'pasta',unit:'g',credited:100,qty:100,week:'shop-1',stockBasis:'full-purchase'}}));
 const value=source==='cloud'?await draft(f,{receiptId:'ambiguous-reduced-credit',quantity:100}):{receiptId:'ambiguous-reduced-credit',market:'UK',retailer:'Tesco',shopSessionId:'shop-1',items:[{key:'pasta',name:'Pasta',classification:'food',quantity:100,unit:'g',pricePaid:1,priceType:'promotion',reduced:true}]};
 if(source==='cloud')Object.assign(value.lines[0],{reduced:true,priceType:'promotion'});
 const commit=()=>source==='cloud'?f.adapter.commitReviewedReceipt(value):f.adapter.commitLocalReceipt(value),result=await commit();
 assert.equal(result.ok,true);if(source==='cloud'){assert.equal(result.committed,true);assert.equal(result.localApplied,true);assert.deepEqual(clone(f.adapter.getPendingConfirmation()),{});}
 assert.equal(result.needsReducedReview,true);assert.equal(result.reviewIssues[0].reason,'previous_reduced_purchase_lot_ambiguous');assert.match(result.reviewMessage,/Check their Use soon labels in At home/);
 assert.deepEqual(JSON.parse(f.store.getItem(f.keys.kitchen)),portions);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],600);
 const again=await commit();assert.equal(again.duplicate,true);assert.equal(again.needsReducedReview,true);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],600);assert.deepEqual(JSON.parse(f.store.getItem(f.keys.kitchen)),portions);
});

for(const source of ['cloud','legacy'])test(source+' receipts and later refresh preserve dated ordinary stock beside an undated portion',async()=>{
 const f=fixture();f.root.BBReducedStock=reducedStock;f.adapter.configure({pantryPolicy:true});
 if(source==='cloud'){f.server.stock={'pasta|g':500};f.server.initialized=true;await f.adapter.synchronize();}
 const dated={name:'Pasta',loc:'cupboard',qty:200,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:200,useByISO:'2026-11-07',notes:'Use first'},ordinary={name:'Pasta',loc:'cupboard',qty:300,unit:'g',selected:true,bb173StockKey:'pasta|g',bb173StockValue:300,notes:'Lunch reserve'};
 f.store.setItem(f.keys.stock,JSON.stringify({'pasta|g':500}));f.store.setItem(f.keys.kitchen,JSON.stringify({dated,ordinary}));
 const value=source==='cloud'?await draft(f,{receiptId:'dated-stock-receipt',quantity:250}):{receiptId:'dated-stock-receipt',market:'UK',retailer:'Tesco',shopSessionId:'shop-1',items:[{key:'pasta',name:'Pasta',classification:'food',quantity:250,unit:'g',pricePaid:1}]};
 const result=source==='cloud'?await f.adapter.commitReviewedReceipt(value):await f.adapter.commitLocalReceipt(value);assert.equal(result.ok,true);if(source==='cloud')assert.equal(result.localApplied,true);
 let rows=JSON.parse(f.store.getItem(f.keys.kitchen));assert.deepEqual(rows.dated,dated);assert.equal(rows.ordinary.qty,550);assert.equal(rows.ordinary.useByISO,undefined);assert.equal(rows.ordinary.notes,'Lunch reserve');
 if(source==='cloud'){assert.equal((await f.adapter.synchronize()).localApplied,true);rows=JSON.parse(f.store.getItem(f.keys.kitchen));assert.deepEqual(rows.dated,dated);assert.equal(rows.ordinary.qty,550);}
 assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],750);
});

test('normal receipt costs include all accepted food and free household lines without changing baseline observations',async()=>{
 const f=fixture(),packets=[];f.adapter.configure({prepareReceiptSave:packet=>{if(packet.receiptId)packets.push(packet);return {changes:{},expected:{}};}});
 const value=await draft(f,{receiptId:'all-purchase-costs'});value.lines.push(Core.normalizeReceiptLine({description:'Soap',classification:'essential',quantity:1,unit:'each',pricePaid:0,reviewed:true},{market:'UK'},1));
 assert.equal((await f.adapter.commitReviewedReceipt(value)).localApplied,true);
 assert.deepEqual(clone(packets[0].purchaseCosts.map(line=>[line.classification,line.pricePaid,line.reduced])),[['food',1.5,false],['essential',0,false]]);
 assert.equal(packets[0].purchaseCosts[0].priceType,'regular');assert.equal(packets[0].reducedItems.length,0);
});
test('legacy cost uses bought pack count while its saved usual guide-pack price stays unchanged',async()=>{
 for(const [priceFields,expected]of [[{price:2},4],[{price:'2'},4],[{price:2,lineTotal:3},3],[{price:2,pricePaid:3},3]]){
  const f=fixture();let packet;f.adapter.configure({prepareReceiptSave:value=>{packet=value;return {changes:{},expected:{}};}});
  await f.adapter.commitLocalReceipt({receiptId:'legacy-pack-total',market:'UK',retailer:'Tesco',shopSessionId:'shop-1',items:[{key:'pasta',name:'Pasta',classification:'food',quantity:1000,unit:'g',guidePackQuantity:500,guidePackUnit:'g',...priceFields}],priceUpdates:[{name:'pasta',price:2,unit:'g'}]});
  assert.equal(packet.purchaseCosts[0].pricePaid,expected);assert.equal(packet.priceUpdates[0].price,2);assert.equal(packet.items[0].price,priceFields.price);assert.equal(packet.purchaseCosts[0].reduced,false);
 }
});
test('a prior yellow-sticker purchase protects the baseline while excess receipt lines remain ordinary',async()=>{
 const f=fixture();enableReduced(f);let body,packet;
 f.adapter.configure({getPurchaseCosts:()=>[{name:'Pasta',quantity:500,unit:'g',pricePaid:1,kind:'manual',shopSessionId:'shop-1'}],prepareReceiptSave:value=>{if(value.receiptId)packet=value;return {changes:{},expected:{}};}});f.server.afterPost=value=>{body=value;};
 const value=await draft(f,{receiptId:'mixed-reduced-and-normal'});Object.assign(value.lines[0],{pricePaid:3,lineTotal:3});value.lines.push({...value.lines[0],id:'line-2',pricePaid:1,lineTotal:1});
 assert.equal((await f.adapter.commitReviewedReceipt(value)).localApplied,true);
 assert.equal(body.lines[0].priceType,'promotion','ambiguous linked line cannot teach a discounted baseline');assert.equal(body.lines[1].priceType,'promotion');
 assert.deepEqual(clone(packet.purchaseCosts.map(line=>[line.pricePaid,line.reduced])),[[3,false],[1,true]]);assert.deepEqual(clone(packet.reducedItems.map(line=>line.lineId)),['line-2']);
});
test('inferred reduced receipt annotations survive an uncertain commit after manual price coverage changes',async()=>{
 const f=fixture();enableReduced(f);let known=[{name:'Pasta',quantity:500,unit:'g',pricePaid:1,kind:'manual'}],lost=false,packet;
 f.adapter.configure({getPurchaseCosts:()=>known,prepareReceiptSave:value=>{if(value.receiptId)packet=value;return {changes:{},expected:{}};},fetch:async(address,input)=>{const response=await f.server.fetch(address,input);if(input.method==='POST'&&!lost){lost=true;known=[];throw Error('response lost after commit');}return response;}});
 const value=await draft(f,{receiptId:'inferred-pending-retry'});Object.assign(value.lines[0],{pricePaid:1,lineTotal:1});
 await assert.rejects(f.adapter.commitReviewedReceipt(value),/response lost/);const journal=f.adapter.getPendingConfirmation();assert.equal(journal.body.lines[0].priceType,'promotion');assert.deepEqual(clone(journal.inferredReducedLineIds),['line-1']);
 const result=await f.adapter.commitReviewedReceipt(value);assert.equal(result.localApplied,true);assert.equal(result.duplicate,true);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],500);assert.equal(packet.purchaseCosts[0].reduced,true);assert.equal(f.server.receipts.size,1);
});
test('legacy linked reduced receipt cannot overwrite standard price when its reduced toggle was omitted',async()=>{
 const f=fixture();enableReduced(f);let packet;f.adapter.configure({getPurchaseCosts:()=>[{name:'Pasta',quantity:500,unit:'g',pricePaid:.75,kind:'manual'}],prepareReceiptSave:value=>{packet=value;return {changes:{},expected:{}};}});
  await f.adapter.commitLocalReceipt({receiptId:'legacy-linked-reduced',market:'UK',retailer:'Tesco',shopSessionId:'shop-1',items:[{key:'pasta',name:'Pasta',classification:'food',quantity:500,unit:'g',price:.75}],priceUpdates:[{name:'Pasta',unit:'g',price:.75}]});
 assert.equal(packet.priceUpdates.length,0);assert.equal(packet.purchaseCosts[0].priceType,'promotion');assert.equal(packet.purchaseCosts[0].reduced,true);
});

test('only confirmed reduced-food stock becomes urgent, while the atomic packet carries the actual paid amount', async () => {
  const f=fixture(),reports=enableReduced(f),packets=[];f.adapter.configure({prepareReceiptSave:packet=>{packets.push(clone(packet));return {changes:{},expected:{}};}});
  const value=await draft(f);value.lines[0].reduced=true;value.lines[0].location='fridge';value.purchasedAt='2026-11-05';
  assert.equal(reports.length,0);assert.equal(f.store.getItem(f.keys.kitchen),null);
  const result=await f.adapter.commitReviewedReceipt(value);assert.equal(result.localApplied,true);
  const rows=Object.values(JSON.parse(f.store.getItem(f.keys.kitchen)));assert.equal(rows.length,1);assert.equal(rows[0].qty,500);assert.equal(reducedStock.isUrgent(rows[0],{actor:ACTOR}),true);
  const packet=packets.find(x=>x.reducedItems?.length);assert.equal(packet.reducedItems[0].pricePaid,1.5);assert.equal(packet.reducedItems[0].priceType,'promotion');assert.equal(packet.purchasedAt,'2026-11-05');
  assert.equal(reports.length,1);assert.equal(reports[0].receiptId,value.receiptId);assert.equal(reports[0].purchasedAt,'2026-11-05');assert.ok(reports[0].confirmedAt);
});

test('ordinary promotional food and price-only reduced receipts do not create urgent stock', async () => {
  const f=fixture();enableReduced(f);const value=await draft(f);value.lines[0].priceType='promotion';await f.adapter.commitReviewedReceipt(value);
  assert.equal(Object.values(JSON.parse(f.store.getItem(f.keys.kitchen))).some(x=>reducedStock.isUrgent(x,{actor:ACTOR})),false);
  const g=fixture();enableReduced(g);const onlyPrices=await draft(g,{receiptId:'receipt-price-only'});onlyPrices.addToPantry=false;onlyPrices.lines[0].reduced=true;
  const result=await g.adapter.commitReviewedReceipt(onlyPrices);assert.equal(result.localApplied,true);assert.deepEqual(JSON.parse(g.store.getItem(g.keys.stock)),{});
  assert.equal(Object.values(JSON.parse(g.store.getItem(g.keys.kitchen))).some(x=>x.bbReduced),false);
});

test('reduced metadata survives pending confirmation recovery and a replay cannot revive frozen food', async () => {
  const f=fixture();enableReduced(f);const value=await draft(f);value.lines[0].reduced=true;
  await f.adapter.synchronize();
  f.store.failKey=f.keys.kitchen;const first=await f.adapter.commitReviewedReceipt(value);assert.equal(first.localApplied,false);
  const pending=f.adapter.getPendingConfirmation();assert.deepEqual(clone(pending.reducedLineIds),['line-1']);
  const retried=await f.adapter.retryPendingConfirmation();assert.equal(retried.localApplied,true);assert.equal(retried.duplicate,true);
  const kitchen=JSON.parse(f.store.getItem(f.keys.kitchen)),id=Object.keys(kitchen)[0];assert.equal(reducedStock.isUrgent(kitchen[id],{actor:ACTOR}),true);
  kitchen[id]=reducedStock.freeze(kitchen[id],{actor:ACTOR});f.store.setItem(f.keys.kitchen,JSON.stringify(kitchen));
  const replay=await f.adapter.commitReviewedReceipt(value);assert.equal(replay.localApplied,true);const row=JSON.parse(f.store.getItem(f.keys.kitchen))[id];assert.equal(row.loc,'freezer');assert.equal(row.bbReduced.urgent,false);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],500);
});

test('local reviewed reduced receipts preserve usual prices and stock credit exactly once', async () => {
  const f=fixture(),reports=enableReduced(f);let packet;
  f.adapter.configure({prepareReceiptSave:value=>{packet=clone(value);return {changes:{},expected:{}};}});
  const input={receiptId:'local-reduced-001',market:'UK',retailer:'Tesco',shopSessionId:'shop-1',purchasedAt:'2026-11-05',stockPantry:true,items:[{key:'pasta',name:'Pasta',classification:'food',quantity:500,unit:'g',price:0.75,reduced:true}],priceUpdates:[{name:'pasta',price:0.75}]};
  const result=await f.adapter.commitLocalReceipt(input);assert.equal(result.ok,true);assert.equal(packet.priceUpdates.length,0);assert.equal(packet.reducedItems[0].pricePaid,0.75);assert.equal(packet.reducedItems[0].priceType,'promotion');
  assert.equal(Object.values(JSON.parse(f.store.getItem(f.keys.kitchen))).some(x=>reducedStock.isUrgent(x,{actor:ACTOR})),true);assert.equal(reports.length,1);
  const repeat=await f.adapter.commitLocalReceipt(input);assert.equal(repeat.duplicate,true);assert.equal(reports.length,1);assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],500);
});

test('receipt reduced labels can annotate still-present Finish-shop stock without crediting it twice',async()=>{
 const f=fixture();enableReduced(f);f.store.setItem(f.keys.stock,JSON.stringify({'pasta|g':500}));f.store.setItem(f.keys.kitchen,JSON.stringify({pasta:{name:'Pasta',loc:'fridge',selected:true,qty:500,unit:'g'}}));
 f.store.setItem(f.keys.finishShop,JSON.stringify({'shop-1|pasta|g':{name:'pasta',unit:'g',credited:500,week:'shop-1'}}));let seen;f.adapter.configure({prepareReceiptSave:packet=>{if(packet.reducedItems?.length)seen=packet;return {changes:{},expected:{}};}});
 const value=await draft(f);value.lines[0].reduced=true;const result=await f.adapter.commitReviewedReceipt(value);assert.equal(result.localApplied,true);
 assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],500);const row=Object.values(JSON.parse(f.store.getItem(f.keys.kitchen)))[0];assert.equal(reducedStock.isUrgent(row,{actor:ACTOR}),true);assert.equal(seen.reducedItems[0].legacyCreditQuantity,500);
});

test('using all reduced stock then buying a normal replacement does not resurrect urgency',async()=>{
 const f=fixture();enableReduced(f);const first=await draft(f);first.lines[0].reduced=true;await f.adapter.commitReviewedReceipt(first);
 await f.adapter.confirmPantry({stock:{},expectedRevision:1,shopSessionId:'shop-1',expectedScope:f.server.scope});
 assert.equal(Object.values(JSON.parse(f.store.getItem(f.keys.kitchen))).some(row=>row.bbReduced?.urgent),false);
 const next=await draft(f,{receiptId:'normal-replacement'});await f.adapter.commitReviewedReceipt(next);
 assert.equal(JSON.parse(f.store.getItem(f.keys.stock))['pasta|g'],500);assert.equal(Object.values(JSON.parse(f.store.getItem(f.keys.kitchen))).some(row=>reducedStock.isUrgent(row,{actor:ACTOR})),false);
});

test('canonical alias and piece-weight normalization keeps ordinary and reduced portions separate',()=>{
 const meta=(actor,source,urgent=true)=>({version:1,actor,urgent,at:'2026-11-05T12:00:00Z',sources:[source]});
 const inventory={regular:{name:'Carrots',loc:'fridge',selected:true,qty:100,unit:'g',bb173StockKey:'carrots|g',bb173StockValue:100},reduced:{name:'Carrot',loc:'fridge',selected:true,qty:1,unit:'each',bb173StockKey:'carrot|each',bb173StockValue:1,bbReduced:meta(ACTOR,'receipt:carrot:one')}};
 const input=JSON.stringify(inventory),normalized=Core.normalizePantryState({'carrots|g':100,'carrot|each':1},inventory,{market:'UK'}),active=Object.values(normalized.inventory).filter(row=>row.selected);
 assert.equal(JSON.stringify(inventory),input);assert.equal(active.length,2);assert.equal(normalized.stock['carrot|g'],180);assert.equal(normalized.inventory.regular.qty,100);assert.equal(normalized.inventory.regular.bbReduced,undefined);assert.equal(normalized.inventory.reduced.qty,80);assert.equal(reducedStock.isUrgent(normalized.inventory.reduced,{actor:ACTOR}),true);assert.deepEqual(normalized.inventory.reduced.bbReduced.sources,['receipt:carrot:one']);
 const mergedAgain=Core.normalizePantryState(normalized.stock,normalized.inventory,{market:'UK'});assert.deepEqual(mergedAgain.stock,normalized.stock);assert.deepEqual(mergedAgain.inventory,normalized.inventory);
 const two=clone(inventory);two.regular.bbReduced=meta(ACTOR,'receipt:carrot:regular',false);const both=Core.normalizePantryState({'carrots|g':100,'carrot|each':1},two,{market:'UK'}).inventory;assert.equal(both.regular.bbReduced.urgent,false);assert.equal(both.reduced.bbReduced.urgent,true);assert.deepEqual(both.regular.bbReduced.sources,['receipt:carrot:regular']);assert.deepEqual(both.reduced.bbReduced.sources,['receipt:carrot:one']);
});

test('canonical reduced metadata merges never mix actor source IDs or make freezer stock urgent',()=>{
 const a={version:1,actor:ACTOR,urgent:true,at:'2026-11-05T12:00:00Z',sources:['actor-a-source']},b={...a,actor:'user_00000002',sources:['actor-b-source']};
 const records={one:{name:'Carrots',loc:'fridge',selected:true,qty:100,unit:'g',bb173StockKey:'carrots|g',bb173StockValue:100,bbReduced:a},two:{name:'Carrot',loc:'fridge',selected:true,qty:1,unit:'each',bb173StockKey:'carrot|each',bb173StockValue:1,bbReduced:b}};
 const separate=Core.normalizePantryState({'carrots|g':100,'carrot|each':1},records,{market:'UK'}).inventory;assert.equal(Object.values(separate).filter(row=>row.selected).length,2);assert.equal(separate.one.bbReduced.actor,ACTOR);assert.deepEqual(separate.one.bbReduced.sources,['actor-a-source']);assert.equal(reducedStock.isUrgent(separate.one,{actor:'user_00000002'}),false);assert.equal(separate.two.bbReduced.actor,'user_00000002');assert.deepEqual(separate.two.bbReduced.sources,['actor-b-source']);
 records.two.bbReduced=clone(a);records.one.loc=records.two.loc='freezer';const active=Object.values(Core.normalizePantryState({'carrots|g':100,'carrot|each':1},records,{market:'UK'}).inventory).find(row=>row.selected);assert.equal(active.qty,180);assert.equal(active.bbReduced.urgent,false);assert.equal(reducedStock.isUrgent(active,{actor:ACTOR}),false);
});

test('a receipt POST timeout releases the lock and preserves one recoverable same-ID confirmation',async()=>{
 const f=fixture(),timers=new Map();let serial=0,posted;
 f.adapter.configure({AbortController,setTimeout:(fn,delay)=>{assert.equal(delay,20000);const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,input)=>{
  if(input.method!=='POST')return f.server.fetch(url,input);
  posted=JSON.parse(input.body);return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(Error('synthetic slow supermarket network')),{once:true}));
 }});
 const reviewed=await draft(f),save=f.adapter.commitReviewedReceipt(reviewed);
 await new Promise(resolve=>setImmediate(resolve));assert.ok(posted);assert.equal(timers.size,1);[...timers.values()][0]();
 await assert.rejects(save,error=>error.commitUnknown===true&&error.recoveryRequired===true);
 assert.equal(timers.size,0);assert.equal(f.adapter.getPendingConfirmation().receiptId,reviewed.receiptId);
 assert.equal(f.store.getItem(f.keys.stock),'{}','an uncertain save cannot invent purchased stock');
 f.adapter.configure({fetch:f.server.fetch});const recovered=await f.adapter.retryPendingConfirmation();
 assert.equal(recovered.committed,true);assert.equal(recovered.localApplied,true);assert.equal(f.server.posts,1);assert.equal(f.server.stock['pasta|g'],500);
 assert.equal(f.adapter.getPendingConfirmation().receiptId,undefined);assert.equal(timers.size,0);
});

test('receipt inventory reads compose caller cancellation without replacing local stock',async()=>{
 const f=fixture();f.store.setItem(f.keys.stock,JSON.stringify({'pasta|g':250}));const controller=new AbortController(),timers=new Map();let serial=0,received;
 f.adapter.configure({AbortController,setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),fetch:(_url,input)=>{received=input.signal;return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(Error('synthetic cancelled refresh')),{once:true}));}});
 const refresh=f.adapter.synchronize({signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));assert.notEqual(received,controller.signal);
 controller.abort();await assert.rejects(refresh,/cancelled refresh/);assert.equal(received.aborted,true);assert.equal(timers.size,0);assert.deepEqual(JSON.parse(f.store.getItem(f.keys.stock)),{'pasta|g':250});
});
