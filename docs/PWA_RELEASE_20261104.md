# BasketBoss PWA release — 4 November 2026

The PWA release brings the latest kitchen workflow and conversational Cook Mentor
from `testflight-build9-fast-mentor` onto production main, preserving the existing
Apple verification, paid access, account deletion and private-catalogue repairs.
The public landing page stays separate from the planner at `/app`.

## Public landing

Forest green, cream and gold branding; clearer mobile/desktop hierarchy; six
feature groups; Plan → At home → Shop → Cook guidance; Premium photo-to-meal and
mentor examples; Free/Premium comparison; current stock-cycle and installation
FAQs. Examples are illustrative and cannot change an account. SmartReceipt
marketing retains its deployment-readiness gate. Pricing links use the existing
Paddle checkout and make no new price or unlimited-AI promises.

## PWA and Premium

The planner includes the compact Plan/budget layout, live pantry quantities,
editable pantry groups, UK/US conversion, saved weeks, pantry-aware Auto-fill,
manual top-ups, simplified shopping purchases and cupboard-staple reminders.
Cook Mentor receives progressive text and ordered sentence audio with one next
clip prefetched. Browser speech endpointing remains platform-controlled.

Free access keeps its 100 public recipes and normal upgrade screens. AI tools
and the private catalogue still verify Premium on the backend. The TestFlight
unlock button is native-only and still requires signed Apple proof. Existing
verified memberships, including previously granted Beta accounts, keep their
account access. No membership or billing configuration was changed for this release.

Service worker cache `v50-pwa-release1` contains the current public app assets.
New pantry, Shop, navigation and voice modules refresh online and keep an offline
fallback. `/app` restores the app shell offline while `/` restores welcome.
API, authenticated, private and server/build requests bypass caching. Worker and
HTML entrypoints require HTTP revalidation. Manifest identity and personal local
stock, plans and sessions remain unchanged.

## Stock database rollout

Production was checked against the base receipt functions before applying the
reviewed upgrades. Both migrations update functions and grants without rewriting
inventory, receipt history, billing tables or RLS policies. Source filenames now
match production migration history:

1. `20261104174441_receipt_auto_stock_policy.sql`
2. `20261104174450_pantry_fractional_stock_balances.sql`

Apply in that order. Never reapply the first alone after the fractional upgrade.
Post-apply checks confirm exact reviewed function fingerprints, `autoStockReady`,
fractional stock balances, strict receipt count validation, measured purchases,
RLS enabled and service-role-only execution. No customer rows were used for tests.
Enabled service flags, Premium verification and receipt review remain required.

## Verification

- Full suite: 2,026 passed, zero failures, one Swift fixture skipped on Linux,
  two existing TODO cases.
- Strict pantry TypeScript contracts passed. All 100 recipes / 730 ingredient
  lines audited in UK and US: zero duplicate rows or conversion failures.
- Browser production-host fixtures: ordinary paywall, native-only Beta button
  absent, Free AI scan gated before camera/upload, no browser script errors.
- Real Chromium PWA installation with production-style redirects: `/app` opens
  the planner offline, `/` opens welcome; no authenticated responses cached.
- Landing at 320 / 390 / 1440 px: no overflow, broken images or script errors.
  Pantry, sample-plan, servings, shopping-pack and Cook demos passed.
- Native packaging and portable iOS checks: 914 assets, 100 Free recipes,
  no private Premium recipe bundle. No signed Apple upload performed here.

The production advisory check is unchanged: service-only inventory tables have
RLS enabled without client policies by design. Existing password-protection
settings are outside this release; Supabase documents them at
[password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
The RLS advisory reference is
[database linter](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
