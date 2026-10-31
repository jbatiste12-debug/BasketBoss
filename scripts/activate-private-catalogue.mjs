// Main-only private catalogue activation. No plaintext recipes, SQL, provider
// bodies or subprocess output are written to the Actions log or artifacts.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectCloudflare} from './check-cloudflare-catalogue.mjs';
import {premiumImportSql, VERSIONED_PREMIUM_TABLE} from './prepare-recipe-release.mjs';
import {recipientForToken, sealPayload, openPayload} from './private-catalogue-envelope.mjs';

export const APPROVED_RELEASE = Object.freeze({
  schemaVersion: 1,
  releaseId: 'recipes-500-20261031',
  sourceCommit: '51caacf0383f1d4b6d3047989543de29466212b2',
  sqlSha256: 'acf472076a8531a0d25e14e3c12dea8c979693e4d6e726dead7ffe437b440eb5'
});
const REPOSITORY = 'jbatiste12-debug/BasketBoss';
export const APPROVED_PAYLOAD_SHA256 = '8fba363da3d82218152c733757e65ca4f0bdfdfa100981cae2f463ce627aaaea';
const LEGACY_TABLE = 'bb_private_premium_recipes';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assert = (value, message) => {if (!value) throw Error(message);};
const sha = value => createHash('sha256').update(value).digest('hex');
const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,255}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, required) {
  return object(value) && Object.keys(value).length === required.length && required.every(key => Object.hasOwn(value, key));
}

export function validateCatalogueRows(rows, baselinePremiumIds) {
  assert(Array.isArray(rows) && rows.length === 400, 'Private release must contain exactly 400 Premium rows.');
  assert(Array.isArray(baselinePremiumIds) && baselinePremiumIds.length === 221 && baselinePremiumIds.every(slug) && new Set(baselinePremiumIds).size === 221, 'Private release has invalid legacy recipe IDs.');
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    assert(fields(row, ['recipe_id', 'sort_index', 'recipe_json', 'normalized_json']), 'Private release has an invalid row shape.');
    assert(row.sort_index === index && slug(row.recipe_id) && !ids.has(row.recipe_id), 'Private release has invalid or duplicate recipe IDs.');
    assert(typeof row.recipe_json === 'string' && typeof row.normalized_json === 'string' && row.recipe_json.length <= 90000 && row.normalized_json.length <= 90000, 'Private release row exceeds its size limit.');
    let recipe, normalized;
    try {recipe = JSON.parse(row.recipe_json); normalized = JSON.parse(row.normalized_json);} catch {throw Error('Private release row is not valid JSON.');}
    assert(recipe?.id === row.recipe_id && normalized?.id === row.recipe_id, 'Private release recipe IDs do not match.');
    assert(Array.isArray(recipe.ingredients) && Array.isArray(normalized.ingredients) && recipe.ingredients.length > 0 && recipe.ingredients.length === normalized.ingredients.length, 'Private release ingredients do not match.');
    assert(recipe.accessTier === 'premium' && recipe.premium === true, 'Private release contains a non-Premium row.');
    assert(typeof recipe.image === 'string' && /^release-assets\/basketboss-v17\/images\/(?:existing|new|preview_single_dish)\/[a-z0-9._-]+\.webp$/i.test(recipe.image), 'Private release has an invalid image path.');
    if (index < 221) assert(row.recipe_id === baselinePremiumIds[index], 'Private release changes the legacy Premium order.');
    else {
      assert(recipe.catalogueNumber === 322 + index - 221, 'Private release addition numbers must cover 322 through 500.');
      assert(recipe.image.startsWith('release-assets/basketboss-v17/images/new/'), 'Private release addition has an invalid image directory.');
    }
    ids.add(row.recipe_id);
  }
  return premiumImportSql(rows);
}

export function validateApprovedPayload(payload, metadata) {
  assert(fields(payload, ['schemaVersion', 'releaseId', 'sourceCommit', 'sqlSha256', 'rows', 'baselinePremiumIds']), 'Private release payload shape is invalid.');
  for (const [key, value] of Object.entries(APPROVED_RELEASE)) assert(payload[key] === value, 'Private release does not match the approved release.');
  assert(metadata?.releaseId === APPROVED_RELEASE.releaseId && metadata?.sourceCommit === APPROVED_RELEASE.sourceCommit, 'Encrypted release metadata does not match the approved release.');
  const sql = validateCatalogueRows(payload.rows, payload.baselinePremiumIds);
  // Public-key encryption does not authenticate the sender. This reviewed hash
  // prevents a different encrypted payload from becoming arbitrary SQL.
  assert(sha(sql) === APPROVED_RELEASE.sqlSha256, 'Private release SQL hash does not match the approved catalogue.');
  return sql;
}

export function legacyRowsDigest(rows, baselinePremiumIds) {
  assert(Array.isArray(rows) && rows.length === 221, 'Production legacy catalogue must contain exactly 221 rows.');
  const expected = new Set(baselinePremiumIds), actual = new Set();
  for (const row of rows) {
    let recipe, normalized;
    try {recipe = JSON.parse(row.recipe_json); normalized = JSON.parse(row.normalized_json);} catch {throw Error('Production legacy catalogue is invalid.');}
    assert(slug(recipe?.id) && recipe.id === normalized?.id && expected.has(recipe.id) && !actual.has(recipe.id), 'Production legacy recipe IDs differ from the approved baseline.');
    actual.add(recipe.id);
  }
  return sha(JSON.stringify(rows.map(row => [row.sort_index, row.recipe_json, row.normalized_json])));
}

export function verifyExpandedRows(actual, expected) {
  assert(Array.isArray(actual) && actual.length === 400, 'Versioned production catalogue does not contain exactly 400 rows.');
  for (const [index, row] of actual.entries()) {
    const wanted = expected[index];
    assert(row.recipe_id === wanted.recipe_id && row.sort_index === wanted.sort_index && row.recipe_json === wanted.recipe_json && row.normalized_json === wanted.normalized_json, 'Versioned production catalogue content does not match the approved release.');
  }
  return true;
}

export function requireReleaseEnvironment(env) {
  assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF === 'refs/heads/main', 'Activation is restricted to this repository main-branch Actions environment.');
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ''), 'The Actions commit ID is invalid.');
  assert(env.RUNNER_TEMP && path.isAbsolute(env.RUNNER_TEMP), 'A private runner temporary directory is required.');
  assert(['inspect', 'activate'].includes(env.BB_IMPORT_MODE), 'Choose inspect or activate mode.');
}

function git(args) {
  const result = spawnSync('git', args, {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1024 * 1024});
  assert(result.status === 0 && !result.error, 'Release Git verification failed.');
  return result.stdout.trim();
}
function verifyReleaseCommits(env, productionCommit) {
  assert(git(['rev-parse', 'HEAD']) === env.GITHUB_SHA, 'The checked-out release commit differs from the Actions event.');
  git(['merge-base', '--is-ancestor', APPROVED_RELEASE.sourceCommit, 'HEAD']);
  assert(/^[a-f0-9]{40}$/.test(productionCommit || ''), 'The active production deployment commit could not be verified.');
  git(['merge-base', '--is-ancestor', APPROVED_RELEASE.sourceCommit, productionCommit]);
}

async function databaseRows(env, connection, sql, perform) {
  assert(/^SELECT\s/.test(sql), 'Only read queries are permitted through the verification API.');
  const response = await perform('https://api.cloudflare.com/client/v4/accounts/' + connection.accountId + '/d1/database/' + connection.databaseId + '/query', {
    method: 'POST', headers: {Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json'},
    body: JSON.stringify({sql}), redirect: 'error', signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => null);
  assert(response.ok && result?.success === true && Array.isArray(result.result) && result.result.length === 1 && result.result[0].success !== false && Array.isArray(result.result[0].results), 'Private production database verification failed.');
  return result.result[0].results;
}

export async function verifyLivePublicRoutes(rows, perform = fetch) {
  const base = 'https://basketboss.co.uk';
  const read = async (route, method = 'GET') => {
    let address = new URL(route, base);
    for (let hop = 0; hop < 4; hop++) {
      assert(['https://basketboss.co.uk', 'https://www.basketboss.co.uk'].includes(address.origin), 'The live public route redirects outside BasketBoss.');
      const response = await perform(address.href, {method, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000)});
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers?.get('location');
      assert(location, 'The live public route returned an invalid redirect.');
      address = new URL(location, address);
    }
    throw Error('The live public route redirects too many times.');
  };
  const landing = await read('/');
  assert(landing.ok && /500\s+(?:(?:Premium\s+)?recipes|with\s+Premium)/i.test(await landing.text()), 'The live landing page has not yet published the 500-recipe copy.');
  const free = await read('/recipes.json');
  const freeRecipes = free.ok ? await free.json().catch(() => null) : null;
  assert(Array.isArray(freeRecipes) && freeRecipes.length === 100, 'The live public recipe catalogue is not exactly 100 recipes.');
  const premium = await read('/api/recipes/premium?catalogue=500');
  assert([401, 403].includes(premium.status), 'The live Premium endpoint did not enforce its signed-in access boundary.');
  const image = JSON.parse(rows[221].recipe_json).image;
  const photo = await read('/' + image, 'HEAD');
  assert(photo.ok && /image\/webp/i.test(photo.headers.get('content-type') || ''), 'A new production recipe image could not be verified.');
  return {landing500: true, freeRecipes: 100, premiumAccessGuard: true, representativeNewImage: true};
}

export async function activatePrivateCatalogue(env = process.env, perform = fetch) {
  requireReleaseEnvironment(env);
  assert(typeof env.CLOUDFLARE_API_TOKEN === 'string' && env.CLOUDFLARE_API_TOKEN.length >= 32, 'The Cloudflare secret is unavailable.');
  const envelopePath = path.join(ROOT, '.github/private-catalogue/recipes-500.sealed.json');
  assert(fs.statSync(envelopePath).size < 24 * 1024 * 1024, 'The encrypted catalogue exceeds its size limit.');
  const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
  let plaintext;
  let payload;
  try {
    plaintext = openPayload(envelope, env.CLOUDFLARE_API_TOKEN);
    assert(sha(plaintext) === APPROVED_PAYLOAD_SHA256, 'Private release payload hash does not match the approved catalogue.');
    payload = JSON.parse(plaintext.toString('utf8'));
  }
  finally {plaintext?.fill(0);}
  const sql = validateApprovedPayload(payload, envelope.metadata);
  const connection = await inspectCloudflare(env, perform);
  assert(/^[a-f0-9]{32}$/i.test(connection.accountId || '') && /^[a-f0-9-]{36}$/i.test(connection.databaseId || ''), 'The verified production binding is invalid.');
  verifyReleaseCommits(env, connection.productionCommit);
  const query = sqlText => databaseRows(env, connection, sqlText, perform);
  const legacyBefore = await query('SELECT sort_index,recipe_json,normalized_json FROM ' + LEGACY_TABLE + ' ORDER BY sort_index');
  const legacyHash = legacyRowsDigest(legacyBefore, payload.baselinePremiumIds);
  const expandedBefore = connection.counts[VERSIONED_PREMIUM_TABLE] === null ? [] : await query('SELECT recipe_id,sort_index,recipe_json,normalized_json FROM ' + VERSIONED_PREMIUM_TABLE + ' ORDER BY sort_index');
  let alreadyActivated = false;
  try {alreadyActivated = verifyExpandedRows(expandedBefore, payload.rows);} catch { /* A different or absent versioned release requires an atomic import. */ }
  const safeResult = {releaseId: APPROVED_RELEASE.releaseId, sourceCommit: APPROVED_RELEASE.sourceCommit, sqlSha256: APPROVED_RELEASE.sqlSha256, project: connection.project, databaseId: connection.databaseId, mode: env.BB_IMPORT_MODE, alreadyActivated, imported: false};
  if (env.BB_IMPORT_MODE === 'inspect') return {...safeResult, ready: true, existingPremiumRows: expandedBefore.length, legacyPremiumRows: 221};

  const tempRoot = fs.realpathSync(env.RUNNER_TEMP);
  const work = fs.mkdtempSync(path.join(tempRoot, 'basketboss-private-import-'));
  fs.chmodSync(work, 0o700);
  try {
    const rollback = Buffer.from(JSON.stringify({schemaVersion: 1, releaseId: APPROVED_RELEASE.releaseId, createdAt: new Date().toISOString(), project: connection.project, databaseId: connection.databaseId, legacyRows: legacyBefore, versionedRows: expandedBefore}));
    try {
      const sealed = sealPayload(rollback, recipientForToken(env.CLOUDFLARE_API_TOKEN), {releaseId: APPROVED_RELEASE.releaseId + '-rollback', sourceCommit: env.GITHUB_SHA});
      fs.writeFileSync(path.join(tempRoot, 'basketboss-catalogue-rollback.sealed.json'), JSON.stringify(sealed), {mode: 0o600, flag: 'wx'});
    } finally {rollback.fill(0);}
    if (!alreadyActivated) {
      const latest = git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0];
      assert(latest === env.GITHUB_SHA, 'Main changed while activation was preparing; rerun the workflow on current main.');
      const sqlPath = path.join(work, 'premium.private.sql');
      fs.writeFileSync(sqlPath, sql, {mode: 0o600});
      const configPath = path.join(work, 'wrangler.json');
      fs.writeFileSync(configPath, JSON.stringify({name: 'basketboss-private-catalogue-import', account_id: connection.accountId, compatibility_date: '2026-10-31', d1_databases: [{binding: 'BB_CATALOGUE_DB', database_name: 'basketboss-private-catalogue', database_id: connection.databaseId}]}), {mode: 0o600});
      const binary = env.WRANGLER_BIN;
      assert(binary && path.isAbsolute(binary) && fs.existsSync(binary), 'Pinned Wrangler executable is unavailable.');
      const version = spawnSync(binary, ['--version'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, env: {...env, WRANGLER_SEND_METRICS: 'false'}});
      assert(version.status === 0 && /\b4\.156\.0\b/.test(version.stdout || ''), 'Wrangler version does not match the reviewed importer.');
      const imported = spawnSync(binary, ['d1', 'execute', 'BB_CATALOGUE_DB', '--remote', '--file', sqlPath, '--config', configPath, '--yes'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000, maxBuffer: 8 * 1024 * 1024,
        cwd: work, env: {...env, CLOUDFLARE_ACCOUNT_ID: connection.accountId, WRANGLER_SEND_METRICS: 'false', CI: 'true'}
      });
      assert(imported.status === 0 && !imported.error, 'Atomic D1 file import did not complete successfully. No provider or SQL output has been published.');
      safeResult.imported = true;
    }
    const after = await query('SELECT recipe_id,sort_index,recipe_json,normalized_json FROM ' + VERSIONED_PREMIUM_TABLE + ' ORDER BY sort_index');
    verifyExpandedRows(after, payload.rows);
    const legacyAfter = await query('SELECT sort_index,recipe_json,normalized_json FROM ' + LEGACY_TABLE + ' ORDER BY sort_index');
    assert(legacyRowsDigest(legacyAfter, payload.baselinePremiumIds) === legacyHash, 'The legacy table changed during activation; manual review is required.');
    console.log(annotation('notice', JSON.stringify({...safeResult, stage: 'database-verified', premiumRecipes: 400, totalRecipes: 500, legacyUnchanged: true})));
    const routes = await verifyLivePublicRoutes(payload.rows, perform);
    return {...safeResult, verified: true, premiumRecipes: 400, totalRecipes: 500, legacyUnchanged: true, publicRoutes: routes};
  } finally {fs.rmSync(work, {recursive: true, force: true});}
}

function annotation(kind, text) {
  return '::' + kind + ' title=Private catalogue activation::' + text.slice(0, 6000).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let summary;
  try {
    const result = await activatePrivateCatalogue();
    summary = JSON.stringify(result, null, 2);
    console.log(annotation('notice', JSON.stringify(result)));
  } catch (error) {
    // Every thrown validation message is fixed text. Unexpected crypto/network
    // errors are reduced to a category so no provider or plaintext can escape.
    const allowed = /^(?:Private release|Encrypted release|Production legacy|Versioned production|Activation is restricted|The (?:Actions|checked-out|active|Cloudflare|verified|encrypted|live|legacy)|A private|Choose |Release Git|Only read|Private production|Main changed|Pinned Wrangler|Wrangler version|Atomic D1|invalid_private_catalogue_)/;
    summary = allowed.test(String(error?.message || '')) ? String(error.message) : 'Private catalogue activation could not be completed. Inspect configuration and retry; no private content was logged.';
    console.error(annotation('error', summary));
    process.exitCode = 1;
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, 'Private catalogue activation\n\n```text\n' + summary + '\n```\n');
}
