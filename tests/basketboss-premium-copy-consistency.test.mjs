/* Marketing acceptance checks: no unsupported Free features, no implied AI guarantee. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');

test('Premium introduction describes server-gated private recipes, not a static 321 bundle',async()=>{
  const copy=await read('bb-premium-features.js');
  assert.doesNotMatch(copy,/full 321-recipe static bundle/i);
  assert.match(copy,/221[\s\S]{0,120}server-verified/i);
  assert.match(copy,/AI tools.*service availability/i);
});

test('Pricing does not sell Free Leftover Magic and identifies 3-day Standard trial',async()=>{
  const pricing=await read('pricing-sandbox.html');
  assert.doesNotMatch(pricing,/Free: 100 recipes, a starter selection of Leftover Magic/i);
  assert.match(pricing,/3-day free trial/i);
  assert.match(pricing,/AI tools.*subject to availability/i);
});
