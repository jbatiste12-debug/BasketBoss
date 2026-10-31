# BasketBoss — production Household Sharing backend staging gate (29 October 2026)

> Historical staging record. The later release commit [97f663d](https://github.com/jbatiste12-debug/BasketBoss/commit/97f663d) (30 October 2026) armed the code-level Household Sharing and partner Premium release brakes. The disabled-brake statements below describe the earlier staged release, not the current source. Runtime feature flags, verified sessions and server-side paid entitlement checks still control access. This note does not verify or change deployed configuration or database permissions.

This release **only stages server-side code on `main` behind disabled-by-default feature flags**.
It is additionally protected by two hardcoded `RELEASE_ARMED=false` brakes, so even
pre-existing Cloudflare variables cannot activate it. A separately reviewed
future code change would be necessary. It does **not** activate Household Sharing; does not modify Cloudflare variables,
Paddle, the production Supabase database, customer accounts, existing meal plans,
`basketboss_data`, Premium serving logic, or the web app UI.

## Scope

- Replace the existing static `/api/household` production placeholder with a
  closed-by-default production API. A live founder/standard subscription is
  validated against the authoritative D1 entitlement row and the configured
  **live** Paddle price IDs. A matching verified Supabase email is required.
- Add a server-only latest-session check (`bb-premium-seat.js`) using the
  Supabase-verified user plus the JWT `session_id` corroborated by a SQL RPC on
  `auth.sessions`. A stale device's Premium request is denied; its local Free
  plan remains untouched. **This is API-level access protection, not forced
  Supabase logout or a guarantee against screenshots/credential theft.**
- Add an opt-in Cloudflare `/api/_middleware.js` guard to paid recipes, AI
  generate/scan, subscription status/portal, and Household Sharing. Public
  pages, checkout, and Paddle webhooks are unaffected.
- Include an **unapplied** production-only SQL migration for new, separate
  `bb_households`, `bb_household_invites` and `bb_household_entries` tables,
  and a service-role-only session validation RPC. Browser roles receive no
  table access, and client code never sees secret credentials.
- Update tests to recognise the new backend gate while keeping the onboarding
  UI and account prompt honest about being unavailable.

## Absolutely do not activate in this release

The code-level `RELEASE_ARMED=false` safety brakes must remain unchanged in this
commit. `BB_PARTNER_SHARING_ENABLED`, `BB_PARTNER_PRODUCTION_READY`, and
`BB_PREMIUM_SINGLE_SESSION_ENABLED` must remain absent or `false` in the
**production** Cloudflare Pages environment. Never copy these settings from
`basketboss-partner-qa` and never copy a QA Supabase key.

The optional session guard, once turned on, affects existing paid subscribers.
**Turning it on before the production SQL RPC exists will fail closed (503),
blocking paid API requests.** Do not do that until the migration and rollout
verification are complete.

## Required next independent approval and release stages

1. **Backup / schema preflight:** Confirm the live project is specifically
   `basketboss-auth` (`kbhyosxuvlcazyzzinqv`). Confirm none of the three
   `bb_household*` tables already exists or inspect differences. Review the
   migration and make a backup. The migration itself is not run by any installer.
2. **SQL review and execution:** Apply only the reviewed SQL file in the **live
   project**. Verify 3 tables, 4 service management RPCs, 1 session RPC,
   RLS enabled, `anon`/`authenticated` have no table grants, and the RPCs
   cannot be executed by browser clients. Test a real session ID with service
   credentials privately (do not paste tokens or secrets into chat).
3. **Cloudflare secrets / live D1 audit:** Verify existing `BILLING_DB`,
   `BB_BILLING_MODE=live`, `BB_BILLING_ENABLED=true`, webhook settings, live
   price IDs, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Add a Supabase
   **live** `SUPABASE_SECRET_KEY` as an encrypted Cloudflare Secret if absent;
   never use a test key. Check a trialing, active, canceled and Free account.
4. **Premium session rollout:** Test old-device denial and most-recent-device
   access on a QA-like isolated environment with the same middleware. Paid
   recipe, AI, subscription and portal behavior must be verified. Only then
   consider `BB_PREMIUM_SINGLE_SESSION_ENABLED=true` in a staged release.
5. **Client and partner entitlements:** The live `main` site still has the
   *onboarding discovery UI only*, not the conflict-safe household syncing
   client. Additionally, the live Premium recipe and AI APIs must explicitly
   decide whether an invited partner shares recipe/AI entitlements. Currently
   they check the individual's own D1 subscription, so a linked partner
   **does not automatically inherit the paid catalogue or AI access**.
   Implement/test this product behavior before promoting the client.
6. **Full two-phone tests:** Confirm one Premium owner + one partner, no
   password-sharing loophole, correct saved meals/servings/pantry/ticks,
   collision review, unlink, invitation expiry, account replacement,
   canceled-subscription lockout and recovery. Do not migrate or overwrite
   legacy `basketboss_data` or locally saved plans.
7. **Activation only after all gates pass:** Explicitly turn on the production
   sharing flags in a separately approved deployment. Keep a rollback switch
   and preserve household data during rollback.

## PostgreSQL read-only preflight (run in correct production SQL Editor)

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
AND table_name IN ('bb_households','bb_household_invites','bb_household_entries')
ORDER BY table_name;
```

Expect **no rows** before first migration. If any rows appear, stop and review.

## Rollback

For the staged code, revert the one GitHub commit to restore the static stub;
leave Cloudflare flags disabled. No database migration is part of this commit.
When actual sharing is live, turn the sharing and session gates off first;
never delete household tables or local plans as a rollback.
