# iOS and Android subscription parity audit

Source audit and implementation notes for 21 November 2026. This is a repository
audit, not proof that store products, prices, offers, agreements, credentials,
D1 schemas or notification delivery are configured in production. No store
purchase, migration or customer-data change is made by this document. Build
numbers and signed-AAB instructions are in [the Android release guide](ANDROID_GOOGLE_PLAY.md).

## Existing iOS contract before the parity changes

| Area | Current implementation |
| --- | --- |
| Application | Bundle ID `uk.co.basketboss.app`; minimum iOS 16; Capacitor 8.6.0 |
| Native integration | Custom `BasketBossPurchasesPlugin.swift`, registered by `BasketBossViewController.capacitorDidLoad`; StoreKit 2, with no third-party purchase SDK |
| Products | `uk.co.basketboss.premium.monthly` and `uk.co.basketboss.premium.annual` |
| Client controller | `native/apple-purchases.mjs`; registered as `BasketBossPurchases` by `native/runtime.mjs` |
| Membership UI | `native/membership.mjs`; signed-out/checking/free/premium/unavailable state, purchase loading/busy/error state, Restore Purchases and Apple management |
| Purchase preparation | Authenticated `/api/apple/purchase-context`; fixed allowed product, account readiness, deletion barrier and existing-provider checks; stable server-owned `appAccountToken` |
| Verification | `/api/apple/verify`, `bb-server-lib/bb-apple-subscriptions.js` and Apple's server library; signed transaction and current subscription lookup, persisted to D1 |
| Membership | Fresh `/api/subscription/status`, including the existing owner, Apple, Paddle, household and beta rules; never a client purchase callback |
| Delivery | Native transaction updates and pending-transaction recovery; server acknowledgement must succeed before `finishTransaction` |
| Store notifications | `/api/apple/notifications`; verified signed data and current store status, not notification labels alone |
| Management | StoreKit's native subscription-management sheet, then membership refresh |

The client requests Apple's localized `displayPrice` and checks that each product
has the expected one-month or one-year subscription period. Native StoreKit
metadata carries introductory-offer terms and Apple eligibility. The membership
UI advertises **7 days free only** when the actual eligible offer has zero price,
one offer period and a seven-day/one-week period. Selecting that offer uses the
ordinary authorised StoreKit purchase flow. Trial access is a verified store
subscription state, not a local timer or a client Premium flag.

`ios/App/App/BasketBossPremium.storekit` is a local debug fixture. Its £4.99 and
£39.99 amounts are not evidence of current App Store prices, and its
`introductoryOffer: null` does not establish a live trial. The release scheme has
no attached local StoreKit configuration. Confirm current territory pricing,
introductory offers and subscription-group eligibility in App Store Connect.
Complimentary TestFlight beta access is a separate server grant, not a free-trial
subscription or a renewal charge.

The server validates Apple's chain/signature, product, application bundle,
environment, subscription group, transaction identifiers and account token. It
re-queries current status so an old signed receipt cannot revive expired or
revoked access. Clients send a bearer session to the production API, omit browser
cookies and re-check account/token/generation/deletion state before applying
asynchronous results. A successful purchase proof is acknowledged even if it no
longer grants Premium; access still comes from current verified membership.

Restore first obtains the native current entitlements; the plugin can request
App Store synchronisation when needed. Each delivered transaction is verified
with the server. The UI reports restoration only when a transaction verification
provides active access and a fresh membership response agrees. Failure to load
purchase prices does not fabricate products or grant access. Managing or
cancelling through Apple retains paid access only while the verified period or
eligible grace period remains active.

The shared native configuration uses `capacitor://localhost` on iOS and the
production API origin. `CapacitorHttp` remains disabled. The iOS Swift plugin,
Xcode registration and native signing settings are preserved by the Android
implementation. The optional shared purchase-intent handshake changes new
checkout coordination, not Apple's proof, restore, finish or entitlement rules.

## Android implementation and equivalent behaviour

| iOS behaviour | Android equivalent |
| --- | --- |
| StoreKit 2 native bridge | Custom `BasketBossGooglePlayPlugin.java`, registered in `MainActivity` |
| Two Apple products | One Play subscription `basketboss_premium`, auto-renewing base plans `monthly` and `annual` |
| Store-returned localized prices | `ProductDetails` eligible subscription offers and pricing phases from Play |
| Eligible seven-day introductory offer | Optional `seven-day` offer under each base plan; only Play-returned, server-allowlisted offer tokens are accepted |
| Stable Apple account token | Opaque server-owned Google obfuscated account ID; verified store metadata binds proof to that BasketBoss user |
| Signed transaction/current Apple status | Android Developer API `purchases.subscriptionsv2.get`, with package/product/base-plan/offer/environment/account validation |
| Server acknowledgement before StoreKit finish | Persist immutable Google purchase ownership, acknowledge on the server, then grant only verified acknowledged active access |
| Restore delivered transactions | Fresh Google owned-subscription query, server verification and a fresh BasketBoss membership read |
| Native Apple manage sheet | Google Play subscription-management deep link, with HTTPS fallback |
| Apple server notifications | Authenticated Google Pub/Sub RTDN; fresh Developer API lookup and safe retry/deduplication |

The Android project uses Capacitor **8.6.0**, Google Play Billing **9.1.0**,
minimum API 24 and compile/target API 36. Billing is an Android Gradle dependency
(`com.android.billingclient:billing`), not an npm purchase package. The packaged
manifest must include `com.android.vending.BILLING` as well as Internet access;
the AAB verifier checks the actual merged manifest. The native origin is exactly
`https://localhost`, with credential-free authenticated API requests to
`https://basketboss.co.uk`. Similar-looking origins are not accepted. Android
billing routes do not open Paddle checkout or use iOS StoreKit.

`native/google-play-purchases.mjs` validates the configured catalogue and the
returned eligible offers. It accepts the configured monthly/yearly auto-renewing
plans and finite introductory phases followed by the expected regular renewal
phase; it rejects mismatched products, periods, offers and unsupported shapes.
Prices, currencies, trial duration and offer tokens are not invented by the UI.
A normal paid base plan remains eligible when the customer has no trial offer.
For each billing period the UI prefers the actual eligible trial/introductory
offer and otherwise shows the regular base plan. Losing eligibility requires a
fresh choice rather than silently converting a trial selection into a paid sale.
App-driven plan replacement, prepaid subscriptions and instalment plans are not
part of this release; Play management remains the route for an existing plan.

New-sale readiness and restore readiness are separate. A configured,
authenticated, account-ready Android user can restore an existing purchase even
when new purchases are switched off. Legacy responses with `available:true`
remain compatible. Invalid credentials/schema, an unavailable verification
service, a wrong account or an active deletion barrier still fail closed.
Disabling checkout must not disable production readers, RTDN or existing paid
access.

Only acknowledged, unexpired Google `active`, `canceled` and `grace_period`
records grant Premium. A cancelled auto-renewal can therefore retain access
until its verified expiry. Pending, on-hold, paused, pending-cancelled and expired
states do not grant Premium. A pending replacement cannot erase the original
paid period, and an unverified predecessor cannot create a new trusted lineage.
Acknowledgement happens only after durable ownership is stored; a temporary
acknowledgement failure is retried through verification/Restore without granting
an unacknowledged entitlement.

The native plugin reconnects to Billing, queries current ownership before a new
sheet and recovers owned purchases on foreground/reconnection. The client does
not retain a purchase callback and attach it to whichever BasketBoss account
signs in next. Generation/account/token guards reject stale asynchronous
results. The server enforces immutable token ownership, reconciliation leases,
replacement lineage and account-deletion tombstones. Raw purchase tokens pass from the native store to the authenticated verification
endpoint; persisted verification tokens and API credentials stay server-side.
They are not written as browser-storage entitlement state.

RTDN verifies Google's OIDC signature, issuer, audience, push service-account
identity, expiry, configured subscription and package. It fetches authoritative
subscription state. A notification body alone cannot grant access. Deduplication
is recorded after successful reconciliation so transient failures remain
retryable. A prepared opaque account binding allows a pending first purchase to
be attributed when payment completes with the app closed. Check real delivery
on a Play-installed device; fixture signatures and mocked API responses do not
prove that production Pub/Sub is connected.

Google Play account deletion is separate from store cancellation. The UI links
to Play management and allows deletion without making cancellation a
prerequisite. Cleanup removes/tombstones the account's Google linkage under the
existing deletion guards. It does not automatically refund or revoke Google
purchases. The existing Paddle cancellation and Apple management rules remain
provider-specific.

## Shared checkout coordination and safe rollout

Already-active entitlement checks alone leave a race: two devices could both
see Free before either store finishes a purchase. The optional D1 purchase-intent
coordinator adds an account/mode slot and immutable attempt history shared by
Apple, Google Play and Paddle. It never grants Premium.

Updated native clients request protocol 1, receive an account/session-bound
reservation, and must start it before opening a payment sheet. The coordinator
tracks `prepared`, `started`, `pending`, `unknown`, `completed` and `canceled`.
Only an unstarted prepared reservation can time out automatically. Started,
pending or uncertain payments remain held until a valid result or verified
provider evidence reconciles the original attempt. A generic network failure,
app restart, empty owned-purchase list, sign-out or Free status is not proof of
cancellation. Definite cancellation/non-launch reports can retry in memory for
the same server-validated session, including refreshed tokens. Reloading the app
does not reconstruct the capability. An unresolved attempt with no recoverable
store proof requires operator reconciliation against the provider; it is never
unlocked by a local reset or a timer. This limitation must be exercised during
signed-device acceptance before strict sales are enabled.

For coordinated Apple purchases, the server issues the reservation UUID as an
account token and retains its exact account/provider/environment/product mapping.
Apple's signed transaction can therefore identify a delayed Ask to Buy approval
without an in-memory callback or a date heuristic. Existing stable account
tokens and owned subscription lineages remain valid, including when new sales
or coordination are later disabled. A token rotation within an original lineage
must remain bound to the same immutable user and a newer verified transaction.
No Swift change is required: the existing bridge already passes the server UUID
to StoreKit. Its existing ownership guard remains intact; an unused coordinated
attempt blocked by that guard directs the user to Restore.

Verified proof updates the provider row and coordinator revision atomically.
An invalid or missing reservation cannot make a genuinely paid subscription
unverifiable. A delayed proof must not clear a newer unrelated attempt. Stable
Apple account tokens and Google obfuscated account IDs identify a user, not an
individual attempt; correlation must use verified store reference/intent data
or the authenticated original reservation. Client cancellation reports affect
coordination only and cannot cancel a store subscription or grant access.

The feature is default off. After the D1 migration, `BB_PURCHASE_INTENTS_ENABLED`
enables coordination; `BB_PURCHASE_INTENTS_STRICT` requires the new protocol for
new checkout. Live Google checkout additionally requires
`GOOGLE_PLAY_LIVE_CHECKOUT_ENABLED`, alongside the configured production provider
reader gate. Enabling only a production reader never authorises a new sale.

This protocol coordinates cooperating, current clients. External store actions
and legacy clients cannot be made atomic with every provider. In strict mode an
older iOS client may need an update before starting a new purchase. Release and
test the updated iOS client before activating strict live checkout. Strict checkout also checks known resumable Apple billing-retry and Paddle
past-due/paused subscriptions against their providers before permitting another
charge. Those states do not become Premium merely because they are resumable.
Existing
Apple/Google paid access, verification, Restore and Manage remain independent
of the optional handshake. Disabling new sales is a valid incident response;
disabling production verification would interrupt existing subscribers.

Both new schemas are **Cloudflare D1**, not Supabase SQL:

- `sql/basketboss_google_play_subscriptions_20261121.sql`
- `sql/basketboss_purchase_intents_20261121.sql`

They require the existing billing/deletion schema. Native packaging does not
apply them, and this work does not assert they have been applied. Server
credentials, product activation and production flag changes remain manual
release steps. No production product, price, credential or customer data should
be changed simply to make a mocked test pass.

## Required device and provider acceptance tests

Run with verified test accounts and Google's licence-test payment instruments.
An Internal testing installation alone does not ensure the card is a test card.
Use separate data for deletion tests and keep real household plans intact.

| Test | Expected evidence |
| --- | --- |
| Monthly and annual new purchase | Correct product/base plan, localized price, verified account binding, server acknowledgement, fresh Premium membership |
| Eligible free trial | Actual returned zero-price seven-day phase and correct renewal price; server-verified active subscription |
| Ineligible trial | No invented free-trial copy; ordinary returned base-plan price |
| Native user cancellation | No Premium grant; original coordination result handled without a second accidental sheet |
| Pending payment | Clear pending message, no Premium until completed and verified; original attempt retained |
| Pending completion with app closed | RTDN/current store proof reconciles original account; later foreground/Restore agrees |
| Network timeout or app termination | No guessed cancellation or blind second purchase; verification/Restore can recover valid paid proof |
| Verification/acknowledgement failure | No premature Premium grant; retry re-reads provider acknowledgement and recovers without rebinding ownership |
| Duplicate and delayed callbacks | Idempotent account binding and entitlements; no newer attempt cleared by old proof |
| Reinstall/another device | Restore queries current Play account, verifies server-side, refreshes Premium |
| Wrong BasketBoss account | Ownership rejected; subscription is not rebound to the second user |
| Account/token change during a request | Stale response cannot update the new account's membership |
| Sales disabled | Existing membership, RTDN, Restore and Manage remain usable when provider readiness is valid |
| Grace, hold, pause, cancelled renewal, expiry, refund | Membership follows current verified lifecycle, including expiry of access |
| Concurrent Apple/Google/Paddle checkout | One coordinated attempt wins; pending/unknown state cannot be cleared by elapsed time |
| Deletion/retry/late notification | Existing deletion barriers and cleanup prevent resurrecting account or purchase linkage |
| iOS regression | Both products, real eligible trial terms, verification-before-finish, restored access and native Manage still work |
| AAB installation | Correct signed package/version and unchanged install-time recipe images on a Play-delivered installation |

Repository tests exercise deterministic fixtures, mocked provider responses,
SQLite/D1 behaviour and client/UI races. A successful native compile or unsigned
CI AAB does not demonstrate real payment, current Console settings, a signed
release, notification delivery or App Store acceptance. Record those results
separately during the owner's signed-device release run.

## Change inventory and validation

[ANDROID_BILLING_CHANGED_FILES.txt](ANDROID_BILLING_CHANGED_FILES.txt) lists every
changed path relative to production source
`57cfa3a20126e34f9ace4a5ae9862187168d41c9`, including the existing Android draft
foundation and this parity completion. Swift/Xcode sources remain unchanged;
the Apple JavaScript controller has a backwards-compatible optional handshake.

The final local regression run passed 404 checks with zero failures or skips,
including the generated Android assets after a successful Android sync. Both iOS and Android
JavaScript entries bundled successfully. These results cover Apple UI/trial/
verification compatibility, Play pricing/lifecycle/restore, callback races,
coordination, and deletion barriers. The final source pin and native Gradle/AAB
results are recorded in the pull request.
Mocked provider and browser tests do not prove live prices, trial eligibility,
RTDN delivery, store-account binding or production payment success. Run the
signed-device matrix above through Play Internal testing and Apple Sandbox /
TestFlight before enabling live checkout.
