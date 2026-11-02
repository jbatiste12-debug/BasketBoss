#!/usr/bin/env node
// Read-only D1 snapshot for a local audit. This module has no import/activation
// path, accepts no arbitrary SQL and never prints credentials or private rows.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = 'bb_private_premium_recipes_500_v1';
const DATABASE_NAMES = new Set(['basketboss_billing_live', 'basketboss-billing-live']);
const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const PRIVATE_RECIPE_SELECT = `SELECT recipe_id,sort_index,recipe_json,normalized_json FROM ${TABLE} ORDER BY sort_index`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error('private_recipe_audit_' + code); };
const inside = (target, directory) => target === directory || target.startsWith(directory + path.sep);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

function credentials(env) {
  const token = env?.CLOUDFLARE_API_TOKEN;
  const account = env?.CLOUDFLARE_ACCOUNT_ID?.trim();
  const database = env?.CLOUDFLARE_DATABASE_ID?.trim();
  if (typeof token !== 'string' || !/^[\x21-\x7e]{32,4096}$/.test(token)) fail('token_unavailable');
  if (typeof account !== 'string' || !/^[a-f0-9]{32}$/i.test(account)) fail('account_invalid');
  if (database && !UUID.test(database)) fail('database_invalid');
  return { token, account, database };
}

async function boundedJSON(response, limit = MAX_RESPONSE_BYTES) {
  const length = response.headers?.get?.('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) fail('response_size');
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) fail('response_size');
        chunks.push(Buffer.from(value));
      }
      bytes = Buffer.concat(chunks, size);
    } finally { await reader.cancel().catch(() => {}); }
  } else if (typeof response.text === 'function') {
    bytes = Buffer.from(await response.text());
    if (bytes.length > limit) fail('response_size');
  } else fail('response_invalid');
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail('response_invalid'); }
}

function checkedRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 400) fail('row_count');
  const ids = new Set(), recipes = [], normalizedRecipes = [];
  for (const [index, row] of rows.entries()) {
    if (!plain(row) || row.sort_index !== index || typeof row.recipe_id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,255}$/i.test(row.recipe_id) || ids.has(row.recipe_id)) fail('row_identity');
    if (typeof row.recipe_json !== 'string' || typeof row.normalized_json !== 'string' || row.recipe_json.length > 90000 || row.normalized_json.length > 90000) fail('row_shape');
    let recipe, normalized;
    try { recipe = JSON.parse(row.recipe_json); normalized = JSON.parse(row.normalized_json); } catch { fail('row_json'); }
    if (!plain(recipe) || !plain(normalized) || recipe.id !== row.recipe_id || normalized.id !== row.recipe_id) fail('row_identity');
    if (recipe.premium !== true || recipe.accessTier !== 'premium') fail('row_tier');
    if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length || !Array.isArray(normalized.ingredients) || normalized.ingredients.length !== recipe.ingredients.length) fail('row_ingredients');
    if (!Array.isArray(recipe.method) || !recipe.method.length || recipe.method.some(step => typeof step !== 'string' || !step.trim())) fail('row_method');
    ids.add(row.recipe_id); recipes.push(recipe); normalizedRecipes.push(normalized);
  }
  const bytes = Buffer.from(JSON.stringify(rows));
  if (bytes.length > MAX_EXPORT_BYTES) fail('export_size');
  return { recipes, normalized: { count_recipes: 400, count_ingredient_lines: recipes.reduce((count, recipe) => count + recipe.ingredients.length, 0), recipes: normalizedRecipes }, sha256: sha256(bytes) };
}

export async function fetchPrivateRecipeRows({ env, perform = fetch }) {
  const connection = credentials(env);
  const prefix = `https://api.cloudflare.com/client/v4/accounts/${connection.account}/d1/database`;
  async function api(address, body) {
    let response, parsed;
    try {
      response = await perform(address, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + connection.token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000)
      });
    } catch { fail('network_unavailable'); }
    if (!response?.ok) {
      await response?.body?.cancel?.().catch(() => {});
      fail([401, 403].includes(response?.status) ? 'api_denied' : 'api_unavailable');
    }
    try { parsed = await boundedJSON(response, body ? MAX_RESPONSE_BYTES : 1024 * 1024); }
    catch (error) {
      if (error?.message === 'private_recipe_audit_response_size') throw error;
      fail('response_invalid');
    }
    if (parsed?.success !== true || !Array.isArray(parsed.result)) fail('response_invalid');
    return parsed;
  }
  let databaseId = connection.database;
  if (!databaseId) {
    const matches = [];
    for (let page = 1; ; page++) {
      if (page > 100) fail('database_discovery_limit');
      const data = await api(`${prefix}?per_page=100&page=${page}`);
      if (data.result.length > 100) fail('response_invalid');
      matches.push(...data.result.filter(item => DATABASE_NAMES.has(item?.name)));
      if (matches.length > 1) fail('database_ambiguous');
      const pages = data.result_info?.total_pages;
      if (Number.isSafeInteger(pages) && pages > 0 ? page >= pages : data.result.length < 100) break;
    }
    if (matches.length !== 1 || !UUID.test(matches[0]?.uuid || '')) fail('database_not_found');
    databaseId = matches[0].uuid;
  }
  // This is the only query and only remote POST in this module. Cloudflare's
  // query API uses POST for SELECT and accepts an Account D1 Read token.
  const data = await api(`${prefix}/${databaseId}/query`, { sql: PRIVATE_RECIPE_SELECT });
  if (data.result.length !== 1 || data.result[0]?.success === false || !Array.isArray(data.result[0]?.results)) fail('query_invalid');
  const rows = data.result[0].results;
  const checked = checkedRows(rows);
  return { rows, databaseId, sha256: checked.sha256 };
}

function safeOutsidePath(target, publicRoot = ROOT) {
  if (typeof target !== 'string' || !target || target.includes('\0')) fail('private_path_invalid');
  const resolved = path.resolve(target);
  let publicDirectory;
  try { publicDirectory = fs.realpathSync(publicRoot); } catch { fail('private_path_invalid'); }
  if (inside(resolved, path.resolve(publicRoot)) || inside(resolved, publicDirectory)) fail('public_output_forbidden');
  // Reject symlinks in every existing path component before mkdir/read/open,
  // including an outside symlink that leads into the checkout.
  let cursor = resolved;
  while (true) {
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (error) { if (error.code !== 'ENOENT') fail('private_path_invalid'); }
    if (stat?.isSymbolicLink()) fail('private_symlink_forbidden');
    if (stat) {
      const actual = fs.realpathSync(cursor);
      if (inside(actual, publicDirectory)) fail('public_output_forbidden');
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolved;
}

function privateDirectory(directory, publicRoot = ROOT) {
  const resolved = safeOutsidePath(directory, publicRoot);
  try { fs.mkdirSync(resolved, { recursive: true, mode: 0o700 }); } catch { fail('private_directory_unavailable'); }
  safeOutsidePath(resolved, publicRoot);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('private_directory_permissions');
  return resolved;
}

export { privateDirectory as ensurePrivateAuditDirectory, safeOutsidePath as privateAuditPath };

export function validatePrivateRecipeExport(value) {
  if (!plain(value) || value.schemaVersion !== 1 || value.source?.kind !== 'cloudflare-d1-read-only' || value.source?.table !== TABLE || !UUID.test(value.source?.databaseId || '') || typeof value.source?.readAt !== 'string' || !Number.isFinite(Date.parse(value.source.readAt)) || !/^[a-f0-9]{64}$/.test(value.rowsSha256 || '')) fail('export_invalid');
  const checked = checkedRows(value.rows);
  if (checked.sha256 !== value.rowsSha256) fail('export_hash_mismatch');
  return checked;
}

export function writePrivateRecipeExport({ outputDirectory, rows, databaseId, readAt = new Date().toISOString(), publicRoot = ROOT }) {
  if (!UUID.test(databaseId || '')) fail('database_invalid');
  if (typeof readAt !== 'string' || !Number.isFinite(Date.parse(readAt))) fail('export_invalid');
  const checked = checkedRows(rows);
  const directory = privateDirectory(outputDirectory, publicRoot);
  const exportPath = path.join(directory, 'current-premium.json');
  safeOutsidePath(exportPath, publicRoot);
  const value = { schemaVersion: 1, source: { kind: 'cloudflare-d1-read-only', table: TABLE, databaseId, readAt }, rowsSha256: checked.sha256, rows };
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > MAX_EXPORT_BYTES) fail('export_size');
  let descriptor;
  try { descriptor = fs.openSync(exportPath, 'wx', 0o600); } catch { fail('private_export_exists_or_unavailable'); }
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  catch { fail('private_export_write_failed'); }
  finally { fs.closeSync(descriptor); }
  return { recipes: checked.recipes.length, ingredientLines: checked.normalized.count_ingredient_lines, sha256: checked.sha256, exportPath };
}

export function readPrivateRecipeExport(file, { publicRoot = ROOT } = {}) {
  const resolved = safeOutsidePath(file, publicRoot);
  let value;
  try {
    const stat = fs.lstatSync(resolved);
    const directory = fs.statSync(path.dirname(resolved));
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_EXPORT_BYTES || (stat.mode & 0o077) !== 0 || (directory.mode & 0o077) !== 0) fail('private_export_permissions');
    value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    if (error?.message === 'private_recipe_audit_private_export_permissions') throw error;
    fail('private_export_invalid');
  }
  const checked = validatePrivateRecipeExport(value);
  return { ...checked, source: value.source };
}

export async function loadPrivateRecipeAudit({ env, outputDirectory, perform = fetch, publicRoot = ROOT }) {
  credentials(env);
  privateDirectory(outputDirectory, publicRoot);
  const fetched = await fetchPrivateRecipeRows({ env, perform });
  return writePrivateRecipeExport({ outputDirectory, rows: fetched.rows, databaseId: fetched.databaseId, publicRoot });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const index = process.argv.indexOf('--out-dir');
    if (index === -1 || !process.argv[index + 1]) fail('output_directory_required');
    const result = await loadPrivateRecipeAudit({ env: process.env, outputDirectory: process.argv[index + 1] });
    console.log(JSON.stringify({ recipes: result.recipes, ingredientLines: result.ingredientLines, rowsSha256: result.sha256 }));
  } catch (error) {
    const code = /^private_recipe_audit_[a-z_]+$/.test(error?.message || '') ? error.message : 'private_recipe_audit_unavailable';
    console.error(code); process.exitCode = 1;
  }
}
