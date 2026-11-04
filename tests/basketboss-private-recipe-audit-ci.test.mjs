import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createPrivateAuditBundle } from '../scripts/recipe-audit-ci.mjs';
import { openPrivateAuditBundle } from '../scripts/open-private-recipe-audit.mjs';
import { recipientForToken, openPayload } from '../scripts/private-catalogue-envelope.mjs';
import { PRIVATE_RECIPE_SELECT, readPrivateRecipeExport } from '../scripts/load-private-recipe-audit.mjs';
import { auditRecipeCoverage, auditRecipeInstructions } from '../scripts/audit-recipe-instructions.mjs';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const read = file => JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
const publicRecipes = read('recipes.json');
const publicIds = new Set(publicRecipes.map(recipe => recipe.id));
const imageIds = ['existing', 'new'].flatMap(folder => fs.readdirSync(path.join(repoRoot, 'release-assets/basketboss-v17/images', folder)).filter(file => file.endsWith('.webp')).map(file => file.slice(0, -5)));
const privateIds = imageIds.filter(id => !publicIds.has(id));
const marker = 'SYNTHETIC PRIVATE RECIPE CONTENT NEVER LOG';
const token = 'synthetic-dedicated-readonly-cloudflare-token';
const databaseId = '12345678-1234-1234-1234-123456789012';
const context = { repository: 'jbatiste12-debug/BasketBoss', ref: 'refs/heads/release/recipe-editorial-collections', commit: 'b'.repeat(40), runId: '123456789', runAttempt: '1' };
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

function rowsFixture() {
  assert.equal(privateIds.length, 400);
  return privateIds.map((id, index) => {
    const method = ['Cut the potatoes into even pieces. ' + marker, 'Cook until tender.'];
    const recipe = { id, name: marker, mins: 30, servings: 4, accessTier: 'premium', premium: true,
      ingredients: [['Potatoes', '500 g', 1, 'Vegetables']], method, steps: [...method] };
    const normalized = { id, ingredients: [{ name: 'Potatoes', key: 'potatoes', quantity: 500, unit: 'g', recipe_id: id, ingredient_index: 0 }] };
    return { recipe_id: id, sort_index: index, recipe_json: JSON.stringify(recipe), normalized_json: JSON.stringify(normalized) };
  });
}
async function withFixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-private-audit-ci-'));
  try {
    const publicRoot = path.join(directory, 'checkout');
    const runnerTemp = path.join(directory, 'runner-temp');
    fs.mkdirSync(publicRoot, { mode: 0o700 });
    fs.mkdirSync(runnerTemp, { mode: 0o700 });
    const free = publicRecipes.map(({ id }) => ({ id, name: 'Synthetic public dinner', mins: 30, servings: 4,
      ingredients: [['Potatoes', '500 g']], method: ['Cut the potatoes.', 'Cook until tender.'], steps: ['Cut the potatoes.', 'Cook until tender.'] }));
    const normalized = free.map(({ id }) => ({ id, ingredients: [{ name: 'Potatoes', key: 'potatoes', quantity: 500, unit: 'g', recipe_id: id, ingredient_index: 0 }] }));
    fs.writeFileSync(path.join(publicRoot, 'recipes.json'), JSON.stringify(free));
    fs.writeFileSync(path.join(publicRoot, 'normalized-ingredient-database.json'), JSON.stringify({ count_recipes: 100, count_ingredient_lines: 100, recipes: normalized }));
    fs.writeFileSync(path.join(publicRoot, 'dessert_recipes.json'), '[]');
    const key = randomBytes(48).toString('hex');
    const keyPath = path.join(directory, 'local-audit.key');
    fs.writeFileSync(keyPath, key + '\n', { mode: 0o600 });
    const recipientPath = path.join(publicRoot, 'recipe-audit-recipient.json');
    fs.writeFileSync(recipientPath, JSON.stringify(recipientForToken(key)) + '\n');
    const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REPOSITORY: context.repository, GITHUB_REF: context.ref, GITHUB_SHA: context.commit,
      GITHUB_RUN_ID: context.runId, GITHUB_RUN_ATTEMPT: context.runAttempt, RUNNER_TEMP: runnerTemp,
      CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_DATABASE_ID: databaseId };
    await run({ directory, publicRoot, runnerTemp, key, keyPath, recipientPath, env, rows: rowsFixture() });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
const response = rows => new Response(JSON.stringify({ success: true, result: [{ success: true, results: rows }] }), { headers: { 'Content-Type': 'application/json' } });
const safeError = error => {
  assert.doesNotMatch(String(error?.message || error), /SYNTHETIC PRIVATE RECIPE CONTENT|synthetic-dedicated-readonly-cloudflare-token|provider-secret-error/);
  return true;
};
function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? filesBelow(path.join(directory, item.name)) : [path.join(directory, item.name)]);
}

test('synthetic 500-record audit roundtrip seals 400 protected rows and restores them only outside checkout', async () => withFixture(async fixture => {
  const { env, rows, publicRoot, recipientPath, keyPath, directory, runnerTemp, key } = fixture;
  let requests = 0;
  const bundle = await createPrivateAuditBundle({ env, publicRoot, recipientPath, perform: async (address, options) => {
    requests++;
    assert.equal(new URL(address).hostname, 'api.cloudflare.com');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { sql: PRIVATE_RECIPE_SELECT });
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    assert.equal(options.redirect, 'error');
    return response(rows);
  } });
  assert.equal(requests, 1);
  assert.equal(bundle.recipes, 400);
  assert.equal(bundle.sha256, digest(rows));
  const envelope = JSON.parse(fs.readFileSync(bundle.sealedPath, 'utf8'));
  assert.equal(envelope.metadata.releaseId, `readonly-recipe-audit-${context.runId}-${context.runAttempt}`);
  assert.equal(envelope.metadata.sourceCommit, context.commit);
  const payloadBytes = openPayload(envelope, key);
  const originalReadAt = JSON.parse(payloadBytes.toString('utf8')).snapshot.source.readAt;
  payloadBytes.fill(0);
  assert.doesNotMatch(JSON.stringify(envelope), new RegExp(marker));
  const summary = fs.readFileSync(bundle.summaryPath, 'utf8');
  assert.match(summary, /\b400\b/);
  assert(summary.includes(bundle.sha256));
  for (const file of filesBelow(runnerTemp)) {
    const bytes = fs.readFileSync(file, 'utf8');
    assert(!bytes.includes(marker), 'runner plaintext must be removed before artifact upload');
    assert(!bytes.includes(token));
    assert(!bytes.includes(key));
  }
  const outputDirectory = path.join(directory, 'opened-private');
  const opened = await openPrivateAuditBundle({ envelopePath: bundle.sealedPath, keyPath, outputDirectory, expected: context, publicRoot });
  assert.equal(opened.recipes, 400);
  assert.equal(opened.sha256, digest(rows));
  const snapshotPath = path.join(outputDirectory, 'current-premium.json');
  assert.equal(fs.statSync(outputDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(snapshotPath).mode & 0o777, 0o600);
  const snapshot = readPrivateRecipeExport(snapshotPath, { publicRoot });
  assert.equal(snapshot.recipes.length, 400);
  assert.equal(snapshot.source.readAt, originalReadAt, 'opening must preserve the D1 acquisition timestamp');
  assert.deepEqual(auditRecipeInstructions({ recipes: snapshot.recipes, normalized: snapshot.normalized }).errors, []);
  const coverage = auditRecipeCoverage({ recipes: publicRecipes, currentPrivateRecipes: snapshot.recipes, images: imageIds.map(id => ({ id, validWebP: true })) });
  assert.equal(coverage.currentFullRecipes, 500);
  assert.equal(coverage.currentProtectedFullRecipesUnavailable, 0);
  assert.deepEqual(coverage.errors, []);
  assert(!fs.readFileSync(recipientPath, 'utf8').includes(key));
  assert(!JSON.stringify(opened).includes(marker));
}));

test('CI refuses nonmanual events, wrong repository/ref and incomplete run identity before provider access', async () => withFixture(async ({ env, publicRoot, recipientPath }) => {
  for (const overrides of [
    { GITHUB_ACTIONS: 'false' }, { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_REPOSITORY: 'someone-else/BasketBoss' }, { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_SHA: 'not-a-commit' }, { GITHUB_RUN_ID: '' }, { GITHUB_RUN_ATTEMPT: '' },
    { CLOUDFLARE_API_TOKEN: '' }
  ]) {
    let called = false;
    await assert.rejects(createPrivateAuditBundle({ env: { ...env, ...overrides }, publicRoot, recipientPath, perform: async () => { called = true; throw Error('must not query'); } }), safeError);
    assert.equal(called, false);
  }
}));

test('CI failures remove private plaintext and retain no provider error body', async () => withFixture(async ({ env, publicRoot, recipientPath, runnerTemp }) => {
  await assert.rejects(createPrivateAuditBundle({ env, publicRoot, recipientPath, perform: async () => new Response('provider-secret-error ' + token, { status: 403 }) }), safeError);
  for (const file of filesBelow(runnerTemp)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /provider-secret-error|synthetic-dedicated-readonly-cloudflare-token|SYNTHETIC PRIVATE RECIPE CONTENT/);
}));

test('a sealing failure after downloading all protected rows still removes every private plaintext file', async () => withFixture(async ({ env, rows, publicRoot, recipientPath, runnerTemp }) => {
  const recipient = JSON.parse(fs.readFileSync(recipientPath, 'utf8'));
  recipient.fingerprint = '0'.repeat(64);
  fs.writeFileSync(recipientPath, JSON.stringify(recipient));
  let downloaded = false;
  await assert.rejects(createPrivateAuditBundle({ env, publicRoot, recipientPath, perform: async () => {
    downloaded = true; return response(rows);
  } }), safeError);
  assert.equal(downloaded, true);
  assert.deepEqual(filesBelow(runnerTemp), [], 'no plaintext or partial artifact may survive failed sealing');
}));

test('opening requires matching repository/ref/commit/run ID and attempt from the selected workflow run', async () => withFixture(async ({ env, rows, publicRoot, recipientPath, keyPath, directory }) => {
  const bundle = await createPrivateAuditBundle({ env, publicRoot, recipientPath, perform: async () => response(rows) });
  for (const [field, value] of [
    ['repository', 'somewhere/BasketBoss'], ['ref', 'refs/heads/main'], ['commit', 'c'.repeat(40)],
    ['runId', '987654321'], ['runAttempt', '2']
  ]) {
    const outputDirectory = path.join(directory, 'wrong-' + field);
    await assert.rejects(Promise.resolve().then(() => openPrivateAuditBundle({ envelopePath: bundle.sealedPath, keyPath, outputDirectory, expected: { ...context, [field]: value }, publicRoot })), safeError);
    assert(!fs.existsSync(path.join(outputDirectory, 'current-premium.json')));
  }
  await assert.rejects(Promise.resolve().then(() => openPrivateAuditBundle({ envelopePath: bundle.sealedPath, keyPath, outputDirectory: path.join(directory, 'missing-expected'), expected: {}, publicRoot })), safeError);
}));

test('wrong keys, altered ciphertext and permissive key files cannot produce a private snapshot', async () => withFixture(async ({ env, rows, publicRoot, recipientPath, keyPath, directory }) => {
  const bundle = await createPrivateAuditBundle({ env, publicRoot, recipientPath, perform: async () => response(rows) });
  const wrongKey = path.join(directory, 'wrong.key'); fs.writeFileSync(wrongKey, randomBytes(48).toString('hex'), { mode: 0o600 });
  await assert.rejects(Promise.resolve().then(() => openPrivateAuditBundle({ envelopePath: bundle.sealedPath, keyPath: wrongKey, outputDirectory: path.join(directory, 'wrong-key-output'), expected: context, publicRoot })), safeError);
  const altered = JSON.parse(fs.readFileSync(bundle.sealedPath, 'utf8'));
  const ciphertext = Buffer.from(altered.ciphertext, 'base64'); ciphertext[0] ^= 1; altered.ciphertext = ciphertext.toString('base64');
  const alteredPath = path.join(directory, 'altered.sealed.json'); fs.writeFileSync(alteredPath, JSON.stringify(altered));
  await assert.rejects(Promise.resolve().then(() => openPrivateAuditBundle({ envelopePath: alteredPath, keyPath, outputDirectory: path.join(directory, 'altered-output'), expected: context, publicRoot })), safeError);
  fs.chmodSync(keyPath, 0o644);
  await assert.rejects(Promise.resolve().then(() => openPrivateAuditBundle({ envelopePath: bundle.sealedPath, keyPath, outputDirectory: path.join(directory, 'permissive-key-output'), expected: context, publicRoot })), safeError);
}));

test('opening never writes into checkout, follows output symlinks or overwrites a prior snapshot', async () => withFixture(async ({ env, rows, publicRoot, recipientPath, keyPath, directory }) => {
  const bundle = await createPrivateAuditBundle({ env, publicRoot, recipientPath, perform: async () => response(rows) });
  for (const outputDirectory of [path.join(publicRoot, 'plaintext'), path.join(directory, 'public-alias')]) {
    if (outputDirectory.endsWith('public-alias')) fs.symlinkSync(publicRoot, outputDirectory, 'dir');
    await assert.rejects(Promise.resolve().then(() => openPrivateAuditBundle({ envelopePath: bundle.sealedPath, keyPath, outputDirectory, expected: context, publicRoot })), safeError);
    assert(!fs.existsSync(path.join(publicRoot, 'current-premium.json')));
  }
  const outputDirectory = path.join(directory, 'once-only');
  await openPrivateAuditBundle({ envelopePath: bundle.sealedPath, keyPath, outputDirectory, expected: context, publicRoot });
  const original = fs.readFileSync(path.join(outputDirectory, 'current-premium.json'));
  await assert.rejects(Promise.resolve().then(() => openPrivateAuditBundle({ envelopePath: bundle.sealedPath, keyPath, outputDirectory, expected: context, publicRoot })), safeError);
  assert.deepEqual(fs.readFileSync(path.join(outputDirectory, 'current-premium.json')), original);
}));

test('manual audit job uses only the dedicated read token and uploads one short-lived sealed artifact', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/cloudflare-catalogue-check.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/);
  const job = workflow.split(/\n  readonly_recipe_audit:\s*\n/)[1];
  assert(job, 'the existing manually selectable workflow must contain the new audit job');
  assert.match(job, /github\.event_name\s*==\s*['"]workflow_dispatch['"]/);
  assert.match(job, /github\.ref\s*==\s*['"]refs\/heads\/release\/recipe-editorial-collections['"]/);
  assert.match(job, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_RECIPE_AUDIT_READ_TOKEN\s*\}\}/);
  assert.doesNotMatch(job, /secrets\.CLOUDFLARE_API_TOKEN\b|environment:\s*github-pages|activate-private-catalogue|wrangler|deploy/i);
  assert.match(job, /node scripts\/recipe-audit-ci\.mjs/);
  assert.equal((job.match(/uses:\s*actions\/upload-artifact@/g) || []).length, 1);
  assert.match(job, /retention-days:\s*1\b/);
  assert.match(job, /path:\s*[^\n]*\.sealed\.json\s*(?:\n|$)/);
  assert.doesNotMatch(job, /path:\s*[^\n]*(?:current-premium\.json|\*|\n\s*[^\n]*current-premium\.json)/);
  const main = workflow.split(/\n  readonly_recipe_audit:\s*\n/)[0];
  assert.match(main, /inspect:\s*\n\s+if:\s*github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(main, /environment:\s*github-pages/);
  assert.match(main, /run:\s*node scripts\/check-cloudflare-catalogue\.mjs/);
});
