# BasketBoss — consolidated Premium Preview audit, 27 October 2026

**Base commit:** `3e324c2e986875b4a9162248c42ba6688429cfbc`, branch `billing-premium-secure-20261026-2`.
**Scope:** Guarded Preview hardening **only**. This is not production release approval.
**Keep disabled:** production deployment, live checkout, live webhooks, real-money billing. **Do not change:** working 321 Owner recipes, verified entitlement logic, Premium Smart Auto-Fill, Gemini AI route, D1 recipe imports.

## Direct fixes prepared as one batch

1. **PWA / Cloudflare Access containment:** a network-only `manifest.webmanifest` request can still redirect to Access login until that Cloudflare policy/session is addressed, but it can no longer abort service-worker installation through `cache.addAll`. The current cache is versioned to discard the old shell; the manifest, all `/api/` routes and `recipes.json` are not served from a stale app cache.
2. **Truthful Premium Preview copy:** corrects an outdated claim that 321 recipes are a static public bundle (current public catalogue is 100, 221 are protected). Qualifies AI as early access, not guaranteed during Preview; corrects a contradictory statement about Free Leftover Magic and clarifies no Standard free trial is currently offered. Pricing/price values, terms of Founder offer, Paddle endpoints and feature gates are unchanged.
3. **New negative-path tests:** PWA Access simulation and Paddle raw-body signature/timestamp/auth guard tests. All tests use isolated fake domains/keys and **do not call Gemini, Paddle, Supabase or D1**.

## Observations, not claims of live proof

| Area | Evidence today | Decision |
| --- | --- | --- |
| Owner full 321 / Smart Auto-Fill | Previously user-confirmed working, unchanged by this release | Preserve |
| Public recipe boundary | Source inspection: 100 public JSON entries, 100 in main inline catalogue, 100 free-ID allowlist, 100 normalized records; 221 additional recipes are server-loaded | Static review pass, runtime adversarial check open |
| Premium recipe API | Authenticated backend path and private D1 query reviewed | Runtime user isolation not proven |
| Paddle disabled billing and webhook HMAC | Source gate inspected; negative-path HMAC cases tested locally | Locally supported only, sandbox lifecycle open |
| AI | Previously worked per Owner, presently Preview unavailable | Owner defers full AI test until controlled pre-launch smoke test. **Never promise AI to paying customers without proof** |
| PWA | Screenshot confirmed redirect of manifest to Access domain and aborted service-worker fetch | Source fix prepared, Access configuration and actual browser PWA retest open |
| Cloud backup | Publishable Supabase client config is present, `basketboss_data` table/RLS not verified | Block customer-sync claim until RLS acceptance |
| Pantry Price Forecast | No distinct source/UI control of that exact name confirmed; Trim My Basket code exists | Do not guess or rewrite Smart Auto-Fill |
| Older deployments and caches | `main` removed a legacy backup; older deployed URLs/history not globally revoked | Inventory/archive review remains |
| Production & real billing | Unchanged; this release does not activate these | Remain OFF |

## Explicit paid-launch blockers

- Confirm real Cloudflare Preview deployment maps to audited commit and test PWA install while Access-protected; ensure no manifest CORS errors on the intended install experience. **Do not disable Cloudflare Access just to hide an error.**
- Run unauthenticated, Free, Owner, active sandbox subscriber and canceled subscriber tests against actual API/D1, including historical public build/caches and client-side Premium-view bypass attempts.
- Confirm explicit refund/chargeback handling: the current handler recognises only subscription events and ignores Paddle `adjustment.created` / `adjustment.updated` events. Define entitlement policy and reconciliation, then test it before launch.
- Sandbox subscription lifecycle end to end: protected checkout, signed webhook creation, concurrent Founder allocation, replay/out-of-order events, trial conversion, failed/past-due payment, cancel and renewal, refund process, multi-device entitlement.
- Confirm isolated D1 billing binding and Supabase `basketboss_data` table with enabled, user-isolating row-level security, or stop advertising cross-device sync.
- Identify exact Pantry Price Forecast acceptance requirement; don't treat Trim My Basket as a verified replacement without approval.
- Review current Paddle live prices, 7-day Founder trial and first-25 seats, seller/domain approval, tax/refund/legal disclosure. Live checkout and webhook flags **remain false** until separately approved.
- Perform Owner AI scan and generate with real Turnstile, quota table and Gemini on a controlled pre-live smoke test. Keep it unavailable to customers until accepted. Earlier code working is **not** production evidence.

## Test evidence and limitations

- `node --check` passes on patched service worker and added JS tests.
- New local tests: **11/11 passed** (3 PWA, 6 billing HMAC/same-origin/disabled-billing and 2 Preview marketing-consistency tests) against the service-worker candidate and verified exact Git blob of `bb-server-lib/bb-billing.js`.
- The full existing repository-wide test suite requires a repository checkout; no CI workflow was present for the audited SHA. Real Cloudflare/Pages/Access/D1/Paddle tests **not run**.
- The connected GitHub integration returned HTTP 403 when creating a new review branch; NO remote write was made. This package produces a local review branch only, without pushing.
- No old handover patches rerun; no imports, secrets, production files or live billing env values changed.

**Release conclusion:** A **guarded Preview-only pull request** is suitable for review; paid launch is **blocked** pending the above integration evidence. Do not merge to production.
