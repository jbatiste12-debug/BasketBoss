# BasketBoss Household Sharing locked release candidate

> Historical staging record. The later release commit [97f663d](https://github.com/jbatiste12-debug/BasketBoss/commit/97f663d) (30 October 2026) armed the code-level Household Sharing and partner Premium release brakes. The disabled-brake statements below describe the earlier staged release, not the current source. Runtime feature flags, verified sessions and server-side paid entitlement checks still control access. This note does not verify or change deployed configuration or database permissions.

Built from production main commit 345700f77706b108ca47d9c6b0685f0abc72a601. Includes the conflict-safe QA browser client and per-day servings, but NOT QA credentials, QA billing bypass or QA backend.

- Both backend release brakes remain false. Household Sharing is NOT live.
- User reported applying revised production SQL manually. This branch does not run SQL or independently verify RLS/RPC privileges. The older SQL source on main may differ from the manually applied migration.
- No customer meal plans, Supabase Auth settings, Paddle, D1, Cloudflare settings, or private backups are changed by this branch.
- Before separate activation approval, verify service-only Supabase privileges, authoritative live D1/Paddle owner entitlement, rejected Free/canceled owners, accepted partner email, paid route device sessions, AI/recipe partner benefits, offline conflicts and PWA cache.
- Rollback disables server activation flags, never deletes household records or local saved meals.
