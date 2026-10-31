import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {receiptCanonicalPairs} from '../bb-server-lib/bb-receipt-canonical-pairs.js';

test('receipt dictionary exactly matches all public catalogue ingredient/unit keys', async () => {
  const catalog = JSON.parse(await readFile(new URL('../ingredient-pack-catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(receiptCanonicalPairs, Object.keys(catalog.ingredients).sort());
  assert.equal(receiptCanonicalPairs.length, 780);
  assert.equal(new Set(receiptCanonicalPairs).size, receiptCanonicalPairs.length);
  assert.equal(Object.isFrozen(receiptCanonicalPairs), true);
  assert.ok(receiptCanonicalPairs.every(pair => typeof pair === 'string' && pair.split('|').length === 2 && pair.split('|').every(Boolean)));
});

test('server receipt modules use the compatible dictionary without JSON import attributes', async () => {
  for (const name of ['functions/api/receipt-inventory.js', 'functions/api/bb173/[action].js']) {
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    assert.match(source, /import \{receiptCanonicalPairs\} from /);
    assert.doesNotMatch(source, /import .*\.json['"]\s+(?:with|assert)\s*\{/);
  }
});
