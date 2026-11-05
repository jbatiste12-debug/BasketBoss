// Main-only, reviewed Cook content correction. Private rows, SQL, credentials,
// provider responses and subprocess output never enter logs or artifacts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectCloudflare } from './check-cloudflare-catalogue.mjs';
import { validatePrivateRecipeExport, PRIVATE_RECIPE_SELECT } from './load-private-recipe-audit.mjs';
import { openPayload, recipientForToken, sealPayload } from './private-catalogue-envelope.mjs';
import { COOK_CORRECTION_SOURCE, COOK_CORRECTION_RECIPIENT_FINGERPRINT, COOK_CORRECTION_SEALED_FILE, COOK_CORRECTION_MANIFEST_FILE } from './prepare-cook-content-corrections.mjs';

// Filled only after the complete private review has produced its exact sealed
// candidate. Public-key encryption alone does not authenticate a publisher.
export const APPROVED_COOK_CORRECTION = Object.freeze({
  manifestSha256: 'unprepared', payloadSha256: 'unprepared',
  sealedSha256: 'unprepared', reviewSourceCommit: 'unprepared',
  beforeRowsSha256: COOK_CORRECTION_SOURCE.sourceRowsSha256,
  recipientFingerprint: COOK_CORRECTION_RECIPIENT_FINGERPRINT
});
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = 'bb_private_premium_recipes_500_v1';
const LEGACY_SELECT = 'SELECT sort_index,recipe_json,normalized_json FROM bb_private_premium_recipes ORDER BY sort_index';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Error('cook_content_activation_' + code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
function fields(value, expected) {
  if (!object(value) || Reflect.ownKeys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) fail('shape');
}
function rowsChecked(rows, digest, source) {
  if (!Array.isArray(rows) || rows.some(row => !object(row) || Object.keys(row).length !== 4 || !['recipe_id', 'sort_index', 'recipe_json', 'normalized_json'].every(key => Object.hasOwn(row, key)))) fail('rows_shape');
  validatePrivateRecipeExport({ schemaVersion: 1, source, rowsSha256: digest, rows });
}
function content(recipe) {
  if (!Array.isArray(recipe.method) || !recipe.method.length || recipe.method.length > 40 || !same(recipe.method, recipe.steps) || recipe.method.some(step => typeof step !== 'string' || !step.trim() || step.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(step))) fail('method');
  if (Object.hasOwn(recipe, 'culinary_prep_notes') && (!Array.isArray(recipe.culinary_prep_notes) || recipe.culinary_prep_notes.length !== recipe.ingredients.length || recipe.culinary_prep_notes.some(note => typeof note !== 'string' || !note.trim() || note.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(note)))) fail('notes');
}

/** Validate the entire current catalogue before generating any writable SQL. */
export function validateCookContentTransition(payload, currentRows) {
  if (!object(payload) || payload.kind !== 'basketboss-cook-content-corrections' || payload.schemaVersion !== 1 || !hex(payload.beforeRowsSha256) || !hex(payload.afterRowsSha256) || payload.beforeRowsSha256 === payload.afterRowsSha256 || !Array.isArray(payload.changes) || !payload.changes.length || payload.changes.length > 400 || !object(payload.source?.snapshot)) fail('payload');
  rowsChecked(payload.rows, payload.afterRowsSha256, payload.source.snapshot);
  const currentHash = hash(JSON.stringify(currentRows));
  if (![payload.beforeRowsSha256, payload.afterRowsSha256].includes(currentHash)) fail('stale_catalogue');
  rowsChecked(currentRows, currentHash, payload.source.snapshot);
  const alreadyApplied = currentHash === payload.afterRowsSha256;
  const changes = new Map();
  for (const change of payload.changes) {
    fields(change, ['id', 'index', 'originalRecipeSha256', 'newRecipeSha256', 'normalizedSha256', 'reasons']);
    const row = payload.rows[change.index];
    if (!Number.isInteger(change.index) || row?.recipe_id !== change.id || changes.has(change.id) || !hex(change.originalRecipeSha256) || change.newRecipeSha256 !== hash(row.recipe_json) || change.normalizedSha256 !== hash(row.normalized_json) || change.originalRecipeSha256 === change.newRecipeSha256 || !Array.isArray(change.reasons) || !change.reasons.length || change.reasons.some(reason => typeof reason !== 'string' || !reason.trim())) fail('change');
    content(JSON.parse(row.recipe_json));
    changes.set(change.id, change);
  }
  for (const [index, next] of payload.rows.entries()) {
    const previous = currentRows[index], change = changes.get(next.recipe_id);
    if (next.recipe_id !== previous.recipe_id || next.sort_index !== previous.sort_index || next.normalized_json !== previous.normalized_json) fail('protected_row');
    if (alreadyApplied || !change) {
      if (next.recipe_json !== previous.recipe_json) fail('unreviewed_row');
      continue;
    }
    if (change.originalRecipeSha256 !== hash(previous.recipe_json)) fail('stale_recipe');
    const before = JSON.parse(previous.recipe_json), after = JSON.parse(next.recipe_json);
    const allowed = new Set(['method', 'steps', 'culinary_prep_notes']);
    const protectedFields = value => Object.fromEntries(Object.entries(value).filter(([key]) => !allowed.has(key)));
    if (!same(protectedFields(before), protectedFields(after))) fail('protected_recipe');
    if (same(before.method, after.method) && same(before.steps, after.steps) && same(before.culinary_prep_notes, after.culinary_prep_notes)) fail('empty_change');
  }
  return { alreadyApplied, beforeRows: currentRows, afterRows: payload.rows, changes: [...changes.values()] };
}

export function buildCookContentCorrectionSql(payload, currentRows) {
  const transition = validateCookContentTransition(payload, currentRows);
  const quote = value => {
    if (typeof value !== 'string' || value.includes('\0')) fail('sql_text');
    return "'" + value.replaceAll("'", "''") + "'";
  };
  // abs(INT64_MIN) reliably raises a SQLite error. These assertions execute
  // within the same D1 file-import transaction as every UPDATE, closing the
  // gap between the API read and import without creating any schema objects.
  const guard = condition => `SELECT CASE WHEN ${condition} THEN 1 ELSE abs(-9223372036854775808) END;`;
  const rowGuard = row => guard(`EXISTS(SELECT 1 FROM ${TABLE} WHERE recipe_id=${quote(row.recipe_id)} AND sort_index=${row.sort_index} AND recipe_json=${quote(row.recipe_json)} AND normalized_json=${quote(row.normalized_json)})`);
  const statements = [
    '-- Private Cook correction: import the whole file atomically with pinned Wrangler.',
    '-- No BEGIN/COMMIT: the D1 file import service owns the transaction.',
    guard(`(SELECT COUNT(*) FROM ${TABLE})=400`),
    ...currentRows.map(rowGuard),
    ...(!transition.alreadyApplied ? transition.changes.map(change => {
      const row = payload.rows[change.index];
      return `UPDATE ${TABLE} SET recipe_json=${quote(row.recipe_json)} WHERE recipe_id=${quote(row.recipe_id)} AND sort_index=${row.sort_index};`;
    }) : []),
    ...payload.rows.map(rowGuard),
    guard(`(SELECT COUNT(*) FROM ${TABLE})=400`)
  ];
  if (statements.some(statement => Buffer.byteLength(statement) > 100000)) fail('sql_statement_size');
  return statements.join('\n') + '\n';
}

export function requireCookCorrectionEnvironment(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'jbatiste12-debug/BasketBoss' || env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) || !['inspect', 'activate'].includes(env.BB_IMPORT_MODE) || !env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP)) fail('untrusted_environment');
}
export function validateCookCorrectionManifest(manifest, sealedBytes, approved = APPROVED_COOK_CORRECTION) {
  fields(manifest, ['schemaVersion', 'releaseId', 'counts', 'beforeRowsSha256', 'afterRowsSha256', 'sourceCommit', 'githubRunId', 'reviewSourceCommit', 'recipientFingerprint', 'payloadSha256', 'sealedSha256']);
  if (manifest.schemaVersion !== 1 || manifest.releaseId !== 'cook-content-corrections' || manifest.sourceCommit !== COOK_CORRECTION_SOURCE.sourceCommit || manifest.githubRunId !== COOK_CORRECTION_SOURCE.githubRunId || manifest.beforeRowsSha256 !== approved.beforeRowsSha256 || !hex(manifest.afterRowsSha256) || manifest.recipientFingerprint !== approved.recipientFingerprint || !hex(approved.payloadSha256) || manifest.payloadSha256 !== approved.payloadSha256 || manifest.sealedSha256 !== approved.sealedSha256 || hash(sealedBytes) !== approved.sealedSha256 || manifest.reviewSourceCommit !== approved.reviewSourceCommit) fail('release_pin');
  fields(manifest.counts, ['reviewed', 'contentFix', 'pass', 'review', 'authorReview']);
  const counts = manifest.counts;
  if (counts.reviewed !== 400 || counts.contentFix < 1 || counts.contentFix + counts.pass + counts.review !== 400 || Object.values(counts).some(n => !Number.isSafeInteger(n) || n < 0)) fail('counts');
  return true;
}
function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1024 * 1024, ...options });
  if (result.status !== 0 || result.error) fail('command_failed');
  return result.stdout.trim();
}
function trustedMain(env, root, approved, run) {
  if (run('git', ['rev-parse', 'HEAD'], { cwd: root }) !== env.GITHUB_SHA) fail('checkout_commit');
  run('git', ['merge-base', '--is-ancestor', COOK_CORRECTION_SOURCE.sourceCommit, 'HEAD'], { cwd: root });
  run('git', ['merge-base', '--is-ancestor', approved.reviewSourceCommit, 'HEAD'], { cwd: root });
  if (run('git', ['ls-remote', 'origin', 'refs/heads/main'], { cwd: root }).split(/\s+/)[0] !== env.GITHUB_SHA) fail('main_changed');
}
async function queryRows(env, connection, sql, perform) {
  if (![PRIVATE_RECIPE_SELECT, LEGACY_SELECT].includes(sql)) fail('read_query');
  const response = await perform(`https://api.cloudflare.com/client/v4/accounts/${connection.accountId}/d1/database/${connection.databaseId}/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }), redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (Number(response.headers?.get?.('content-length')) > 24 * 1024 * 1024) fail('read_size');
  const text = await response.text();
  if (text.length > 24 * 1024 * 1024) fail('read_size');
  let result;
  try { result = JSON.parse(text); } catch { fail('read_invalid'); }
  if (!response.ok || result?.success !== true || result.result?.length !== 1 || result.result[0].success === false || !Array.isArray(result.result[0].results)) fail('read_invalid');
  return result.result[0].results;
}

// Dependency injection is for offline synthetic verification; the CLI always
// uses this module's immutable production policy, checkout and real commands.
export async function activateCookContentCorrections(env = process.env, perform = fetch, { root = ROOT, approved = APPROVED_COOK_CORRECTION, inspect = inspectCloudflare, runCommand = command } = {}) {
  requireCookCorrectionEnvironment(env);
  if (typeof env.CLOUDFLARE_API_TOKEN !== 'string' || !/^[\x21-\x7e]{32,4096}$/.test(env.CLOUDFLARE_API_TOKEN)) fail('token');
  const readPublic = (file, max) => { const address = path.join(root, file), stat = fs.lstatSync(address); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) fail('release_file'); return fs.readFileSync(address); };
  const manifestBytes = readPublic(COOK_CORRECTION_MANIFEST_FILE, 16000);
  if (!hex(approved.manifestSha256) || hash(manifestBytes) !== approved.manifestSha256) fail('manifest_pin');
  const sealedBytes = readPublic(COOK_CORRECTION_SEALED_FILE, 24 * 1024 * 1024);
  const manifest = JSON.parse(manifestBytes);
  validateCookCorrectionManifest(manifest, sealedBytes, approved);
  const envelope = JSON.parse(sealedBytes);
  let plaintext, payload;
  try {
    plaintext = openPayload(envelope, env.CLOUDFLARE_API_TOKEN);
    if (hash(plaintext) !== manifest.payloadSha256 || envelope.metadata.releaseId !== manifest.releaseId || envelope.metadata.sourceCommit !== manifest.reviewSourceCommit) fail('payload_pin');
    payload = JSON.parse(plaintext);
  } finally { plaintext?.fill(0); }
  if (payload.reviewSourceCommit !== manifest.reviewSourceCommit || payload.beforeRowsSha256 !== manifest.beforeRowsSha256 || payload.afterRowsSha256 !== manifest.afterRowsSha256 || payload.changes?.length !== manifest.counts.contentFix || payload.authorReview?.length !== manifest.counts.authorReview || !same(payload.source, { ...COOK_CORRECTION_SOURCE, snapshot: payload.source?.snapshot })) fail('manifest_payload');
  trustedMain(env, root, approved, runCommand);
  const connection = await inspect(env, perform);
  if (!/^[a-f0-9]{32}$/i.test(connection.accountId || '') || !/^[a-f0-9-]{36}$/i.test(connection.databaseId || '') || connection.databaseId !== payload.source.snapshot.databaseId || connection.counts[TABLE] !== 400) fail('production_binding');
  const query = sql => queryRows(env, connection, sql, perform);
  const current = await query(PRIVATE_RECIPE_SELECT), legacy = await query(LEGACY_SELECT);
  if (legacy.length !== 221) fail('legacy_count');
  const legacyHash = hash(JSON.stringify(legacy));
  const transition = validateCookContentTransition(payload, current);
  const sql = buildCookContentCorrectionSql(payload, current);
  const result = { releaseId: manifest.releaseId, mode: env.BB_IMPORT_MODE, alreadyApplied: transition.alreadyApplied, imported: false, reviewed: 400, corrected: payload.changes.length, beforeRowsSha256: manifest.beforeRowsSha256, afterRowsSha256: manifest.afterRowsSha256 };
  if (env.BB_IMPORT_MODE === 'inspect') return { ...result, ready: true };
  const temp = fs.realpathSync(env.RUNNER_TEMP), work = fs.mkdtempSync(path.join(temp, 'basketboss-cook-content-'));
  fs.chmodSync(work, 0o700);
  try {
    const rollback = Buffer.from(JSON.stringify({ schemaVersion: 1, releaseId: manifest.releaseId, createdAt: new Date().toISOString(), databaseId: connection.databaseId, rowsSha256: hash(JSON.stringify(current)), rows: current, legacyRowsSha256: legacyHash, legacyRows: legacy }));
    try { fs.writeFileSync(path.join(temp, 'basketboss-cook-content-rollback.sealed.json'), JSON.stringify(sealPayload(rollback, recipientForToken(env.CLOUDFLARE_API_TOKEN), { releaseId: 'cook-content-corrections-rollback', sourceCommit: env.GITHUB_SHA })), { mode: 0o600, flag: 'wx' }); }
    finally { rollback.fill(0); }
    if (!transition.alreadyApplied) {
      trustedMain(env, root, approved, runCommand);
      const binary = env.WRANGLER_BIN;
      if (!binary || !path.isAbsolute(binary) || !fs.existsSync(binary)) fail('wrangler_missing');
      if (!/\b4\.156\.0\b/.test(runCommand(binary, ['--version'], { env: { ...env, WRANGLER_SEND_METRICS: 'false' } }))) fail('wrangler_version');
      const sqlPath = path.join(work, 'cook.private.sql'), configPath = path.join(work, 'wrangler.json');
      fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
      fs.writeFileSync(configPath, JSON.stringify({ name: 'basketboss-cook-content-corrections', account_id: connection.accountId, compatibility_date: '2026-10-31', d1_databases: [{ binding: 'BB_CATALOGUE_DB', database_name: 'basketboss-private-catalogue', database_id: connection.databaseId }] }), { mode: 0o600 });
      runCommand(binary, ['d1', 'execute', 'BB_CATALOGUE_DB', '--remote', '--file', sqlPath, '--config', configPath, '--yes'], { cwd: work, timeout: 240000, maxBuffer: 8 * 1024 * 1024, env: { ...env, CLOUDFLARE_ACCOUNT_ID: connection.accountId, WRANGLER_SEND_METRICS: 'false', CI: 'true' } });
      result.imported = true;
    }
    const after = await query(PRIVATE_RECIPE_SELECT);
    if (hash(JSON.stringify(after)) !== manifest.afterRowsSha256 || !same(after, payload.rows)) fail('readback');
    if (hash(JSON.stringify(await query(LEGACY_SELECT))) !== legacyHash) fail('legacy_changed');
    return { ...result, verified: true, normalizedUnchanged: true, legacyUnchanged: true };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

export async function runCookContentActivationCLI({ log = console.log, error = console.error } = {}) {
  try { const result = await activateCookContentCorrections(); log(JSON.stringify(result)); return 0; }
  catch (cause) { error(/^cook_content_activation_[a-z_]+$/.test(cause?.message || '') ? cause.message : 'cook_content_activation_unavailable'); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCookContentActivationCLI();
