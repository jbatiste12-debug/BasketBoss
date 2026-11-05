#!/usr/bin/env node
// Offline preparation of the owner's accepted editorial recommendations.
// Recipe identities and recommendation text remain in private/encrypted files.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensurePrivateAuditDirectory, privateAuditPath, readPrivateRecipeExport, validatePrivateRecipeExport } from './load-private-recipe-audit.mjs';
import { MAX_PRIVATE_CATALOGUE_BYTES, sealPayload } from './private-catalogue-envelope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COOK_AUTHOR_SOURCE = Object.freeze({ githubRunId: '42080854115', githubRunAttempt: 1, sourceCommit: 'f958b21681614ea54aa0b635664b6a5a550f2942', sourceRowsSha256: '1e54c10834b144142fab94b0fca88d12fc904c6ea3da1137d8307b7f5a887eb8' });
export const COOK_AUTHOR_RECIPIENT_FINGERPRINT = '62df600a0710ed523668111e40339a72ec502300fc248a8a67862008a1ae74ac';
export const COOK_AUTHOR_SEALED_FILE = '.github/private-catalogue/cook-author-recommendations.sealed.json';
export const COOK_AUTHOR_MANIFEST_FILE = '.github/private-catalogue/cook-author-recommendations.manifest.json';
export const COOK_AUTHOR_APPROVAL = Object.freeze({ date: '2026-11-05', basis: 'USER_ACCEPTED_EDITORIAL_RECOMMENDATIONS', kitchenTested: false });
// Exact protected targets from the 33-question review. Hashing the identity
// keeps protected recipe names out of this public transport implementation.
export const COOK_AUTHOR_TARGETS = Object.freeze([
  [25, 'fa4a99f2b93e513f6b15423283b9ffac882a4c927faface1240c9b3494614b06', [3], 'Cornflour'],
  [32, 'ea72b03749cd8f3628b67c2c13b482e0d69e359838b878d381bd21f7893dd553', [0]],
  [37, '827146db85c14f4d2b6960150bb21844bd71a797eff5222d38b084bd143f8749', []],
  [51, '6d05dbe2a8c2d9ed4cb8598a45065b6c2ba0c7051b195484ee2a1b2ae0ed7e78', [3]],
  [55, 'fea5f4e42f1594fdfcae72bb8d2cf35685d5947772e646ac5a43d9bcf284dd28', [1, 2]],
  [60, '6831066d03b5a0d1356c5ad6753afa2e1e8e32329fc8d47d4cb88e73974969ef', [], 'Cooking oil'],
  [61, 'b2fb38d739f429ce2f871d7317563a7df9f3f30bbe9b3793153304221561c773', [], 'Cooking oil'],
  [64, 'e4159eabcd4aafdadc50fc916bc2218e63f9da3eed762085179b89d5735b7ff0', [], 'Cooking oil'],
  [67, '92b319f10470bae283ce776548e1dc664aad62f1f2cfec4265085d0b49739427', [], 'Cooking oil'],
  [69, '6dd97bbdbb270442bfea06c2902cd8660eb6559446450074865256f153291424', []],
  [72, 'e557b14c83b0be45451f4f91c0c20a29442cac1b536efce1fd6f1257f0c761d6', []],
  [76, '736735fe49d03d706497703b457323e29e6feb988bb92a316442725e9587cc49', []],
  [165, '723d74a08af0581876ac44f43e343cbe2997b3fdf7c444094ba5d9605f7657d2', []],
  [183, '091f538e55a6a396389acd3d16bd7c09b7801bbc4c383772a98e0c930aed31b9', []],
  [216, '8fc0707437b38e3790ba72cd13e885bec26dfe3878de52bbb08d3d5bc05383f0', [10]],
  [259, 'fc18eec5b7a8083b2600f148aceed8c03d96c472b35f904c41cb22bd9b38ff5d', []],
  [303, 'b59346216e33db010928dd01312311f4c65c6c003dcb57110d2b71b3dd7e4be9', []],
  [336, 'efd5762dd8f66afb379916846b02cc73f271c33eb045c69d5f66fafae60a4243', [0]]
].map(([index, idSha256, ingredientIndexes, appendName]) => Object.freeze({ index, idSha256, ingredientIndexes: Object.freeze(ingredientIndexes), ...(appendName ? { appendName } : {}) })));
const RECIPIENT_FILE = '.github/private-catalogue/catalogue-recipient.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Error('cook_author_recommendations_' + code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (value, key) => Object.hasOwn(value, key);
const protectedFields = (value, allowed) => Object.fromEntries(Object.entries(value).filter(([key]) => !allowed.has(key)));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const price = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function fields(value, required, optional = []) {
  if (!plain(value)) fail('shape');
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !own(value, key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) fail('fields');
  if (keys.some(key => !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !own(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail('fields');
}
function text(value, { blank = false, length = 20000 } = {}) {
  if (typeof value !== 'string' || !blank && !value.trim() || value.length > length || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('text');
}
function strings(value, { max = 40, blank = false } = {}) {
  if (!Array.isArray(value) || !value.length || value.length > max) fail('text');
  for (let i = 0; i < value.length; i++) { if (!own(value, i)) fail('text'); text(value[i], { blank, length: 8000 }); }
}
const RECIPE_FIELDS = new Set(['ingredients', 'ingredient_display_lines', 'method', 'steps', 'culinary_prep_notes', 'tip', 'mins', 'time_minutes', 'prep_minutes', 'cook_minutes', 'prep_mins', 'cook_mins', 'waiting_mins', 'rest_mins', 'total_elapsed_mins', 'cost', 'ci_estimates', 'cost_ci_estimates']);
const NORMALIZED_FIELDS = new Set(['ingredients', 'name', 'mins', 'time_minutes', 'prep_minutes', 'cook_minutes', 'prep_mins', 'cook_mins', 'waiting_mins', 'rest_mins', 'total_elapsed_mins', 'cost', 'ci_estimates', 'cost_ci_estimates']);
const AMOUNT_FIELDS = new Set(['quantity', 'unit', 'price_hint', 'status', 'quantity_basis', 'prep_note', 'needs_review', 'unit_assumption', 'audit_provisional_quantity_source', 'audit_quantity_verified']);
const REMOVABLE_FLAGS = ['needs_review', 'unit_assumption', 'audit_provisional_quantity_source', 'audit_quantity_verified'];
const CANONICAL_UNITS = new Set(['g', 'ml', 'each', 'count', 'staple']);
const AMOUNT_NUMBER = '(?:0|[1-9]\\d*)(?:\\.\\d+)?';
const METRIC_AMOUNT = new RegExp(`^(${AMOUNT_NUMBER})\\s*(g|ml)(?: (?:dry|peeled|and|deseeded|flesh))*$`);
const SPOON_WITH_EXPLICIT_METRIC = new RegExp(`^(${AMOUNT_NUMBER})(?:/(${AMOUNT_NUMBER}))?\\s*(?:tsp|tbsp)\\s*\\(\\s*(${AMOUNT_NUMBER})\\s*(g|ml)\\s*\\)$`);
const COUNT_AMOUNT = new RegExp(`^(${AMOUNT_NUMBER})(?: (?:(?:small|medium|large) )?(eggs?|wrappers?|each|counts?|pieces?))?(?:, about (${AMOUNT_NUMBER})[-–](${AMOUNT_NUMBER}) cm square)?$`);

// This release accepts only explicit source measures. The shared pantry policy
// normalizes already separated numbers/units and may estimate container sizes
// or densities, so it cannot prove correspondence to these authored strings.
// Match the entire string: a numeric prefix, unknown unit or unknown prose is
// never enough to authorize a normalized amount. A spoon amount may provide an
// explicit metric equivalent; that equivalent wins without a density guess.
function sourceAmount(value) {
  const amount = value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const spoon = amount.match(SPOON_WITH_EXPLICIT_METRIC);
  if (spoon) {
    if (!positive(Number(spoon[1])) || spoon[2] !== undefined && !positive(Number(spoon[2]))) return null;
    const quantity = Number(spoon[3]);
    return positive(quantity) ? { quantity, unit: spoon[4] } : null;
  }
  const metric = amount.match(METRIC_AMOUNT);
  if (metric) {
    const quantity = Number(metric[1]);
    return positive(quantity) ? { quantity, unit: metric[2] } : null;
  }
  const count = amount.match(COUNT_AMOUNT);
  if (!count || count[3] !== undefined && (!/^wrappers?$/.test(count[2] || '') || !positive(Number(count[3])) || !(Number(count[4]) >= Number(count[3])))) return null;
  const quantity = Number(count[1]);
  return positive(quantity) ? { quantity, unit: 'each' } : null;
}
const sameAmount = (a, b) => Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 8;
const samePrice = (a, b) => Math.abs(a - b) <= 0.005 + Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 8;

/** Shared by offline preparation and activation; no provider access. */
export function validateCookAuthorRecipeChange(before, beforeNormalized, after, afterNormalized, target) {
  if (![before, beforeNormalized, after, afterNormalized].every(plain) || hash(before.id) !== target.idSha256 || after.id !== before.id || beforeNormalized.id !== before.id || afterNormalized.id !== before.id) fail('identity');
  if (!same(protectedFields(before, RECIPE_FIELDS), protectedFields(after, RECIPE_FIELDS))) fail('protected_recipe');
  for (const key of Object.keys(after)) if (!own(before, key) && key !== 'culinary_prep_notes') fail('new_recipe_field');
  for (const key of Object.keys(before)) if (!own(after, key)) fail('removed_recipe_field');
  if (!same(protectedFields(beforeNormalized, NORMALIZED_FIELDS), protectedFields(afterNormalized, NORMALIZED_FIELDS))) fail('protected_normalized');
  if (!same(Object.keys(beforeNormalized), Object.keys(afterNormalized))) fail('normalized_fields');
  for (const key of NORMALIZED_FIELDS) {
    if (key === 'ingredients' || same(beforeNormalized[key], afterNormalized[key])) continue;
    if (!own(before, key) || !same(afterNormalized[key], after[key])) fail('normalized_metadata');
  }
  strings(after.method); strings(after.steps);
  if (!same(after.method, after.steps)) fail('method_steps');
  if (own(after, 'tip')) text(after.tip, { blank: true });
  if (!Array.isArray(after.ingredients) || !after.ingredients.length || after.ingredients.length > 60 || !Array.isArray(afterNormalized.ingredients) || afterNormalized.ingredients.length !== after.ingredients.length) fail('ingredients');
  if (after.ingredients.length < before.ingredients.length || after.ingredients.length > before.ingredients.length + (target.appendName ? 1 : 0)) fail('ingredient_append');
  const notes = after.culinary_prep_notes;
  if (notes !== undefined) {
    strings(notes, { max: 60, blank: true });
    if (notes.length !== after.ingredients.length || notes.some((note, i) => !note.trim() && (typeof before.culinary_prep_notes?.[i] !== 'string' || before.culinary_prep_notes[i].trim()))) fail('notes');
  }
  if (own(after, 'ingredient_display_lines')) {
    strings(after.ingredient_display_lines, { max: 60 });
    if (after.ingredient_display_lines.length !== after.ingredients.length) fail('display_lines');
    if (!same(before.ingredients, after.ingredients) && !same(after.ingredient_display_lines, after.ingredients.map(item => `${item[0]} — ${item[1]}`))) fail('display_lines');
  }
  const allowedAmounts = new Set(target.ingredientIndexes);
  for (const [i, ingredient] of after.ingredients.entries()) {
    if (!Array.isArray(ingredient) || ingredient.length !== 4) fail('ingredient_shape');
    text(ingredient[0]); text(ingredient[1]); text(ingredient[3]);
    if (!price(ingredient[2])) fail('price');
    const previous = before.ingredients[i], normalized = afterNormalized.ingredients[i], oldNormalized = beforeNormalized.ingredients[i];
    if (!plain(normalized) || normalized.name !== ingredient[0] || normalized.recipe_id !== after.id || normalized.ingredient_index !== i || typeof normalized.key !== 'string' || !normalized.key.trim()) fail('ingredient_alignment');
    if (previous) {
      if (!Array.isArray(previous) || ingredient[0] !== previous[0] || ingredient[3] !== previous[3]) fail('protected_ingredient');
      if ((!same(previous, ingredient) || !same(oldNormalized, normalized)) && !allowedAmounts.has(i)) fail('unapproved_ingredient');
      if (!same(protectedFields(oldNormalized, AMOUNT_FIELDS), protectedFields(normalized, AMOUNT_FIELDS))) fail('protected_ingredient_metadata');
      for (const key of Object.keys(normalized)) if (!own(oldNormalized, key) && !['quantity_basis', 'prep_note'].includes(key)) fail('new_ingredient_metadata');
      for (const key of Object.keys(oldNormalized)) if (!own(normalized, key) && !REMOVABLE_FLAGS.includes(key)) fail('removed_ingredient_metadata');
      for (const key of REMOVABLE_FLAGS) if (own(normalized, key) && !same(normalized[key], oldNormalized[key])) fail('review_flags');
      if (!same(normalized.status, oldNormalized.status) && normalized.status !== 'PARSED') fail('status');
      if (!same(normalized.quantity_basis, oldNormalized.quantity_basis) && normalized.quantity_basis !== 'USER_ACCEPTED_CULINARY_RECOMMENDATION') fail('quantity_basis');
      if (!same(normalized.prep_note, oldNormalized.prep_note)) text(normalized.prep_note);
    } else {
      if (ingredient[0] !== target.appendName) fail('ingredient_append');
      fields(normalized, ['name', 'key', 'quantity', 'unit', 'price_hint', 'status', 'quantity_basis', 'recipe_id', 'ingredient_index']);
      if (normalized.status !== 'PARSED' || normalized.quantity_basis !== 'USER_ACCEPTED_CULINARY_RECOMMENDATION') fail('new_ingredient_status');
    }
    // Existing unrelated legacy amounts, including unknown/zero staples, are
    // preserved. Every newly authored/changed amount must be usable and finite.
    if (!previous || !same(previous[1], ingredient[1]) || !same(normalized.quantity, oldNormalized.quantity) || !same(normalized.unit, oldNormalized.unit)) {
      if (!positive(normalized.quantity) || !CANONICAL_UNITS.has(normalized.unit)) fail('quantity');
      const parsed = sourceAmount(ingredient[1]);
      if (!parsed || parsed.unit !== (normalized.unit === 'count' ? 'each' : normalized.unit) || !sameAmount(parsed.quantity, normalized.quantity)) fail('source_quantity_mismatch');
    }
    if (!previous || !same(previous[2], ingredient[2]) || !same(normalized.price_hint, oldNormalized.price_hint)) {
      if (!price(normalized.price_hint)) fail('price');
      if (!samePrice(ingredient[2], normalized.price_hint)) fail('source_price_mismatch');
    }
  }
  for (const key of RECIPE_FIELDS) {
    if (same(before[key], after[key])) continue;
    if (/^(?:mins|time_minutes|prep_minutes|cook_minutes|prep_mins|cook_mins|waiting_mins|rest_mins|total_elapsed_mins)$/.test(key) && (!own(before, key) || !positive(after[key]))) fail('time');
    if (key === 'cost' && !positive(after.cost)) fail('cost');
    if (['ci_estimates', 'cost_ci_estimates'].includes(key)) {
      if (!plain(before[key]) || !plain(after[key]) || !same(Object.keys(before[key]), Object.keys(after[key]))) fail('regional_cost');
      for (const [region, estimate] of Object.entries(after[key])) {
        const old = before[key][region], numeric = new Set(['estimate', 'per_serving_estimate', 'estimate_gbp', 'estimate_usd']);
        if (!plain(old) || !plain(estimate) || !same(Object.keys(old), Object.keys(estimate)) || !same(protectedFields(old, numeric), protectedFields(estimate, numeric))) fail('regional_cost');
        for (const field of numeric) if (own(estimate, field) && !positive(estimate[field])) fail('regional_cost');
        if (estimate.confidence !== 'INDICATIVE_UNVERIFIED' || estimate.per_serving_estimate !== Math.round((estimate.estimate / after.servings + Number.EPSILON) * 100) / 100 || estimate[estimate.currency === 'USD' ? 'estimate_usd' : 'estimate_gbp'] !== estimate.estimate) fail('regional_cost');
      }
      if (after[key].UK?.estimate !== after.cost) fail('regional_cost');
    }
  }
  if (!same(before.cost, after.cost)) {
    for (const key of ['ci_estimates', 'cost_ci_estimates']) if (own(after, key) && after[key].UK?.estimate !== after.cost) fail('regional_cost');
  }
  if (same(before, after) && same(beforeNormalized, afterNormalized)) fail('empty_change');
  return true;
}

/** targets is injected only by offline synthetic tests; CLI policy is fixed. */
export function buildCookAuthorRecommendations({ snapshot, recommendations, targets = COOK_AUTHOR_TARGETS }) {
  validatePrivateRecipeExport(snapshot);
  if (!Array.isArray(recommendations) || recommendations.length !== 2 || targets.length !== 18) fail('coverage');
  const allowed = new Map(targets.map(target => [target.index, target])), changes = new Map();
  for (const batch of recommendations) {
    fields(batch, ['sourceRowsSha256', 'changes']);
    if (batch.sourceRowsSha256 !== snapshot.rowsSha256 || !Array.isArray(batch.changes) || batch.changes.length !== 9) fail('coverage');
    for (const entry of batch.changes) {
      fields(entry, ['id', 'index', 'recipeSha256', 'normalizedSha256', 'recipe', 'normalized', 'recommendation', 'resolvedFindings']);
      const target = allowed.get(entry.index), row = snapshot.rows[entry.index];
      if (!target || row?.recipe_id !== entry.id || hash(entry.id) !== target.idSha256 || changes.has(entry.index)) fail('target');
      if (entry.recipeSha256 !== hash(row.recipe_json) || entry.normalizedSha256 !== hash(row.normalized_json)) fail('stale_hash');
      text(entry.recommendation); strings(entry.resolvedFindings);
      validateCookAuthorRecipeChange(JSON.parse(row.recipe_json), JSON.parse(row.normalized_json), entry.recipe, entry.normalized, target);
      changes.set(entry.index, entry);
    }
  }
  if (changes.size !== 18 || [...allowed.keys()].some(index => !changes.has(index))) fail('coverage');
  const metadata = [], rows = snapshot.rows.map(row => {
    const entry = changes.get(row.sort_index);
    if (!entry) return { ...row };
    const recipe_json = JSON.stringify(entry.recipe);
    // Preserve normalized bytes if the accepted recommendation did not edit it.
    const normalized_json = same(JSON.parse(row.normalized_json), entry.normalized) ? row.normalized_json : JSON.stringify(entry.normalized);
    metadata.push({ id: row.recipe_id, index: row.sort_index, originalRecipeSha256: hash(row.recipe_json), newRecipeSha256: hash(recipe_json), originalNormalizedSha256: hash(row.normalized_json), newNormalizedSha256: hash(normalized_json), recommendation: entry.recommendation, resolvedFindings: [...entry.resolvedFindings] });
    return { ...row, recipe_json, normalized_json };
  });
  const afterRowsSha256 = hash(JSON.stringify(rows));
  const candidateSnapshot = { schemaVersion: 1, source: { ...snapshot.source }, rowsSha256: afterRowsSha256, rows };
  validatePrivateRecipeExport(candidateSnapshot);
  const counts = { catalogue: 400, changed: 18, unchanged: 382, resolvedFindings: metadata.reduce((n, change) => n + change.resolvedFindings.length, 0) };
  if (counts.resolvedFindings !== 18) fail('findings_coverage');
  return { candidateSnapshot, counts, payload: { kind: 'basketboss-cook-author-recommendations', schemaVersion: 1, source: { ...COOK_AUTHOR_SOURCE, snapshot: { ...snapshot.source } }, approval: { ...COOK_AUTHOR_APPROVAL }, beforeRowsSha256: snapshot.rowsSha256, afterRowsSha256, changes: metadata, rows } };
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
    if (/^cook_author_recommendations_/.test(error?.message || '')) throw error;
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
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return resolved;
}
function unavailable(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail('output_exists');
}
function writeExclusive(file, bytes) {
  let descriptor;
  try { descriptor = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  catch { fail('output_write_failed'); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
const jsonBytes = value => Buffer.from(JSON.stringify(value) + '\n');
export function prepareCookAuthorRecommendations({ snapshotPath, recommendationsDirectory, outputDirectory, sealedPath, manifestPath, publicRoot = ROOT, reviewSourceCommit, expectedSourceRowsSha256 = COOK_AUTHOR_SOURCE.sourceRowsSha256, expectedRecipientFingerprint = COOK_AUTHOR_RECIPIENT_FINGERPRINT, targets = COOK_AUTHOR_TARGETS }) {
  readPrivateRecipeExport(snapshotPath, { publicRoot });
  const snapshot = readPrivateJSON(snapshotPath, publicRoot);
  if (snapshot.rowsSha256 !== expectedSourceRowsSha256) fail('source_pin_mismatch');
  const directory = privateAuditPath(recommendationsDirectory, publicRoot);
  const recommendations = ['a', 'b'].map(batch => readPrivateJSON(path.join(directory, `private-batch-${batch}.json`), publicRoot));
  if (!/^[a-f0-9]{40}$/.test(reviewSourceCommit || '')) fail('review_commit_invalid');
  const built = buildCookAuthorRecommendations({ snapshot, recommendations, targets });
  built.payload.reviewSourceCommit = reviewSourceCommit;
  let recipient;
  try { recipient = JSON.parse(fs.readFileSync(publicDestination(path.join(publicRoot, RECIPIENT_FILE), RECIPIENT_FILE, publicRoot), 'utf8')); }
  catch { fail('public_recipient_invalid'); }
  if (recipient.fingerprint !== expectedRecipientFingerprint) fail('recipient_pin_mismatch');
  const plaintext = jsonBytes(built.payload);
  if (plaintext.length > MAX_PRIVATE_CATALOGUE_BYTES) fail('payload_size');
  const sealedBytes = jsonBytes(sealPayload(plaintext, recipient, { releaseId: 'cook-author-recommendations', sourceCommit: reviewSourceCommit }));
  const sealed = publicDestination(sealedPath, COOK_AUTHOR_SEALED_FILE, publicRoot), manifest = publicDestination(manifestPath, COOK_AUTHOR_MANIFEST_FILE, publicRoot);
  const output = ensurePrivateAuditDirectory(outputDirectory, publicRoot);
  const candidatePath = privateAuditPath(path.join(output, 'candidate-premium.json'), publicRoot), payloadPath = privateAuditPath(path.join(output, 'cook-author-recommendations.json'), publicRoot);
  for (const file of [candidatePath, payloadPath, sealed, manifest]) unavailable(file);
  const summary = { schemaVersion: 1, releaseId: 'cook-author-recommendations', approval: { ...COOK_AUTHOR_APPROVAL }, counts: built.counts, beforeRowsSha256: built.payload.beforeRowsSha256, afterRowsSha256: built.payload.afterRowsSha256, sourceCommit: COOK_AUTHOR_SOURCE.sourceCommit, githubRunId: COOK_AUTHOR_SOURCE.githubRunId, reviewSourceCommit, recipientFingerprint: recipient.fingerprint, payloadSha256: hash(plaintext), sealedSha256: hash(sealedBytes) };
  writeExclusive(candidatePath, jsonBytes(built.candidateSnapshot)); writeExclusive(payloadPath, plaintext);
  writeExclusive(sealed, sealedBytes); writeExclusive(manifest, jsonBytes(summary));
  return summary;
}
function argumentsForCLI(argv) {
  const accepted = new Set(['--snapshot', '--recommendations-dir', '--out-dir', '--sealed', '--manifest', '--review-source-commit']), values = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!accepted.has(flag) || values.has(flag) || typeof value !== 'string' || !value || value.startsWith('--')) fail('arguments');
    values.set(flag, value);
  }
  if ([...accepted].some(flag => !values.has(flag))) fail('arguments');
  return { snapshotPath: values.get('--snapshot'), recommendationsDirectory: values.get('--recommendations-dir'), outputDirectory: values.get('--out-dir'), sealedPath: values.get('--sealed'), manifestPath: values.get('--manifest'), reviewSourceCommit: values.get('--review-source-commit') };
}
export function runCookAuthorRecommendationsCLI(argv, { log = console.log, error: logError = console.error } = {}) {
  try { log(JSON.stringify(prepareCookAuthorRecommendations(argumentsForCLI(argv)))); return 0; }
  catch (error) { logError(/^(?:cook_author_recommendations|private_recipe_audit|invalid_private_catalogue)_[a-z_]+$/.test(error?.message || '') ? error.message : 'cook_author_recommendations_unavailable'); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCookAuthorRecommendationsCLI(process.argv.slice(2));
