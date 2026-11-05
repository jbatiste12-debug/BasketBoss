import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  auditCookMethodSummary, runCookMethodSummary, COOK_AUDIT_REPOSITORY
} from '../scripts/audit-cook-method-private-summary.mjs';
import { PRIVATE_RECIPE_SELECT } from '../scripts/load-private-recipe-audit.mjs';

const method = createRequire(import.meta.url)('../bb-cook-method.js');
const token = 'SYNTHETIC-DEDICATED-READ-TOKEN-DO-NOT-LOG';
const secret = 'SYNTHETIC PRIVATE RECIPE CONTENT';
const env = {
  GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push',
  GITHUB_REPOSITORY: COOK_AUDIT_REPOSITORY, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40),
  CLOUDFLARE_RECIPE_AUDIT_READ_TOKEN: token,
  CLOUDFLARE_API_TOKEN: 'BROAD-TOKEN-MUST-NEVER-BE-USED-FOR-THIS-AUDIT',
  CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32), CLOUDFLARE_DATABASE_ID: '12345678-1234-1234-1234-123456789012'
};
const cards = ['Heat to 200°C (180°C fan). Add 1.5 tbsp oil and ½ tsp salt. Stir. Stir.', 'Cut two chicken breasts into 2 cm pieces. Cook for 2–3 minutes. Rest for two minutes.'];
const publicFixture = () => Array.from({ length: 100 }, (_, index) => ({
  id: 'public-' + index, ingredients: [['Oil', '1 tbsp', 1, 'Other']], method: [...cards]
}));
const privateFixture = () => Array.from({ length: 400 }, (_, index) => {
  const id = 'protected-' + index;
  const recipe = { id, name: secret + ' ' + index, premium: true, accessTier: 'premium', ingredients: [['Oil ' + secret, '1 tbsp', 1, 'Other']], method: [...cards] };
  return { recipe_id: id, sort_index: index, recipe_json: JSON.stringify(recipe), normalized_json: JSON.stringify({ id, ingredients: [{ name: secret, quantity: 1, unit: 'tbsp' }] }) };
});
const response = rows => new Response(JSON.stringify({ success: true, result: [{ success: true, results: rows }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const safe = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(text, /SYNTHETIC PRIVATE RECIPE CONTENT|SYNTHETIC-DEDICATED-READ-TOKEN|BROAD-TOKEN|provider-secret/);
};

test('summary audit uses one fixed read with the dedicated token and exposes only 100 + 400 aggregate results', async () => {
  const rows = privateFixture(), publicRecipes = publicFixture(), before = JSON.stringify({ rows, publicRecipes }), calls = [];
  const result = await auditCookMethodSummary({ env, publicRecipes, perform: async (address, options) => {
    calls.push(address);
    assert.match(address, /\/d1\/database\/12345678-1234-1234-1234-123456789012\/query$/);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(JSON.parse(options.body), { sql: PRIVATE_RECIPE_SELECT });
    return response(rows);
  } });
  assert.equal(calls.length, 1);
  assert.equal(result.readOnly, true);
  assert.equal(result.allCatalogueMethodsChecked, true);
  assert.equal(result.auditScope, 'method parsing, invariant preservation and idempotence');
  assert.equal(Object.hasOwn(result, 'current500FullyAudited'), false);
  assert.equal(result.publicRecipes, 100);
  assert.equal(result.protectedRecipes, 400);
  assert.equal(result.currentFullRecords, 500);
  assert.equal(result.sourceCommit, env.GITHUB_SHA);
  assert.equal(result.protectedRowsSha256, createHash('sha256').update(JSON.stringify(rows)).digest('hex'));
  assert.equal(result.protected.sourceCards, 800);
  assert.equal(result.protected.normalizedCards, 800);
  assert.equal(result.protected.changedCards, 400);
  assert.equal(result.affectedRecipes, 0);
  assert(Object.values(result.issues).every(count => count === 0));
  assert.equal(JSON.stringify({ rows, publicRecipes }), before);
  safe(result);
  const output = [];
  assert.equal(await runCookMethodSummary({ env, publicRecipes, perform: async () => response(rows), write: line => output.push(line) }), 0);
  assert.equal(output.length, 1);
  safe(output[0]);
});

test('wrong event, repository, branch, runner or commit is rejected before any read', async () => {
  for (const overrides of [
    { GITHUB_ACTIONS: 'false' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REPOSITORY: 'someone-else/BasketBoss' }, { GITHUB_REF: 'refs/pull/1/merge' },
    { GITHUB_REF: 'refs/heads/release/recipe-editorial-collections' }, { GITHUB_SHA: secret }
  ]) {
    let called = false;
    const output = [];
    assert.equal(await runCookMethodSummary({ env: { ...env, ...overrides }, publicRecipes: publicFixture(), perform: async () => { called = true; throw Error(secret); }, write: line => output.push(line) }), 1);
    assert.equal(called, false);
    assert.deepEqual(output.map(line => JSON.parse(line)), [{ error: 'cook_method_audit_context_invalid' }]);
    safe(output);
  }
});

test('missing dedicated token fails clearly even when a broad token exists', async () => {
  let called = false;
  const output = [];
  assert.equal(await runCookMethodSummary({ env: { ...env, CLOUDFLARE_RECIPE_AUDIT_READ_TOKEN: '' }, publicRecipes: publicFixture(), perform: async () => { called = true; throw Error(secret); }, write: line => output.push(line) }), 1);
  assert.equal(called, false);
  assert.deepEqual(output.map(line => JSON.parse(line)), [{ error: 'cook_method_audit_read_token_unconfigured' }]);
  safe(output);
});

test('provider failure bodies and thrown private errors cannot reach output', async () => {
  for (const perform of [
    async () => new Response('provider-secret ' + token + ' ' + secret, { status: 403 }),
    async () => { throw Error('provider-secret ' + token + ' ' + secret); },
    async () => new Response('provider-secret ' + secret, { status: 200 })
  ]) {
    const output = [];
    assert.equal(await runCookMethodSummary({ env, publicRecipes: publicFixture(), perform, write: line => output.push(line) }), 1);
    assert.equal(output.length, 1);
    assert.match(JSON.parse(output[0]).error, /^cook_method_audit_protected_read_(?:failed|denied)$/);
    safe(output);
  }
});

test('count, empty output, quantity, time, temperature and idempotence regressions produce only fixed issue counts', async () => {
  for (const [change, issue] of [
    [value => value.slice(1), 'normalized_card_count_changed'],
    [value => value.map(() => ''), 'normalized_invalid'],
    [value => value.map(card => card.replace('1.5 tbsp', '1.5 tsp')), 'measurement_changed'],
    [value => value.map(card => card.replace('½ tsp', '½ tbsp')), 'measurement_changed'],
    [value => value.map(card => card.replace('2–3 minutes', '2–3 hours')), 'measurement_changed'],
    [value => value.map(card => card.replace('two minutes', 'two seconds')), 'measurement_changed'],
    [value => value.map(card => card.replace('2 cm', '2 mm')), 'measurement_changed'],
    [value => value.map(card => card.replace('two chicken breasts', 'three chicken breasts')), 'measurement_changed'],
    [value => value.map(card => card.replace('200°C', '200°F')), 'measurement_changed']
  ]) {
    const methodApi = { ...method, normalizeMethod: (value, context) => change(method.normalizeMethod(value, context)) };
    const result = await auditCookMethodSummary({ env, publicRecipes: publicFixture(), perform: async () => response(privateFixture()), methodApi });
    assert.equal(result.issues[issue], 500);
    assert.equal(result.affectedRecipes, 500);
    safe(result);
  }
  const methodApi = { ...method, normalizeMethod: (value, context) => method.normalizeMethod(value, context).map(card => card + ' Stir.') };
  const result = await auditCookMethodSummary({ env, publicRecipes: publicFixture(), perform: async () => response(privateFixture()), methodApi });
  assert.equal(result.issues.not_idempotent, 500);
  safe(result);
});

test('ingredient mutation, source card loss and thrown method errors are detected without exposing recipes', async () => {
  for (const [methodApi, issue] of [
    [{ ...method, sourceMethod: recipe => { recipe.ingredients.push([secret]); return method.sourceMethod(recipe); } }, 'ingredients_mutated'],
    [{ ...method, sourceMethod: recipe => method.sourceMethod(recipe).slice(1) }, 'source_card_count_changed'],
    [{ ...method, normalizeMethod: () => { throw Error(secret + token); } }, 'method_exception']
  ]) {
    const output = [];
    assert.equal(await runCookMethodSummary({ env, publicRecipes: publicFixture(), perform: async () => response(privateFixture()), methodApi, write: line => output.push(line) }), 1);
    assert.equal(JSON.parse(output[0]).issues[issue], 500);
    safe(output);
  }
});

test('current public methods also satisfy the same audit without private fixtures or output files', async () => {
  const result = await auditCookMethodSummary({ env, perform: async () => response(privateFixture()) });
  assert.equal(result.public.recipes, 100);
  assert.equal(result.public.affectedRecipes, 0);
  safe(result);
  const source = fs.readFileSync(new URL('../scripts/audit-cook-method-private-summary.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFile|appendFile|mkdir|mkdtemp|createWriteStream|writePrivateRecipeExport|loadPrivateRecipeAudit)\b/);
});

test('workflow adds a separate trusted-main-push summary job and preserves the manual sealed job', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/cloudflare-catalogue-check.yml', import.meta.url), 'utf8');
  const job = workflow.split(/\n  cook_method_readonly_summary:\s*\n/)[1]?.split(/\n  readonly_recipe_audit:\s*\n/)[0];
  assert(job);
  assert.match(job, /github\.event_name\s*==\s*'push'/);
  assert.match(job, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(job, /github\.repository\s*==\s*'jbatiste12-debug\/BasketBoss'/);
  assert.match(job, /CLOUDFLARE_RECIPE_AUDIT_READ_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_RECIPE_AUDIT_READ_TOKEN\s*\}\}/);
  assert.match(job, /persist-credentials:\s*false/);
  assert.match(job, /run:\s*node scripts\/audit-cook-method-private-summary\.mjs/);
  assert.doesNotMatch(job, /secrets\.CLOUDFLARE_API_TOKEN\b|GITHUB_STEP_SUMMARY|wrangler|deploy|--out/);
  assert.doesNotMatch(job, /upload-artifact|--review-recipient|--sealed-review-output|--review-transport-log/);
  for (const file of ['bb-cook-method.js', 'recipes.json', 'scripts/load-private-recipe-audit.mjs', 'scripts/audit-cook-method-private-summary.mjs']) assert(workflow.split('\npermissions:')[0].includes('      - ' + file));
});
