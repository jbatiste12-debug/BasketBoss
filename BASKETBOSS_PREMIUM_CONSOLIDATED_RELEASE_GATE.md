# BasketBoss Preview consolidation — release report

This is **not approval for live billing**. The one-run operation addresses only
public recipe delivery and shared presentation entitlements, while retaining
the billing/pricing changes already committed on the Preview branch.

## Changes prepared

- Confirm that the published `recipes.json` already has the 100 Free recipes,
  or split it if a 321-item version is encountered (with a strict ID check).
  The 221 private recipe records must already exist in the **private Cloudflare
  D1 database**; this patch never uploads or modifies the database.
- Make a Meal can load the 221 through `/api/recipes/premium` with a valid
  Supabase bearer token and only after server-side entitlement verification.
- A QA switch or browser localStorage cannot grant additional recipes.
- New service-worker cache version; remove legacy full recipe catalogue from
  pre-cache. Older installed versions, old preview URLs and historic public
  repository versions may still expose previously distributed content.
- Presentation-only shared verified Premium state for supported UI components.
  This is not authorization for money, recipes, AI or customer data.
- Billing safeguards remain distinct for sandbox and live Paddle credentials.

## Required manual acceptance (not automatically passed)

- [ ] Live/sandbox customer D1 bindings confirmed distinct, no accidental mixing.
- [ ] Old public deployments and caches containing private recipes restricted/
      removed where possible; confirm historical exposure and remediation.
- [ ] Free account opens 100 recipes; direct API returns 401/403; static URL
      returns only 100; no unauthorised content in other public files.
- [ ] Owner sees and opens all 321 recipes through secured API.
- [ ] Paid sandbox customer purchases & automatically unlocks *all advertised*
      benefits on multiple devices.
- [ ] Smart Auto-Fill, Pantry Forecast and Shop Mode use server-verified
      entitlement; client checks must not be the sole security enforcement.
- [ ] AI scan/generation service genuinely works under enforced quota, or is
      explicitly excluded from the paid offer until working.
- [ ] Webhook lifecycle: renewal, trial, cancellation, refunds, failed payment,
      replay/reordering, retries and signature verification.
- [ ] Cloud backup `basketboss_data` is created and protected by correct RLS,
      or optional sync is disabled/accurately disclosed.
- [ ] Paddle product prices and advertised terms match in both environments.
- [ ] Everything accepted before enabling real billing or merging to main.

Always keep live checkout and webhooks disabled until acceptance tests pass.
