#!/usr/bin/env node
// Dedicated manual read-only audit. Only ciphertext is retained as an artifact.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrivateRecipeAudit, readPrivateRecipeExport, privateAuditPath } from './load-private-recipe-audit.mjs';
import { sealPayload } from './private-catalogue-envelope.mjs';
import { auditRecipeInstructions, summarizePrivateRecipeAudit } from './audit-recipe-instructions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUDIT_REPOSITORY = 'jbatiste12-debug/BasketBoss';
export const AUDIT_REF = 'refs/heads/release/recipe-editorial-collections';
const fail = code => { throw Error('readonly_recipe_audit_' + code); };
export function checkedAuditContext(value) {
  if (!value || value.repository !== AUDIT_REPOSITORY || value.ref !== AUDIT_REF || !/^[a-f0-9]{40}$/.test(value.commit || '') || !/^[1-9][0-9]{0,19}$/.test(value.runId || '') || !/^[1-9][0-9]{0,5}$/.test(value.runAttempt || '')) fail('context_invalid');
  return { repository: value.repository, ref: value.ref, commit: value.commit, runId: value.runId, runAttempt: value.runAttempt };
}
function runnerContext(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch') fail('manual_runner_required');
  return checkedAuditContext({ repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, commit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
}
export function cleanupPrivateAuditRunner({ env, publicRoot = ROOT }) {
  runnerContext(env);
  if (!env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP)) fail('runner_temp_required');
  const directory = privateAuditPath(env.RUNNER_TEMP, publicRoot);
  for (const name of fs.readdirSync(directory)) {
    if (!/^basketboss-private-audit-[A-Za-z0-9]{6}$/.test(name)) continue;
    const target = path.join(directory, name);
    if (fs.lstatSync(target).isDirectory()) fs.rmSync(target, { recursive: true, force: true });
  }
}
function exclusiveWrite(file, bytes) {
  let descriptor;
  try { descriptor = fs.openSync(file, 'wx', 0o600); }
  catch { fail('output_exists_or_unavailable'); }
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

export async function createPrivateAuditBundle({ env, perform = fetch, publicRoot = ROOT, recipientPath = path.join(publicRoot, '.github/private-catalogue/recipe-audit-recipient.json') }) {
  const context = runnerContext(env);
  if (!env.CLOUDFLARE_API_TOKEN) fail('read_token_unconfigured');
  if (!env.CLOUDFLARE_ACCOUNT_ID) fail('account_unconfigured');
  if (!env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP)) fail('runner_temp_required');
  const runnerDirectory = privateAuditPath(env.RUNNER_TEMP, publicRoot);
  const recipientStat = fs.lstatSync(recipientPath);
  if (!recipientStat.isFile() || recipientStat.size > 4096) fail('recipient_invalid');
  let recipient;
  try { recipient = JSON.parse(fs.readFileSync(recipientPath, 'utf8')); } catch { fail('recipient_invalid'); }
  const sealedPath = privateAuditPath(path.join(runnerDirectory, 'basketboss-recipe-audit.sealed.json'), publicRoot);
  const summaryPath = privateAuditPath(path.join(runnerDirectory, 'basketboss-recipe-audit-summary.json'), publicRoot);
  const privateDirectory = fs.mkdtempSync(path.join(runnerDirectory, 'basketboss-private-audit-'));
  let plaintext;
  try {
    const loaded = await loadPrivateRecipeAudit({ env, perform, outputDirectory: privateDirectory, publicRoot });
    const checked = readPrivateRecipeExport(loaded.exportPath, { publicRoot });
    const snapshot = JSON.parse(fs.readFileSync(loaded.exportPath, 'utf8'));
    const read = name => JSON.parse(fs.readFileSync(path.join(publicRoot, name), 'utf8'));
    const publicRecipes = read('recipes.json');
    if (!Array.isArray(publicRecipes) || publicRecipes.length !== 100) fail('public_count_invalid');
    const ids = new Set(publicRecipes.map(recipe => recipe.id));
    if (ids.size !== 100 || checked.recipes.some(recipe => ids.has(recipe.id))) fail('catalogue_identity_invalid');
    const publicAudit = auditRecipeInstructions({ recipes: publicRecipes, normalized: read('normalized-ingredient-database.json'), desserts: read('dessert_recipes.json') });
    const privateAudit = summarizePrivateRecipeAudit(checked);
    const summary = {
      publicRecipes: publicRecipes.length, protectedRecipes: checked.recipes.length,
      currentFullRecords: publicRecipes.length + checked.recipes.length,
      protectedIngredientLines: privateAudit.ingredientLines,
      publicConsistencyErrors: publicAudit.errors.length, publicReviewFindings: publicAudit.review.length,
      protectedConsistencyErrors: privateAudit.consistencyErrors, protectedReviewFindings: privateAudit.reviewFindings,
      rowsSha256: checked.sha256, sourceCommit: context.commit
    };
    plaintext = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'basketboss-private-recipe-audit', context, snapshot }));
    const envelope = sealPayload(plaintext, recipient, { releaseId: `readonly-recipe-audit-${context.runId}-${context.runAttempt}`, sourceCommit: context.commit });
    exclusiveWrite(sealedPath, JSON.stringify(envelope) + '\n');
    exclusiveWrite(summaryPath, JSON.stringify(summary) + '\n');
    return { sealedPath, summaryPath, recipes: checked.recipes.length, sha256: checked.sha256, summary };
  } finally {
    plaintext?.fill(0);
    fs.rmSync(privateDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--cleanup')) cleanupPrivateAuditRunner({ env: process.env });
    else {
      const result = await createPrivateAuditBundle({ env: process.env });
      console.log(JSON.stringify(result.summary));
    }
  } catch (error) {
    console.error(/^(?:readonly_recipe_audit|private_recipe_audit)_[a-z_]+$/.test(error?.message || '') ? error.message : 'readonly_recipe_audit_unavailable');
    process.exitCode = 1;
  }
}
