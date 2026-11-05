import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { COOK_AUTHOR_SOURCE, COOK_AUTHOR_APPROVAL, COOK_AUTHOR_TARGETS, COOK_AUTHOR_RECIPIENT_FINGERPRINT, COOK_AUTHOR_SEALED_FILE, COOK_AUTHOR_MANIFEST_FILE, buildCookAuthorRecommendations, prepareCookAuthorRecommendations, runCookAuthorRecommendationsCLI } from '../scripts/prepare-cook-author-recommendations.mjs';
import { APPROVED_COOK_AUTHOR_RECOMMENDATIONS, activateCookAuthorRecommendations, buildCookAuthorRecommendationSql, validateCookAuthorTransition, requireCookAuthorEnvironment, validateCookAuthorManifest } from '../scripts/activate-cook-author-recommendations.mjs';
import { recipientForToken, openPayload } from '../scripts/private-catalogue-envelope.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const secret = 'SYNTHETIC_PRIVATE_AUTHOR_RECOMMENDATION_809ca';
const token = 'synthetic-author-recipient-token-with-sufficient-entropy';
const table = 'bb_private_premium_recipes_500_v1';
const select = `SELECT recipe_id,sort_index,recipe_json,normalized_json FROM ${table} ORDER BY sort_index`;
function fixture() {
  const rows = Array.from({ length: 400 }, (_, index) => {
    const id = 'synthetic-premium-' + index;
    const ingredients = [[secret, '50 g', 1.5, 'Other'], ['Existing unknown staple', 'to taste', 0, 'Other']];
    const recipe = { id, name: secret + index, premium: true, accessTier: 'premium', image: 'preserve.webp', servings: 4, mins: 20, cost: 6, ingredients, ingredient_display_lines: ingredients.map(item => `${item[0]} — ${item[1]}`), method: ['Original method ' + secret], steps: ['Original method ' + secret], culinary_prep_notes: ['Original preparation', ''], tip: 'Original tip', metadata: { preserve: [1, 'exact'] }, ci_estimates: { UK: { estimate: 6, currency: 'GBP', per_serving_estimate: 1.5, confidence: 'INDICATIVE_UNVERIFIED', cost_basis: 'Preserved estimate basis', estimate_gbp: 6 } } };
    const normalized = { id, name: recipe.name, servings: 4, ingredients: [{ name: secret, key: 'synthetic', quantity: 50, unit: 'g', price_hint: 1.5, status: 'PARSED_EDITORIAL_UNVERIFIED', recipe_id: id, ingredient_index: 0, quantity_basis: 'EDITORIAL_ASSUMPTION_UNVERIFIED', needs_review: true, audit_quantity_verified: false }, { name: 'Existing unknown staple', key: 'staple', quantity: 0, unit: 'legacy_unknown', price_hint: 0, status: 'REVIEW_REQUIRED', recipe_id: id, ingredient_index: 1 }] };
    return { recipe_id: id, sort_index: index, recipe_json: JSON.stringify(recipe), normalized_json: ' ' + JSON.stringify(normalized) + '\n' };
  });
  const snapshot = { schemaVersion: 1, source: { kind: 'cloudflare-d1-read-only', table, databaseId: '01234567-89ab-cdef-0123-456789abcdef', readAt: '2026-11-05T12:00:00.000Z' }, rowsSha256: sha(JSON.stringify(rows)), rows };
  const targets = COOK_AUTHOR_TARGETS.map((target, i) => ({ index: target.index, idSha256: sha(rows[target.index].recipe_id), ingredientIndexes: [0], ...(i === 1 ? { appendName: 'Cooking oil' } : {}) }));
  const changes = targets.map(target => {
    const row = rows[target.index], recipe = JSON.parse(row.recipe_json), normalized = JSON.parse(row.normalized_json);
    recipe.method = recipe.steps = ['Accepted method ' + secret, "Serve chef's portion when cooked."];
    return { id: row.recipe_id, index: target.index, recipeSha256: sha(row.recipe_json), normalizedSha256: sha(row.normalized_json), recipe, normalized, recommendation: 'Owner accepted this editorial recommendation ' + secret, resolvedFindings: ['Finding ' + secret] };
  });
  const first = changes[0];
  first.recipe.ingredients[0][1] = '100 g';
  first.recipe.ingredient_display_lines[0] = `${secret} — 100 g`;
  first.normalized.ingredients[0].quantity = 100;
  first.normalized.ingredients[0].status = 'PARSED';
  first.normalized.ingredients[0].quantity_basis = 'USER_ACCEPTED_CULINARY_RECOMMENDATION';
  delete first.normalized.ingredients[0].needs_review;
  delete first.normalized.ingredients[0].audit_quantity_verified;
  const recommendations = [0, 1].map(i => ({ sourceRowsSha256: snapshot.rowsSha256, changes: changes.slice(i * 9, i * 9 + 9) }));
  return { snapshot, recommendations, targets };
}
function built(input) {
  const result = buildCookAuthorRecommendations(input);
  result.payload.reviewSourceCommit = 'b'.repeat(40);
  return result;
}
function diskFixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-cook-author-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const publicRoot = path.join(base, 'checkout'), privateRoot = path.join(base, 'private');
  const recommendationsDirectory = path.join(privateRoot, 'recommendations'), outputDirectory = path.join(privateRoot, 'candidate');
  fs.mkdirSync(path.join(publicRoot, '.github/private-catalogue'), { recursive: true });
  fs.mkdirSync(recommendationsDirectory, { recursive: true, mode: 0o700 }); fs.chmodSync(privateRoot, 0o700);
  const input = fixture(), snapshotPath = path.join(privateRoot, 'current-premium.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(input.snapshot), { mode: 0o600 });
  input.recommendations.forEach((review, i) => fs.writeFileSync(path.join(recommendationsDirectory, `private-batch-${i ? 'b' : 'a'}.json`), JSON.stringify(review), { mode: 0o600 }));
  const recipient = recipientForToken(token);
  fs.writeFileSync(path.join(publicRoot, '.github/private-catalogue/catalogue-recipient.json'), JSON.stringify(recipient));
  return { ...input, base, options: { snapshotPath, recommendationsDirectory, outputDirectory, sealedPath: path.join(publicRoot, COOK_AUTHOR_SEALED_FILE), manifestPath: path.join(publicRoot, COOK_AUTHOR_MANIFEST_FILE), publicRoot, expectedSourceRowsSha256: input.snapshot.rowsSha256, expectedRecipientFingerprint: recipient.fingerprint, reviewSourceCommit: 'b'.repeat(40), targets: input.targets } };
}
function sqliteFixture(t, rows) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE ${table} (recipe_id TEXT PRIMARY KEY, sort_index INTEGER UNIQUE, recipe_json TEXT NOT NULL, normalized_json TEXT NOT NULL); CREATE TABLE bb_private_premium_recipes (legacy TEXT); INSERT INTO bb_private_premium_recipes VALUES ('preserve every byte');`);
  const insert = db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?)`);
  for (const row of rows) insert.run(row.recipe_id, row.sort_index, row.recipe_json, row.normalized_json);
  return db;
}
const readRows = db => db.prepare(select).all().map(row => ({ ...row }));
function atomicImport(db, sql) {
  db.exec('BEGIN');
  try { db.exec(sql); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

test('the fixed production policy names exactly 18 hashed identities at approved positions', () => {
  assert.equal(COOK_AUTHOR_TARGETS.length, 18);
  assert.equal(new Set(COOK_AUTHOR_TARGETS.map(x => x.idSha256)).size, 18);
  assert.equal(new Set(COOK_AUTHOR_TARGETS.map(x => x.index)).size, 18);
  assert.equal(COOK_AUTHOR_TARGETS.filter(x => x.appendName).length, 5);
  assert.ok(COOK_AUTHOR_TARGETS.every(x => /^[a-f0-9]{64}$/.test(x.idSha256) && Object.isFrozen(x) && Object.isFrozen(x.ingredientIndexes)));
  assert.throws(() => buildCookAuthorRecommendations({ ...fixture(), targets: undefined }), /target/);
  assert.equal(COOK_AUTHOR_SOURCE.sourceRowsSha256, '1e54c10834b144142fab94b0fca88d12fc904c6ea3da1137d8307b7f5a887eb8');
});

test('accepted recommendations preserve 382 rows byte for byte and all protected recipe metadata', () => {
  const input = fixture(), original = clone(input), { payload, candidateSnapshot, counts } = built(input);
  assert.deepEqual(input, original);
  assert.deepEqual(counts, { catalogue: 400, changed: 18, unchanged: 382, resolvedFindings: 18 });
  assert.deepEqual(payload.approval, { date: '2026-11-05', basis: 'USER_ACCEPTED_EDITORIAL_RECOMMENDATIONS', kitchenTested: false });
  assert.equal(payload.afterRowsSha256, sha(JSON.stringify(payload.rows)));
  assert.equal(candidateSnapshot.rowsSha256, payload.afterRowsSha256);
  const targets = new Set(input.targets.map(x => x.index));
  for (const row of payload.rows) {
    const before = input.snapshot.rows[row.sort_index];
    if (!targets.has(row.sort_index)) assert.deepEqual(row, before);
    const recipe = JSON.parse(row.recipe_json), previous = JSON.parse(before.recipe_json);
    for (const key of ['id', 'name', 'premium', 'accessTier', 'image', 'servings', 'metadata']) assert.deepEqual(recipe[key], previous[key]);
    if (row.sort_index !== input.targets[0].index) assert.equal(row.normalized_json, before.normalized_json);
    assert.deepEqual(JSON.parse(row.normalized_json).ingredients[1], JSON.parse(before.normalized_json).ingredients[1], 'unrelated unknown staple is retained exactly');
  }
  assert.equal(validateCookAuthorTransition(payload, input.snapshot.rows, input).alreadyApplied, false);
  assert.equal(validateCookAuthorTransition(payload, payload.rows, input).alreadyApplied, true);
});

test('coverage, identity and raw source hashes fail closed', () => {
  for (const mutate of [
    x => x.recommendations.pop(),
    x => x.recommendations[0].changes.pop(),
    x => x.recommendations[0].sourceRowsSha256 = '0'.repeat(64),
    x => x.recommendations[0].changes[0].index++,
    x => x.recommendations[0].changes[0].id = 'wrong-identity',
    x => x.recommendations[0].changes[1] = clone(x.recommendations[0].changes[0]),
    x => x.recommendations[0].changes[0].recipeSha256 = '0'.repeat(64),
    x => x.recommendations[0].changes[0].normalizedSha256 = '0'.repeat(64),
    x => x.recommendations[0].changes[0].extra = secret,
    x => x.recommendations[0].changes[0].resolvedFindings = [],
    x => x.recommendations[0].changes[0].resolvedFindings.push('an unapproved extra finding'),
    x => x.recommendations[0].changes[0].recommendation = '',
  ]) { const input = fixture(); mutate(input); assert.throws(() => built(input), /cook_author_recommendations_/); }
});

test('protected fields, unrelated quantities and normalized metadata cannot enter the new variant', () => {
  for (const mutate of [
    c => c.recipe.name = 'changed name',
    c => c.recipe.servings = 9,
    c => c.recipe.premium = false,
    c => c.recipe.image = 'changed.webp',
    c => c.recipe.metadata.preserve[0] = 5,
    c => c.recipe.invented = 'new field',
    c => delete c.recipe.tip,
    c => c.normalized.servings = 9,
    c => c.normalized.invented = 'new field',
    c => c.normalized.ingredients[0].key = 'changed key',
    c => c.normalized.ingredients[0].name = 'changed name',
    c => c.normalized.ingredients[0].recipe_id = 'different-id',
    c => c.normalized.ingredients[0].ingredient_index = 4,
    c => c.normalized.ingredients[0].status = 'KITCHEN_TESTED',
    c => c.normalized.ingredients[0].quantity_basis = 'VERIFIED',
    c => c.normalized.ingredients[0].audit_quantity_verified = true,
    c => c.normalized.ingredients[0].unit_assumption = 'invented assumption',
    c => c.normalized.ingredients[1].quantity = 4,
    c => c.recipe.ingredients[0][0] = 'renamed ingredient',
    c => c.recipe.ingredients[0][3] = 'changed category',
    c => c.recipe.method = ['different from steps'],
    c => c.recipe.culinary_prep_notes[0] = ' ',
    c => c.recipe.ingredient_display_lines[0] = 'inconsistent amount',
  ]) { const input = fixture(); mutate(input.recommendations[0].changes[0]); assert.throws(() => built(input), /cook_author_recommendations_|private_recipe_audit_/); }
});

test('changed amounts and prices must be finite and canonical while existing zero staples survive', () => {
  for (const quantity of [0, -1, NaN, Infinity, '100']) {
    const input = fixture(); input.recommendations[0].changes[0].normalized.ingredients[0].quantity = quantity;
    assert.throws(() => built(input), /quantity/);
  }
  for (const unit of ['packet', 'kg', '', null]) {
    const input = fixture(); input.recommendations[0].changes[0].normalized.ingredients[0].unit = unit;
    assert.throws(() => built(input), /quantity/);
  }
  for (const amount of [-1, NaN, Infinity, '1']) {
    const input = fixture(); input.recommendations[0].changes[0].normalized.ingredients[0].price_hint = amount;
    assert.throws(() => built(input), /price/);
  }
  const free = fixture(); free.recommendations[0].changes[0].normalized.ingredients[0].price_hint = free.recommendations[0].changes[0].recipe.ingredients[0][2] = 0;
  assert.equal(built(free).payload.changes.length, 18, 'leftover/pantry zero price is legitimate');
});

test('changed source quantities must agree with their normalized number and dimension', () => {
  for (const mutate of [
    c => { c.normalized.ingredients[0].quantity = 999; c.normalized.ingredients[0].unit = 'ml'; },
    c => c.normalized.ingredients[0].quantity = 999,
    c => c.normalized.ingredients[0].unit = 'ml',
    c => c.recipe.ingredients[0][1] = '200 g',
    c => c.recipe.ingredients[0][1] = 'an unparseable amount',
    c => c.recipe.ingredients[0][1] = '100 mysteryunits',
    c => c.recipe.ingredients[0][1] = '100 g unknownwords',
    c => c.recipe.ingredients[0][1] = '100 g or 999 ml',
    c => c.recipe.ingredients[0][1] = '100 g; 999 ml',
    c => c.recipe.ingredients[0][1] = '1e2 g',
    c => c.recipe.ingredients[0][1] = '0 tsp (100 g)',
    c => c.recipe.ingredients[0][1] = '1/0 tsp (100 g)',
    c => c.recipe.ingredients[0][1] = '1/4 tsp (100 g) unknownwords',
  ]) {
    const input = fixture(), change = input.recommendations[0].changes[0]; mutate(change);
    change.recipe.ingredient_display_lines[0] = `${change.recipe.ingredients[0][0]} — ${change.recipe.ingredients[0][1]}`;
    assert.throws(() => built(input), /source_quantity_mismatch/);
  }
  for (const [amount, quantity, unit] of [
    ['600 g peeled and deseeded flesh', 600, 'g'],
    ['200 g', 200, 'g'], ['15 g', 15, 'g'], ['20 ml', 20, 'ml'], ['30 ml', 30, 'ml'],
    ['4 large eggs', 4, 'each'], ['160 ml', 160, 'ml'],
    ['1/4 tsp (1.5 g)', 1.5, 'g'],
    ['60 medium wrappers, about 9–10 cm square', 60, 'each'],
    ['60 medium wrappers, about 9-10 cm square', 60, 'count'],
  ]) {
    const input = fixture(), change = input.recommendations[0].changes[0];
    change.recipe.ingredients[0][1] = amount; change.recipe.ingredient_display_lines[0] = `${secret} — ${amount}`;
    change.normalized.ingredients[0].quantity = quantity; change.normalized.ingredients[0].unit = unit;
    assert.equal(built(input).payload.changes.length, 18);
  }
});

test('new or changed source prices match normalized prices while unchanged legacy differences survive', () => {
  for (const mutate of [
    c => { c.recipe.ingredients[0][2] = 10; c.normalized.ingredients[0].price_hint = 99; },
    c => c.recipe.ingredients[0][2] = 10,
    c => c.normalized.ingredients[0].price_hint = 99,
    c => { c.recipe.ingredients[0][2] = 1e308; c.normalized.ingredients[0].price_hint = 9e307; },
  ]) {
    const input = fixture(); mutate(input.recommendations[0].changes[0]); assert.throws(() => built(input), /source_price_mismatch/);
  }
  const floating = fixture(), priceChange = floating.recommendations[0].changes[0];
  priceChange.recipe.ingredients[0][2] = 0.1 + 0.2; priceChange.normalized.ingredients[0].price_hint = 0.3;
  assert.equal(built(floating).payload.changes.length, 18);
  const legacy = fixture(), row = legacy.snapshot.rows[legacy.targets[0].index], before = JSON.parse(row.normalized_json);
  before.ingredients[0].price_hint = 1.25; row.normalized_json = JSON.stringify(before);
  legacy.snapshot.rowsSha256 = sha(JSON.stringify(legacy.snapshot.rows));
  for (const batch of legacy.recommendations) batch.sourceRowsSha256 = legacy.snapshot.rowsSha256;
  const quantityChange = legacy.recommendations[0].changes[0];
  quantityChange.normalizedSha256 = sha(row.normalized_json); quantityChange.normalized.ingredients[0].price_hint = 1.25;
  assert.equal(built(legacy).payload.changes.length, 18, 'quantity-only correction preserves an unchanged legacy tuple/price-hint difference');
});

test('only a precise configured append is allowed and recipe/normalized rows stay aligned', () => {
  const input = fixture(), change = input.recommendations[0].changes[1], i = change.recipe.ingredients.length;
  change.recipe.ingredients.push(['Cooking oil', '10 ml', 0.05, 'Other']);
  change.recipe.ingredient_display_lines.push('Cooking oil — 10 ml'); change.recipe.culinary_prep_notes.push('Measure the oil.');
  change.normalized.ingredients.push({ name: 'Cooking oil', key: 'cooking oil', quantity: 10, unit: 'ml', price_hint: 0.05, status: 'PARSED', quantity_basis: 'USER_ACCEPTED_CULINARY_RECOMMENDATION', recipe_id: change.id, ingredient_index: i });
  assert.equal(built(input).payload.changes.length, 18);
  for (const mutate of [
    x => x.recipe.ingredients[i][0] = 'Unapproved ingredient',
    x => x.normalized.ingredients[i].ingredient_index++,
    x => x.normalized.ingredients[i].quantity = 0,
    x => x.normalized.ingredients[i].quantity = 999,
    x => x.normalized.ingredients[i].unit = 'g',
    x => x.normalized.ingredients[i].price_hint = 99,
    x => x.normalized.ingredients[i].status = 'VERIFIED',
    x => x.normalized.ingredients[i].extra = 'unapproved metadata',
    x => x.normalized.ingredients.pop(),
  ]) { const candidate = clone(input); mutate(candidate.recommendations[0].changes[1]); assert.throws(() => built(candidate)); }
});

test('time and regional cost edits use existing fields and preserve indicative confidence', () => {
  const input = fixture(), change = input.recommendations[0].changes[0];
  change.recipe.mins = 30; change.recipe.cost = 8;
  change.recipe.ci_estimates.UK.estimate = change.recipe.ci_estimates.UK.estimate_gbp = 8;
  change.recipe.ci_estimates.UK.per_serving_estimate = 2;
  assert.equal(built(input).payload.changes.length, 18);
  for (const mutate of [
    c => c.recipe.mins = 0,
    c => c.recipe.time_minutes = 30,
    c => c.recipe.cost = -1,
    c => c.recipe.cost = 10,
    c => c.recipe.ci_estimates.UK.confidence = 'VERIFIED',
    c => c.recipe.ci_estimates.UK.cost_basis = 'changed unsupported basis',
    c => c.recipe.ci_estimates.UK.per_serving_estimate = 1,
    c => c.recipe.ci_estimates.UK.estimate_gbp = 100,
    c => c.recipe.ci_estimates.FR = clone(c.recipe.ci_estimates.UK),
  ]) { const candidate = clone(input); mutate(candidate.recommendations[0].changes[0]); assert.throws(() => built(candidate)); }
});

test('offline preparation writes only encrypted content and hashes into the checkout', t => {
  const input = diskFixture(t), summary = prepareCookAuthorRecommendations(input.options);
  assert.equal(summary.counts.changed, 18); assert.deepEqual(summary.approval, COOK_AUTHOR_APPROVAL);
  const publicFiles = [input.options.manifestPath, input.options.sealedPath];
  for (const file of publicFiles) { assert.ok(!fs.readFileSync(file, 'utf8').includes(secret)); assert.equal(fs.statSync(file).mode & 0o777, 0o600); }
  for (const file of ['candidate-premium.json', 'cook-author-recommendations.json']) assert.equal(fs.statSync(path.join(input.options.outputDirectory, file)).mode & 0o777, 0o600);
  const payload = JSON.parse(openPayload(JSON.parse(fs.readFileSync(input.options.sealedPath)), token));
  assert.equal(payload.changes.length, 18); assert.ok(payload.changes[0].recommendation.includes(secret));
  assert.equal(sha(Buffer.from(JSON.stringify(payload) + '\n')), summary.payloadSha256);
  assert.throws(() => prepareCookAuthorRecommendations(input.options), /output_exists/);
});

test('private permissions, source pins and fixed destinations reject unsafe preparation', t => {
  for (const mutate of [
    x => fs.chmodSync(x.options.snapshotPath, 0o644),
    x => fs.chmodSync(x.options.recommendationsDirectory, 0o755),
    x => fs.chmodSync(path.join(x.options.recommendationsDirectory, 'private-batch-b.json'), 0o644),
    x => x.options.outputDirectory = path.join(x.options.publicRoot, 'plaintext'),
    x => x.options.sealedPath = path.join(x.base, 'wrong.sealed.json'),
    x => x.options.expectedSourceRowsSha256 = '0'.repeat(64),
    x => x.options.expectedRecipientFingerprint = '0'.repeat(64),
    x => x.options.reviewSourceCommit = 'bad',
    x => { const address = path.join(x.base, 'linked'); fs.symlinkSync(x.options.recommendationsDirectory, address); x.options.recommendationsDirectory = address; },
  ]) { const input = diskFixture(t); mutate(input); assert.throws(() => prepareCookAuthorRecommendations(input.options)); }
  const input = diskFixture(t), stdout = [], stderr = [];
  assert.equal(runCookAuthorRecommendationsCLI(['--expected-source-hash', secret], { log: x => stdout.push(x), error: x => stderr.push(x) }), 1);
  assert.deepEqual(stdout, []); assert.deepEqual(stderr, ['cook_author_recommendations_arguments']);
});

test('transition validation rejects stale rows and self-consistent unauthorized payload edits', () => {
  const input = fixture(), { payload } = built(input);
  for (const mutate of [rows => rows[399].normalized_json += ' ', rows => rows[0].recipe_json += ' ', rows => rows.pop(), rows => rows[5].sort_index = 450]) {
    const stale = clone(input.snapshot.rows); mutate(stale); assert.throws(() => validateCookAuthorTransition(payload, stale, input));
  }
  for (const mutate of [
    p => { const r = JSON.parse(p.rows[25].recipe_json); r.servings = 10; p.rows[25].recipe_json = JSON.stringify(r); p.changes[0].newRecipeSha256 = sha(p.rows[25].recipe_json); },
    p => p.rows[399].recipe_json += ' ',
    p => p.rows[399].normalized_json += ' ',
    p => p.changes[0].originalNormalizedSha256 = '0'.repeat(64),
    p => p.approval.kitchenTested = true,
  ]) { const candidate = clone(payload); mutate(candidate); candidate.afterRowsSha256 = sha(JSON.stringify(candidate.rows)); assert.throws(() => validateCookAuthorTransition(candidate, input.snapshot.rows, input)); }
});

test('atomic D1 SQL changes only the 18 targets and verifies every before/after row', t => {
  const input = fixture(), { payload } = built(input), db = sqliteFixture(t, input.snapshot.rows);
  const sql = buildCookAuthorRecommendationSql(payload, input.snapshot.rows, input);
  assert.equal((sql.match(/^UPDATE /gm) || []).length, 18);
  assert.equal((sql.match(/^SELECT CASE /gm) || []).length, 802);
  assert.doesNotMatch(sql, /^(?:BEGIN|COMMIT|ROLLBACK|DROP TABLE|ALTER TABLE|DELETE FROM)\b/im);
  assert.doesNotMatch(sql, /UPDATE\s+bb_private_premium_recipes\s/i);
  atomicImport(db, sql);
  assert.deepEqual(readRows(db), payload.rows);
  assert.equal(db.prepare('SELECT legacy FROM bb_private_premium_recipes').get().legacy, 'preserve every byte');
  assert.equal(validateCookAuthorTransition(payload, readRows(db), input).alreadyApplied, true);
  assert.doesNotMatch(buildCookAuthorRecommendationSql(payload, readRows(db), input), /^UPDATE /m);
});

test('a concurrent unchanged-row mutation aborts before write and a second-update failure rolls back both JSON columns', t => {
  for (const mode of ['stale', 'updateFailure', 'afterGuard']) {
    const input = fixture(), { payload } = built(input), db = sqliteFixture(t, input.snapshot.rows), sql = buildCookAuthorRecommendationSql(payload, input.snapshot.rows, input);
    if (mode === 'stale') db.prepare(`UPDATE ${table} SET normalized_json=normalized_json || ' ' WHERE sort_index=399`).run();
    if (mode === 'updateFailure') db.exec(`CREATE TRIGGER reject_second BEFORE UPDATE ON ${table} WHEN OLD.sort_index=32 BEGIN SELECT RAISE(ABORT,'simulated update failure'); END;`);
    if (mode === 'afterGuard') db.exec(`CREATE TRIGGER corrupt_after AFTER UPDATE ON ${table} WHEN NEW.sort_index=336 BEGIN UPDATE ${table} SET normalized_json=normalized_json || ' ' WHERE sort_index=399; END;`);
    const before = readRows(db); assert.throws(() => atomicImport(db, sql)); assert.deepEqual(readRows(db), before);
    assert.equal(db.prepare('SELECT legacy FROM bb_private_premium_recipes').get().legacy, 'preserve every byte');
  }
});

function activationFixture(t, mode = 'activate') {
  const input = diskFixture(t), manifest = prepareCookAuthorRecommendations(input.options), root = input.options.publicRoot;
  const runner = path.join(input.base, 'runner'); fs.mkdirSync(runner, { mode: 0o700 });
  const binary = path.join(runner, 'wrangler'); fs.writeFileSync(binary, 'synthetic executable', { mode: 0o700 });
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'jbatiste12-debug/BasketBoss', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), GITHUB_EVENT_NAME: 'push', RUNNER_TEMP: runner, BB_IMPORT_MODE: mode, CLOUDFLARE_API_TOKEN: token, WRANGLER_BIN: binary };
  const approved = { manifestSha256: sha(fs.readFileSync(input.options.manifestPath)), payloadSha256: manifest.payloadSha256, sealedSha256: manifest.sealedSha256, reviewSourceCommit: manifest.reviewSourceCommit, beforeRowsSha256: manifest.beforeRowsSha256, recipientFingerprint: manifest.recipientFingerprint };
  const db = sqliteFixture(t, input.snapshot.rows), calls = [], rollbackPath = path.join(runner, 'basketboss-cook-author-rollback.sealed.json');
  const legacy = input.snapshot.rows.slice(0, 221).map(({ sort_index, recipe_json, normalized_json }) => ({ sort_index, recipe_json, normalized_json }));
  let writes = 0, mainChecks = 0, stale = false, wrongVersion = false, badReadback = false, badLegacy = false;
  const perform = async (address, options) => {
    const sql = JSON.parse(options.body).sql; calls.push(sql); assert.match(sql, /^SELECT /); assert.equal(options.headers.Authorization, 'Bearer ' + token);
    const rows = sql === select ? readRows(db) : clone(legacy);
    if (writes && badReadback && sql === select) rows[399].recipe_json += ' ';
    if (writes && badLegacy && sql !== select) rows[0].recipe_json += ' ';
    return { ok: true, headers: new Headers(), text: async () => JSON.stringify({ success: true, result: [{ success: true, results: rows }] }) };
  };
  const runCommand = (executable, args) => {
    if (executable === 'git') {
      if (args[0] === 'rev-parse') return env.GITHUB_SHA;
      if (args[0] === 'merge-base') return '';
      if (args[0] === 'ls-remote') { mainChecks++; return (stale && mainChecks > 1 ? 'c'.repeat(40) : env.GITHUB_SHA) + '\trefs/heads/main'; }
      assert.fail('unexpected git operation');
    }
    assert.equal(executable, binary);
    if (args[0] === '--version') return wrongVersion ? 'wrangler 4.155.0' : 'wrangler 4.156.0';
    assert.deepEqual(args.slice(0, 5), ['d1', 'execute', 'BB_CATALOGUE_DB', '--remote', '--file']);
    assert.ok(fs.existsSync(rollbackPath), 'encrypted rollback exists before importer runs');
    assert.equal(fs.statSync(rollbackPath).mode & 0o777, 0o600);
    const encrypted = fs.readFileSync(rollbackPath, 'utf8'); assert.ok(!encrypted.includes(secret)); assert.ok(!encrypted.includes(token));
    const rollback = JSON.parse(openPayload(JSON.parse(encrypted), token));
    assert.deepEqual(rollback.rows, input.snapshot.rows); assert.deepEqual(rollback.legacyRows, legacy); assert.equal(rollback.rowsSha256, manifest.beforeRowsSha256);
    assert.ok(!args[5].startsWith(root + path.sep)); assert.equal(fs.statSync(args[5]).mode & 0o777, 0o600);
    atomicImport(db, fs.readFileSync(args[5], 'utf8')); writes++;
    return 'private provider response ' + secret;
  };
  const deps = { root, approved, targets: input.targets, inspect: async () => ({ accountId: '1'.repeat(32), databaseId: input.snapshot.source.databaseId, counts: { [table]: 400 } }), runCommand };
  return { ...input, env, deps, manifest, db, calls, runner, rollbackPath, perform, writes: () => writes, setStale: () => { stale = true; }, setWrongVersion: () => { wrongVersion = true; }, setBadReadback: () => { badReadback = true; }, setBadLegacy: () => { badLegacy = true; } };
}

test('publisher pins refuse a valid public-key envelope until its exact reviewed artifact is approved', t => {
  const input = activationFixture(t, 'inspect'), sealed = fs.readFileSync(input.options.sealedPath);
  assert.throws(() => validateCookAuthorManifest(input.manifest, sealed), /release_pin/);
  assert.equal(validateCookAuthorManifest(input.manifest, sealed, input.deps.approved), true);
  for (const field of ['payloadSha256', 'sealedSha256', 'reviewSourceCommit', 'beforeRowsSha256', 'recipientFingerprint']) {
    assert.throws(() => validateCookAuthorManifest(input.manifest, sealed, { ...input.deps.approved, [field]: '0'.repeat(field === 'reviewSourceCommit' ? 40 : 64) }), /release_pin/);
  }
  assert.throws(() => validateCookAuthorManifest(input.manifest, Buffer.concat([sealed, Buffer.from(' ')]), input.deps.approved), /release_pin/);
  for (const mutate of [m => m.approval.kitchenTested = true, m => m.counts.changed = 19, m => m.sourceCommit = '0'.repeat(40), m => m.counts.resolvedFindings = 33, m => m.extra = secret]) {
    const manifest = clone(input.manifest); mutate(manifest); assert.throws(() => validateCookAuthorManifest(manifest, sealed, input.deps.approved));
  }
  const pins = Object.values(APPROVED_COOK_AUTHOR_RECOMMENDATIONS).slice(0, 4);
  assert.ok(pins.every(x => x === '') || pins.every((x, i) => new RegExp(`^[a-f0-9]{${i === 3 ? 40 : 64}}$`).test(x)), 'publisher pins are either unprepared or complete');
});

test('synthetic activation seals full rollback before one atomic import and verifies exact readback', async t => {
  const input = activationFixture(t), result = await activateCookAuthorRecommendations(input.env, input.perform, input.deps);
  assert.equal(result.imported, true); assert.equal(result.verified, true); assert.equal(result.unchangedRowsPreserved, 382); assert.equal(result.legacyUnchanged, true);
  assert.equal(input.writes(), 1); assert.equal(input.calls.length, 4);
  assert.equal(sha(JSON.stringify(readRows(input.db))), input.manifest.afterRowsSha256);
  assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(result).includes(token));
  assert.deepEqual(fs.readdirSync(input.runner).sort(), ['basketboss-cook-author-rollback.sealed.json', 'wrangler']);
});

test('inspect and already-applied activation execute no importer', async t => {
  const inspect = activationFixture(t, 'inspect'), result = await activateCookAuthorRecommendations(inspect.env, inspect.perform, inspect.deps);
  assert.equal(result.ready, true); assert.equal(result.imported, false); assert.equal(inspect.writes(), 0); assert.equal(fs.existsSync(inspect.rollbackPath), false);
  assert.deepEqual(readRows(inspect.db), inspect.snapshot.rows);
  const applied = activationFixture(t), payload = JSON.parse(fs.readFileSync(path.join(applied.options.outputDirectory, 'cook-author-recommendations.json')));
  atomicImport(applied.db, buildCookAuthorRecommendationSql(payload, applied.snapshot.rows, applied));
  const again = await activateCookAuthorRecommendations(applied.env, applied.perform, applied.deps);
  assert.equal(again.alreadyApplied, true); assert.equal(again.imported, false); assert.equal(again.verified, true); assert.equal(applied.writes(), 0);
});

test('newer main, wrong importer and mismatched manifest prevent writes; readback mismatch cannot report success', async t => {
  for (const mutation of ['setStale', 'setWrongVersion', 'setBadReadback', 'setBadLegacy']) {
    const input = activationFixture(t); input[mutation]();
    await assert.rejects(activateCookAuthorRecommendations(input.env, input.perform, input.deps), /main_changed|wrangler_version|readback|legacy_changed/);
    assert.equal(input.writes(), mutation === 'setBadReadback' || mutation === 'setBadLegacy' ? 1 : 0);
    assert.ok(fs.existsSync(input.rollbackPath)); assert.deepEqual(fs.readdirSync(input.runner).sort(), ['basketboss-cook-author-rollback.sealed.json', 'wrangler']);
  }
  const input = activationFixture(t); input.deps.approved.manifestSha256 = '0'.repeat(64);
  await assert.rejects(activateCookAuthorRecommendations(input.env, input.perform, input.deps), /manifest_pin/);
  assert.equal(input.writes(), 0); assert.equal(input.calls.length, 0);
});

test('activation is restricted to this repository main Actions context and errors reveal only fixed categories', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'jbatiste12-debug/BasketBoss', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), GITHUB_EVENT_NAME: 'push', RUNNER_TEMP: '/tmp/runner', BB_IMPORT_MODE: 'inspect' };
  requireCookAuthorEnvironment(env);
  for (const patch of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_REF: 'refs/pull/1/merge' }, { GITHUB_REPOSITORY: 'foreign/repository' }, { GITHUB_SHA: 'bad' }, { RUNNER_TEMP: 'relative' }, { BB_IMPORT_MODE: 'delete' }]) assert.throws(() => requireCookAuthorEnvironment({ ...env, ...patch }));
  const child = spawnSync(process.execPath, [new URL('../scripts/activate-cook-author-recommendations.mjs', import.meta.url).pathname], { encoding: 'utf8', env: { PATH: process.env.PATH || '', ...env, GITHUB_REF: 'refs/pull/1/merge', BB_IMPORT_MODE: 'activate', CLOUDFLARE_API_TOKEN: token, PRIVATE_TEXT: secret } });
  assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.equal(child.stderr.trim(), 'cook_author_activation_untrusted_environment');
  assert.ok(!child.stderr.includes(secret)); assert.ok(!child.stderr.includes(token));
});

test('author workflow shares the catalogue concurrency boundary and uploads only encrypted rollback', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/activate-cook-author-recommendations.yml', import.meta.url), 'utf8');
  const push = workflow.match(/  push:\n([\s\S]*?)\npermissions:/)?.[1];
  assert.ok(push); assert.match(push, /branches: \[main\]/);
  assert.deepEqual([...push.matchAll(/^      - (.+)$/gm)].map(x => x[1]), [COOK_AUTHOR_SEALED_FILE]);
  for (const pattern of [/if: github\.ref == 'refs\/heads\/main'/, /environment: github-pages/, /group: basketboss-private-catalogue-500/, /cancel-in-progress: false/, /persist-credentials: false/, /--save-exact wrangler@4\.156\.0/, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/]) assert.match(workflow, pattern);
  assert.deepEqual([...workflow.matchAll(/^          path: (.+)$/gm)].map(x => x[1]), ['${{ runner.temp }}/basketboss-cook-author-rollback.sealed.json']);
  assert.doesNotMatch(workflow, /pull_request_target|pull_request:|upload-pages-artifact|download-artifact/);
});
