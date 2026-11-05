import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { activateCookContentCorrections, buildCookContentCorrectionSql, validateCookContentTransition, requireCookCorrectionEnvironment, validateCookCorrectionManifest } from '../scripts/activate-cook-content-corrections.mjs';
import { createHash } from 'node:crypto';
import { COOK_CORRECTION_RANGES, COOK_CORRECTION_SOURCE, COOK_CORRECTION_RECIPIENT_FINGERPRINT, COOK_CORRECTION_SEALED_FILE, COOK_CORRECTION_MANIFEST_FILE, buildCookContentCorrections, prepareCookContentCorrections, runCookContentCorrectionsCLI } from '../scripts/prepare-cook-content-corrections.mjs';
import { recipientForToken, openPayload } from '../scripts/private-catalogue-envelope.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const secret = 'SYNTHETIC_PRIVATE_RECIPE_TEXT_4e28c7';
const token = 'synthetic-test-recipient-token-with-sufficient-entropy';

function fixture() {
  const rows = Array.from({ length: 400 }, (_, index) => {
    const id = 'premium-' + String(index).padStart(3, '0');
    const recipe = { id, premium: true, accessTier: 'premium', title: secret + index, ingredients: [{ name: secret, quantity: '125 g', unit: 'g' }], servings: 4, mins: 25, cost: 3.75, metadata: { preserve: [1, 'unchanged'] }, method: ['Original ' + secret], steps: ['Original ' + secret], culinary_prep_notes: ['Original prep ' + secret] };
    return { recipe_id: id, sort_index: index, recipe_json: JSON.stringify(recipe), normalized_json: '{ "id": ' + JSON.stringify(id) + ', "ingredients": [{"ingredient": "' + secret + '", "quantity":125}] }\n' };
  });
  const snapshot = { schemaVersion: 1, source: { kind: 'cloudflare-d1-read-only', table: 'bb_private_premium_recipes_500_v1', databaseId: '01234567-89ab-cdef-0123-456789abcdef', readAt: '2026-11-02T12:00:00.000Z' }, rowsSha256: sha(JSON.stringify(rows)), rows };
  const reviews = COOK_CORRECTION_RANGES.map(range => ({ range: [...range], sourceRowsSha256: snapshot.rowsSha256, reviewed: rows.slice(range[0], range[1] + 1).map(row => ({ id: row.recipe_id, status: 'pass', findings: [] })), patches: [], authorReview: [] }));
  reviews[0].reviewed[0].status = 'content_fix';
  reviews[0].patches.push({ id: rows[0].recipe_id, index: 0, recipeSha256: sha(rows[0].recipe_json), normalizedSha256: sha(rows[0].normalized_json), method: ['Corrected method ' + secret, 'Serve when cooked.'], steps: ['Corrected method ' + secret, 'Serve when cooked.'], culinary_prep_notes: ['Prepare ingredients ' + secret], reasons: ['Missing original cooking action ' + secret] });
  reviews[0].authorReview.push({ id: rows[0].recipe_id, issue: 'Uncertain ingredient quantity ' + secret, evidence: 'Synthetic evidence ' + secret, suggestion: 'Ask author before changing quantities ' + secret });
  return { snapshot, reviews };
}

function diskFixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-cook-corrections-'));
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
  reviews.forEach((review, index) => fs.writeFileSync(path.join(reviewsDirectory, `cook-review-batch-${index}.json`), JSON.stringify(review), { mode: 0o600 }));
  const recipient = recipientForToken(token);
  fs.writeFileSync(path.join(publicRoot, '.github/private-catalogue/catalogue-recipient.json'), JSON.stringify(recipient));
  return { snapshot, reviews, base, options: { snapshotPath, reviewsDirectory, outputDirectory, sealedPath: path.join(publicRoot, COOK_CORRECTION_SEALED_FILE), manifestPath: path.join(publicRoot, COOK_CORRECTION_MANIFEST_FILE), publicRoot, expectedSourceRowsSha256: snapshot.rowsSha256, expectedRecipientFingerprint: recipient.fingerprint } };
}

test('400 reviewed recipes change only method, steps and culinary preparation notes', () => {
  const input = fixture(), original = clone(input);
  const { payload, candidateSnapshot, counts } = buildCookContentCorrections(input);
  assert.deepEqual(input, original, 'does not mutate source or review records');
  assert.equal(payload.kind, 'basketboss-cook-content-corrections');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.rows.length, 400);
  assert.equal(payload.changes.length, 1);
  assert.deepEqual(payload.source, { ...COOK_CORRECTION_SOURCE, snapshot: input.snapshot.source });
  assert.deepEqual(counts, { reviewed: 400, contentFix: 1, pass: 399, review: 0, authorReview: 1 });
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
      assert.deepEqual(next.culinary_prep_notes, input.reviews[0].patches[0].culinary_prep_notes);
      delete previous.method; delete previous.steps; delete previous.culinary_prep_notes; delete next.method; delete next.steps; delete next.culinary_prep_notes;
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
    x => x.reviews[4].reviewed.pop(),
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
    assert.throws(() => buildCookContentCorrections(input), /cook_content_corrections_/);
  }
});

test('content_fix status corresponds exactly to patches and valid unchanged rows may remain review', () => {
  for (const mutate of [
    x => x.reviews[0].reviewed[0].status = 'pass',
    x => x.reviews[0].reviewed[1].status = 'content_fix',
    x => x.reviews[0].reviewed[1].status = 'unchecked',
    x => x.reviews[0].patches.length = 0,
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildCookContentCorrections(input), /cook_content_corrections_/);
  }
  const input = fixture(); input.reviews[0].reviewed[1].status = 'review';
  assert.equal(buildCookContentCorrections(input).counts.review, 1);
});

test('raw recipe and normalized hashes reject stale edits, including whitespace', () => {
  for (const field of ['recipeSha256', 'normalizedSha256']) {
    const input = fixture(); input.reviews[0].patches[0][field] = '0'.repeat(64);
    assert.throws(() => buildCookContentCorrections(input), /patch_stale_hash/);
  }
  for (const field of ['recipe_json', 'normalized_json']) {
    const input = fixture(); input.snapshot.rows[0][field] += ' ';
    input.snapshot.rowsSha256 = sha(JSON.stringify(input.snapshot.rows));
    input.reviews.forEach(review => review.sourceRowsSha256 = input.snapshot.rowsSha256);
    assert.throws(() => buildCookContentCorrections(input), /patch_stale_hash/);
  }
  const badExport = fixture(); badExport.snapshot.rows[0].normalized_json += ' ';
  assert.throws(() => buildCookContentCorrections(badExport), /export_hash_mismatch/);
});

test('patches reject metadata, quantities, normalization and all non-allowlisted changes', () => {
  for (const field of ['ingredients', 'servings', 'mins', 'cost', 'title', 'premium', 'accessTier', 'recipe_json', 'normalized_json', 'normalized', '__proto__']) {
    const input = fixture();
    Object.defineProperty(input.reviews[0].patches[0], field, { value: { attacker: true }, enumerable: true });
    assert.throws(() => buildCookContentCorrections(input), /review_fields/, field);
  }
});

test('method, steps and culinary notes require bounded text and method consistency', () => {
  const mutations = [
    patch => patch.method = [],
    patch => patch.method = 'a method',
    patch => patch.method = [''],
    patch => patch.steps = ['different'],
    patch => { patch.method = patch.steps = Array(41).fill('too many'); },
    patch => { patch.method = patch.steps = ['x'.repeat(8001)]; },
    patch => { patch.method = patch.steps = ['control\u0000text']; },
    patch => patch.reasons = [],
    patch => { patch.method = patch.steps = ['Original ' + secret]; patch.culinary_prep_notes = ['Original prep ' + secret]; },
    patch => patch.culinary_prep_notes = '',
    patch => patch.culinary_prep_notes = [''],
    patch => patch.culinary_prep_notes = ['One item', 'Extra ingredient invented'],
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input.reviews[0].patches[0]);
    assert.throws(() => buildCookContentCorrections(input), /cook_content_corrections_/);
  }
});

test('offline preparation writes protected private candidates and authenticated public ciphertext', t => {
  const { snapshot, options } = diskFixture(t);
  const beforeNormalized = snapshot.rows.map(row => row.normalized_json);
  const result = prepareCookContentCorrections(options);
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
  const privatePayload = JSON.parse(fs.readFileSync(path.join(options.outputDirectory, 'cook-content-corrections.json'), 'utf8'));
  assert.deepEqual(opened, privatePayload);
  assert.equal(opened.changes.length, 1);
  assert.deepEqual(opened.rows.map(row => row.normalized_json), beforeNormalized);
  const candidate = JSON.parse(fs.readFileSync(path.join(options.outputDirectory, 'candidate-premium.json'), 'utf8'));
  assert.deepEqual(candidate.rows, opened.rows);
  assert.equal(fs.statSync(options.outputDirectory).mode & 0o777, 0o700);
  for (const name of ['candidate-premium.json', 'cook-content-corrections.json']) assert.equal(fs.statSync(path.join(options.outputDirectory, name)).mode & 0o777, 0o600);
  assert.throws(() => prepareCookContentCorrections(options), /output_exists/);
  assert.equal(fs.readFileSync(options.sealedPath, 'utf8'), sealedText);
});

test('private output cannot enter the checkout through direct paths or symlinks', t => {
  const { options, base } = diskFixture(t);
  for (const outputDirectory of [options.publicRoot, path.join(options.publicRoot, 'private-output')]) {
    assert.throws(() => prepareCookContentCorrections({ ...options, outputDirectory }), /public_output_forbidden/);
  }
  const link = path.join(base, 'private-looking-link'); fs.symlinkSync(options.publicRoot, link);
  assert.throws(() => prepareCookContentCorrections({ ...options, outputDirectory: path.join(link, 'candidate') }), /symlink_forbidden/);
  assert.equal(fs.existsSync(options.sealedPath), false);
});

test('inputs require private permissions and immutable original public release destinations', t => {
  const { options } = diskFixture(t);
  fs.chmodSync(options.snapshotPath, 0o644);
  assert.throws(() => prepareCookContentCorrections(options), /permissions/);
  fs.chmodSync(options.snapshotPath, 0o600);
  fs.chmodSync(path.join(options.reviewsDirectory, 'cook-review-batch-2.json'), 0o644);
  assert.throws(() => prepareCookContentCorrections(options), /permissions/);
  fs.chmodSync(path.join(options.reviewsDirectory, 'cook-review-batch-2.json'), 0o600);
  assert.throws(() => prepareCookContentCorrections({ ...options, sealedPath: path.join(options.publicRoot, '.github/private-catalogue/recipes-500.sealed.json') }), /public_destination_forbidden/);
  assert.throws(() => prepareCookContentCorrections({ ...options, manifestPath: path.join(options.publicRoot, 'private-methods.json') }), /public_destination_forbidden/);
  assert.equal(fs.existsSync(options.sealedPath), false);
});

test('production source and recipient pins cannot be bypassed through CLI flags; errors redact private content', t => {
  const { options } = diskFixture(t);
  const { expectedSourceRowsSha256, expectedRecipientFingerprint, ...productionOptions } = options;
  assert.throws(() => prepareCookContentCorrections(productionOptions), /source_pin_mismatch/);
  assert.throws(() => prepareCookContentCorrections({ ...productionOptions, expectedSourceRowsSha256 }), /recipient_pin_mismatch/);
  const args = ['--snapshot', options.snapshotPath, '--reviews-dir', options.reviewsDirectory, '--out-dir', options.outputDirectory, '--sealed', options.sealedPath];
  for (const extra of [[], ['--expected-source-hash', expectedSourceRowsSha256], ['--out-dir', secret]]) {
    const stdout = [], stderr = [];
    const status = runCookContentCorrectionsCLI([...args, ...extra], { log: message => stdout.push(message), error: message => stderr.push(message) });
    assert.equal(status, 1);
    assert.deepEqual(stdout, []);
    assert.equal(stderr.length, 1);
    assert.match(stderr[0], /^cook_content_corrections_[a-z_]+$/);
    assert.ok(!stderr[0].includes(secret));
    assert.ok(!stderr[0].includes(options.snapshotPath));
  }
});


test('an omitted preparation-note patch preserves the original field including absence', () => {
  for (const hadNotes of [true, false]) {
    const input = fixture();
    delete input.reviews[0].patches[0].culinary_prep_notes;
    if (!hadNotes) {
      const recipe = JSON.parse(input.snapshot.rows[0].recipe_json);
      delete recipe.culinary_prep_notes;
      input.snapshot.rows[0].recipe_json = JSON.stringify(recipe);
      input.snapshot.rowsSha256 = sha(JSON.stringify(input.snapshot.rows));
      input.reviews.forEach(review => review.sourceRowsSha256 = input.snapshot.rowsSha256);
      input.reviews[0].patches[0].recipeSha256 = sha(input.snapshot.rows[0].recipe_json);
    }
    const { payload } = buildCookContentCorrections(input);
    const original = JSON.parse(input.snapshot.rows[0].recipe_json);
    const candidate = JSON.parse(payload.rows[0].recipe_json);
    assert.equal(Object.hasOwn(candidate, 'culinary_prep_notes'), hadNotes);
    assert.deepEqual(candidate.culinary_prep_notes, original.culinary_prep_notes);
  }
});

const table = 'bb_private_premium_recipes_500_v1';
const select = `SELECT recipe_id,sort_index,recipe_json,normalized_json FROM ${table} ORDER BY sort_index`;
function sqliteFixture(t, rows) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE ${table} (recipe_id TEXT PRIMARY KEY, sort_index INTEGER UNIQUE, recipe_json TEXT NOT NULL, normalized_json TEXT NOT NULL); CREATE TABLE bb_private_premium_recipes (legacy TEXT); INSERT INTO bb_private_premium_recipes VALUES ('preserve every byte');`);
  const insert = db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?)`);
  for (const row of rows) insert.run(row.recipe_id, row.sort_index, row.recipe_json, row.normalized_json);
  return db;
}
const readRows = db => db.prepare(select).all().map(row => ({ ...row }));
function atomicImport(db, sql) {
  // Wrangler's remote D1 file import owns the transaction; the generated SQL
  // deliberately has no transaction control statements.
  db.exec('BEGIN');
  try { db.exec(sql); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

test('transition validation checks current catalogue hash and all protected values before SQL', () => {
  const input = fixture(), { payload } = buildCookContentCorrections(input);
  const transition = validateCookContentTransition(payload, input.snapshot.rows);
  assert.equal(transition.alreadyApplied, false);
  assert.equal(validateCookContentTransition(payload, payload.rows).alreadyApplied, true);
  for (const mutation of [
    rows => rows[0].normalized_json += ' ',
    rows => rows[80].recipe_json += ' ',
    rows => rows[1].sort_index = 401,
    rows => rows.pop(),
  ]) {
    const stale = clone(input.snapshot.rows); mutation(stale);
    assert.throws(() => validateCookContentTransition(payload, stale));
  }
  for (const mutation of [
    recipe => recipe.ingredients[0].quantity = 'invented quantity',
    recipe => recipe.servings = 50,
    recipe => recipe.title = 'different title',
    recipe => recipe.premium = false,
    recipe => recipe.metadata.preserve.push('changed'),
  ]) {
    const tampered = clone(payload);
    const recipe = JSON.parse(tampered.rows[0].recipe_json); mutation(recipe);
    tampered.rows[0].recipe_json = JSON.stringify(recipe);
    tampered.afterRowsSha256 = sha(JSON.stringify(tampered.rows));
    tampered.changes[0].newRecipeSha256 = sha(tampered.rows[0].recipe_json);
    assert.throws(() => validateCookContentTransition(tampered, input.snapshot.rows));
  }
});

test('D1 correction SQL changes only reviewed recipe JSON and round-trips quoted content', t => {
  const input = fixture();
  input.reviews[0].patches[0].method = input.reviews[0].patches[0].steps = ["Cook chef's beans; keep café texture. '); DROP TABLE bb_private_premium_recipes; --"];
  const { payload } = buildCookContentCorrections(input);
  const db = sqliteFixture(t, input.snapshot.rows);
  const beforeNormalized = input.snapshot.rows.map(row => row.normalized_json);
  const sql = buildCookContentCorrectionSql(payload, input.snapshot.rows);
  assert.doesNotMatch(sql, /^(?:BEGIN|COMMIT|ROLLBACK|DROP TABLE|ALTER TABLE|DELETE FROM)\b/im);
  assert.doesNotMatch(sql, /UPDATE\s+bb_private_premium_recipes\s/i);
  atomicImport(db, sql);
  assert.deepEqual(readRows(db), payload.rows);
  assert.deepEqual(readRows(db).map(row => row.normalized_json), beforeNormalized);
  assert.equal(db.prepare('SELECT legacy FROM bb_private_premium_recipes').get().legacy, 'preserve every byte');
  assert.equal(validateCookContentTransition(payload, readRows(db)).alreadyApplied, true);
});

test('the SQL rejects a catalogue that changes after the initial read and rolls back all updates', t => {
  const input = fixture(), { payload } = buildCookContentCorrections(input);
  const db = sqliteFixture(t, input.snapshot.rows);
  const sql = buildCookContentCorrectionSql(payload, input.snapshot.rows);
  // This unchanged row is outside the patch, so checking only changed rows
  // would miss a concurrent author update and violate the reviewed snapshot.
  db.prepare(`UPDATE ${table} SET recipe_json=recipe_json || ' ' WHERE sort_index=399`).run();
  const before = readRows(db);
  assert.throws(() => atomicImport(db, sql));
  assert.deepEqual(readRows(db), before);
  assert.equal(db.prepare('SELECT legacy FROM bb_private_premium_recipes').get().legacy, 'preserve every byte');
});

test('a failure during the second patch rolls back the first and preserves normalized bytes', t => {
  const input = fixture();
  input.reviews[0].reviewed[1].status = 'content_fix';
  input.reviews[0].patches.push({ ...clone(input.reviews[0].patches[0]), id: input.snapshot.rows[1].recipe_id, index: 1, recipeSha256: sha(input.snapshot.rows[1].recipe_json), normalizedSha256: sha(input.snapshot.rows[1].normalized_json) });
  const { payload } = buildCookContentCorrections(input);
  const db = sqliteFixture(t, input.snapshot.rows);
  db.exec(`CREATE TRIGGER reject_second BEFORE UPDATE ON ${table} WHEN OLD.sort_index=1 BEGIN SELECT RAISE(ABORT,'simulated update failure'); END;`);
  assert.throws(() => atomicImport(db, buildCookContentCorrectionSql(payload, input.snapshot.rows)), /simulated update failure/);
  assert.deepEqual(readRows(db), input.snapshot.rows);
});

test('only this repository main Actions context can activate content corrections', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'jbatiste12-debug/BasketBoss', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), GITHUB_EVENT_NAME: 'push', RUNNER_TEMP: '/tmp/runner', BB_IMPORT_MODE: 'inspect' };
  requireCookCorrectionEnvironment(env);
  for (const patch of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_REF: 'refs/pull/1/merge' }, { GITHUB_REPOSITORY: 'foreign/repository' }, { GITHUB_SHA: 'bad' }, { RUNNER_TEMP: 'relative' }, { BB_IMPORT_MODE: 'delete' }]) {
    assert.throws(() => requireCookCorrectionEnvironment({ ...env, ...patch }));
  }
});


test('a valid public-key envelope from an unapproved publisher cannot activate a catalogue', t => {
  const { options } = diskFixture(t);
  const manifest = prepareCookContentCorrections(options);
  const sealed = fs.readFileSync(options.sealedPath);
  assert.equal(JSON.parse(openPayload(JSON.parse(sealed), token)).rows.length, 400);
  manifest.beforeRowsSha256 = COOK_CORRECTION_SOURCE.sourceRowsSha256;
  manifest.recipientFingerprint = COOK_CORRECTION_RECIPIENT_FINGERPRINT;
  assert.throws(() => validateCookCorrectionManifest(manifest, sealed), /release_pin/);
  for (const mutate of [
    x => x.sourceCommit = '0'.repeat(40),
    x => x.githubRunId = '1',
    x => x.beforeRowsSha256 = '0'.repeat(64),
    x => x.recipientFingerprint = '0'.repeat(64),
    x => x.reviewSourceCommit = '0'.repeat(40),
    x => x.payloadSha256 = '0'.repeat(64),
    x => x.sealedSha256 = '0'.repeat(64),
    x => x.extra = secret,
  ]) {
    const candidate = clone(manifest); mutate(candidate);
    assert.throws(() => validateCookCorrectionManifest(candidate, sealed));
  }
});

test('the correction workflow uses the shared main-only deployment boundary and encrypted rollback', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/activate-cook-content-corrections.yml', import.meta.url), 'utf8');
  const push = workflow.match(/  push:\n([\s\S]*?)\npermissions:/)?.[1];
  assert.ok(push);
  assert.match(push, /branches: \[main\]/);
  assert.deepEqual([...push.matchAll(/^      - (.+)$/gm)].map(match => match[1]), ['.github/private-catalogue/cook-content-corrections.sealed.json']);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: github-pages/);
  assert.match(workflow, /group: basketboss-private-catalogue-500/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /--save-exact wrangler@4\.156\.0/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  const artifactPaths = [...workflow.matchAll(/^          path: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(artifactPaths, ['${{ runner.temp }}/basketboss-cook-content-rollback.sealed.json']);
  assert.doesNotMatch(workflow, /pull_request_target|pull_request:|upload-pages-artifact|download-artifact/);
});

test('untrusted activation CLI errors expose only a fixed error category', () => {
  const child = spawnSync(process.execPath, [new URL('../scripts/activate-cook-content-corrections.mjs', import.meta.url).pathname], {
    encoding: 'utf8', env: { PATH: process.env.PATH || '', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'jbatiste12-debug/BasketBoss', GITHUB_REF: 'refs/pull/1/merge', GITHUB_SHA: 'a'.repeat(40), GITHUB_EVENT_NAME: 'pull_request', BB_IMPORT_MODE: 'activate', RUNNER_TEMP: '/tmp', CLOUDFLARE_API_TOKEN: token, SYNTHETIC_PRIVATE_TEXT: secret }
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr.trim(), 'cook_content_activation_untrusted_environment');
  assert.ok(!child.stderr.includes(secret));
  assert.ok(!child.stderr.includes(token));
});

function activationFixture(t, mode = 'activate') {
  const disk = diskFixture(t), manifest = prepareCookContentCorrections(disk.options);
  const root = disk.options.publicRoot;
  const runner = path.join(disk.base, 'runner'); fs.mkdirSync(runner, { mode: 0o700 });
  const binary = path.join(runner, 'wrangler'); fs.writeFileSync(binary, 'synthetic executable', { mode: 0o700 });
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'jbatiste12-debug/BasketBoss', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), GITHUB_EVENT_NAME: 'push', RUNNER_TEMP: runner, BB_IMPORT_MODE: mode, CLOUDFLARE_API_TOKEN: token, WRANGLER_BIN: binary };
  const approved = { manifestSha256: sha(fs.readFileSync(disk.options.manifestPath)), payloadSha256: manifest.payloadSha256, sealedSha256: manifest.sealedSha256, reviewSourceCommit: manifest.reviewSourceCommit, beforeRowsSha256: manifest.beforeRowsSha256, recipientFingerprint: manifest.recipientFingerprint };
  const db = sqliteFixture(t, disk.snapshot.rows), calls = [];
  let writes = 0, mainChecks = 0, staleOnSecondCheck = false, wrongVersion = false;
  const legacy = disk.snapshot.rows.slice(0, 221).map(({ sort_index, recipe_json, normalized_json }) => ({ sort_index, recipe_json, normalized_json }));
  const rollbackPath = path.join(runner, 'basketboss-cook-content-rollback.sealed.json');
  const perform = async (address, options) => {
    const sql = JSON.parse(options.body).sql;
    calls.push(sql);
    assert.match(sql, /^SELECT /, 'HTTP verification API only reads');
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    const rows = sql === select ? readRows(db) : legacy;
    return { ok: true, headers: new Headers(), text: async () => JSON.stringify({ success: true, result: [{ success: true, results: rows }] }) };
  };
  const runCommand = (executable, args) => {
    if (executable === 'git') {
      if (args[0] === 'rev-parse') return env.GITHUB_SHA;
      if (args[0] === 'merge-base') return '';
      if (args[0] === 'ls-remote') { mainChecks++; return (staleOnSecondCheck && mainChecks > 1 ? 'b'.repeat(40) : env.GITHUB_SHA) + '\trefs/heads/main'; }
      assert.fail('unexpected git operation');
    }
    assert.equal(executable, binary);
    if (args[0] === '--version') return wrongVersion ? 'wrangler 4.155.0' : 'wrangler 4.156.0';
    assert.deepEqual(args.slice(0, 5), ['d1', 'execute', 'BB_CATALOGUE_DB', '--remote', '--file']);
    assert.ok(fs.existsSync(rollbackPath), 'sealed rollback is durable before the first write');
    assert.equal(fs.statSync(rollbackPath).mode & 0o777, 0o600);
    const sealed = fs.readFileSync(rollbackPath, 'utf8');
    assert.ok(!sealed.includes(secret)); assert.ok(!sealed.includes(token));
    const rollback = JSON.parse(openPayload(JSON.parse(sealed), token));
    assert.deepEqual(rollback.rows, disk.snapshot.rows);
    assert.deepEqual(rollback.legacyRows, legacy);
    assert.equal(rollback.rowsSha256, manifest.beforeRowsSha256);
    const sqlPath = args[5];
    assert.ok(!sqlPath.startsWith(root + path.sep));
    assert.equal(fs.statSync(sqlPath).mode & 0o777, 0o600);
    atomicImport(db, fs.readFileSync(sqlPath, 'utf8'));
    writes++;
    return 'synthetic provider output that must not be returned ' + secret;
  };
  const deps = { root, approved, inspect: async () => ({ accountId: '1'.repeat(32), databaseId: disk.snapshot.source.databaseId, counts: { [table]: 400 } }), runCommand };
  return { ...disk, env, deps, manifest, db, calls, runner, rollbackPath, writes: () => writes, setStale: () => { staleOnSecondCheck = true; }, setWrongVersion: () => { wrongVersion = true; }, perform };
}

test('synthetic activation seals a complete rollback before atomic UPDATE and verifies the readback', async t => {
  const input = activationFixture(t);
  const result = await activateCookContentCorrections(input.env, input.perform, input.deps);
  assert.equal(result.imported, true); assert.equal(result.verified, true);
  assert.equal(result.normalizedUnchanged, true); assert.equal(result.legacyUnchanged, true);
  assert.equal(input.writes(), 1); assert.equal(input.calls.length, 4);
  assert.equal(sha(JSON.stringify(readRows(input.db))), input.manifest.afterRowsSha256);
  assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(result).includes(token));
  assert.deepEqual(fs.readdirSync(input.runner).sort(), ['basketboss-cook-content-rollback.sealed.json', 'wrangler']);
});

test('inspect and already-applied synthetic activations execute no importer', async t => {
  const inspect = activationFixture(t, 'inspect');
  const result = await activateCookContentCorrections(inspect.env, inspect.perform, inspect.deps);
  assert.equal(result.ready, true); assert.equal(result.imported, false);
  assert.equal(inspect.writes(), 0); assert.equal(fs.existsSync(inspect.rollbackPath), false);
  assert.deepEqual(readRows(inspect.db), inspect.snapshot.rows);
  const applied = activationFixture(t);
  const payload = JSON.parse(fs.readFileSync(path.join(applied.options.outputDirectory, 'cook-content-corrections.json')));
  atomicImport(applied.db, buildCookContentCorrectionSql(payload, applied.snapshot.rows));
  const again = await activateCookContentCorrections(applied.env, applied.perform, applied.deps);
  assert.equal(again.alreadyApplied, true); assert.equal(again.imported, false);
  assert.equal(again.verified, true); assert.equal(applied.writes(), 0);
});

test('a newer main or wrong Wrangler version prevents any synthetic database write', async t => {
  for (const change of ['setStale', 'setWrongVersion']) {
    const input = activationFixture(t); input[change]();
    await assert.rejects(activateCookContentCorrections(input.env, input.perform, input.deps), change === 'setStale' ? /main_changed/ : /wrangler_version/);
    assert.equal(input.writes(), 0); assert.deepEqual(readRows(input.db), input.snapshot.rows);
    assert.ok(fs.existsSync(input.rollbackPath));
    assert.deepEqual(fs.readdirSync(input.runner).sort(), ['basketboss-cook-content-rollback.sealed.json', 'wrangler']);
  }
});

test('a reviewed synthetic manifest accepts only its exact payload, envelope and review commit', t => {
  const input = activationFixture(t, 'inspect'), sealed = fs.readFileSync(input.options.sealedPath);
  assert.equal(validateCookCorrectionManifest(input.manifest, sealed, input.deps.approved), true);
  for (const property of ['payloadSha256', 'sealedSha256', 'reviewSourceCommit', 'beforeRowsSha256', 'recipientFingerprint']) {
    const altered = { ...input.deps.approved, [property]: '0'.repeat(property === 'reviewSourceCommit' ? 40 : 64) };
    assert.throws(() => validateCookCorrectionManifest(input.manifest, sealed, altered), /release_pin/);
  }
  assert.throws(() => validateCookCorrectionManifest(input.manifest, Buffer.concat([sealed, Buffer.from(' ')]), input.deps.approved), /release_pin/);
});
