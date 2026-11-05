// Optional one-run transport for an explicitly requested full content review.
// No private plaintext is written. Only the fixed encrypted file can be created.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { privateAuditPath, validatePrivateRecipeExport } from './load-private-recipe-audit.mjs';
import { sealPayload } from './private-catalogue-envelope.mjs';

export const COOK_REVIEW_FILENAME = 'basketboss-cook-review.sealed.json';
export const COOK_REVIEW_TRANSPORT_CHUNK_CHARS = 12 * 1024;
const MAX_ENVELOPE_BYTES = 24 * 1024 * 1024;
const REPOSITORY = 'jbatiste12-debug/BasketBoss';
const REF = 'refs/heads/main';
const fail = code => { throw Error('cook_method_audit_' + code); };

export function checkedCookReviewContext(value) {
  if (!value || value.repository !== REPOSITORY || value.ref !== REF ||
      !/^[a-f0-9]{40}$/.test(value.commit || '') ||
      !/^[1-9][0-9]{0,19}$/.test(value.runId || '') ||
      !/^[1-9][0-9]{0,5}$/.test(value.runAttempt || '')) fail('review_context_invalid');
  return { repository: value.repository, ref: value.ref, commit: value.commit, runId: value.runId, runAttempt: value.runAttempt };
}

export function prepareCookReviewSnapshot({ env, root, recipientPath, outputPath, transportLog = false, writeTransport }) {
  if (typeof transportLog !== 'boolean' || transportLog && typeof writeTransport !== 'function') fail('review_options_invalid');
  if (recipientPath === undefined && outputPath === undefined) {
    if (transportLog) fail('review_options_invalid');
    return undefined;
  }
  if (typeof recipientPath !== 'string' || !recipientPath || typeof outputPath !== 'string' || !outputPath) fail('review_options_invalid');
  if (env?.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'push') fail('review_context_invalid');
  const context = checkedCookReviewContext({ repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, commit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
  const metadata = { releaseId: `cook-content-review-${context.runId}-${context.runAttempt}`, sourceCommit: context.commit };
  let runnerTemp, output, recipient;
  try {
    if (!path.isAbsolute(env.RUNNER_TEMP || '') || !path.isAbsolute(outputPath)) fail('review_output_invalid');
    runnerTemp = privateAuditPath(env.RUNNER_TEMP, root);
    const tempStat = fs.lstatSync(runnerTemp);
    if (!tempStat.isDirectory() || typeof process.getuid === 'function' && tempStat.uid !== process.getuid()) fail('review_output_invalid');
    output = privateAuditPath(outputPath, root);
    if (path.dirname(output) !== runnerTemp || path.basename(output) !== COOK_REVIEW_FILENAME || fs.existsSync(output)) fail('review_output_invalid');
  } catch { fail('review_output_invalid'); }
  try {
    const expected = path.resolve(root, '.github/private-catalogue/cook-review-recipient.json');
    const recipientFile = path.resolve(root, recipientPath);
    if (recipientFile !== expected || fs.realpathSync(recipientFile) !== recipientFile) fail('review_recipient_invalid');
    const stat = fs.lstatSync(recipientFile);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 4096) fail('review_recipient_invalid');
    recipient = JSON.parse(fs.readFileSync(recipientFile, 'utf8'));
    // Validate the explicit public recipient before reading any protected rows.
    sealPayload(Buffer.alloc(0), recipient, metadata);
  } catch { fail('review_recipient_invalid'); }

  return fetched => {
    let plaintext, descriptor, created = false, complete = false;
    try {
      const snapshot = {
        schemaVersion: 1,
        source: { kind: 'cloudflare-d1-read-only', table: 'bb_private_premium_recipes_500_v1', databaseId: fetched.databaseId, readAt: new Date().toISOString() },
        rowsSha256: fetched.sha256, rows: fetched.rows
      };
      validatePrivateRecipeExport(snapshot);
      plaintext = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'basketboss-cook-content-review', context, snapshot }));
      const envelope = sealPayload(plaintext, recipient, metadata);
      const envelopeBytes = Buffer.from(JSON.stringify(envelope) + '\n');
      if (envelopeBytes.length > MAX_ENVELOPE_BYTES) fail('review_seal_failed');
      // Recheck aliases before the exclusive open. Never follow a final symlink
      // or overwrite any file placed at the output path after preparation.
      if (privateAuditPath(output, root) !== output || privateAuditPath(runnerTemp, root) !== runnerTemp) fail('review_output_invalid');
      descriptor = fs.openSync(output, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      created = true;
      fs.writeFileSync(descriptor, envelopeBytes);
      fs.fsyncSync(descriptor);
      complete = true;
      if (transportLog) {
        // Explicit fallback transport for the authenticated GitHub log reader.
        // Encode only the authenticated encrypted envelope, never the plaintext.
        const encoded = envelopeBytes.toString('base64');
        const hash = createHash('sha256').update(envelopeBytes).digest('hex');
        const count = Math.ceil(encoded.length / COOK_REVIEW_TRANSPORT_CHUNK_CHARS);
        for (let index = 0; index < count; index++) {
          const part = encoded.slice(index * COOK_REVIEW_TRANSPORT_CHUNK_CHARS, (index + 1) * COOK_REVIEW_TRANSPORT_CHUNK_CHARS);
          writeTransport(`BB_COOK_REVIEW_CIPHER ${index + 1}/${count} ${hash} ${part}`);
        }
      }
      return { sealed: true, protectedRecipes: fetched.rows.length, rowsSha256: fetched.sha256, recipientFingerprint: recipient.fingerprint };
    } catch { fail('review_seal_failed'); }
    finally {
      plaintext?.fill(0);
      try { if (descriptor !== undefined) fs.closeSync(descriptor); }
      finally { if (created && !complete) fs.rmSync(output, { force: true }); }
    }
  };
}
