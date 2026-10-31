import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicKey, createHash} from 'node:crypto';
import {MAX_PRIVATE_CATALOGUE_BYTES, recipientForToken, sealPayload, openPayload} from '../scripts/private-catalogue-envelope.mjs';

const token = 'synthetic-cloudflare-api-token-with-high-entropy-placeholder';
const options = {releaseId: 'recipes-500-20261031', sourceCommit: 'a'.repeat(40)};
const plaintext = Buffer.from('Private recipe title, ingredients and method — never publish as plaintext.');
const copy = value => JSON.parse(JSON.stringify(value));
const bitflip = text => {const data = Buffer.from(text, 'base64');data[0] ^= 1;return data.toString('base64');};
const envelope = () => sealPayload(plaintext, recipientForToken(token), options);

test('recipient is deterministic X25519 public SPKI with SHA256 fingerprint', () => {
  const recipient = recipientForToken(token);
  assert.deepEqual(recipient, recipientForToken(token));
  const der = Buffer.from(recipient.publicKey, 'base64');
  assert.equal(createPublicKey({key: der, format: 'der', type: 'spki'}).asymmetricKeyType, 'x25519');
  assert.equal(createHash('sha256').update(der).digest('hex'), recipient.fingerprint);
  assert.notEqual(recipient.fingerprint, recipientForToken(token + '-rotated').fingerprint);
  assert.ok(!JSON.stringify(recipient).includes(token));
});

test('roundtrip survives JSON serialization without publishing plaintext or token', () => {
  const sealed = envelope();
  assert.deepEqual(openPayload(copy(sealed), token), plaintext);
  assert.ok(!JSON.stringify(sealed).includes(token));
  assert.ok(!JSON.stringify(sealed).includes(plaintext.toString()));
  assert.equal(sealed.metadata.plaintextBytes, plaintext.length);
});

test('encryption uses unique ephemeral keys, salts, IVs and ciphertext', () => {
  const a = envelope(), b = envelope();
  for (const key of ['ephemeralPublicKey', 'salt', 'iv', 'ciphertext', 'tag']) assert.notEqual(a[key], b[key], key);
  assert.deepEqual(openPayload(a, token), openPayload(b, token));
});

test('token rotation fails closed', () => {
  assert.throws(() => openPayload(envelope(), token + '-rotated'), /private_catalogue_decryption_failed/);
});

test('authentication rejects ciphertext, tag, nonce, salt and public-key tampering', () => {
  for (const field of ['ciphertext', 'tag', 'iv', 'salt']) {
    const changed = envelope();changed[field] = bitflip(changed[field]);
    assert.throws(() => openPayload(changed, token), /decryption_failed/, field);
  }
  const changed = envelope();changed.ephemeralPublicKey = recipientForToken(token + '-other-key').publicKey;
  assert.throws(() => openPayload(changed, token), /decryption_failed/);
});

test('all release metadata and recipient identity are authenticated', () => {
  for (const [key, value] of [['releaseId', 'other-release'], ['sourceCommit', 'b'.repeat(40)], ['plaintextSha256', '0'.repeat(64)]]) {
    const changed = envelope();changed.metadata[key] = value;
    assert.throws(() => openPayload(changed, token), /decryption_failed/, key);
  }
  const changed = envelope();changed.recipientFingerprint = '0'.repeat(64);
  assert.throws(() => openPayload(changed, token), /decryption_failed/);
});

test('strict envelopes reject unknown fields, versions, suites, prototypes and accessors', () => {
  for (const changed of [{...envelope(), extra: true}, {...envelope(), version: 2}, {...envelope(), suite: 'none'}]) assert.throws(() => openPayload(changed, token), /invalid_private_catalogue_envelope/);
  const inherited = Object.create({secret: true});Object.assign(inherited, envelope());
  assert.throws(() => openPayload(inherited, token), /invalid_private_catalogue_envelope/);
  const getter = envelope();Object.defineProperty(getter, 'salt', {enumerable: true, get() {throw Error('getter must never run');}});
  assert.throws(() => openPayload(getter, token), /invalid_private_catalogue_envelope/);
  const metadata = envelope();metadata.metadata.extra = true;
  assert.throws(() => openPayload(metadata, token), /invalid_private_catalogue_metadata/);
});

test('strict canonical base64, DER keys and exact field sizes are enforced', () => {
  for (const [field, value] of [['salt', 'AA=='], ['iv', '!!!!'], ['tag', Buffer.alloc(17).toString('base64')], ['ephemeralPublicKey', Buffer.alloc(44).toString('base64')], ['ciphertext', ' AAAAAA==']]) {
    const changed = envelope();changed[field] = value;
    assert.throws(() => openPayload(changed, token), /invalid_private_catalogue_/, field);
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const noncanonical = envelope();
  noncanonical.tag = noncanonical.tag.slice(0, -3) + alphabet[alphabet.indexOf(noncanonical.tag.at(-3)) + 1] + '==';
  assert.throws(() => openPayload(noncanonical, token), /invalid_private_catalogue_|decryption_failed/);
});

test('recipient public keys and fingerprint must agree before encryption', () => {
  const recipient = recipientForToken(token);recipient.fingerprint = '0'.repeat(64);
  assert.throws(() => sealPayload(plaintext, recipient, options), /invalid_private_catalogue_recipient_fingerprint/);
  assert.throws(() => sealPayload(plaintext, {...recipientForToken(token), extra: true}, options), /invalid_private_catalogue_recipient/);
});

test('bounds and types reject oversized payloads, weak tokens and malformed release fields', () => {
  const recipient = recipientForToken(token);
  assert.throws(() => sealPayload('plaintext', recipient, options), /invalid_private_catalogue_plaintext/);
  assert.throws(() => sealPayload(Buffer.alloc(MAX_PRIVATE_CATALOGUE_BYTES + 1), recipient, options), /invalid_private_catalogue_plaintext/);
  for (const input of ['', 'short', token + '\n', null, 123]) assert.throws(() => recipientForToken(input), /invalid_private_catalogue_token/);
  for (const bad of [{...options, sourceCommit: 'short'}, {...options, releaseId: '../escape'}, {...options, releaseId: 'x'.repeat(121)}]) assert.throws(() => sealPayload(plaintext, recipient, bad), /invalid_private_catalogue_/);
  const changed = envelope();changed.metadata.plaintextBytes = MAX_PRIVATE_CATALOGUE_BYTES + 1;
  assert.throws(() => openPayload(changed, token), /invalid_private_catalogue_plaintext_size/);
  const mismatch = envelope();mismatch.metadata.plaintextBytes++;
  assert.throws(() => openPayload(mismatch, token), /invalid_private_catalogue_ciphertext_size/);
});

test('empty and maximum-size byte payloads roundtrip', () => {
  const recipient = recipientForToken(token);
  for (const source of [Buffer.alloc(0), Buffer.alloc(MAX_PRIVATE_CATALOGUE_BYTES, 0xab)]) assert.deepEqual(openPayload(sealPayload(source, recipient, options), token), source);
});
