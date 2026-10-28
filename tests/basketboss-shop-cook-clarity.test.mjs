import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const index = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('bb-shop-cook-clarity.css', 'utf8');
const onboarding = fs.readFileSync('bb-onboarding-v2.js', 'utf8');
const legacy = fs.readFileSync('bb-cold-preview.js', 'utf8');

test('fix is last linked CSS layer and the original scripts remain', () => {
  assert.match(index, /bb-shop-cook-clarity\.css\?v=20261028-r1/);
  assert.equal((index.match(/bb-shop-cook-clarity\.css\?v=20261028-r1/g) || []).length, 1);
  assert.match(index, /bb-onboarding-v2\.js\?v=20261028-onboard-v5/);
  assert.match(index, /bb-plan-premium-polish\.js\?v=20261028-plan-convert-1/);
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
    'function openCook(id)', 'id="bbBody"', 'id="bbExit"', 'id="bbTimerToggle"',
    'id="bbMinus"', 'id="bbPlus"', 'id="bbReset"', 'id="bbNext"',
    'id="bbStart"', 'data-prep=', 'data-tool='
  ]) assert.ok(index.includes(token), `Expected original Cook anchor: ${token}`);
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
