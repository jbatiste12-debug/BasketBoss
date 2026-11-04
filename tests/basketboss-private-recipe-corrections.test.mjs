import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CORRECTION_RANGES, CORRECTION_SOURCE, CORRECTION_SEALED_FILE, CORRECTION_MANIFEST_FILE, buildPrivateRecipeCorrections, preparePrivateRecipeCorrections, runPrivateRecipeCorrectionsCLI } from '../scripts/prepare-private-recipe-corrections.mjs';
import { recipientForToken, openPayload } from '../scripts/private-catalogue-envelope.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const secret = 'SYNTHETIC_PRIVATE_RECIPE_TEXT_4e28c7';
const token = 'synthetic-test-recipient-token-with-sufficient-entropy';

function fixture() {
  const rows = Array.from({ length: 400 }, (_, index) => {
    const id = 'premium-' + String(index).padStart(3, '0');
    const recipe = { id, premium: true, accessTier: 'premium', title: secret + index, ingredients: [{ name: secret, quantity: '125 g', unit: 'g' }], servings: 4, mins: 25, cost: 3.75, metadata: { preserve: [1, 'unchanged'] }, method: ['Original ' + secret], steps: ['Original ' + secret] };
    return { recipe_id: id, sort_index: index, recipe_json: JSON.stringify(recipe), normalized_json: '{ "id": ' + JSON.stringify(id) + ', "ingredients": [{"ingredient": "' + secret + '", "quantity":125}] }\n' };
  });
  const snapshot = { schemaVersion: 1, source: { kind: 'cloudflare-d1-read-only', table: 'bb_private_premium_recipes_500_v1', databaseId: '01234567-89ab-cdef-0123-456789abcdef', readAt: '2026-11-02T12:00:00.000Z' }, rowsSha256: sha(JSON.stringify(rows)), rows };
  const reviews = CORRECTION_RANGES.map(range => ({ range: [...range], sourceRowsSha256: snapshot.rowsSha256, reviewed: rows.slice(range[0], range[1] + 1).map(row => ({ id: row.recipe_id, status: 'pass', findings: [] })), patches: [], authorReview: [] }));
  reviews[0].reviewed[0].status = 'method_fix';
  reviews[0].patches.push({ id: rows[0].recipe_id, index: 0, recipeSha256: sha(rows[0].recipe_json), normalizedSha256: sha(rows[0].normalized_json), method: ['Corrected method ' + secret, 'Serve when cooked.'], steps: ['Corrected method ' + secret, 'Serve when cooked.'], reasons: ['Missing original cooking action ' + secret] });
  reviews[0].authorReview.push({ id: rows[0].recipe_id, issue: 'Uncertain ingredient quantity ' + secret, evidence: 'Synthetic evidence ' + secret, suggestion: 'Ask author before changing quantities ' + secret });
  return { snapshot, reviews };
}

function diskFixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-method-corrections-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const publicRoot = path.join(base, 'checkout');
  const privateRoot = path.join(base, 'private');
  const reviewsDirectory = path.join(privateRoot, 'reviews');
  const outputDirectory = path.join(privateRoot, 'candidate');
  fs.mkdirSync(path.join(publicRoot, '.github/private-catalogue'), { recursive: true });
  fs.mkdirSync(reviewsDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateRoot, 0o700);
  const { snapshot, reviews } = fixture();
  const snapshotPath = path.join(privateRoot, 'current-premium.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot), { mode: 0o600 });
  reviews.forEach((review, index) => fs.writeFileSync(path.join(reviewsDirectory, `review-batch-${index}.json`), JSON.stringify(review), { mode: 0o600 }));
  const recipient = recipientForToken(token);
  fs.writeFileSync(path.join(publicRoot, '.github/private-catalogue/catalogue-recipient.json'), JSON.stringify(recipient));
  return { snapshot, reviews, base, options: { snapshotPath, reviewsDirectory, outputDirectory, sealedPath: path.join(publicRoot, CORRECTION_SEALED_FILE), manifestPath: path.join(publicRoot, CORRECTION_MANIFEST_FILE), publicRoot, expectedSourceRowsSha256: snapshot.rowsSha256, expectedRecipientFingerprint: recipient.fingerprint } };
}

test('400 reviewed recipes produce only the explicit method and steps correction', () => {
  const input = fixture(), original = clone(input);
  const { payload, candidateSnapshot, counts } = buildPrivateRecipeCorrections(input);
  assert.deepEqual(input, original, 'does not mutate source or review records');
  assert.equal(payload.kind, 'basketboss-private-recipe-method-corrections');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.rows.length, 400);
  assert.equal(payload.changes.length, 1);
  assert.deepEqual(payload.source, { ...CORRECTION_SOURCE, snapshot: input.snapshot.source });
  assert.deepEqual(counts, { reviewed: 400, methodFix: 1, pass: 399, review: 0, authorReview: 1 });
  assert.equal(payload.beforeRowsSha256, input.snapshot.rowsSha256);
  assert.equal(payload.afterRowsSha256, sha(JSON.stringify(payload.rows)));
  assert.equal(candidateSnapshot.rowsSha256, payload.afterRowsSha256);
  for (const [index, row] of payload.rows.entries()) {
    const before = input.snapshot.rows[index];
    assert.equal(row.normalized_json, before.normalized_json, 'normalized bytes preserved at ' + index);
    assert.equal(row.recipe_id, before.recipe_id);
    assert.equal(row.sort_index, before.sort_index);
    if (index) assert.equal(row.recipe_json, before.recipe_json, 'unpatched recipe bytes preserved');
    else {
      const previous = JSON.parse(before.recipe_json), next = JSON.parse(row.recipe_json);
      assert.deepEqual(next.method, input.reviews[0].patches[0].method);
      assert.deepEqual(next.steps, next.method);
      delete previous.method; delete previous.steps; delete next.method; delete next.steps;
      assert.deepEqual(next, previous, 'all quantities, ingredients, metadata and identity preserved');
      assert.equal(payload.changes[0].originalRecipeSha256, sha(before.recipe_json));
      assert.equal(payload.changes[0].newRecipeSha256, sha(row.recipe_json));
      assert.equal(payload.changes[0].normalizedSha256, sha(before.normalized_json));
    }
  }
  assert.deepEqual(payload.authorReview, input.reviews[0].authorReview);
});

test('review coverage, ranges, source guards and cross-ID duplicates fail closed', () => {
  const mutations = [
    x => x.reviews.pop(),
    x => x.reviews[5].reviewed.pop(),
    x => x.reviews[0].range[1]--,
    x => x.reviews[2].sourceRowsSha256 = '0'.repeat(64),
    x => x.reviews[0].reviewed[1].id = x.reviews[0].reviewed[0].id,
    x => x.reviews[1].reviewed[0].id = x.reviews[0].reviewed[0].id,
    x => x.reviews[1].patches.push(clone(x.reviews[0].patches[0])),
    x => x.reviews[0].patches.push(clone(x.reviews[0].patches[0])),
    x => x.reviews[0].patches[0].index = 1,
    x => x.reviews[0].patches[0].id = 'absent-recipe',
    x => x.reviews[0].authorReview[0].id = x.snapshot.rows[100].recipe_id,
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildPrivateRecipeCorrections(input), /private_recipe_corrections_/);
  }
});

test('method_fix status corresponds exactly to patches and valid unchanged rows may remain review', () => {
  for (const mutate of [
    x => x.reviews[0].reviewed[0].status = 'pass',
    x => x.reviews[0].reviewed[1].status = 'method_fix',
    x => x.reviews[0].reviewed[1].status = 'unchecked',
    x => x.reviews[0].patches.length = 0,
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildPrivateRecipeCorrections(input), /private_recipe_corrections_/);
  }
  const input = fixture(); input.reviews[0].reviewed[1].status = 'review';
  assert.equal(buildPrivateRecipeCorrections(input).counts.review, 1);
});

test('raw recipe and normalized hashes reject stale edits, including whitespace', () => {
  for (const field of ['recipeSha256', 'normalizedSha256']) {
    const input = fixture(); input.reviews[0].patches[0][field] = '0'.repeat(64);
    assert.throws(() => buildPrivateRecipeCorrections(input), /patch_stale_hash/);
  }
  for (const field of ['recipe_json', 'normalized_json']) {
    const input = fixture(); input.snapshot.rows[0][field] += ' ';
    input.snapshot.rowsSha256 = sha(JSON.stringify(input.snapshot.rows));
    input.reviews.forEach(review => review.sourceRowsSha256 = input.snapshot.rowsSha256);
    assert.throws(() => buildPrivateRecipeCorrections(input), /patch_stale_hash/);
  }
  const badExport = fixture(); badExport.snapshot.rows[0].normalized_json += ' ';
  assert.throws(() => buildPrivateRecipeCorrections(badExport), /export_hash_mismatch/);
});

test('patches reject metadata, quantities, normalization and all non-allowlisted changes', () => {
  for (const field of ['ingredients', 'servings', 'mins', 'cost', 'title', 'premium', 'accessTier', 'recipe_json', 'normalized_json', 'normalized', '__proto__']) {
    const input = fixture();
    Object.defineProperty(input.reviews[0].patches[0], field, { value: { attacker: true }, enumerable: true });
    assert.throws(() => buildPrivateRecipeCorrections(input), /review_fields/, field);
  }
});

test('methods and steps require matching full nonempty arrays with bounded strings', () => {
  const mutations = [
    patch => patch.method = [],
    patch => patch.method = 'a method',
    patch => patch.method = [''],
    patch => patch.steps = ['different'],
    patch => { patch.method = patch.steps = Array(41).fill('too many'); },
    patch => { patch.method = patch.steps = ['x'.repeat(8001)]; },
    patch => { patch.method = patch.steps = ['control\u0000text']; },
    patch => patch.reasons = [],
    patch => { patch.method = patch.steps = ['Original ' + secret]; },
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input.reviews[0].patches[0]);
    assert.throws(() => buildPrivateRecipeCorrections(input), /private_recipe_corrections_/);
  }
});

test('offline preparation writes protected private candidates and authenticated public ciphertext', t => {
  const { snapshot, options } = diskFixture(t);
  const beforeNormalized = snapshot.rows.map(row => row.normalized_json);
  const result = preparePrivateRecipeCorrections(options);
  const sealedText = fs.readFileSync(options.sealedPath, 'utf8');
  const manifestText = fs.readFileSync(options.manifestPath, 'utf8');
  assert.ok(!sealedText.includes(secret));
  assert.ok(!manifestText.includes(secret));
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!manifestText.includes('"method"'));
  assert.ok(!manifestText.includes('ingredients'));
  assert.ok(!sealedText.includes(token));
  assert.deepEqual(JSON.parse(manifestText), result);
  const opened = JSON.parse(openPayload(JSON.parse(sealedText), token));
  const privatePayload = JSON.parse(fs.readFileSync(path.join(options.outputDirectory, 'method-corrections.json'), 'utf8'));
  assert.deepEqual(opened, privatePayload);
  assert.equal(opened.changes.length, 1);
  assert.deepEqual(opened.rows.map(row => row.normalized_json), beforeNormalized);
  const candidate = JSON.parse(fs.readFileSync(path.join(options.outputDirectory, 'candidate-premium.json'), 'utf8'));
  assert.deepEqual(candidate.rows, opened.rows);
  assert.equal(fs.statSync(options.outputDirectory).mode & 0o777, 0o700);
  for (const name of ['candidate-premium.json', 'method-corrections.json']) assert.equal(fs.statSync(path.join(options.outputDirectory, name)).mode & 0o777, 0o600);
  assert.throws(() => preparePrivateRecipeCorrections(options), /output_exists/);
  assert.equal(fs.readFileSync(options.sealedPath, 'utf8'), sealedText);
});

test('private output cannot enter the checkout through direct paths or symlinks', t => {
  const { options, base } = diskFixture(t);
  for (const outputDirectory of [options.publicRoot, path.join(options.publicRoot, 'private-output')]) {
    assert.throws(() => preparePrivateRecipeCorrections({ ...options, outputDirectory }), /public_output_forbidden/);
  }
  const link = path.join(base, 'private-looking-link'); fs.symlinkSync(options.publicRoot, link);
  assert.throws(() => preparePrivateRecipeCorrections({ ...options, outputDirectory: path.join(link, 'candidate') }), /symlink_forbidden/);
  assert.equal(fs.existsSync(options.sealedPath), false);
});

test('inputs require private permissions and immutable original public release destinations', t => {
  const { options } = diskFixture(t);
  fs.chmodSync(options.snapshotPath, 0o644);
  assert.throws(() => preparePrivateRecipeCorrections(options), /permissions/);
  fs.chmodSync(options.snapshotPath, 0o600);
  fs.chmodSync(path.join(options.reviewsDirectory, 'review-batch-2.json'), 0o644);
  assert.throws(() => preparePrivateRecipeCorrections(options), /permissions/);
  fs.chmodSync(path.join(options.reviewsDirectory, 'review-batch-2.json'), 0o600);
  assert.throws(() => preparePrivateRecipeCorrections({ ...options, sealedPath: path.join(options.publicRoot, '.github/private-catalogue/recipes-500.sealed.json') }), /public_destination_forbidden/);
  assert.throws(() => preparePrivateRecipeCorrections({ ...options, manifestPath: path.join(options.publicRoot, 'private-methods.json') }), /public_destination_forbidden/);
  assert.equal(fs.existsSync(options.sealedPath), false);
});

test('production source and recipient pins cannot be bypassed through CLI flags; errors redact private content', t => {
  const { options } = diskFixture(t);
  const { expectedSourceRowsSha256, expectedRecipientFingerprint, ...productionOptions } = options;
  assert.throws(() => preparePrivateRecipeCorrections(productionOptions), /source_pin_mismatch/);
  assert.throws(() => preparePrivateRecipeCorrections({ ...productionOptions, expectedSourceRowsSha256 }), /recipient_pin_mismatch/);
  const args = ['--snapshot', options.snapshotPath, '--reviews-dir', options.reviewsDirectory, '--out-dir', options.outputDirectory, '--sealed', options.sealedPath];
  for (const extra of [[], ['--expected-source-hash', expectedSourceRowsSha256], ['--out-dir', secret]]) {
    const stdout = [], stderr = [];
    const status = runPrivateRecipeCorrectionsCLI([...args, ...extra], { log: message => stdout.push(message), error: message => stderr.push(message) });
    assert.equal(status, 1);
    assert.deepEqual(stdout, []);
    assert.equal(stderr.length, 1);
    assert.match(stderr[0], /^private_recipe_corrections_[a-z_]+$/);
    assert.ok(!stderr[0].includes(secret));
    assert.ok(!stderr[0].includes(options.snapshotPath));
  }
});
