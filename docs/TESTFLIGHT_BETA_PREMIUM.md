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

Deploy the backend change to the existing production Cloudflare Pages project before distributing the client. **A new TestFlight build is required:** older installed apps do not include the AppTransaction bridge or these bundled buttons. The current candidate is iOS build 7. GitHub's unsigned archive is compilation evidence, not a signed TestFlight upload.

On a physical TestFlight device, sign in with a confirmed account, open Upgrade, tap **Unlock TestFlight Beta Premium**, and confirm the active/expiry message on both Paywall and Settings. Restart the app and verify Premium recipes, a Chef Boss question with spoken reply, and an AI feature. Check a second signed-in device with the same account follows existing session rules. App Store signing, TestFlight upload, real Apple Sandbox receipt verification and external AI provider responses require that device check; portable mocks and synthetic certificate fixtures do not prove those production paths.
