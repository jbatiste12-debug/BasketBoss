# Business lifecycle audit — Build 17

Scope: Plan → At home → Shop → Cook, receipt reconciliation, weekly spending, rollover and account continuity. No visual redesign, CSS changes, database migration or Premium bypass is included.

## Findings and regression coverage

| Area | Corrected behaviour | Regression evidence |
| --- | --- | --- |
| Quantity and identity | Compatible metric and piece units reconcile; whole peppers cannot become spice containers. Ambiguous legacy stock remains intact for review. Confirmed staple stock stops duplicate cupboard demand. | Whole-pepper, pantry-policy, staple app-flow and host-contract tests; 100-recipe UK/US audit. |
| Partial shopping | Household ticks and partials do not pre-credit stock. Finish transfers once, preserves unticked demand and keeps fresh purchases separate from frozen reserves. | Manual-purchase app tests and actual-app 375px flow. |
| Receipts after Finish | Verified archived trip context, shared food/household credit, duplicate-line grouping and receipt replay checks prevent double stock. | Adapter/core tests, transactional app tests and actual-app linked-receipt flow. |
| Ordinary spending | Finished purchases retain their costs; covered receipt payments replace estimates. Zero-price purchases and compatible kg/g or l/ml quotes remain valid. | Spending-ledger, finite-price and production app-budget tests. |
| Reduced spending | Discounted payments stay separate from ordinary baselines. Missing receipt annotations can use verified trip evidence; excess ordinary stock does not become urgent. | Reduced-purchase tests, adapter inference cases and actual-app receipt flow. |
| Uncertain receipts | Known payments with uncertain quantities stay recorded without invented food amounts; overlapping ambiguous costs retain review state. Undated receipts are not silently assigned to the current week. | Expense-only and coverage tests. |
| Cooking | Urgent unfrozen stock is consumed first; depleted urgency clears. Balances floor at zero. Repeated meal/Day done confirmations and leftover meals do not deduct twice. | Allocation, Cook conversion and Day done tests; actual-app dinner/lunch/dessert flow. |
| Rollover | Stock and baselines survive plan clearing and new weeks. US local calendar and UK/Channel Islands London weeks agree across cost and completion ledgers. | Timestamp and timezone rollover regressions, including legacy UTC identifiers. |
| Accounts and backup | First guest claim retains data; later accounts are isolated. Complete kitchen backups load before empty-device writes. Conflicts preserve local quantities; restore uses compare-and-set with safe rollback. | Host, cloud-controller, deletion and actual-app first-claim/account-switch/fresh-device tests. |

## Verification record

The final full Node suite reports **2,433 cases: 2,430 passed, zero failed, one platform skip and two existing TODOs**. Strict TypeScript contracts, native web packaging and portable iOS checks also pass. Machine-readable results are recorded in [business-lifecycle-audit.json](business-lifecycle-audit.json).

The actual application browser audit passes 14 groups at 375×812 with zero failures or browser errors. Its test-only bridge exposes production closure functions in the served test page; it does not replace stock or budget calculations with a separate implementation. Auth, cloud and receipt HTTP responses are mocked. PostgreSQL checks run in isolated PGlite. No production account data is edited and no auth emails, paid provider calls, subscriptions or public sightings are created.

The ingredient audit covers 100 recipes, 730 ingredient lines and both UK and US modes: zero duplicate rows, non-canonical rows or conversion failures. Twelve existing recipe amounts still require review and remain preserved rather than silently guessed.

One native Swift test requires macOS and is skipped on Linux. Two existing Paddle TODO cases remain labelled TODO. Linux packaging and browser emulation do not prove Apple signing, real StoreKit purchases, the iOS software keyboard or TestFlight distribution. Native CI results are tracked separately; the final signed upload still runs from Xcode on the owner's Mac.

## Reproduce

```sh
BB_PGLITE_MODULE=/path/to/isolated/node_modules/@electric-sql/pglite \
BB_RECEIPT_PGLITE_PATH=/path/to/isolated/node_modules/@electric-sql/pglite/dist/index.js \
  node --test --test-isolation=none tests/*.test.mjs
BB_PANTRY_TYPESCRIPT_PATH=/path/to/isolated/typescript/lib/tsc.js \
  node scripts/check-pantry-types.mjs
npm run audit:pantry
npm run build:native
npm run ios:verify
git diff --check
```

The TypeScript contract checker expects 5.9.3. Run the full suite with the isolated PostgreSQL module present so database assertions execute rather than skip.
