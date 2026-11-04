import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAppleOCSPUTCDate,withAppleOCSPDateCompatibility} from '../bb-server-lib/bb-apple-ocsp.js';
import {loadAppleServerSDK} from '../bb-server-lib/vendor/apple-server-sdk.mjs';
import {appleRootCertificates} from '../bb-server-lib/bb-apple-roots.js';
import {getAppleAppTransactionVerifier} from '../bb-server-lib/bb-apple-subscriptions.js';
const sdk=loadAppleServerSDK();
test('ASN.1 OCSP dates parse as calendar-validated UTC with optional Z and bounded fractional seconds',()=>{
 for(const [input,expected]of [['20261104123045Z','2026-11-04T12:30:45.000Z'],['20261104123045','2026-11-04T12:30:45.000Z'],['20261104123045.12Z','2026-11-04T12:30:45.120Z'],['20261104123045.123456789Z','2026-11-04T12:30:45.123Z'],['20000229120000Z','2000-02-29T12:00:00.000Z'],['00010101000000Z','0001-01-01T00:00:00.000Z'],['00991231235959Z','0099-12-31T23:59:59.000Z']])assert.equal(parseAppleOCSPUTCDate(input).toISOString(),expected);
});
test('malformed, non-UTC and impossible OCSP dates never yield Invalid Date or echo their input',()=>{
 const privateValue='private.certificate.value';
 for(const input of [undefined,null,42,{},'',privateValue,'202611041230','2026110412304500Z','20261104123045+0000','20261104123045-0100','20261104123045.Z','20261104123045.1234567890Z','00000101000000Z','20261301000000Z','20260001000000Z','20260229000000Z','19000229000000Z','20260431000000Z','20261100230000Z','20261104240000Z','20261104126000Z','20261104123060Z'])assert.throws(()=>parseAppleOCSPUTCDate(input),error=>error instanceof RangeError&&error.message==='Invalid Apple OCSP UTC date.'&&!error.message.includes(privateValue));
});
test('pinned SDK parser compatibility preserves online checks and rejects invalid input with official FAILURE',async()=>{
 const verifier=await getAppleAppTransactionVerifier();assert.equal(verifier.enableOnlineChecks,true);assert.equal(verifier.environment,'Sandbox');assert.equal(verifier.bundleId,'uk.co.basketboss.app');assert.equal(verifier.rootCertificates.length,1);assert.equal(Object.hasOwn(verifier,'parseX509Date'),true);
 assert.equal(verifier.parseX509Date('20261104123045Z').getTime(),Date.parse('2026-11-04T12:30:45Z'));
 assert.throws(()=>verifier.parseX509Date('20261301000000Z'),error=>error instanceof sdk.VerificationException&&error.status===sdk.VerificationStatus.FAILURE&&error.message==='');
 assert.throws(()=>withAppleOCSPDateCompatibility({},sdk),/Pinned Apple verifier date interface/);
});
test('only the date parser is replaced; official certificate, signature, revocation and clock-skew methods remain intact',()=>{
 const verifier=new sdk.SignedDataVerifier(appleRootCertificates(),true,sdk.Environment.SANDBOX,'uk.co.basketboss.app'),methods=['verifyAndDecodeAppTransaction','verifyJWT','verifyCertificateChain','verifyCertificateChainWithoutCaching','checkOCSPStatus','checkDates'];
 const before=methods.map(name=>verifier[name]);assert.equal(withAppleOCSPDateCompatibility(verifier,sdk),verifier);for(const [index,name]of methods.entries())assert.equal(verifier[name],before[index],name);assert.equal(verifier.enableOnlineChecks,true);
 const now=Date.now(),date=verifier.parseX509Date('20000101000000Z');assert.ok(date.getTime()<now-60000,'stale times are real past dates, not NaN');
});
