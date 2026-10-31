import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const index = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('bb-shop-cook-clarity.css', 'utf8');
const onboarding = fs.readFileSync('bb-onboarding-v2.js', 'utf8');
const legacy = fs.readFileSync('bb-cold-preview.js', 'utf8');

test('original app styles and versioned onboarding scripts remain linked once', () => {
  const assets=[...index.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)]
    .map(match=>new URL(match[1],'https://basketboss.co.uk/'));
  for(const file of ['bb-shop-cook-clarity.css','bb-onboarding-v2.js','bb-plan-premium-polish.js']){
    const matches=assets.filter(url=>url.pathname==='/'+file);
    assert.equal(matches.length,1,`${file} must be linked once`);
    assert.ok(matches[0].searchParams.get('v'),`${file} must retain its cache-busting version`);
    assert.ok(fs.existsSync(file),`${file} must exist`);
  }
});
test('retire duplicate marketing panel without removing it or its legacy handlers', () => {
  assert.match(index, /id="bbColdVisitor"/);
  assert.match(legacy, /panel\.hidden=validSession\(\)/);
  assert.match(css, /#bbColdVisitor\s*\{\s*display:none\s*!important;/);
});
test('onboarding Shop keeps real read-only ingredient rows, quantities and item estimates', () => {
  for (const name of ['bbob-real-shop','bbob-shop-item','bbob-shop-item-name','bbob-shop-price','bbob-shop-total']) {
    assert.match(onboarding, new RegExp(name));
    assert.match(css, new RegExp(name));
  }
  assert.match(onboarding, /Mixed peppers/);
  assert.match(onboarding, /Chicken breast/);
  assert.match(onboarding, /22\.60/);
  assert.match(css, /grid-template-columns:\s*24px minmax\(0,1fr\) max-content/);
});
test('Cook modal keeps original step, ingredient and timer handlers', () => {
  for (const token of [
    'id="bbBody"', 'id="bbExit"', 'id="bbTimerToggle"',
    'id="bbMinus"', 'id="bbPlus"', 'id="bbReset"', 'id="bbNext"',
    'id="bbStart"', 'data-prep=', 'data-tool='
  ]) assert.ok(index.includes(token), `Expected original Cook anchor: ${token}`);
  assert.match(index,/function\s+openCook\s*\([^)]*\)\s*\{/);
  assert.match(css, /#modalRoot\s*>\s*\.cook-overlay\s+\.bb-kitchen/);
  assert.match(css, /\.bb-clock\s*>\s*div:last-child\s*>\s*button/);
});
test('pricing, app persistence and regions remain owned by the existing app', () => {
  for (const token of ['function persist()', 'bb307SwitchIsland', 'bb172SaveBudget',
      'bb81ProUpgradePreview', 'id="bb307Island"', 'id="bb307SaveMarket"']) {
    assert.ok(index.includes(token), `Original app anchor missing: ${token}`);
  }
  assert.doesNotMatch(css, /fetch\(|localStorage|Paddle\.Checkout|innerHTML|addEventListener/);
});
