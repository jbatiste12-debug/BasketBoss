# Premium app finish and Auto-fill validation — 10 November 2026

The app now uses a shared forest-green, ivory and restrained gold finish across
Plan, Discover, At home, Shop, Cook, account dialogs and membership screens.
The phone header places the brand/settings above two equally sized region and
membership controls, keeping their full labels readable. The new styles load
after the existing component styles and are included in the PWA precache and
native package. Existing keyboard, dialog scrolling and navigation geometry
remain controlled by their original components.

## Auto-fill

Profiling the authenticated 700-recipe catalogue identified repeated validation
of all catalogue role metadata inside the candidate loop. The generated client
now validates that static metadata once, while continuing to check each recipe's
current dinner eligibility. Legacy recipe decisions retain their original
predicate. Breakfasts and desserts retain their existing exclusion rules.

Serving projections and canonical identities are reused only within a draw or
attempt. Pantry proposals include the complete current stock in their cache key,
so reserving a meal changes the next proposal. No quantity, allocation, purchase
estimate or membership grant is cached across button presses.

Local headless Chromium measurements used the complete catalogue, mocked
authenticated endpoints and the existing confirmation/commit flow:

| Goal | Original calculation | Updated calculation | Updated tap to confirmation |
| --- | ---: | ---: | ---: |
| No goal | 5,063 ms | 1,064 ms | 1,187 ms |
| Waste less food | 5,115 ms | 1,188 ms | 1,310 ms |
| Spend less on groceries | 6,289 ms | 1,415 ms | 1,540 ms |

Each updated scenario also confirmed seven distinct committed dinner selections,
with no API request after the Auto-fill tap and no JavaScript page errors. These
are local single-scenario measurements, not iPhone or production latency promises.

## Checks completed

- Complete Node test run: **3,364 passed, zero failed**, 1 platform skip and
  2 existing TODO cases, out of 3,367 tests; approximately 140 seconds.
- The skip is the actual Swift endpoint-detector fixture: Swift is unavailable
  on this Linux host. The existing macOS workflow runs that fixture.
- The existing TODO cases concern Paddle refund/chargeback policy and sandbox
  lifecycle integration acceptance; this change does not implement those tasks.
- Four new compiled-policy tests cover all authored roles, legacy IDs, malformed
  metadata, live recipe edits and the absence of repeated metadata scans.
- Integrated real-PWA interactions: **28/28 passed** at 320×760, 390×844,
  844×390 and 1280×900. Covered tabs/header, keyboard navigation visibility,
  Settings/region controls, breakfast/dessert search and close behavior, pantry
  editor controls and Cook Prep → Next → Exit. Saved plans and stock unchanged
  when those interactions were cancelled or closed.
- Twelve supplementary checks passed across the same four viewports: signed-in
  account panels, signed-out account forms and the actual generated native
  membership page. Membership checks used simulated platform and purchase-state
  callbacks, verifying readable prices, plan layout and disabled/loading states;
  they did not contact Apple or perform a purchase. **40/40 integrated scenarios
  passed** with no JavaScript page errors.
- Additional real-page surface checks: 15 views across five tabs and three widths,
  with no horizontal overflow or JavaScript page errors. Dialog layout checks:
  18/18 passed across narrow and short viewports.
- Portable native build passed. Explicit catalogue-700 package verification:
  1,149 files, 200 public Free recipes, 500 authenticated Premium recipes and
  **no private recipe bundle**.
- Repeated PWA generation produced identical hashes for all 34 generated files.
  `app.html` and `index.html` match; `git diff --check` passes.
- Recipe source datasets, IDs, positional ingredient arrays and image assets
  were not edited.

The complete regression command requires the project's configured Playwright,
Chromium and PGlite module paths:

```sh
npm ci --no-audit --no-fund
npm run build:native
node --test --test-concurrency=1 tests/*.test.mjs
node tools/catalogue700/build-pwa.mjs
node tools/catalogue700/build-client.mjs \
  --source-root "$PWD" \
  --public-release "$PWD/catalogues/700/release" \
  --output-dir /tmp/basketboss-700-validation
git diff --check
```

## Owner sharing and release status

The separate [owner household opt-in](OWNER_HOUSEHOLD_OPT_IN.md) allows the
configured, verified owner account to share complimentary access when explicitly
enabled on the server. Its default remains OFF; it does not fabricate a purchase
or alter Apple's purchase environment. Existing production, identity, session,
accepted-partner and account-deletion checks remain required.

This validation does not deploy the app, activate the owner-sharing flag, change
live account records, sign an iOS archive or upload an App Store build. Installed
native clients need a subsequent build containing these changes.
