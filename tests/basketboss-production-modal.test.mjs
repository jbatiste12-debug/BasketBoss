import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');
test('production modal is customer-facing, scroll safe, and checkout gated',async()=>{
  const [modal,css,terms,pricing,checkout,index]=await Promise.all([
    read('bb-premium-features.js'),read('bb-premium-features.css'),read('bb174-trial-ux.js'),
    read('pricing-sandbox.html'),read('paddle-sandbox.js'),read('index.html')]);
  for(const s of ['More magic, less waste.','Includes 321 recipes, Smart Auto-Fill, 1-Tap Batch Cooking',
    '7-day free trial · First 25 confirmed members only','3-day free trial · Cancel anytime',
    'Cancel anytime before your trial ends']) assert.ok(modal.includes(s),s);
  for(const s of ['SANDBOX PREVIEW','Preview only:','must be verified before launch',
    'once configured']) assert.ok(!modal.includes(s),s);
  assert.match(css,/#bb173TierDialog\[open\].*display:flex/);
  assert.match(css,/#bb173TierDialog \.bb173-tier-body.*overflow-y:auto/);
  assert.ok(modal.includes("config.mode==='live'"));
  assert.ok(checkout.includes("config.mode!=='live'"));
  assert.ok(pricing.includes('Cancellations &amp; refunds'));
  assert.ok(pricing.includes('privacy.html'));
  assert.ok(pricing.includes('terms.html'));
  assert.ok(terms.includes('first 25 confirmed eligible members'));
  assert.ok(index.includes('bb-myweek-etched-watermark-20261027'));
  assert.ok(index.includes("bind('bbFeaturedAddWeek',()=>{if(r)bb80PromptAddRecipe(r.id);});"));
});
