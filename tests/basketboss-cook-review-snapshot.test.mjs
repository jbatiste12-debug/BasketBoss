import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { auditCookMethodSummary, runCookMethodSummary } from '../scripts/audit-cook-method-private-summary.mjs';
import { prepareCookReviewSnapshot, COOK_REVIEW_FILENAME, COOK_REVIEW_TRANSPORT_CHUNK_CHARS } from '../scripts/seal-cook-review-snapshot.mjs';
import { recipientForToken, openPayload } from '../scripts/private-catalogue-envelope.mjs';
import { validatePrivateRecipeExport, writePrivateRecipeExport, PRIVATE_RECIPE_SELECT } from '../scripts/load-private-recipe-audit.mjs';

const marker = 'SYNTHETIC PRIVATE COOK REVIEW CONTENT';
const token = 'SYNTHETIC-DEDICATED-READ-TOKEN-NEVER-OUTPUT';
const databaseId = '12345678-1234-1234-1234-123456789012';
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const rowsFixture = () => Array.from({ length: 400 }, (_, index) => {
  const id = 'private-cook-review-' + index;
  const recipe = { id, name: marker, premium: true, accessTier: 'premium', ingredients: [['Potatoes', '500 g', 1, 'Vegetables']], method: ['Cut potatoes into 2 cm pieces. ' + marker, 'Cook for 10 minutes.'] };
  return { recipe_id: id, sort_index: index, recipe_json: JSON.stringify(recipe), normalized_json: JSON.stringify({ id, ingredients: [{ name: 'Potatoes', quantity: 500, unit: 'g' }] }) };
});
const publicFixture = () => Array.from({ length: 100 }, (_, index) => ({ id: 'public-' + index, ingredients: [['Potatoes', '500 g']], method: ['Cut potatoes.', 'Cook for 10 minutes.'] }));
const response = rows => new Response(JSON.stringify({ success: true, result: [{ success: true, results: rows }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const safe = value => assert.doesNotMatch(typeof value === 'string' ? value : JSON.stringify(value), /SYNTHETIC PRIVATE COOK REVIEW CONTENT|SYNTHETIC-DEDICATED-READ-TOKEN|provider-secret/);

async function withFixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-cook-review-'));
  try {
    const root = path.join(directory, 'checkout'), runnerTemp = path.join(directory, 'runner-temp');
    fs.mkdirSync(path.join(root, '.github/private-catalogue'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(runnerTemp, { mode: 0o700 });
    const key = randomBytes(48).toString('hex'), keyPath = path.join(directory, 'session-review.key');
    fs.writeFileSync(keyPath, key + '\n', { mode: 0o600 });
    const recipientPath = path.join(root, '.github/private-catalogue/cook-review-recipient.json');
    fs.writeFileSync(recipientPath, JSON.stringify(recipientForToken(key)));
    const outputPath = path.join(runnerTemp, COOK_REVIEW_FILENAME);
    const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'jbatiste12-debug/BasketBoss', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123456789', GITHUB_RUN_ATTEMPT: '2', RUNNER_TEMP: runnerTemp, CLOUDFLARE_RECIPE_AUDIT_READ_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32), CLOUDFLARE_DATABASE_ID: databaseId };
    await run({ directory, root, runnerTemp, key, keyPath, recipientPath, outputPath, env, rows: rowsFixture() });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('optional main-push snapshot decrypts to the exact validated 400 rows with bound run context outside checkout', async () => withFixture(async fixture => {
  const { env, root, runnerTemp, recipientPath, outputPath, rows, keyPath, key, directory } = fixture;
  const output = [];
  let calls = 0;
  assert.equal(await runCookMethodSummary({ env, root, publicRecipes: publicFixture(), reviewRecipientPath: recipientPath, sealedReviewOutput: outputPath, perform: async (address, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body), { sql: PRIVATE_RECIPE_SELECT });
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    return response(rows);
  }, write: line => output.push(line) }), 0);
  assert.equal(calls, 1);
  safe(output);
  const summary = JSON.parse(output[0]);
  assert.equal(summary.sealedReviewSnapshot.sealed, true);
  assert.equal(summary.sealedReviewSnapshot.rowsSha256, digest(rows));
  assert.deepEqual(fs.readdirSync(runnerTemp), [COOK_REVIEW_FILENAME]);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  const encrypted = fs.readFileSync(outputPath, 'utf8');
  safe(encrypted);
  assert(!encrypted.includes(key));
  assert(!fs.readFileSync(recipientPath, 'utf8').includes(key));
  const envelope = JSON.parse(encrypted);
  assert.equal(envelope.metadata.releaseId, 'cook-content-review-123456789-2');
  assert.equal(envelope.metadata.sourceCommit, env.GITHUB_SHA);
  let plaintext;
  try {
    plaintext = openPayload(envelope, fs.readFileSync(keyPath, 'utf8').trim());
    const payload = JSON.parse(plaintext.toString('utf8'));
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.kind, 'basketboss-cook-content-review');
    assert.deepEqual(payload.context, { repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, commit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
    assert.deepEqual(payload.snapshot.rows, rows);
    assert.equal(validatePrivateRecipeExport(payload.snapshot).sha256, digest(rows));
    const outputDirectory = path.join(directory, 'opened-private');
    const opened = writePrivateRecipeExport({ outputDirectory, rows: payload.snapshot.rows, databaseId, readAt: payload.snapshot.source.readAt, publicRoot: root });
    assert.equal(opened.sha256, digest(rows));
    assert.equal(fs.statSync(opened.exportPath).mode & 0o777, 0o600);
    assert(!opened.exportPath.startsWith(root + path.sep));
  } finally { plaintext?.fill(0); }
  assert.throws(() => openPayload(envelope, randomBytes(48).toString('hex')));
  envelope.metadata.sourceCommit = 'c'.repeat(40);
  assert.throws(() => openPayload(envelope, key));
}));

test('summary-only default creates no snapshot, while failed invariants still leave an intact encrypted review artifact', async () => withFixture(async ({ env, root, runnerTemp, recipientPath, outputPath, rows, key }) => {
  const summary = await auditCookMethodSummary({ env, root, publicRecipes: publicFixture(), perform: async () => response(rows) });
  assert.equal(Object.hasOwn(summary, 'sealedReviewSnapshot'), false);
  assert.deepEqual(fs.readdirSync(runnerTemp), []);
  const output = [];
  assert.equal(await runCookMethodSummary({ env, root, publicRecipes: publicFixture(), reviewRecipientPath: recipientPath, sealedReviewOutput: outputPath, perform: async () => response(rows), methodApi: { sourceMethod: recipe => recipe.method, normalizeMethod: () => [] }, write: line => output.push(line) }), 1);
  safe(output);
  let plaintext;
  try {
    plaintext = openPayload(JSON.parse(fs.readFileSync(outputPath, 'utf8')), key);
    assert.deepEqual(JSON.parse(plaintext.toString('utf8')).snapshot.rows, rows);
  } finally { plaintext?.fill(0); }
}));

test('invalid output paths, incomplete flags, run identity and recipient fail before any protected read', async () => withFixture(async ({ env, root, directory, runnerTemp, recipientPath, outputPath }) => {
  const existing = path.join(runnerTemp, 'existing.sealed.json');
  fs.writeFileSync(existing, 'keep-existing-file');
  const symlinkTemp = path.join(directory, 'runner-alias');
  fs.symlinkSync(runnerTemp, symlinkTemp, 'dir');
  const cases = [
    { sealedReviewOutput: path.join(root, COOK_REVIEW_FILENAME) },
    { sealedReviewOutput: path.join(directory, COOK_REVIEW_FILENAME) },
    { sealedReviewOutput: path.join(runnerTemp, 'nested', COOK_REVIEW_FILENAME) },
    { sealedReviewOutput: existing },
    { sealedReviewOutput: path.join(symlinkTemp, COOK_REVIEW_FILENAME), env: { ...env, RUNNER_TEMP: symlinkTemp } },
    { sealedReviewOutput: undefined }, { reviewRecipientPath: undefined }, { reviewRecipientPath: '', sealedReviewOutput: '' },
    { env: { ...env, GITHUB_RUN_ID: '' } }, { env: { ...env, GITHUB_RUN_ATTEMPT: '' } },
    { reviewRecipientPath: path.join(directory, 'some-other-recipient.json') }
  ];
  for (const change of cases) {
    let called = false;
    const output = [];
    assert.equal(await runCookMethodSummary({ env, root, publicRecipes: publicFixture(), reviewRecipientPath: recipientPath, sealedReviewOutput: outputPath, ...change, perform: async () => { called = true; throw Error(marker); }, write: line => output.push(line) }), 1);
    assert.equal(called, false);
    assert.match(JSON.parse(output[0]).error, /^cook_method_audit_review_(?:options|context|output|recipient)_invalid$/);
    safe(output);
  }
  assert.equal(fs.readFileSync(existing, 'utf8'), 'keep-existing-file');
  assert(!fs.existsSync(outputPath));
  const recipient = JSON.parse(fs.readFileSync(recipientPath, 'utf8'));
  recipient.fingerprint = '0'.repeat(64);
  fs.writeFileSync(recipientPath, JSON.stringify(recipient));
  let called = false;
  await assert.rejects(auditCookMethodSummary({ env, root, publicRecipes: publicFixture(), reviewRecipientPath: recipientPath, sealedReviewOutput: outputPath, perform: async () => { called = true; throw Error(marker); } }), /cook_method_audit_review_recipient_invalid/);
  assert.equal(called, false);
}));

test('exclusive output rejects symlinks or a file created after preparation and failed ciphertext writes remove partial artifacts', async () => withFixture(async ({ env, root, runnerTemp, recipientPath, outputPath, rows }) => {
  const fetched = { rows, databaseId, sha256: digest(rows) };
  let seal = prepareCookReviewSnapshot({ env, root, recipientPath, outputPath });
  fs.writeFileSync(outputPath, 'keep-racing-file');
  assert.throws(() => seal(fetched), /cook_method_audit_review_seal_failed/);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'keep-racing-file');
  fs.rmSync(outputPath);
  fs.symlinkSync(path.join(root, 'forbidden-plaintext.json'), outputPath);
  assert.throws(() => prepareCookReviewSnapshot({ env, root, recipientPath, outputPath }), /cook_method_audit_review_output_invalid/);
  fs.rmSync(outputPath);
  seal = prepareCookReviewSnapshot({ env, root, recipientPath, outputPath });
  const originalWrite = fs.writeFileSync;
  try {
    fs.writeFileSync = (file, data, ...options) => {
      if (typeof file === 'number') { fs.writeSync(file, 'partial-ciphertext'); throw Error(marker); }
      return originalWrite(file, data, ...options);
    };
    assert.throws(() => seal(fetched), /cook_method_audit_review_seal_failed/);
  } finally { fs.writeFileSync = originalWrite; }
  assert.deepEqual(fs.readdirSync(runnerTemp), []);
  assert(!fs.existsSync(path.join(root, 'forbidden-plaintext.json')));
}));

test('explicit ciphertext log transport reconstructs the exact sealed file and decrypts without exposing plaintext or credentials', async () => withFixture(async ({ env, root, recipientPath, outputPath, rows, key }) => {
  const output = [];
  assert.equal(await runCookMethodSummary({ env, root, publicRecipes: publicFixture(), reviewRecipientPath: recipientPath, sealedReviewOutput: outputPath, reviewTransportLog: true, perform: async () => response(rows), write: line => output.push(line) }), 0);
  safe(output);
  assert(!output.join('\n').includes(key));
  const chunks = output.filter(line => line.startsWith('BB_COOK_REVIEW_CIPHER '));
  assert(chunks.length > 1);
  const parts = chunks.map(line => {
    const match = line.match(/^BB_COOK_REVIEW_CIPHER ([1-9][0-9]*)\/([1-9][0-9]*) ([a-f0-9]{64}) ([A-Za-z0-9+/]+={0,2})$/);
    assert(match);
    return { index: Number(match[1]), count: Number(match[2]), hash: match[3], part: match[4] };
  });
  assert(parts.every((part, index) => part.index === index + 1 && part.count === parts.length && part.hash === parts[0].hash));
  assert(parts.every(part => part.part.length <= COOK_REVIEW_TRANSPORT_CHUNK_CHARS));
  assert(parts.slice(0, -1).every(part => part.part.length === 12288));
  const reconstructed = Buffer.from(parts.map(part => part.part).join(''), 'base64');
  assert.deepEqual(reconstructed, fs.readFileSync(outputPath));
  assert.equal(createHash('sha256').update(reconstructed).digest('hex'), parts[0].hash);
  let plaintext;
  try {
    plaintext = openPayload(JSON.parse(reconstructed.toString('utf8')), key);
    const payload = JSON.parse(plaintext.toString('utf8'));
    assert.deepEqual(payload.snapshot.rows, rows);
    assert.equal(payload.context.commit, env.GITHUB_SHA);
    assert.equal(payload.context.runId, env.GITHUB_RUN_ID);
    assert.equal(validatePrivateRecipeExport(payload.snapshot).sha256, digest(rows));
  } finally { plaintext?.fill(0); }
  const summary = JSON.parse(output.at(-1));
  assert.equal(summary.sealedReviewSnapshot.sealed, true);
  assert.equal(summary.protectedRecipes, 400);
}));

test('ciphertext log flag requires the full explicit snapshot options and trusted context before any read', async () => withFixture(async ({ env, root, recipientPath, outputPath }) => {
  for (const change of [
    { reviewRecipientPath: undefined, sealedReviewOutput: undefined },
    { reviewRecipientPath: undefined }, { sealedReviewOutput: undefined },
    { env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' } },
    { env: { ...env, GITHUB_RUN_ID: '' } },
    { reviewTransportLog: 'true' }
  ]) {
    const output = [];
    let called = false;
    assert.equal(await runCookMethodSummary({ env, root, publicRecipes: publicFixture(), reviewRecipientPath: recipientPath, sealedReviewOutput: outputPath, reviewTransportLog: true, ...change, perform: async () => { called = true; throw Error(marker); }, write: line => output.push(line) }), 1);
    assert.equal(called, false);
    assert.equal(output.length, 1);
    assert(!output[0].startsWith('BB_COOK_REVIEW_CIPHER '));
    safe(output);
  }
}));
