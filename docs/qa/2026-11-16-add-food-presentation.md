# Add food: optional amount details

Scope: presentation only, based on `198dfc327095bff5ca95bc14ce8a7f2592cf5494`.

The Add food sheet leads with the existing autocomplete, Got it / Running low /
Out controls and Done. A native **Add amount** disclosure starts collapsed and
contains the original pack-size, Full pack / Half pack, extra-pack and Edit amount
controls. “Same-size full spares” is displayed as **Extra unopened packs**. Controls
are moved, not cloned; their existing input and save listeners stay attached.
Estimated-stock and check-label guidance stays visible outside the disclosure.

Out shows **None at home** and hides amount details only when the original amount
really is zero. Out with unopened spares retains the original positive balance.
Existing validation can reveal and focus an amount field. Unknown quantities still
require the same confirmation; collapsing a disclosure never supplies stock.
Existing Edit item dialogs keep their current layout.

## Files

- Presentation: `bb-pantry-add-amount-presentation.js` (new DOM disclosure/focus
  adapter), scoped additions to `bb-pantry-inline.css`.
- Loading only: `app.html`, `index.html`.
- Packaging/cache: `scripts/build-native-web.mjs`, `service-worker.js`, generated
  `pwa700/app.html`, `pwa700/manifest.json`, `pwa700/precache.js`.
- Deployment proof: `scripts/verify-web700-deployment.mjs` also checks the new
  public presentation asset. Tests cover stale delivery and the revised cache key.
- Browser regression helpers: pantry tabs and planned-unit suites open optional
  details before entering an amount; their calculation assertions are unchanged.
- Release handoff is a separate commit: Build 51 launcher, README, release notes,
  phone checklist and launcher tests. Version 1.0.4; catalogue protocol unchanged.

No changes to `bb-pantry-inline.js`, `bb-pantry-stock-levels-ui.js`,
`bb-pantry-stock-levels.js`, `bb-pantry-pack-sync.js`, `shopping-inventory.js`,
`bb-home.js`, `bb-pantry-policy.js`, `bb-pantry-deduction.js` or
`bb-receipt-inventory-core.mjs`. Their bytes and all embedded script bodies in
app/index are checked against the baseline. No billing, entitlement, auth,
analytics event, database or household data changes.

## Phone checklist

1. At home → Add food: food suggestions still work; Add amount starts collapsed.
2. Choose a known item. Got it retains existing stock. Running low shows an
   estimate and asks for the existing pack confirmation when needed.
3. Open Add amount: one Full pack / Half pack row, Extra unopened packs, Edit
   amount and existing advanced controls remain accessible.
4. For a confirmed 1 kg pack, Half pack + two unopened packs totals 2,500 g.
5. Out without spares shows None at home; Out with one full spare retains 1 kg.
6. Enter an exact amount of 250 g when the plan needs 500 g: the remaining gap is
   250 g before purchase-pack rounding. Exact decimal amounts remain editable.
7. Invalid/unknown quantities reveal their original error and field. Close/back
   without Done must preserve the saved pantry. Done must save once.
8. Reopen a saved item, switch tabs, restart offline, and check household stock
   from another device as part of the physical-device release check.

Mobile captures are actual generated-app Chromium views, 390 × 844, in
`/workspace/shared/BasketBoss-Add-Food-20261116/`. The before capture uses the
saved pre-change generated HTML, never the moving Git HEAD. Browser API calls are
intercepted; no production account or saved data is used. Xcode signing, Face ID,
App Store upload and two physical household devices require manual verification.

## Validation

- 244 unit, integration, cache, security and deployment-contract checks passed.
- 7 new real-app Add food cases passed, plus all 31 existing pantry tabs,
  planned-unit and stock-level browser regressions. Both 320px and 390px tested.
- 24 Build 49–51 launcher/archive checks passed; final source pin is verified
  again in the release handoff commit.
- Native 700 bundle built and verified: 1,178 files, Free 200, Premium 500,
  no private recipe bundle. New presenter and CSS match the web source.
- Syntax and Git whitespace checks passed. Nine protected logic files and all
  app/index inline script bodies are byte-identical to the baseline.

Two free pantry scans are not implemented in this source. Existing Premium /
active-trial scan gating is preserved. Apple onboarding remains native iOS only.
