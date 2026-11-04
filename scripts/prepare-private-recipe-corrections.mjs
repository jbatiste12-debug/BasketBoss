#!/usr/bin/env node
// Offline, review-only transport. This script never queries or activates a
// catalogue, and needs only the public encryption recipient.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensurePrivateAuditDirectory, privateAuditPath, readPrivateRecipeExport, validatePrivateRecipeExport } from './load-private-recipe-audit.mjs';
import { MAX_PRIVATE_CATALOGUE_BYTES, sealPayload } from './private-catalogue-envelope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CORRECTION_RANGES = Object.freeze([[0, 66], [67, 133], [134, 200], [201, 267], [268, 333], [334, 399]].map(Object.freeze));
export const CORRECTION_SOURCE = Object.freeze({ githubRunId: '41507583952', githubRunAttempt: 1, sourceCommit: '27e4086ad254b174bd3a9b8ab494d30e3c3f6a69', sourceRowsSha256: '61733dd3cbb63f56dabad75572b54739c8fd39edf90bea0e468e24db3be2be68' });
export const CORRECTION_RECIPIENT_FINGERPRINT = '62df600a0710ed523668111e40339a72ec502300fc248a8a67862008a1ae74ac';
export const CORRECTION_SEALED_FILE = '.github/private-catalogue/recipes-500-audit-corrections.sealed.json';
export const CORRECTION_MANIFEST_FILE = '.github/private-catalogue/recipes-500-audit-corrections.manifest.json';
const RECIPIENT_FILE = '.github/private-catalogue/catalogue-recipient.json';
const PATCH_FIELDS = ['id', 'index', 'recipeSha256', 'normalizedSha256', 'method', 'steps', 'reasons'];
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Error('private_recipe_corrections_' + code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fields(value, required, optional = []) {
  if (!plain(value)) fail('review_shape');
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) fail('review_fields');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('review_fields');
  }
}
function strings(value, { max = 40, length = 8000, empty = false } = {}) {
  if (!Array.isArray(value) || value.length > max || (!empty && !value.length)) fail('review_text');
  for (let index = 0; index < value.length; index++) {
    const text = value[index];
    if (!Object.hasOwn(value, index) || typeof text !== 'string' || !text.trim() || text.length > length || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail('review_text');
  }
}
function text(value) {
  strings([value], { length: 20000 });
}

/** Pure validation/build layer; production source pins are enforced by prepare. */
export function buildPrivateRecipeCorrections({ snapshot, reviews }) {
  validatePrivateRecipeExport(snapshot);
  if (!Array.isArray(reviews) || reviews.length !== CORRECTION_RANGES.length) fail('review_coverage');
  const rows = snapshot.rows;
  const byId = new Map(rows.map(row => [row.recipe_id, row]));
  const reviewedIds = new Set(), patches = new Map(), authorReview = [];
  const statuses = new Map();
  const counts = { reviewed: 0, methodFix: 0, pass: 0, review: 0, authorReview: 0 };
  for (const [batchIndex, batch] of reviews.entries()) {
    fields(batch, ['range', 'sourceRowsSha256', 'reviewed', 'patches', 'authorReview'], ['checkpoint']);
    const range = CORRECTION_RANGES[batchIndex];
    if (!same(batch.range, range) || batch.sourceRowsSha256 !== snapshot.rowsSha256) fail('review_source_or_range');
    if (!Array.isArray(batch.reviewed) || batch.reviewed.length !== range[1] - range[0] + 1 || !Array.isArray(batch.patches) || !Array.isArray(batch.authorReview) || batch.authorReview.length > 4000) fail('review_coverage');
    const owns = id => byId.has(id) && byId.get(id).sort_index >= range[0] && byId.get(id).sort_index <= range[1];
    for (const entry of batch.reviewed) {
      fields(entry, ['id', 'status', 'findings']);
      if (!owns(entry.id) || reviewedIds.has(entry.id)) fail('review_duplicate_or_identity');
      if (!['method_fix', 'pass', 'review'].includes(entry.status)) fail('review_status');
      strings(entry.findings, { empty: true });
      reviewedIds.add(entry.id); statuses.set(entry.id, entry.status);
      counts.reviewed++; counts[entry.status === 'method_fix' ? 'methodFix' : entry.status]++;
    }
    for (const patch of batch.patches) {
      // An allowlist prevents ingredient, quantity, metadata, or normalized-row
      // edits from entering this method-only transport.
      fields(patch, PATCH_FIELDS);
      const row = byId.get(patch.id);
      if (!owns(patch.id) || patch.index !== row.sort_index || patches.has(patch.id)) fail('patch_duplicate_or_identity');
      if (patch.recipeSha256 !== hash(row.recipe_json) || patch.normalizedSha256 !== hash(row.normalized_json)) fail('patch_stale_hash');
      strings(patch.method); strings(patch.steps); strings(patch.reasons, { length: 4000 });
      if (!same(patch.method, patch.steps)) fail('patch_method_steps_mismatch');
      const recipe = JSON.parse(row.recipe_json);
      if (same(recipe.method, patch.method) && same(recipe.steps, patch.steps)) fail('patch_no_change');
      patches.set(patch.id, patch);
    }
    for (const entry of batch.authorReview) {
      fields(entry, ['id', 'issue', 'evidence', 'suggestion']);
      if (!owns(entry.id)) fail('author_review_identity');
      text(entry.issue); text(entry.evidence); text(entry.suggestion);
      authorReview.push({ ...entry });
    }
  }
  if (reviewedIds.size !== 400 || rows.some(row => !reviewedIds.has(row.recipe_id))) fail('review_coverage');
  for (const row of rows) {
    if ((statuses.get(row.recipe_id) === 'method_fix') !== patches.has(row.recipe_id)) fail('patch_status_mismatch');
  }
  if (!patches.size) fail('patches_required');
  const changes = [];
  const candidateRows = rows.map(row => {
    const patch = patches.get(row.recipe_id);
    if (!patch) return { ...row };
    const recipe = JSON.parse(row.recipe_json);
    const candidate = { ...recipe, method: [...patch.method], steps: [...patch.steps] };
    // All other recipe fields come from the original parsed value, and the
    // normalized JSON string is copied byte for byte without parsing/reserializing.
    const recipeJson = JSON.stringify(candidate);
    changes.push({ id: row.recipe_id, index: row.sort_index, originalRecipeSha256: hash(row.recipe_json), newRecipeSha256: hash(recipeJson), normalizedSha256: hash(row.normalized_json), reasons: [...patch.reasons] });
    return { ...row, recipe_json: recipeJson };
  });
  const afterRowsSha256 = hash(JSON.stringify(candidateRows));
  const candidateSnapshot = { schemaVersion: 1, source: { ...snapshot.source }, rowsSha256: afterRowsSha256, rows: candidateRows };
  validatePrivateRecipeExport(candidateSnapshot);
  counts.authorReview = authorReview.length;
  return {
    candidateSnapshot,
    payload: { kind: 'basketboss-private-recipe-method-corrections', schemaVersion: 1, source: { ...CORRECTION_SOURCE, snapshot: { ...snapshot.source } }, beforeRowsSha256: snapshot.rowsSha256, afterRowsSha256, changes, rows: candidateRows, authorReview },
    counts
  };
}

function readPrivateJSON(file, publicRoot) {
  const resolved = privateAuditPath(file, publicRoot);
  let descriptor;
  try {
    const directory = fs.lstatSync(path.dirname(resolved));
    if (!directory.isDirectory() || directory.mode & 0o077 || typeof process.getuid === 'function' && directory.uid !== process.getuid()) fail('private_input_permissions');
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_PRIVATE_CATALOGUE_BYTES || stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('private_input_permissions');
    return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  } catch (error) {
    if (/^private_recipe_corrections_/.test(error?.message || '')) throw error;
    fail('private_input_invalid');
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
function publicDestination(file, expected, publicRoot) {
  if (typeof file !== 'string' || path.resolve(file) !== path.join(path.resolve(publicRoot), expected)) fail('public_destination_forbidden');
  const resolved = path.resolve(file);
  let cursor = resolved;
  while (true) {
    try { if (fs.lstatSync(cursor).isSymbolicLink()) fail('public_symlink_forbidden'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolved;
}
function unavailable(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail('output_exists');
}
function writeExclusive(file, bytes) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor);
  } catch { fail('output_write_failed'); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
const jsonBytes = value => Buffer.from(JSON.stringify(value) + '\n');

export function preparePrivateRecipeCorrections({ snapshotPath, reviewsDirectory, outputDirectory, sealedPath, manifestPath, publicRoot = ROOT, expectedSourceRowsSha256 = CORRECTION_SOURCE.sourceRowsSha256, expectedRecipientFingerprint = CORRECTION_RECIPIENT_FINGERPRINT }) {
  // Reuse the read-only loader's export validation and private path contract.
  readPrivateRecipeExport(snapshotPath, { publicRoot });
  const snapshot = readPrivateJSON(snapshotPath, publicRoot);
  if (snapshot.rowsSha256 !== expectedSourceRowsSha256) fail('source_pin_mismatch');
  const reviewDirectory = privateAuditPath(reviewsDirectory, publicRoot);
  const reviews = CORRECTION_RANGES.map((_, index) => readPrivateJSON(path.join(reviewDirectory, `review-batch-${index}.json`), publicRoot));
  const built = buildPrivateRecipeCorrections({ snapshot, reviews });
  let recipient;
  try { recipient = JSON.parse(fs.readFileSync(publicDestination(path.join(publicRoot, RECIPIENT_FILE), RECIPIENT_FILE, publicRoot), 'utf8')); }
  catch { fail('public_recipient_invalid'); }
  if (recipient.fingerprint !== expectedRecipientFingerprint) fail('recipient_pin_mismatch');
  const plaintext = jsonBytes(built.payload);
  if (plaintext.length > MAX_PRIVATE_CATALOGUE_BYTES) fail('payload_size');
  const envelope = sealPayload(plaintext, recipient, { releaseId: 'recipes-500-audit-corrections', sourceCommit: CORRECTION_SOURCE.sourceCommit });
  const sealedBytes = jsonBytes(envelope);
  const sealed = publicDestination(sealedPath, CORRECTION_SEALED_FILE, publicRoot);
  const manifest = manifestPath ? publicDestination(manifestPath, CORRECTION_MANIFEST_FILE, publicRoot) : undefined;
  const directory = ensurePrivateAuditDirectory(outputDirectory, publicRoot);
  const candidatePath = privateAuditPath(path.join(directory, 'candidate-premium.json'), publicRoot);
  const payloadPath = privateAuditPath(path.join(directory, 'method-corrections.json'), publicRoot);
  for (const file of [candidatePath, payloadPath, sealed, ...(manifest ? [manifest] : [])]) unavailable(file);
  // Public output deliberately includes only counts, IDs, and cryptographic
  // hashes. Findings, reasons, ingredient text, and methods stay encrypted.
  const summary = { schemaVersion: 1, counts: built.counts, beforeRowsSha256: built.payload.beforeRowsSha256, afterRowsSha256: built.payload.afterRowsSha256, sourceCommit: CORRECTION_SOURCE.sourceCommit, githubRunId: CORRECTION_SOURCE.githubRunId, recipientFingerprint: recipient.fingerprint, sealedSha256: hash(sealedBytes), changedRecipeIds: built.payload.changes.map(change => change.id), authorReviewRecipeIds: [...new Set(built.payload.authorReview.map(entry => entry.id))] };
  writeExclusive(candidatePath, jsonBytes(built.candidateSnapshot));
  writeExclusive(payloadPath, plaintext);
  writeExclusive(sealed, sealedBytes);
  if (manifest) writeExclusive(manifest, jsonBytes(summary));
  return summary;
}

function argumentsForCLI(argv) {
  const accepted = new Set(['--snapshot', '--reviews-dir', '--out-dir', '--sealed', '--manifest']);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!accepted.has(flag) || values.has(flag) || typeof value !== 'string' || !value || value.startsWith('--')) fail('arguments');
    values.set(flag, value);
  }
  if (['--snapshot', '--reviews-dir', '--out-dir', '--sealed'].some(flag => !values.has(flag))) fail('arguments');
  return { snapshotPath: values.get('--snapshot'), reviewsDirectory: values.get('--reviews-dir'), outputDirectory: values.get('--out-dir'), sealedPath: values.get('--sealed'), manifestPath: values.get('--manifest') };
}
export function runPrivateRecipeCorrectionsCLI(argv, { log = console.log, error: logError = console.error } = {}) {
  try { log(JSON.stringify(preparePrivateRecipeCorrections(argumentsForCLI(argv)))); return 0; }
  catch (error) {
    const code = /^(?:private_recipe_corrections|private_recipe_audit|invalid_private_catalogue)_[a-z_]+$/.test(error?.message || '') ? error.message : 'private_recipe_corrections_unavailable';
    logError(code); return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runPrivateRecipeCorrectionsCLI(process.argv.slice(2));
