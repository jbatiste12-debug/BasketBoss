# Pantry pack levels — branch review, 16 November 2026

Branch: `codex/pantry-stock-levels-20261116`. Base: `9a17ae08f3c22dccb910c2eb9e16204285c1abb3`.
No merge, deployment, production data mutation, schema migration, provider or policy change.

## Behaviour and placement

- The existing item editor starts with 44px **Got it / Running low / Out** buttons. Known quantities retain exact amounts under **Edit amount**; unknown quantities keep that disclosure open.
- Got it preserves an existing balance. Explicit Full/Half choices and Running low use a confirmed physical capacity. Buying multiples do not establish physical capacity.
- Running low is an **estimated quarter** of one opened pack. Total stock is `capacity × (opened portion + full spare packs)`. A 1kg spare plus a quarter-open 1kg pack supplies 1,250g. Out empties the opened pack and retains the 1,000g spare.
- Suggested sizes require a confirming tap and remain estimated. Unknown/incompatible amounts never acquire assumed meal credit. Spices/oils retain their qualitative controls.
- Inputs use the existing guarded editor and atomic local save. Recipe subtraction, purchase rounding, cooking deduction and receipt/checkbox deduplication retain their existing owners.
- Cooking never reapplies a saved fraction. Changed balances flag old estimates for review. Editing an estimated capacity requires a new level choice or explicit amount edit before saving.
- Shop shows a compact **item · Check amount / Check stock** row when relevant stock needs review. It opens the same editor and leaves the calculated gap unchanged. At 320px/390px the rice notice is under 64px high and its button retains a 44px target.

## Household and offline handling

Stock already syncs for eligible household partners. Capacities now use a separate metadata-only namespace on the existing authenticated household CAS endpoint. No second quantity ledger exists. Independent capacity survives exact amount edits; obsolete levels can be cleared without forgetting the pack size.

The durable outbox pins actor/session/household and joins the existing atomic local save. Conflicts preserve local and remote inputs for review; the adapter never overwrites partner stock or silently combines different capacities. Legacy whole-kitchen responses exclude reserved metadata. Foreground/reconnection refreshes preserve open drafts. Server stock and metadata use separate CAS operations; metadata never becomes quantity authority during partial/offline sync.

## Files

| Files | Type |
|---|---|
| `bb-pantry-stock-levels.js` | New pure input mapping/validation logic |
| `bb-pantry-pack-sync.js` | New metadata sync/outbox logic |
| `bb-pantry-stock-levels-ui.js` | UI/input drafts and read-only shopping review prompt |
| `bb-pantry-inline.js`, `shopping-inventory.js` | Existing input/save integration and stale-editor guards |
| `bb-pantry-inline.css` | Presentation only |
| `functions/api/household/index.js` | Scoped metadata transport; existing auth/entitlement gates retained |
| `app.html`, `index.html`, native build script, service worker, generated `pwa700` files | Loading/packaging/cache versions |
| Four new stock-level/sync/browser test files | Verification |
| Existing pantry quantity/tabs/exhausted/planned-unit browser tests | Use real Edit amount disclosure and visible empty-state entry; retain original assertions |
| Existing beta-domain, signup-funnel, Premium-security and PWA cache/browser tests | Cache identity expectations only |
| This file | Review notes and phone checklist |

Protected files `bb-home.js`, `bb-pantry-policy.js`, `bb-pantry-deduction.js`, `bb-receipt-inventory-core.mjs` and both embedded `bbHomeConversionContext` functions match the base byte-for-byte. Billing, entitlement/auth modules and analytics event names remain unchanged. App/index entrypoints remain identical.

## Verification

- **221 unit/integration/native-wrapper checks passed**, no skips: 500g needed/250g stocked, Half, unknown capacity/unit mismatch, multiple packs, leftovers, duplicate taps, receipt plus checkbox credit, offline restart, household conflicts, metadata rollback, independent capacities, legacy-client isolation, security gates and cache protection.
- Mandatory Chromium: **17** planned-unit/exhausted, **10** pantry tab/editor, **6** exact-quantity, **7** new controls/compact-notice checks passed. No browser skips. They use the real generated app, intercepted requests and disposable fixture storage.
- Web700 and native700 builds verified: 200 public Free recipes, 500 authenticated Premium recipes, no private recipe bundle. New modules and pantry UI/CSS match across bundles. Stock integration differs only by the existing absolute-web/relative-native receipt-core import URL.
- Cache checks passed again after generation; `git diff --check` passed.
- Screenshots: `/workspace/shared/BasketBoss-Stock-Levels-20261116/` contains before/after editor, pantry, Out with spare and compact Shop notice. These show local fixtures, not customer data.

## Phone checklist before release

1. Confirm a 1kg rice pack, choose Running low with no spares: 250g estimated. A 500g recipe must leave 250g to buy.
2. Add a full spare: 1,250g total. Out retains 1,000g; with no spare it becomes zero and follows existing empty-stock visibility rules.
3. Try Half, Edit amount, dismiss/reopen and duplicate taps. No invented refill, duplicate pack or unintended save.
4. Cook a meal; confirm the exact remainder survives reopening without reapplying its old level.
5. Try unknown capacity, incompatible units, changed estimated capacity and a spice/oil. Preserve review/qualitative paths.
6. Save offline, reopen, reconnect; then change the same stock/capacity on two household devices. Review conflicts without overwriting either device.
7. Use the compact Check stock row; its editor must keep the gap unchanged until a deliberate save.

Real iPhone/Xcode and two-device production household tests remain manual. No real accounts or household records were changed. This branch is not live and is not included in Build 48.
