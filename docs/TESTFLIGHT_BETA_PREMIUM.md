# TestFlight Beta Premium

The native Upgrade controls already route to the bundled membership/paywall screen. Its Apple plan buttons call the Capacitor `BasketBossPurchases` plugin, prepare an account token through `/api/apple/purchase-context`, invoke StoreKit purchase, and submit the signed transaction to `/api/apple/verify` before finishing it. Previously, configuration/product loading errors were collapsed into unavailable plans. The updated client distinguishes configuration, connectivity and App Store product-loading failures.

TestFlight purchases still use Apple's Sandbox. The existing paid-subscription backend requires complete Apple billing configuration and an explicit sandbox account allowlist. This source audit identifies possible rejection points; it does not establish the current production configuration or reproduce an Apple transaction from a tester's device.

## Complimentary beta access

The native Paywall and Settings membership card both expose **Unlock TestFlight Beta Premium** for a signed-in iOS account, independently of subscription product availability. The action makes no purchase and creates no renewing subscription.

1. The native `getAppTransaction` bridge obtains `AppTransaction.shared`, requires local verification and Sandbox, and returns the signed JWS in memory.
2. `POST /api/apple/testflight-beta` authenticates the confirmed BasketBoss account, checks the current device session and deletion state, and verifies the signed AppTransaction with Apple's official library, pinned Apple roots, online certificate checks, exact BasketBoss bundle ID and Sandbox environment. A configured Apple app ID must agree when supplied by Apple.
3. Cloudflare D1 stores a separate `bb_testflight_beta_grants` record. Only a digest of the verified app transaction ID is retained. A proof binds to one account; repeated requests do not extend the grant, and a second account cannot reuse it. Account deletion clears account linkage and retains a revoked proof tombstone.
4. The client re-reads authoritative subscription status and refreshes the existing verified Premium/catalogue pipeline. Browser flags, request headers and editable user metadata cannot grant access.

The shared entitlement reader recognizes `provider: testflight_beta`, `tier: premium`, `mode: sandbox`. Protected recipes, Chef Boss questions and speech, AI, shopping and explicitly enabled household features use this persisted entitlement. Existing provider credentials, feature flags, device/session rules and usage limits still apply. A grant does not turn on a disabled AI service or manufacture provider credentials. Paid Apple and Paddle subscription records are unchanged; a beta member is prevented from starting another purchase.

Apple's Sandbox AppTransaction also covers development/sandbox acquisition; it does not contain a cryptographically distinct TestFlight marker or BasketBoss user binding. Immutable first-account claiming limits reuse; it is not App Attest or protection against a stolen proof's first claim. Production, Xcode and LocalTesting verification environments are not accepted as Sandbox.

## Expiry and rollout

The campaign ends **1 February 2027 at 00:00 UTC**. Each grant lasts at most 90 days from first activation and never beyond that date. `BB_TESTFLIGHT_BETA_ENABLED=false` disables new and existing beta grants; a non-null `revoked_at_ms` revokes one grant. Existing purchased memberships continue to work when beta access is disabled or expires.

The new isolated D1 table and index initialize additively on the first successful claim using the existing `BILLING_DB` binding. The reviewed equivalent SQL is in `sql/basketboss_testflight_beta_20261103.sql`; no subscription migration, IAP product configuration or new secret is required for beta access. Existing Supabase authentication/current-session service configuration remains required.

Deploy the backend change to the existing production Cloudflare Pages project before distributing the client. **A new TestFlight build is required for clients that lack the AppTransaction bridge or bundled beta buttons.** Once those are installed, the server-only compatibility repairs below do not require another Apple build. GitHub's unsigned archive is compilation evidence, not a signed TestFlight upload.

On a physical TestFlight device, sign in with a confirmed account, open Upgrade, tap **Unlock TestFlight Beta Premium**, and confirm the active/expiry message on both Paywall and Settings. Restart the app and verify Premium recipes, a Chef Boss question with spoken reply, and an AI feature. Check a second signed-in device with the same account follows existing session rules. App Store signing, TestFlight upload, real Apple Sandbox receipt verification and external AI provider responses require that device check; portable mocks and synthetic certificate fixtures do not prove those production paths.

## Troubleshooting beta activation

The message “Apple subscriptions are temporarily unavailable. Please try again.”
after **Unlock TestFlight Beta Premium** was a generic server exception fallback.
It does not identify a failed payment, and the static sign-in help sentence in
Settings does not establish that the tester is signed out. The beta button is
normally shown only to an authenticated native iOS account.

The endpoint now records one safe `BB_BETA_DIAGNOSTIC` line for a caught error.
Unexpected exceptions return a beta-specific message containing a fixed reference
that existing installed clients already display. No raw exception, account ID,
email, bearer token, request body or Apple receipt is logged. Existing known
Apple errors retain their status and code. Proof verification and signed-claim
failures add a fixed reference to the message that installed clients display.

| Reference | Failed step to inspect |
|---|---|
| BB_BETA_CONFIGURATION | Billing DB/auth configuration |
| BB_BETA_ORIGIN | Production host/branch and request origin |
| BB_BETA_AUTHENTICATION | Confirmed account authentication |
| BB_BETA_DELETION | D1 deletion journal/readiness |
| BB_BETA_SESSION | Newest-session RPC availability or result |
| BB_BETA_REQUEST | Signed proof request shape |
| BB_BETA_APPLE_VERIFICATION | Apple verifier setup, proof and certificate verification |
| BB_BETA_GRANT_WRITE | D1 beta grant persistence/readback |
| BB_BETA_CONFIRMATION | Account/session recheck after persistence |

Deploy the backend commit to the production `basketboss-site` Pages project.
This troubleshooting update changes server files only; the existing TestFlight
app can display the returned reference without a new Apple build. Preview
branches intentionally cannot activate beta grants.

To collect the next failure: Cloudflare dashboard → Workers & Pages →
`basketboss-site` → Deployments → latest successful Production deployment →
View details → Functions → Real-time Logs. Start the stream, then ask the tester
to tap **Unlock TestFlight Beta Premium** once. Copy only the
`BB_BETA_DIAGNOSTIC` line or the `BB_BETA_...` reference shown in the app.

Read-only production checks on 4 November 2026 confirmed that
`bb_hh_service_session_ok(uuid,uuid)` exists, is executable by `service_role`
and not by anon/authenticated, and rejects a nonexistent session. Its logged
requests in the preceding 24 hours returned HTTP 200. These checks do not
identify the cousin's individual activation or establish the production Apple
verifier/D1 grant state. No account entitlements or production schema were
changed by these checks.

## Apple verifier runtime compatibility

A production inspection after the tester reported `BB_BETA_APPLE_VERIFICATION`
found no explicit Node.js compatibility flag. Newer Cloudflare dates enable Node
automatically, so this alone does not establish a runtime failure. Apple's
server library uses Node crypto,
including X.509 certificates. Cold library initialization can fail before it
returns a normal Apple proof-verification error. Local cold-start checks pass
with `nodejs_compat` and a compatibility date of 2024-09-23 or later.

The main-only **Repair Apple verifier runtime compatibility** workflow enables
`nodejs_compat` on the existing production `basketboss-site` project, preserving
other flags and any compatibility date at or after that minimum. It retains
database, storage, build and secret configuration, verifies the returned
configuration, then requests a rebuild of the current successful deployment.
If the project is already compatible, it makes no update or rebuild. An explicit
conflicting flag or unexpected configuration change stops the operation.

The workflow uses the existing `github-pages` environment credentials and prints
only fixed readiness/result metadata. Missing Cloudflare write permission is
reported without exposing credentials or provider response bodies. No accounts,
payments or entitlements are changed by the runtime repair. Apple's signature,
certificate and sandbox checks remain required.

After a successful rebuild, retry the beta unlock in the existing TestFlight
app. The runtime correction is server-only; a successful real activation and
authoritative Premium status are still needed to confirm the issue is resolved.

The readiness inspector now reports the validated compatibility date and accounts
for Cloudflare's implicit Node default from 2026-08-04 and explicit opt-outs.
The attempted automatic explicit-flag update was rejected with HTTP 403 by the
Pages read-only token; that attempt made no settings change. Verifier startup
failures are further separated into fixed import, trust-root and constructor
references without exposing raw exception messages or signed proofs.

`GET /api/apple/verifier-health` is a production-only, public startup readiness
check. It constructs the pinned-root Sandbox verifier with online checks enabled;
it does not accept proofs or read/write accounts, payments or entitlements. It
returns only readiness or a fixed initialization reference. The existing main-only
inspection workflow probes this route without account credentials, allowing
startup failures to be investigated without asking a tester to resubmit a receipt.
A ready verifier does not prove a particular tester has Premium access.

## Pages SDK module loading

The production readiness probe isolated an SDK module-loading failure. A legacy
ESM bundle reproduces `Dynamic require of "stream" is not supported` in real
workerd. The official Apple SDK now ships as a reproducible ESM bundle whose
Node built-ins use static native imports. Its SDK body remains behind an explicit
request-time `loadAppleServerSDK()` factory, keeping random initialization out of
Worker global scope. The official SDK version, cryptography, pinned roots and
online checks are unchanged. No dependency or runtime-setting change is needed.

Run `node scripts/build-apple-sdk.mjs --check` to verify the checked-in bundle and
license notices against the pinned dependency tree. The workerd regression
`node scripts/test-apple-sdk-worker.mjs` proves legacy failure versus a ready
fixed bundle. The full existing Apple worker tests continue to verify signed
fixtures and reject tampering, incorrect bundle/environment and untrusted roots.

After production deployment, the public verifier readiness route must report
ready on both domains. A tester must then activate Beta Premium and verify the
authoritative membership status before considering the user-facing issue fixed.


## OCSP transport and strict UTC date compatibility

SDK startup readiness does not exercise the verifier's online OCSP requests.
A second real-workerd regression reproduces a separate failure after startup:
`node-fetch` reaches a Node HTTP header compatibility error before either OCSP
request leaves the Worker. The SDK classifies it as a retryable verification
failure. This is a confirmed runtime incompatibility; it does not alone establish
which step rejected an individual tester's request.

The reproducible bundle now supplies Workers-native Fetch for the official
SDK's HTTP transport. Requests preserve exact DER bytes and headers. Responses
support the SDK's JSON methods and Node `Buffer`-returning `buffer()` method.
The SDK's request timeout covers reading the whole response body; aborts,
network failures and non-success HTTP responses still reject verification.
No new credential, entitlement, database or Cloudflare setting is required.

The pinned SDK 3.1.0 also parses OCSP dates using a regex that omits the trailing
`Z` in ASN.1 GeneralizedTime. `Invalid Date` can then bypass its freshness
comparisons. Our explicitly documented instance wrapper replaces only
`parseX509Date()`, on both app-proof and paid-purchase verifiers, with a strict,
calendar-validated UTC parser. It accepts 14 digits, optional bounded fractional
seconds and optional `Z`; impossible or malformed values throw the official
SDK's `VerificationException(FAILURE)`. Certificate chains, signature checks,
revocation status and the SDK's existing clock-skew comparisons stay in place.
The vendored SDK source is generated from the unchanged pinned release; it is
not patched to disable or replace verification.

The real-workerd fixture now verifies an ES256 AppTransaction with online
checks enabled and two signed, valid OCSP responses. The legacy transport
fails before sending a request; the native transport makes both OCSP POSTs.
Revoked, stale, future-dated, malformed-date, tampered and malformed responses
remain rejected, as do network errors and non-success HTTP responses. These
are synthetic keys and certificates confined to the isolated test process.
Production continues to use pinned Apple roots and real online checks.

Actual verification failures now expose only fixed diagnostic references:

| Reference | Meaning |
|---|---|
| `BB_BETA_APPLE_VERIFY_RETRYABLE_VERIFICATION_FAILURE` | Online certificate verification could not complete; inspect runtime transport or provider availability |
| `BB_BETA_APPLE_VERIFY_VERIFICATION_FAILURE` | Signature or trusted-chain verification failed |
| `BB_BETA_APPLE_VERIFY_INVALID_CERTIFICATE` | Certificate decoding, validity or certificate-purpose check failed |
| `BB_BETA_APPLE_VERIFY_INVALID_APP_IDENTIFIER` | The verified proof belongs to a different app |
| `BB_BETA_APPLE_VERIFY_INVALID_ENVIRONMENT` | The verified proof is not Sandbox |
| `BB_BETA_APPLE_VERIFY_INVALID_CHAIN_LENGTH` | The SDK rejected the certificate-chain shape |
| `BB_BETA_APPLE_VERIFY_FAILURE` | The SDK rejected proof/OCSP contents, including invalid freshness dates |
| `BB_BETA_APPLE_VERIFY_TIMEOUT` | The existing bounded verifier timed out |
| `BB_BETA_APPLE_VERIFY_REQUEST_FORMAT` | The signed proof has an invalid envelope |
| `BB_BETA_APPLE_VERIFY_UNEXPECTED` | An unclassified verifier exception occurred; no raw detail is disclosed |
| `BB_BETA_APPLE_CLAIM_APP_TRANSACTION_ID` | A successfully verified payload lacks a valid app transaction identity |
| `BB_BETA_APPLE_CLAIM_APP_ID` | A successfully verified payload contains an invalid or conflicting Apple app ID |
| `BB_BETA_APPLE_CLAIM_BUNDLE_ID` / `..._ENVIRONMENT` | A successfully verified payload fails the exact app/environment requirement |
| `BB_BETA_APPLE_CLAIM_APPLICATION_VERSION` / `..._RECEIPT_CREATION_DATE` | A successfully verified payload fails a required version/date check |
| `BB_BETA_APPLE_CLAIM_CONFIGURATION` | The configured Apple app ID is invalid |

No proof fields, identifiers, certificate bodies, exception text, bearer tokens
or account details appear in these references or diagnostic logs. Failed
verification and claims do not persist a beta grant. A valid tester's successful
activation and authoritative Premium status remain the final production check.
