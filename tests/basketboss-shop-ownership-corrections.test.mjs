import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const ownership = createRequire(import.meta.url)('../bb-shop-ownership.js');
const copy = value => JSON.parse(JSON.stringify(value));

test('undoing a manual purchase preserves unrelated manual requests and completed meals', () => {
  const rice = {name: 'Rice', quantity: 4, unit: 'g', pending: true};
  const before = {home: {version: 1, byActor: {user: {manualBuys: {rice}, manualRequests: {first: 'rice-4'}, cooked: {}}}}};
  const after = copy(before);after.home.byActor.user.manualBuys.rice.pending = false;
  const changes = ownership.capture(before, after, ['home']), current = copy(after);
  current.home.byActor.user.manualBuys.milk = {name: 'Milk', quantity: 500, unit: 'ml', pending: true};
  current.home.byActor.user.manualRequests.second = 'milk-500';current.home.byActor.user.cooked.dinner = {at: 123};
  const restored = ownership.rewind(current, changes).home.byActor.user;
  assert.deepEqual(restored.manualBuys.rice, rice);assert.deepEqual(restored.manualBuys.milk, current.home.byActor.user.manualBuys.milk);
  assert.equal(restored.manualRequests.second, 'milk-500');assert.deepEqual(restored.cooked.dinner, {at: 123});
  current.home.byActor.user.manualBuys.rice.unit = 'kg';
  assert.throws(() => ownership.rewind(current, changes), /used or changed/);
});

test('undoing one household purchase preserves other essential edits and identities', () => {
  const before = {features: {version: 1, essentials: [{id: 'soap', unit: 'each', ownedQty: 1}, {id: 'cleaner', unit: 'ml', ownedQty: 100}]}};
  const after = copy(before);after.features.essentials[0].ownedQty = 3;
  const changes = ownership.capture(before, after, ['features']), current = copy(after);
  current.features.essentials[1].ownedQty = 500;current.features.essentials.push({id: 'paper', unit: 'each', ownedQty: 2});
  const restored = ownership.rewind(current, changes).features.essentials;
  assert.equal(restored.find(row => row.id === 'soap').ownedQty, 1);
  assert.equal(restored.find(row => row.id === 'cleaner').ownedQty, 500);assert.equal(restored.find(row => row.id === 'paper').ownedQty, 2);
  current.features.essentials[0].ownedQty = 2;
  assert.throws(() => ownership.rewind(current, changes), /used or changed/);
});

test('undoing a newly created household row preserves household rows added later', () => {
  const before = {features: {version: 1, essentials: []}}, soap = {id: 'soap', unit: 'each', ownedQty: 2};
  const after = {features: {version: 1, essentials: [soap]}}, changes = ownership.capture(before, after, ['features']);
  const paper = {id: 'paper', unit: 'each', ownedQty: 1};
  assert.deepEqual(ownership.rewind({features: {version: 1, essentials: [paper, soap]}}, changes).features.essentials, [paper]);
});

test('an off-plan household purchase retains its durable essential id in the checked anchor', () => {
  const id = 'ess:manual-household:bought:soap|each';
  const session = {id: 'shop-1', purchases: {[id]: {actualQty: 2}}, shelfEdits: {[id]: {kind: 'shop-owned-v1', amount: 2, essential: true, anchor: {name: 'Soap', unit: 'each', required: 2, qty: 2}}}};
  const rows = ownership.anchor([], session, {essential: true, idFor: row => 'ess:' + row.id});
  assert.equal(rows[0].id, id.slice(4));assert.equal('ess:' + rows[0].id, id);
});

test('increasing a household target exposes only the additional quantity still needed', () => {
  const id = 'ess:cleaner', original = {id: 'cleaner', name: 'Cleaner', unit: 'ml', targetQty: 1000, ownedQty: 625, qty: 375};
  const session = {id: 'shop-1', purchases: {[id]: {actualQty: 500}}, shelfEdits: {[id]: {kind: 'shop-owned-v1', amount: 500, essential: true, anchor: original}}};
  const rows = ownership.anchor([{...original, targetQty: 1200, ownedQty: 1125, qty: 75}], session, {essential: true, idFor: row => 'ess:' + row.id});
  assert.equal(rows[0].qty, 575);assert.equal(rows[0].targetQty, 1200);assert.equal(rows[0].ownedQty, 625);
  assert.equal(rows[0].qty - session.purchases[id].actualQty, 75);
});
