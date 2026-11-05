import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), reduced = require('../bb-reduced-purchases.js'), reducedStock = require('../bb-reduced-stock.js');

const source = await fs.readFile(new URL('../bb-receipt-host.js', import.meta.url), 'utf8');
const actorA = '11111111-1111-4111-8111-111111111111';
const actorB = '22222222-2222-4222-8222-222222222222';
const keys = {stock: 'basketboss_321_v7_measured_pantry', kitchen: 'basketboss_makeameal_v1_inventory', confirmed: 'basketboss_ui_next_confirmed_pantry_v1', ledger: 'basketboss_purchase_receipts_v1', owner: 'basketboss_receipt_projection_owner_v1'};
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));let fail = null;
  return {values, getItem: key => values.get(key) ?? null, setItem(key, value) {if (key === fail) {fail = null;throw Error('quota');}values.set(key, String(value));}, removeItem: key => values.delete(key), failNext(key) {fail = key;}};
}
class Element {
  constructor(tag) {this.tagName = tag.toUpperCase();this.children = [];this.events = {};this.dataset = {};this.attributes = {};this.value = '';this.textContent = '';this.disabled = false;}
  append(...children) {for (const child of children) {child.parent = this;this.children.push(child);}}
  setAttribute(key, value) {this.attributes[key] = value;}
  addEventListener(name, handler) {this.events[name] = handler;}
  removeAttribute(name) {delete this.attributes[name];}
  remove() {if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this);}
  close() {this.events.close?.();}
  showModal() {this.open = true;}
  focus() {}
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
function harness({stock = {}, actor = actorA, cached = null, document = false, status = {ok: true, available: true, premium: true}, fetch: fetcher} = {}) {
  let currentSession = actor === 'guest' ? null : {access_token: 'synthetic-token-' + actor, expires_at: 9999999999, user: {id: actor}};
  let currentCache = cached, pending = {}, essentials = [], currentContext = {market: 'UK', retailer: 'Tesco', shopSessionId: 'shop-current'};
  const store = storage({[keys.stock]: JSON.stringify(stock)}), events = {}, notices = [], calls = [], body = new Element('body');
  const doc = document ? {createElement: tag => new Element(tag), body, getElementById: () => null} : undefined;
  const inventory = {
    configure(value) {this.options = value;}, getCachedProjection: () => currentCache, getPendingConfirmation: () => pending,
    recoverLocalTransaction() {}, async synchronize() {calls.push('synchronize');return {ok: true, localApplied: true};},
    async retryPendingConfirmation() {calls.push('retry');pending = {};return {ok: true, localApplied: true};},
    async confirmPantry(value) {calls.push(value);return {ok: true, committed: true, localApplied: true, projection: {stock: value.stock}};}
  };
  const root = {localStorage: store, document: doc, Intl, Date, console, queueMicrotask, addEventListener: (name, fn) => {events[name] = fn;}};
  vm.runInNewContext(source, root, {filename: 'bb-receipt-host.js'});
  const options = {storage: store, document: doc, inventory, getSession: () => currentSession, getContext: () => currentContext,
    getStock: () => JSON.parse(store.getItem(keys.stock) || '{}'), getEssentials: () => essentials, setEssentials: value => {essentials = value;return true;},
    fetch: fetcher || (async address => {calls.push(address);return {ok: true, json: async () => status};}), notify: value => notices.push(value),
    onProjection() {}, openUpgrade() {calls.push('upgrade');}, openLegacy() {calls.push('legacy');}, now: () => Date.parse('2026-10-31T12:00:00Z')};
  const host = root.BBReceiptHostFactory(options);host.configure();
  return {host, inventory, store, calls, notices, body, root, helpers: root.BBReceiptHostHelpers, options, setSession(value) {currentSession = value;}, setActor(id) {currentSession = id === 'guest' ? null : {access_token: 'synthetic-token-' + id, user: {id}};}, setContext(value) {currentContext = {...currentContext, ...value};}, setCached(value) {currentCache = value;}, setPending(value) {pending = value;}, getEssentials: () => essentials, setEssentials(value) {essentials = value;}, event(name) {events[name]?.();}};
}

test('weekly receipt subtotals separate food/non-food and exclude other markets, old or unknown dates', () => {
  const {helpers} = harness();
  const row = {receiptId: 'r1', market: 'UK', currency: 'GBP', purchasedAt: '2026-10-30', foodSubtotal: 5, essentialsSubtotal: 2, receiptTotal: 6.5};
  const result = helpers.weeklyReceiptSummary({receipts: [row, {...row}, {...row, receiptId: 'old', purchasedAt: '2026-10-01'}, {...row, receiptId: 'us', market: 'US', currency: 'USD'}, {...row, receiptId: 'unknown', purchasedAt: null}], essentials: [{receiptId: 'r1', lineId: 'e1', name: 'Shampoo', market: 'UK', currency: 'GBP', purchasedAt: '2026-10-30', pricePaid: 2}]}, {market: 'UK'}, Date.parse('2026-10-31'));
  assert.equal(result.food, 5);assert.equal(result.nonFood, 2);assert.equal(result.paid, 6.5);assert.equal(result.receipts.length, 1);assert.equal(result.essentials[0].name, 'Shampoo');assert.equal(result.unallocated, 1);
});
test('unread actual receipt totals remain unknown rather than becoming zero paid', () => {
  const {helpers} = harness();const result = helpers.weeklyReceiptSummary({receipts: [{receiptId: 'r', market: 'UK', currency: 'GBP', purchasedAt: '2026-10-31', foodSubtotal: 4, essentialsSubtotal: 0, receiptTotal: null}]}, {market: 'UK'}, Date.parse('2026-10-31'));
  assert.equal(result.paid, null);assert.equal(result.incomplete, true);
});
test('reviewed net refunds reduce actual paid totals without allocating discounts to food or essentials', () => {
  const {helpers} = harness();const row = {market: 'UK', currency: 'GBP', purchasedAt: '2026-10-31', foodSubtotal: 0, essentialsSubtotal: 0};
  const result = helpers.weeklyReceiptSummary({receipts: [{...row, receiptId: 'purchase', foodSubtotal: 10, receiptTotal: 10}, {...row, receiptId: 'refund', receiptTotal: -3}]}, {market: 'UK'}, Date.parse('2026-10-31'));
  assert.equal(result.paid, 7);assert.equal(result.food, 10);assert.equal(result.nonFood, 0);assert.equal(result.incomplete, false);
});
test('US Sunday evening remains in the local shopping week after UTC has reached Monday', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const {helpers} = harness(), now = Date.parse('2026-11-02T01:00:00Z');
    const bounds = helpers.weekBounds(now);assert.equal(bounds.start, '2026-10-26');assert.equal(bounds.end, '2026-11-02');
    const row = {market: 'US', currency: 'USD', foodSubtotal: 4, essentialsSubtotal: 0, receiptTotal: 4};
    const result = helpers.weeklyReceiptSummary({receipts: [{...row, receiptId: 'sunday', purchasedAt: '2026-11-02T00:30:00Z'}, {...row, receiptId: 'monday', purchasedAt: '2026-11-02'}]}, {market: 'US'}, now);
    assert.equal(result.receipts.length, 1);assert.equal(result.receipts[0].receiptId, 'sunday');
  } finally {if (previous === undefined) delete process.env.TZ;else process.env.TZ = previous;}
});
test('the first account claims guest stock once, while later accounts restore their own pantry and essentials', () => {
  const h = harness({stock: {'rice|g': 100}, actor: 'guest'});h.setEssentials([{name: 'Guest soap'}]);
  h.setActor(actorA);h.host.switchActor();assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 100);assert.equal(h.getEssentials()[0].name, 'Guest soap');
  h.store.setItem(keys.stock, JSON.stringify({'pasta|g': 500}));h.setEssentials([{name: 'A shampoo'}]);
  h.setActor(actorB);h.host.switchActor();assert.equal(h.store.getItem(keys.stock), null);assert.equal(h.getEssentials().length, 0);
  h.store.setItem(keys.stock, JSON.stringify({'lentils|g': 200}));
  h.setActor(actorA);h.host.switchActor();assert.equal(JSON.parse(h.store.getItem(keys.stock))['pasta|g'], 500);assert.equal(h.getEssentials()[0].name, 'A shampoo');
  h.setActor('guest');h.host.switchActor();assert.equal(h.store.getItem(keys.stock), null);assert.equal(h.getEssentials().length, 0,'claimed guest amounts cannot be credited to another account again');
  assert.ok([...h.store.values].every(([key, value]) => !key.startsWith('basketboss_receipt_host_snapshot_') || !value.includes('synthetic-token')));
});
test('first sign-in retains completed guest meals, manual requests, paid-price baselines and the same purchase identity', () => {
  const h = harness({stock: {'rice|g': 500}, actor: 'guest'}), own = h.host.keys;
  const home = {version: 1, byActor: {guest: {targets: {'rice|g': {pending: true, targetQty: 800}}, cooked: {'cook-one': {at: 100}}, planned: {'week|Monday|rice': {at: 100}}, manualBuys: {topup: {pending: true, quantity: 300}}}}};
  const prices = JSON.stringify({'UK|Tesco|rice|g': {packPrice: 1.25}}), trip = JSON.stringify({version: 7, id: 'same-trip', reducedPurchases: {}}), ticks = JSON.stringify({'rice|g': true});
  h.store.setItem('basketboss_at_home_requirements_v1', JSON.stringify(home));h.store.setItem(own.prices, prices);h.store.setItem(own.shop, trip);h.store.setItem(own.ticks, ticks);
  h.setActor(actorA);assert.equal(h.host.switchActor(), true);
  assert.equal(h.store.getItem(own.prices), prices);assert.equal(h.store.getItem(own.shop), trip);assert.equal(h.store.getItem(own.ticks), ticks);assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 500);
  const adopted = JSON.parse(h.store.getItem('basketboss_at_home_requirements_v1'));assert.deepEqual(adopted.byActor[actorA], home.byActor.guest);assert.equal(adopted.byActor.guest, undefined);
  assert.equal(h.host.switchActor(), false,'repeated session refresh must not re-adopt anything');
  h.setActor('guest');h.host.switchActor();assert.equal(h.store.getItem(own.shop), null);assert.equal(h.store.getItem(own.prices), null);assert.equal(h.store.getItem(own.ticks), null);
  h.setActor(actorB);h.host.switchActor();assert.equal(h.store.getItem(keys.stock), null);assert.equal(h.store.getItem(own.prices), null);
  h.setActor(actorA);h.host.switchActor();assert.equal(h.store.getItem(own.shop), trip);assert.equal(h.store.getItem(own.prices), prices);assert.equal(h.store.getItem(own.ticks), ticks);
});
test('a first account with server pantry keeps the unowned guest baseline pending the existing merge review', () => {
  const h = harness({stock: {'rice|g': 500}, actor: 'guest', cached: {actorId: actorA, initialized: true, scope: {kind: 'user', id: actorA}, serverStock: {'rice|g': 700}, pantryReview: {required: true}}});
  h.setActor(actorA);h.host.switchActor();assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 500);assert.equal(h.store.getItem(keys.owner), null,'claiming local stock must not forge a confirmed cloud projection');
  assert.equal(h.host.getProjection().serverStock['rice|g'], 700);assert.equal(h.host.getProjection().pantryReview.required, true);
});
test('signing out or switching accounts isolates unfinished purchases, reduced history and usual prices', () => {
  const h = harness(), own = h.host.keys, fields = ['prices','paidPrices','packSizes','shop','shopArchive','ticks','purchases','choices','partials'];
  const original = Object.fromEntries(fields.map(key=>[key, JSON.stringify({savedFor: actorA, key})]));
  for(const key of fields)h.store.setItem(own[key],original[key]);
  h.setActor(actorB);h.host.switchActor();for(const key of fields)assert.equal(h.store.getItem(own[key]),null,key+' cannot leak into another account');
  h.setActor(actorA);h.host.switchActor();for(const key of fields)assert.equal(h.store.getItem(own[key]),original[key],key+' must survive returning to its account');
});
test('guest adoption rolls back its household and completion records if any scoped stock write fails', () => {
  const h = harness({stock: {'rice|g': 500}, actor: 'guest'});h.setEssentials([{name:'Guest soap'}]);
  const home = JSON.stringify({version:1,byActor:{guest:{planned:{already:true},cooked:{},targets:{}}}});h.store.setItem('basketboss_at_home_requirements_v1',home);
  h.store.setItem(keys.kitchen,'{}');const before = [...h.store.values];h.store.failNext(keys.kitchen);h.setActor(actorA);assert.throws(()=>h.host.switchActor(),/quota/);
  assert.deepEqual([...h.store.values],before);assert.equal(h.getEssentials()[0].name,'Guest soap');assert.equal(h.store.getItem('basketboss_at_home_requirements_v1'),home);
});
test('claiming the first guest profile rebinds cost and urgency ownership without rewriting purchase identities', () => {
  const h = harness({stock: {'carrot|g':200}, actor:'guest'}), own = h.host.keys, at = Date.parse('2026-10-31T12:00:00Z');
  const cost = reduced.record({actor:'guest',market:'UK',shopSessionId:'guest-trip',id:'paid-carrots',purchaseId:'carrot|g',name:'Carrots',unit:'g',quantity:200,pricePaid:.5,at});
  h.store.setItem(own.shop, JSON.stringify({version:7,id:'guest-trip',reducedPurchases:{[cost.id]:cost},receiptContext:{actorId:'guest',market:'UK',retailer:'Tesco'}}));
  h.store.setItem(own.shopArchive, JSON.stringify({'finished-guest-trip':{version:7,id:'finished-guest-trip',receiptContext:{actorId:'guest',market:'UK',retailer:'Tesco'}}}));
  h.store.setItem(own.kitchen, JSON.stringify({carrots:{name:'Carrots',qty:200,unit:'g',loc:'fridge',selected:true,bb173StockKey:'carrot|g',bb173StockValue:200,bbReduced:{version:1,actor:'guest',urgent:true,at,sources:['reduced:guest:guest-trip:paid-carrots']}}}));
  h.setActor(actorA);h.host.switchActor();const trip = JSON.parse(h.store.getItem(own.shop)), item = JSON.parse(h.store.getItem(own.kitchen)).carrots;
  assert.equal(trip.reducedPurchases[cost.id].actor,actorA);assert.equal(trip.reducedPurchases[cost.id].id,cost.id);assert.equal(trip.receiptContext.actorId,actorA);
  const archived=JSON.parse(h.store.getItem(own.shopArchive))['finished-guest-trip'];assert.equal(archived.id,'finished-guest-trip');assert.equal(archived.receiptContext.actorId,actorA,'a guest Finish then sign-in retains the same own-account receipt link');
  assert.equal(reduced.eligible(trip,{actor:actorA,market:'UK'},{ticks:{'carrot|g':true},purchases:{'carrot|g':{qty:200,unit:'g',bbBetaSelectedWeek:'guest-trip'}}}).length,1);
  assert.equal(reducedStock.isUrgent(item,{actor:actorA}),true);assert.equal(item.bbReduced.sources[0],'reduced:guest:guest-trip:paid-carrots');
});
test('account switching isolates the meal plan, school lunches and custom dinners before the reload callback', () => {
  const h = harness(), own = h.host.keys, previous = {plan:{version:2,planned:[{day:'Monday',recipeId:'rice'}]},lunch:{version:1,days:{Monday:[{name:'Apple',qty:1,unit:'each'}]}},notes:{Tuesday:'Custom dinner'}};
  for (const [key,value] of Object.entries(previous)) h.store.setItem(own[key],JSON.stringify(value));
  const changes=[];h.host.configure({onActorChanged:value=>{changes.push(value);assert.equal(JSON.parse(h.store.getItem(own.actor)).actorId,value.actor);return true;}});
  h.setActor(actorB);h.host.switchActor();for(const key of Object.keys(previous))assert.equal(h.store.getItem(own[key]),null);
  h.setActor(actorA);h.host.switchActor();for(const [key,value] of Object.entries(previous))assert.deepEqual(JSON.parse(h.store.getItem(own[key])),value);
  assert.deepEqual(changes.map(value=>value.previous),[actorA,actorB]);
});
test('another tab or a BFCache restore reloads stale account memory without archiving the new account under the old identity', () => {
  for(const event of ['basketboss:session-changed','pageshow']){
    const h=harness(), own=h.host.keys, changes=[];h.host.configure({onActorChanged:value=>{changes.push(value);return true;}});
    const otherProfile=JSON.stringify({'pasta|g':900});h.store.setItem(own.stock,otherProfile);h.store.setItem(own.actor,JSON.stringify({version:1,actorId:actorB,localAccountSeen:true}));
    h.setActor(actorB);h.event(event);
    assert.equal(changes.length,1,event);assert.equal(changes[0].previous,actorA);assert.equal(changes[0].actor,actorB);
    assert.equal(h.store.getItem(own.stock),otherProfile);assert.equal(h.store.getItem('basketboss_receipt_host_snapshot_v1:'+actorA),null,'the other tab already isolated its profile; do not archive its stock as ours');
  }
});
test('a versioned account backup contains stock, prices, quantities and completion identity without auth or server ownership', () => {
  const h = harness({stock:{'rice|g':500}}), own = h.host.keys;
  h.store.setItem(own.prices,JSON.stringify({'rice|g':{packPrice:1.25}}));h.store.setItem(own.plan,JSON.stringify({version:2,planned:[{recipeId:'rice',day:'Monday'}]}));
  h.store.setItem('basketboss_cloud_session_v1','secret-session-that-must-never-be-backed-up');
  h.store.setItem('basketboss_at_home_requirements_v1',JSON.stringify({version:1,byActor:{[actorA]:{targets:{},cooked:{one:{recipeId:'rice',at:100}},planned:{completed:true}}}}));
  const backup = h.host.exportBackup();assert.equal(backup.version,1);assert.equal(backup.actorId,actorA);assert.equal(backup.hasData,true);
  assert.equal(backup.values[own.stock]['rice|g'],500);assert.equal(backup.values[own.prices]['rice|g'].packPrice,1.25);assert.equal(backup.home.planned.completed,true);
  assert.equal(Object.hasOwn(backup.values,own.plan),false);assert.equal(Object.hasOwn(backup.values,own.owner),false);assert.ok(!JSON.stringify(backup).includes('secret-session'));
  backup.values[own.stock]['rice|g']=999;assert.equal(JSON.parse(h.store.getItem(own.stock))['rice|g'],500,'export returns an independent snapshot');
});
test('a fresh device restores the exact account backup once, retaining stock and usual price rather than adding quantities', () => {
  const source = harness({stock:{'rice|g':500}}), own = source.host.keys;source.setEssentials([{name:'Soap',ownedQty:1,targetQty:2}]);source.store.setItem(own.prices,JSON.stringify({'rice|g':{packPrice:1.25}}));
  const backup = source.host.exportBackup(), fresh = harness();fresh.store.setItem(own.lunch,JSON.stringify({version:1,children:1,days:{Monday:[],Tuesday:[],Wednesday:[],Thursday:[],Friday:[]},menus:{}}));fresh.store.setItem(own.shop,JSON.stringify({version:7,id:'empty-local-trip',bought:{},purchases:{}}));
  assert.equal(fresh.host.hasLocalData(),false);const before=[...fresh.store.values],proposal=fresh.host.prepareBackupRestore(backup);
  assert.equal(proposal.restored,true);assert.equal(proposal.requiresReview,false);assert.deepEqual([...fresh.store.values],before,'preparing is read-only');assert.equal(proposal.updates[own.owner],null);
  for(const [key,value]of Object.entries(proposal.updates))value===null?fresh.store.removeItem(key):fresh.store.setItem(key,JSON.stringify(value));fresh.setEssentials(backup.essentials);
  assert.equal(JSON.parse(fresh.store.getItem(own.stock))['rice|g'],500);assert.equal(JSON.parse(fresh.store.getItem(own.prices))['rice|g'].packPrice,1.25);assert.equal(fresh.getEssentials()[0].ownedQty,1);
  const repeated=fresh.host.prepareBackupRestore(backup);assert.equal(repeated.restored,false);assert.equal(repeated.requiresReview,false);assert.deepEqual(Object.keys(repeated.updates),[]);
});
test('remote backups cannot overwrite local pantry, import another actor or smuggle credentials', () => {
  const source=harness({stock:{'rice|g':500}}), backup=source.host.exportBackup(), local=harness({stock:{'rice|g':300}}), before=[...local.store.values];
  const proposal=local.host.prepareBackupRestore(backup);assert.equal(proposal.requiresReview,true);assert.equal(proposal.restored,false);assert.deepEqual(Object.keys(proposal.updates),[]);assert.deepEqual([...local.store.values],before);
  for(const alter of [value=>{value.actorId=actorB;},value=>{value.values.basketboss_cloud_session_v1={access_token:'forbidden'};},value=>{value.values[local.host.keys.kitchen]={food:{name:'Rice',access_token:'forbidden'}};},value=>{value.values[local.host.keys.stock]['rice|g']=-100;},value=>{value.values[local.host.keys.kitchen]={food:{name:'Rice',qty:-100,unit:'g'}};}]){
    const malformed=structuredClone(backup);alter(malformed);assert.throws(()=>local.host.prepareBackupRestore(malformed),/backup_/);assert.deepEqual([...local.store.values],before);
  }
});
test('an unresolved receipt journal cannot be exported as a trustworthy cloud pantry snapshot', () => {
  const h=harness({stock:{'rice|g':500}}), before=[...h.store.values];h.setPending({receiptId:'uncertain-receipt'});
  assert.throws(()=>h.host.exportBackup(),/backup_paused/);assert.deepEqual([...h.store.values],before);
});
test('quota failure rolls account switch back without clearing the previous pantry', () => {
  const h = harness({stock: {'rice|g': 100}});h.setEssentials([{name: 'Keep me'}]);
  h.store.setItem('basketboss_receipt_host_snapshot_v1:' + actorB, JSON.stringify({version: 1, actorId: actorB, values: {...Object.fromEntries(Object.values(keys).map(key => [key, null])), [keys.stock]: JSON.stringify({'rice|g': 200}), [keys.kitchen]: '{}'}, essentials: []}));
  h.store.failNext(keys.kitchen);h.setActor(actorB);
  assert.throws(() => h.host.switchActor(), /quota/);assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 100);assert.equal(h.getEssentials()[0].name, 'Keep me');
  assert.equal(JSON.parse(h.store.getItem(h.host.keys.actor)).actorId, actorA);
});
test('tampered account archive cannot restore authentication or unrelated local keys', () => {
  const h = harness();h.store.setItem('basketboss_cloud_session_v1', 'do-not-change');h.store.setItem('basketboss_receipt_host_snapshot_v1:' + actorB, JSON.stringify({version: 1, actorId: actorB, values: {...Object.fromEntries(Object.values(keys).map(key => [key, null])), basketboss_cloud_session_v1: 'bad'}}));h.setActor(actorB);
  assert.throws(() => h.host.switchActor(), /snapshot_invalid/);assert.equal(h.store.getItem('basketboss_cloud_session_v1'), 'do-not-change');
});
test('Free account opens upgrade; gated-off Premium retains existing price-only scanner', async () => {
  const free = harness({status: {ok: true, available: false, premium: false}});await free.host.open();assert.ok(free.calls.includes('upgrade'));assert.ok(!free.calls.includes('legacy'));
  const paid = harness({status: {ok: true, available: false, premium: true}});await paid.host.open();assert.ok(paid.calls.includes('legacy'));assert.ok(!paid.calls.includes('synchronize'));
});
test('late availability response cannot enable receipt inventory for another account', async () => {
  let resolve;const h = harness({fetch: () => new Promise(done => {resolve = done;})});const pending = h.host.refreshAvailability();
  h.setActor(actorB);h.host.switchActor();resolve({ok: true, json: async () => ({ok: true, available: true, premium: true})});await pending;assert.equal(h.host.getAvailability().available, false);assert.ok(!h.calls.includes('synchronize'));
});
test('pending receipt blocks legacy FinishShop and pantry deduction until recovery', async () => {
  const h = harness();h.setPending({receiptId: 'pending'});assert.equal(h.host.allowLegacyTransfer(), false);assert.equal(h.host.requiresPantryReview(), true);
  await h.host.recoverReceipt({retry: true});assert.ok(h.calls.includes('retry'));assert.equal(h.host.hasPendingConfirmation(), false);
});
test('an interrupted local projection journal also blocks legacy transfers', () => {
  const h = harness();h.store.setItem('basketboss_receipt_inventory_journal_v1:' + actorA, '{}');assert.equal(h.host.hasPendingConfirmation(), true);assert.equal(h.host.allowLegacyTransfer(), false);assert.equal(h.host.confirmLocalPantryReview().ok, false);
});
test('downgraded users can confirm local pantry without claiming cloud sync or clearing pending receipts', async () => {
  const cached = {scope: {kind: 'user', id: actorA}, inventoryRevision: 2, lastReceiptId: 'r1', pantryReview: {required: true, shopSessionId: 'shop-old'}};
  const h = harness({cached, status: {ok: true, available: false, premium: false}});
  h.store.setItem(keys.confirmed, JSON.stringify({version: 1, confirmedAt: '2026-10-31T12:00:00Z', items: [{name: 'rice', qty: 100, unit: 'g'}]}));
  assert.equal(h.host.requiresPantryReview(), true);assert.equal(h.host.confirmLocalPantryReview().ok, true);assert.equal(h.host.requiresPantryReview(), false);assert.equal(cached.pantryReview.required, true);assert.ok(!h.calls.some(x => typeof x === 'object'));
  h.setContext({shopSessionId: 'shop-next'});assert.equal(h.host.requiresPantryReview(), false);
  h.setCached({...cached, inventoryRevision: 3});assert.equal(h.host.requiresPantryReview(), true);
  h.setPending({receiptId: 'unresolved'});assert.equal(h.host.requiresPantryReview(), true);assert.equal(h.host.confirmLocalPantryReview().ok, false);
});
test('a new shopping session carries measured pantry forward and bounds legacy coverage by actor/scope', () => {
  const scope = {kind: 'user', id: actorA};const h = harness({cached: {scope, inventoryRevision: 3, lastReceiptId: 'r1', pantryReview: {required: false, shopSessionId: 'shop-current'}}});
  const marker = {receiptPantryConfirmedActor: actorA, receiptPantryConfirmedScope: 'user:' + actorA, receiptPantryConfirmedRevision: 3, receiptPantryConfirmedShopSessionId: 'shop-current'};
  assert.equal(h.host.requiresPantryReview(), false);assert.equal(h.host.coversLegacyCredit(marker), true);assert.equal(h.host.coversLegacyCredit({...marker, receiptPantryConfirmedActor: actorB}), false);
  h.setContext({shopSessionId: 'shop-next'});assert.equal(h.host.requiresPantryReview(), false);assert.equal(h.host.coversLegacyCredit(marker), false);
});

function pantryHarness({scope = {kind: 'user', id: actorA}, revision = 2} = {}) {
  const data = {ok: true, initialized: true, scope, inventoryRevision: revision, stock: {'rice|g': 400}};
  const h = harness({stock: {'rice|g': 300}, document: true, fetch: async () => ({ok: true, json: async () => data})});
  h.store.setItem(keys.owner, JSON.stringify({actorId: actorA, scope: {kind: 'user', id: actorA}}));
  return {...h, data};
}
test('cancelling Pantry review performs no cloud write and retains quantities', async () => {
  const h = pantryHarness(), dialog = await h.host.reviewPantry();
  assert.equal(h.host.allowLegacyTransfer(), false);
  descendants(dialog).find(x => x.textContent === 'Review later').onclick();
  assert.equal(h.calls.length, 0);assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 300);assert.equal(h.host.allowLegacyTransfer(), true);
});
test('stale Pantry revision retains local values and offers a fresh review', async () => {
  const h = pantryHarness();h.inventory.confirmPantry = async () => {const error = Error('conflict');error.status = 409;throw error;};
  const dialog = await h.host.reviewPantry(), form = descendants(dialog).find(x => x.tagName === 'FORM');
  await form.events.submit({preventDefault() {}});
  assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 300);assert.ok(descendants(dialog).some(x => /changed on another device/.test(x.textContent)));assert.equal(descendants(dialog).find(x => x.type === 'submit').disabled, false);
});
test('explicit changed-scope review replaces full stock without summing cloud/device and marks reviewed legacy credit', async () => {
  const scope = {kind: 'household', id: 'household-reviewed'};const h = pantryHarness({scope});
  h.store.setItem(keys.ledger, JSON.stringify({'shop-current|rice|g': {week: 'shop-current', credited: 100}}));
  h.inventory.confirmPantry = async value => {
    assert.equal(JSON.parse(h.store.getItem(keys.owner)).scope.kind, 'user');assert.equal(value.stock['rice|g'], 400);assert.equal(value.expectedRevision, 2);assert.equal(value.expectedScope.id, scope.id);
    h.store.setItem(keys.stock, JSON.stringify(value.stock));h.store.setItem(keys.owner, JSON.stringify({actorId: actorA, scope}));h.setCached({scope, inventoryRevision: 3, lastReceiptId: 'r', pantryReview: {required: false, shopSessionId: 'shop-current'}});
    return {localApplied: true, projection: {stock: value.stock}};
  };
  const dialog = await h.host.reviewPantry();await descendants(dialog).find(x => x.tagName === 'FORM').events.submit({preventDefault() {}});
  assert.equal(JSON.parse(h.store.getItem(keys.stock))['rice|g'], 400);const receipt = JSON.parse(h.store.getItem(keys.ledger))['shop-current|rice|g'];assert.equal(h.host.coversLegacyCredit(receipt), true);assert.equal(h.host.requiresPantryReview(), false);
});
test('account change closes a Pantry dialog before exposing another account’s amounts', async () => {
  const h = pantryHarness(), dialog = await h.host.reviewPantry();assert.ok(h.body.children.includes(dialog));h.setActor(actorB);h.event('basketboss:session-changed');assert.ok(!h.body.children.includes(dialog));
});


test('deletion prevents receipt actor isolation from archiving deleted pantry into a guest account', () => {
  const h = harness({stock: {'rice|g': 100}});
  h.event('basketboss:account-deletion-started');h.store.values.clear();h.setActor('guest');
  h.event('basketboss:session-changed');h.host.switchActor();h.host.afterRender();
  assert.equal(h.store.values.size, 0);assert.equal(h.host.allowLegacyTransfer(), false);
  assert.equal(h.host.confirmLocalPantryReview().ok, false);
});

test('deletion invalidates a late receipt availability response and never starts projection sync', async () => {
  let release;
  const waiting = new Promise(resolve => {release = resolve;});
  const h = harness({fetch: async () => {await waiting;return {ok: true, json: async () => ({available: true, premium: true})};}});
  const pending = h.host.refreshAvailability();
  h.event('basketboss:account-deletion-started');release();await pending;
  assert.equal(h.host.getAvailability().available, false);assert.equal(h.calls.includes('synchronize'), false);
});

test('late Pantry confirmation cannot update receipt coverage after deletion starts or is cancelled', async () => {
  let release, began;
  const waiting = new Promise(resolve => {release = resolve;});
  const started = new Promise(resolve => {began = resolve;});
  const h = harness({stock: {'rice|g': 100}, cached: {scope: {kind: 'user', id: actorA}, inventoryRevision: 1}});
  h.inventory.confirmPantry = async () => {began();await waiting;return {ok: true, committed: true, localApplied: true, projection: {stock: {'rice|g': 500}}};};
  let projected = 0;h.options.onProjection = () => {projected++;};
  const pending = h.host.confirmCurrentPantry({stock: {'rice|g': 100}});await started;
  const before = [...h.store.values];h.event('basketboss:account-deletion-started');h.event('basketboss:account-deletion-cancelled');
  const afterCancellation = projected;release();const result = await pending;
  assert.equal(result.ok, false);assert.equal(projected, afterCancellation);
  assert.deepEqual([...h.store.values], before);
});

test('verified receipt stock can be consumed while its next-shop review remains required', async () => {
  const cached = {initialized: true, scope: {kind: 'user', id: actorA}, inventoryRevision: 2, pantryReview: {required: true}};
  const h = harness({cached});
  await h.host.refreshAvailability({synchronize: false});
  assert.equal(h.host.requiresPantryReview(), true);
  assert.equal(h.host.canConsumePantry(), true, 'routine shopping review does not block confirmed cooking');
  h.setCached({...cached, initialized: false});assert.equal(h.host.canConsumePantry(), false, 'uninitialized stock still needs review');
  h.setCached(cached);h.setPending({receiptId: 'unresolved'});assert.equal(h.host.canConsumePantry(), false);
  h.setPending({});h.store.setItem('basketboss_receipt_inventory_journal_v1:' + actorA, '{}');assert.equal(h.host.canConsumePantry(), false);
  h.store.removeItem('basketboss_receipt_inventory_journal_v1:' + actorA);
  h.setCached({...cached, scope: {kind: 'user', id: actorB}});assert.equal(h.host.canConsumePantry(), false, 'another account projection never authorizes stock consumption');
  h.setCached(cached);h.event('basketboss:account-deletion-started');assert.equal(h.host.canConsumePantry(), false);
});

test('local and Free pantry consumption does not depend on receipt service activation', async () => {
  const local = harness({actor: 'guest', stock: {'rice|g': 500}});
  assert.equal(local.host.canConsumePantry(), true);
  const cached = {initialized: false, scope: {kind: 'user', id: actorA}, inventoryRevision: 0, pantryReview: {required: true}};
  const free = harness({cached, stock: {'rice|g': 500}, status: {ok: true, available: false, premium: false}});
  await free.host.refreshAvailability({synchronize: false});
  assert.equal(free.host.canConsumePantry(), true, 'manual compatible stock remains consumable without online receipt access');
  free.setPending({receiptId: 'unresolved'});assert.equal(free.host.canConsumePantry(), false);
});

test('cook sync preserves next-shop review until an explicit pantry confirmation', async () => {
  let revision = 2;
  const scope = {kind: 'user', id: actorA};
  const cached = {initialized: true, scope, inventoryRevision: revision, pantryReview: {required: true}};
  const h = harness({cached});let checks = 0;
  h.inventory.confirmPantry = async value => {
    checks++;
    if (checks === 1) assert.equal(JSON.parse(h.store.getItem(keys.confirmed)).receiptCookReview.required, true, 'review intent must be durable before cloud confirmation');
    h.setCached({initialized: true, scope, inventoryRevision: ++revision, pantryReview: {required: false}});
    return {ok: true, committed: true, localApplied: true, projection: {stock: value.stock}};
  };
  const cooked = await h.host.confirmCookedPantry({stock: {'rice|g': 700}});
  assert.equal(cooked.ok, true);assert.equal(cooked.weeklyReviewRequired, true);
  assert.equal(h.host.requiresPantryReview(), true);assert.equal(h.host.canConsumePantry(), true);
  assert.equal(JSON.parse(h.store.getItem(keys.confirmed)).receiptCookReview.scope, 'user:' + actorA);
  const reviewed = await h.host.confirmCurrentPantry({stock: {'rice|g': 700}});
  assert.equal(reviewed.ok, true);assert.equal(h.host.requiresPantryReview(), false);
  assert.equal(JSON.parse(h.store.getItem(keys.confirmed)).receiptCookReview, undefined);
  assert.equal(h.store.getItem(keys.confirmed).includes('synthetic-token'), false);
});

test('merge conflicts and failed cooking sync cannot authorize later consumption', async () => {
  const cached = {initialized: true, scope: {kind: 'user', id: actorA}, inventoryRevision: 2, pantryReview: {required: true}};
  const h = harness({cached});
  h.inventory.confirmPantry = async () => {const error = Error('revision conflict');error.status = 409;throw error;};
  const failed = await h.host.confirmCookedPantry({stock: {'rice|g': 700}});
  assert.equal(failed.ok, false);assert.equal(failed.conflict, true);
  assert.equal(h.host.requiresPantryReview(), true);assert.equal(h.host.canConsumePantry(), false);
  const merge = harness({cached});merge.inventory.synchronize = async () => ({ok: false, localApplied: false, localError: 'receipt_initial_pantry_merge_required'});
  await merge.host.refreshAvailability({force: true});assert.equal(merge.host.canConsumePantry(), false);
});

test('explicit offline pantry review clears a preserved cooking review without changing cloud stock', async () => {
  const cached = {initialized: true, scope: {kind: 'user', id: actorA}, inventoryRevision: 2, pantryReview: {required: false}};
  const h = harness({cached, status: {ok: true, available: false, premium: false}});
  h.store.setItem(keys.confirmed, JSON.stringify({version: 1, confirmedAt: '2026-10-31T12:00:00Z', items: [], receiptCookReview: {required: true, actorId: actorA, scope: 'user:' + actorA}}));
  assert.equal(h.host.requiresPantryReview(), true);
  assert.equal(h.host.confirmLocalPantryReview().ok, true);
  assert.equal(h.host.requiresPantryReview(), false);
  assert.equal(JSON.parse(h.store.getItem(keys.confirmed)).receiptCookReview, undefined);
  assert.equal(h.calls.some(value => typeof value === 'object'), false);
});

test('offline cook sync preserves the weekly review even when a recent manual acknowledgement exists', async () => {
  const cached = {initialized: true, scope: {kind: 'user', id: actorA}, inventoryRevision: 2, pantryReview: {required: true}};
  const h = harness({cached, status: {ok: true, available: false, premium: false}});
  h.store.setItem(keys.confirmed, JSON.stringify({version: 1, confirmedAt: '2026-10-31T12:00:00Z', items: []}));
  const result = await h.host.confirmCookedPantry({stock: {'rice|g': 700}});
  assert.equal(result.ok, true);assert.equal(result.localOnly, true);assert.equal(result.weeklyReviewRequired, true);
  assert.equal(h.host.requiresPantryReview(), true);assert.equal(h.host.canConsumePantry(), true);
  assert.equal(JSON.parse(h.store.getItem(keys.confirmed)).receiptLocalReview, undefined, 'cooking is not a new pantry-review acknowledgement');
});

test('weekly pantry review accepts partial physical items and packs without rounding the balance', async () => {
 const h=pantryHarness();h.data.stock={'egg|each':8.666667,'rice|pack':.5};
 h.store.setItem(keys.stock,JSON.stringify(h.data.stock));
 const dialog=await h.host.reviewPantry(),inputs=descendants(dialog).filter(x=>x.tagName==='INPUT');
 assert.equal(inputs.length,2);assert.ok(inputs.every(input=>input.step==='any'));
 await descendants(dialog).find(x=>x.tagName==='FORM').events.submit({preventDefault(){}});
 const call=h.calls.find(x=>typeof x==='object');assert.deepEqual(JSON.parse(JSON.stringify(call.stock)),h.data.stock);
 assert.deepEqual(JSON.parse(h.store.getItem(keys.stock)),h.data.stock);
});
