// Private catalogue transport. Public envelopes contain ciphertext and public
// keys only. Authentication of the publisher belongs to the main-branch release
// workflow; anyone knowing the recipient public key can construct an envelope.
import {
  createHash, hkdfSync, createPrivateKey, createPublicKey, generateKeyPairSync,
  diffieHellman, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual
} from 'node:crypto';

export const MAX_PRIVATE_CATALOGUE_BYTES = 16 * 1024 * 1024;
const VERSION = 1;
const SUITE = 'X25519-HKDF-SHA256-AES-256-GCM';
const DOMAIN = Object.freeze({repository: 'jbatiste12-debug/BasketBoss', environment: 'github-pages', purpose: 'private catalogue import', schema: 1});
const RECIPIENT_SALT = Buffer.from(DOMAIN.repository);
const RECIPIENT_INFO = Buffer.from('BasketBoss private catalogue recipient v1');
const PAYLOAD_INFO = Buffer.from('BasketBoss private catalogue payload v1\0' + JSON.stringify(DOMAIN));
const PRIVATE_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const PUBLIC_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const RECIPIENT_FIELDS = ['version', 'suite', 'publicKey', 'fingerprint'];
const ENVELOPE_FIELDS = ['version', 'suite', 'recipientFingerprint', 'ephemeralPublicKey', 'salt', 'iv', 'metadata', 'ciphertext', 'tag'];
const METADATA_FIELDS = ['releaseId', 'sourceCommit', 'plaintextSha256', 'plaintextBytes'];
const hash = value => createHash('sha256').update(value).digest();
const fail = label => { throw Error('invalid_private_catalogue_' + label); };

function fields(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label);
  const own = Reflect.ownKeys(value);
  if (own.length !== expected.length || own.some(key => typeof key !== 'string' || !expected.includes(key))) fail(label);
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(label);
  }
}
function hex(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(label);
  return value;
}
function base64(value, maxBytes, label, exactBytes) {
  // Avoid repeated grouped matches: multi-megabyte payloads can exhaust the
  // regexp engine's stack. Re-encoding below enforces padding and zero pad bits.
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(maxBytes / 3) || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail(label);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length > maxBytes || exactBytes !== undefined && decoded.length !== exactBytes || decoded.toString('base64') !== value) fail(label);
  return decoded;
}
function publicKey(value, label) {
  const der = base64(value, 44, label, 44);
  if (!der.subarray(0, PUBLIC_PREFIX.length).equals(PUBLIC_PREFIX)) fail(label);
  try {
    const key = createPublicKey({key: der, format: 'der', type: 'spki'});
    if (key.asymmetricKeyType !== 'x25519' || !key.export({format: 'der', type: 'spki'}).equals(der)) fail(label);
    return {key, der};
  } catch { fail(label); }
}
function privateRecipient(token) {
  // Cloudflare API tokens are high-entropy secrets. Weak user passwords must not
  // be substituted: publishing a recipient key permits offline guessing.
  if (typeof token !== 'string' || token.length < 32 || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) fail('token');
  const seed = Buffer.from(hkdfSync('sha256', Buffer.from(token), RECIPIENT_SALT, RECIPIENT_INFO, 32));
  const der = Buffer.concat([PRIVATE_PREFIX, seed]);
  try { return createPrivateKey({key: der, format: 'der', type: 'pkcs8'}); }
  finally { seed.fill(0); der.fill(0); }
}
function checkedRecipient(recipient) {
  fields(recipient, RECIPIENT_FIELDS, 'recipient');
  if (recipient.version !== VERSION || recipient.suite !== SUITE) fail('recipient');
  const parsed = publicKey(recipient.publicKey, 'recipient_key');
  if (!timingSafeEqual(hash(parsed.der), Buffer.from(hex(recipient.fingerprint, 'recipient_fingerprint'), 'hex'))) fail('recipient_fingerprint');
  return parsed;
}
function releaseMetadata(options, plaintext) {
  fields(options, ['releaseId', 'sourceCommit'], 'release_options');
  if (typeof options.releaseId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(options.releaseId)) fail('release_id');
  if (typeof options.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(options.sourceCommit)) fail('source_commit');
  return {releaseId: options.releaseId, sourceCommit: options.sourceCommit, plaintextSha256: hash(plaintext).toString('hex'), plaintextBytes: plaintext.length};
}
function checkedMetadata(metadata) {
  fields(metadata, METADATA_FIELDS, 'metadata');
  if (typeof metadata.releaseId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(metadata.releaseId)) fail('release_id');
  if (typeof metadata.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(metadata.sourceCommit)) fail('source_commit');
  hex(metadata.plaintextSha256, 'plaintext_hash');
  if (!Number.isSafeInteger(metadata.plaintextBytes) || metadata.plaintextBytes < 0 || metadata.plaintextBytes > MAX_PRIVATE_CATALOGUE_BYTES) fail('plaintext_size');
  return {releaseId: metadata.releaseId, sourceCommit: metadata.sourceCommit, plaintextSha256: metadata.plaintextSha256, plaintextBytes: metadata.plaintextBytes};
}
function aad(envelope) {
  return Buffer.from(JSON.stringify({domain: DOMAIN, version: envelope.version, suite: envelope.suite,
    recipientFingerprint: envelope.recipientFingerprint, ephemeralPublicKey: envelope.ephemeralPublicKey,
    salt: envelope.salt, iv: envelope.iv, metadata: envelope.metadata}));
}
function payloadKey(privateKey, peerPublicKey, salt) {
  const shared = diffieHellman({privateKey, publicKey: peerPublicKey});
  try { return Buffer.from(hkdfSync('sha256', shared, salt, PAYLOAD_INFO, 32)); }
  finally { shared.fill(0); }
}

export function recipientForToken(token) {
  const key = privateRecipient(token);
  const der = createPublicKey(key).export({format: 'der', type: 'spki'});
  return {version: VERSION, suite: SUITE, publicKey: der.toString('base64'), fingerprint: hash(der).toString('hex')};
}

export function sealPayload(plaintext, recipient, options) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length > MAX_PRIVATE_CATALOGUE_BYTES) fail('plaintext');
  const peer = checkedRecipient(recipient);
  const {privateKey, publicKey: ephemeral} = generateKeyPairSync('x25519');
  const salt = randomBytes(32), iv = randomBytes(12);
  const envelope = {version: VERSION, suite: SUITE, recipientFingerprint: recipient.fingerprint,
    ephemeralPublicKey: ephemeral.export({format: 'der', type: 'spki'}).toString('base64'),
    salt: salt.toString('base64'), iv: iv.toString('base64'), metadata: releaseMetadata(options, plaintext)};
  const key = payloadKey(privateKey, peer.key, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, {authTagLength: 16});
    cipher.setAAD(aad(envelope), {plaintextLength: plaintext.length});
    envelope.ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
    envelope.tag = cipher.getAuthTag().toString('base64');
    return envelope;
  } finally { key.fill(0); }
}

export function openPayload(envelope, token) {
  fields(envelope, ENVELOPE_FIELDS, 'envelope');
  if (envelope.version !== VERSION || envelope.suite !== SUITE) fail('envelope');
  hex(envelope.recipientFingerprint, 'recipient_fingerprint');
  const metadata = checkedMetadata(envelope.metadata);
  const peer = publicKey(envelope.ephemeralPublicKey, 'ephemeral_key');
  const salt = base64(envelope.salt, 32, 'salt', 32), iv = base64(envelope.iv, 12, 'iv', 12);
  const ciphertext = base64(envelope.ciphertext, MAX_PRIVATE_CATALOGUE_BYTES, 'ciphertext');
  const tag = base64(envelope.tag, 16, 'tag', 16);
  if (ciphertext.length !== metadata.plaintextBytes) fail('ciphertext_size');
  const recipient = privateRecipient(token);
  const fingerprint = hash(createPublicKey(recipient).export({format: 'der', type: 'spki'}));
  if (!timingSafeEqual(fingerprint, Buffer.from(envelope.recipientFingerprint, 'hex'))) throw Error('private_catalogue_decryption_failed');
  let key, partial, plaintext;
  try {
    key = payloadKey(recipient, peer.key, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, {authTagLength: 16});
    decipher.setAAD(aad({...envelope, metadata}), {plaintextLength: metadata.plaintextBytes});
    decipher.setAuthTag(tag);
    partial = decipher.update(ciphertext);
    plaintext = Buffer.concat([partial, decipher.final()]);
    if (!timingSafeEqual(hash(plaintext), Buffer.from(metadata.plaintextSha256, 'hex'))) throw Error('hash mismatch');
    return plaintext;
  } catch {
    plaintext?.fill(0);
    throw Error('private_catalogue_decryption_failed');
  } finally { key?.fill(0); partial?.fill(0); }
}
