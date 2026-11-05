#!/usr/bin/env node
// Trusted-main read-only Cook audit. Private plaintext remains in memory. Logs
// contain aggregate fields and, only when explicitly requested, ciphertext.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fetchPrivateRecipeRows } from './load-private-recipe-audit.mjs';
import { prepareCookReviewSnapshot } from './seal-cook-review-snapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const method = createRequire(import.meta.url)('../bb-cook-method.js');
export const COOK_AUDIT_REPOSITORY = 'jbatiste12-debug/BasketBoss';
const fail = code => { throw Error('cook_method_audit_' + code); };
const digest = value => createHash('sha256').update(value).digest('hex');
const cardsValid = cards => Array.isArray(cards) && cards.length > 0 && cards.every(card => typeof card === 'string' && card.trim());
const ISSUE_CODES = Object.freeze([
  'source_invalid', 'source_card_count_changed', 'normalized_invalid',
  'normalized_card_count_changed', 'measurement_changed', 'not_idempotent',
  'ingredients_mutated', 'recipe_mutated', 'method_exception'
]);
const FAILURE_CODES = new Set([
  'context_invalid', 'read_token_unconfigured', 'read_token_invalid',
  'account_unconfigured', 'protected_read_failed', 'protected_read_denied',
  'public_catalogue_invalid', 'catalogue_identity_invalid', 'unavailable',
  'review_options_invalid', 'review_context_invalid', 'review_output_invalid',
  'review_recipient_invalid', 'review_seal_failed'
].map(code => 'cook_method_audit_' + code));

function trustedContext(env) {
  if (env?.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'push' ||
      env.GITHUB_REPOSITORY !== COOK_AUDIT_REPOSITORY || env.GITHUB_REF !== 'refs/heads/main' ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) fail('context_invalid');
  return env.GITHUB_SHA;
}

// Keep each unique numeric expression and each explicit measured quantity.
// Comparing sets permits conservative duplicate prose removal and reordering,
// while detecting changed values, duration units and temperature scales.
function measurements(text) {
  const number = '(?:\\d+(?:[.,]\\d+)?(?:\\s*[/–—-]\\s*\\d+(?:[.,]\\d+)?)?|[¼½¾⅓⅔⅛⅜⅝⅞])';
  const words = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|halves|quarter|quarters|third|thirds|dozen|couple)';
  const amount = '(?:' + number + '|' + words + '|a)';
  const unit = '(?:°\\s*[cf]|degrees?\\s*(?:celsius|fahrenheit|[cf])?|milliseconds?|seconds?|secs?|minutes?|mins?|hours?|hrs?|millilitres?|milliliters?|ml|litres?|liters?|l|milligrams?|mg|kilograms?|kg|grams?|g|teaspoons?|tsp|tablespoons?|tbsp|cups?|ounces?|oz|pounds?|lb|cloves?|pinches?|handfuls?|millimetres?|millimeters?|mm|centimetres?|centimeters?|cm|inches|inch)';
  const measured = new RegExp('(?<![a-z0-9_])' + amount + '\\s*' + unit + '\\b', 'gi');
  const numeric = new RegExp(number, 'g');
  const spelled = new RegExp('\\b' + words + '\\b', 'gi');
  const tokens = [...(text.match(numeric) || []), ...(text.match(spelled) || []), ...(text.match(measured) || []), ...(text.match(/\b(?:once|twice)\b/gi) || [])];
  return JSON.stringify([...new Set(tokens.map(token => token.toLowerCase().replace(/\s+/g, ' ').trim()))].sort());
}

function auditCatalogue(recipes, api) {
  const issues = Object.fromEntries(ISSUE_CODES.map(code => [code, 0]));
  const summary = { recipes: recipes.length, ingredientLines: 0, sourceCards: 0, normalizedCards: 0, changedRecipes: 0, changedCards: 0, affectedRecipes: 0, issues };
  for (const recipe of recipes) {
    const before = JSON.stringify(recipe), ingredientsBefore = JSON.stringify(recipe.ingredients);
    const found = new Set();
    summary.ingredientLines += Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0;
    try {
      const source = api.sourceMethod(recipe), normalized = api.normalizeMethod(recipe);
      const sourceValid = cardsValid(source), normalizedValid = cardsValid(normalized);
      if (!sourceValid) found.add('source_invalid');
      if (!normalizedValid) found.add('normalized_invalid');
      if (Array.isArray(source)) summary.sourceCards += source.length;
      if (Array.isArray(normalized)) summary.normalizedCards += normalized.length;
      if (cardsValid(recipe.method) && (!Array.isArray(source) || source.length !== recipe.method.length)) found.add('source_card_count_changed');
      if (Array.isArray(source) && (!Array.isArray(normalized) || normalized.length !== source.length)) found.add('normalized_card_count_changed');
      if (sourceValid && normalizedValid) {
        let changed = false;
        for (const [index, card] of source.entries()) {
          if (normalized[index] !== card) { summary.changedCards++; changed = true; }
          if (typeof normalized[index] !== 'string' || measurements(card) !== measurements(normalized[index])) found.add('measurement_changed');
        }
        if (changed) summary.changedRecipes++;
        if (JSON.stringify(api.normalizeMethod(normalized, recipe)) !== JSON.stringify(normalized)) found.add('not_idempotent');
      }
    } catch { found.add('method_exception'); }
    if (JSON.stringify(recipe.ingredients) !== ingredientsBefore) found.add('ingredients_mutated');
    if (JSON.stringify(recipe) !== before) found.add('recipe_mutated');
    if (found.size) summary.affectedRecipes++;
    for (const code of found) issues[code]++;
  }
  return summary;
}

export async function auditCookMethodSummary({ env, perform = fetch, root = ROOT, publicRecipes, methodApi = method, reviewRecipientPath, sealedReviewOutput, reviewTransportLog = false, writeReviewTransport } = {}) {
  const sourceCommit = trustedContext(env);
  // Deliberately do not accept the general Cloudflare token as a fallback.
  const token = env.CLOUDFLARE_RECIPE_AUDIT_READ_TOKEN;
  if (typeof token !== 'string' || !token.trim()) fail('read_token_unconfigured');
  if (!/^[\x21-\x7e]{32,4096}$/.test(token)) fail('read_token_invalid');
  if (!env.CLOUDFLARE_ACCOUNT_ID) fail('account_unconfigured');
  let recipes = publicRecipes;
  if (recipes === undefined) {
    try { recipes = JSON.parse(fs.readFileSync(path.join(root, 'recipes.json'), 'utf8')); }
    catch { fail('public_catalogue_invalid'); }
  }
  if (!Array.isArray(recipes) || recipes.length !== 100 || recipes.some(recipe => !recipe || typeof recipe.id !== 'string' || !Array.isArray(recipe.ingredients))) fail('public_catalogue_invalid');
  const ids = new Set(recipes.map(recipe => recipe.id));
  if (ids.size !== 100) fail('catalogue_identity_invalid');
  const publicSha256 = digest(JSON.stringify(recipes));
  const sealReview = prepareCookReviewSnapshot({ env, root, recipientPath: reviewRecipientPath, outputPath: sealedReviewOutput, transportLog: reviewTransportLog, writeTransport: writeReviewTransport });
  let fetched;
  try {
    fetched = await fetchPrivateRecipeRows({ env: {
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_DATABASE_ID: env.CLOUDFLARE_DATABASE_ID
    }, perform });
  } catch (error) {
    fail(error?.message === 'private_recipe_audit_api_denied' ? 'protected_read_denied' : 'protected_read_failed');
  }
  const protectedRecipes = fetched.rows.map(row => JSON.parse(row.recipe_json));
  if (protectedRecipes.some(recipe => ids.has(recipe.id))) fail('catalogue_identity_invalid');
  // Seal the exact acquired rows before any normalization code sees recipes.
  const sealedReviewSnapshot = sealReview?.(fetched);
  const publicAudit = auditCatalogue(recipes, methodApi), protectedAudit = auditCatalogue(protectedRecipes, methodApi);
  const issues = Object.fromEntries(ISSUE_CODES.map(code => [code, publicAudit.issues[code] + protectedAudit.issues[code]]));
  return {
    readOnly: true, allCatalogueMethodsChecked: true,
    auditScope: 'method parsing, invariant preservation and idempotence', sourceCommit,
    publicRecipes: publicAudit.recipes, protectedRecipes: protectedAudit.recipes,
    currentFullRecords: publicAudit.recipes + protectedAudit.recipes,
    publicSha256, protectedRowsSha256: fetched.sha256,
    affectedRecipes: publicAudit.affectedRecipes + protectedAudit.affectedRecipes,
    issues, public: publicAudit, protected: protectedAudit,
    ...(sealedReviewSnapshot ? { sealedReviewSnapshot } : {})
  };
}

export async function runCookMethodSummary({ write = line => console.log(line), ...options } = {}) {
  try {
    const summary = await auditCookMethodSummary({ ...options, writeReviewTransport: options.reviewTransportLog ? write : undefined });
    write(JSON.stringify(summary));
    return summary.affectedRecipes ? 1 : 0;
  } catch (error) {
    write(JSON.stringify({ error: FAILURE_CODES.has(error?.message) ? error.message : 'cook_method_audit_unavailable' }));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = name => { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1] || ''; };
  process.exitCode = await runCookMethodSummary({ env: process.env, reviewRecipientPath: argument('--review-recipient'), sealedReviewOutput: argument('--sealed-review-output'), reviewTransportLog: process.argv.includes('--review-transport-log') });
}
