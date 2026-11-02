import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {proposal} = createRequire(import.meta.url)('../bb-pantry-deduction.js');

test('Cook converts compatible metric stock and requirements into one measured balance', () => {
  const stock = {'rice|kg': .5, 'rice|g': 300, 'milk|l': 1};
  const ingredients = [{key: 'Rice', unit: 'kg', required: .6}, {key: 'Milk', unit: 'ml', required: 250}];
  const before = JSON.stringify({stock, ingredients});
  const result = proposal({stock, ingredients});
  assert.deepEqual(result.remainingStock, {'rice|g': 200, 'milk|ml': 750});
  assert.equal(result.rows[0].deduct, 600);
  assert.equal(result.rows[1].deduct, 250);
  assert.deepEqual(result.issues, []);
  assert.equal(JSON.stringify({stock, ingredients}), before, 'preview does not mutate source stock or the recipe');
});

test('duplicate recipe lines aggregate before deduction and cannot spend the same stock twice', () => {
  const result = proposal({stock: {'rice|g': 1000}, ingredients: [
    {key: 'Rice', unit: 'g', required: 200}, {key: 'rice', unit: 'kg', required: .3}
  ]});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].required, 500);
  assert.deepEqual(result.remainingStock, {'rice|g': 500});
});

test('used quantities floor at zero and exhausted ingredients leave active stock', () => {
  const result = proposal({stock: {'rice|g': 100}, ingredients: [
    {key: 'rice', unit: 'g', required: 600}, {key: 'salt', unit: 'g', required: 1}
  ]});
  assert.deepEqual(result.remainingStock, {});
  assert.equal(result.rows[0].deduct, 100);
  assert.equal(result.rows[0].remaining, 0);
  assert.equal(result.rows[1].deduct, 0);
  assert.deepEqual(result.used, [{id: 'rice|g', key: 'rice', unit: 'g', required: 100}]);
});

test('unknown amounts or units remain visible for review without silently consuming stock', () => {
  const result = proposal({stock: {'salt|g': 100, 'pepper|g': 50}, ingredients: [
    {name: 'Salt', unit: 'g', required: null}, {name: 'Pepper', unit: 'pinch', required: 1}
  ]});
  assert.deepEqual(result.remainingStock, {'salt|g': 100, 'pepper|g': 50});
  assert.deepEqual(result.rows.map(row => row.issue), ['amount_unknown', 'unit_unknown']);
  assert.equal(result.issues.length, 2);
  assert.ok(result.issues.every(row => row.message.includes('review')));
  assert.deepEqual(result.used, []);
});

test('garlic bulbs never become cloves and count stock never becomes grams', () => {
  const result = proposal({stock: {'garlic|bulb': 2, 'onion|each': 3}, ingredients: [
    {key: 'garlic', unit: 'clove', required: 4}, {key: 'onion', unit: 'g', required: 200}
  ]});
  assert.deepEqual(result.remainingStock, {'garlic|bulb': 2, 'onion|each': 3});
  assert.ok(result.rows.every(row => !row.canDeduct && row.issue === 'unit_mismatch' && row.deduct === 0));
  assert.match(result.rows[0].issueLabel, /bulb/);
});

test('available exact units can be used while additional incompatible stock is flagged', () => {
  const result = proposal({stock: {'garlic|clove': 1, 'garlic|bulb': 2}, ingredients: [{key: 'garlic', unit: 'clove', required: 4}]});
  assert.equal(result.rows[0].deduct, 1);
  assert.equal(result.rows[0].issue, 'unit_mismatch');
  assert.deepEqual(result.remainingStock, {'garlic|bulb': 2});
});

test('reviewed metric edits apply the amount actually used and zero means skip', () => {
  const ingredients = [{key: 'rice', unit: 'g', required: 500}, {key: 'milk', unit: 'ml', required: 250}];
  const result = proposal({stock: {'rice|g': 1000, 'milk|ml': 500}, ingredients, amounts: [
    {id: 'rice|g', quantity: .35, unit: 'kg'}, {id: 'milk|ml', quantity: 0, unit: 'ml'}
  ]});
  assert.deepEqual(result.remainingStock, {'rice|g': 650, 'milk|ml': 500});
  assert.equal(result.rows[0].required, 500, 'recipe amount stays available alongside the reviewed deduction');
  assert.equal(result.rows[0].deduct, 350);
});

test('invalid or incompatible review edits fail before changing any balance', () => {
  const input = {stock: {'rice|g': 1000}, ingredients: [{key: 'rice', unit: 'g', required: 500}]};
  for (const amounts of [
    [{id: 'rice|g', quantity: 2, unit: 'each'}],
    [{id: 'rice|g', quantity: -1, unit: 'g'}],
    [{id: 'other|g', quantity: 20, unit: 'g'}],
    [{id: 'rice|g', quantity: 10, unit: 'g'}, {id: 'rice|g', quantity: 20, unit: 'g'}]
  ]) assert.throws(() => proposal({...input, amounts}), /Review|compatible/);
  assert.deepEqual(input.stock, {'rice|g': 1000});
});

test('corrupt stock and overflowing metric quantities stop deduction for explicit review', () => {
  for (const stock of [{'rice|g': -1}, {'rice|g': '100'}, {'rice|g': Infinity}, {'rice|kg': 1001}, {'broken-key': 200}]) {
    assert.throws(() => proposal({stock, ingredients: [{key: 'rice', unit: 'g', required: 100}]}), /Review|Check/);
  }
  assert.throws(() => proposal({stock: {}, ingredients: [{key: 'rice', unit: 'kg', required: 1001}]}), /Check/);
});
