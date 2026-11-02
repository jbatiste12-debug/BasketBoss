#!/usr/bin/env node
// Open only an artifact downloaded from the expected repository Actions run.
// Encryption does not authenticate the publisher; trusted GitHub download and
// explicit expected run/commit context are both required operational checks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPayload } from './private-catalogue-envelope.mjs';
import { validatePrivateRecipeExport, writePrivateRecipeExport, privateAuditPath } from './load-private-recipe-audit.mjs';
import { checkedAuditContext, AUDIT_REPOSITORY, AUDIT_REF } from './recipe-audit-ci.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = code => { throw Error('readonly_recipe_audit_' + code); };
export function openPrivateAuditBundle({ envelopePath, keyPath, outputDirectory, expected, publicRoot = ROOT }) {
  const context = checkedAuditContext(expected);
  const privateKeyPath = privateAuditPath(keyPath, publicRoot);
  const keyStat = fs.lstatSync(privateKeyPath);
  if (!keyStat.isFile() || keyStat.nlink !== 1 || (keyStat.mode & 0o077) !== 0 || keyStat.size < 32 || keyStat.size > 4097) fail('key_permissions_invalid');
  const input = privateAuditPath(envelopePath, publicRoot);
  const inputStat = fs.lstatSync(input);
  if (!inputStat.isFile() || inputStat.size > 24 * 1024 * 1024) fail('envelope_invalid');
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(input, 'utf8')); } catch { fail('envelope_invalid'); }
  if (envelope?.metadata?.sourceCommit !== context.commit || envelope?.metadata?.releaseId !== `readonly-recipe-audit-${context.runId}-${context.runAttempt}`) fail('context_mismatch');
  let plaintext;
  try {
    const key = fs.readFileSync(privateKeyPath, 'utf8').trim();
    try { plaintext = openPayload(envelope, key); } catch { fail('decrypt_failed'); }
    let payload;
    try { payload = JSON.parse(plaintext.toString('utf8')); } catch { fail('payload_invalid'); }
    if (payload?.schemaVersion !== 1 || payload?.kind !== 'basketboss-private-recipe-audit') fail('payload_invalid');
    const actual = checkedAuditContext(payload.context);
    if (JSON.stringify(actual) !== JSON.stringify(context)) fail('context_mismatch');
    const checked = validatePrivateRecipeExport(payload.snapshot);
    const result = writePrivateRecipeExport({ outputDirectory, rows: payload.snapshot.rows, databaseId: payload.snapshot.source.databaseId, readAt: payload.snapshot.source.readAt, publicRoot });
    if (result.sha256 !== checked.sha256) fail('export_hash_mismatch');
    return result;
  } finally { plaintext?.fill(0); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = name => { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; };
  try {
    const result = openPrivateAuditBundle({ envelopePath: argument('--sealed'), keyPath: argument('--key-file'), outputDirectory: argument('--out-dir'), expected: { repository: AUDIT_REPOSITORY, ref: AUDIT_REF, commit: argument('--commit'), runId: argument('--run-id'), runAttempt: argument('--run-attempt') } });
    console.log(JSON.stringify({ recipes: result.recipes, ingredientLines: result.ingredientLines, rowsSha256: result.sha256 }));
  } catch (error) {
    console.error(/^(?:readonly_recipe_audit|private_recipe_audit)_[a-z_]+$/.test(error?.message || '') ? error.message : 'readonly_recipe_audit_unavailable');
    process.exitCode = 1;
  }
}
