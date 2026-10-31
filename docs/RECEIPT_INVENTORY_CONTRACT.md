# Receipt inventory implementation checkpoint

This is the agreed integration contract, not an assertion that the workflow is deployed or complete. Shared core and browser adapter are implemented; backend, SQL migration, scanner UI and host integration are owned by root after the other workers reached their usage limit. Do not stage these files with the recipe release until the receipt implementation has its own review.

## Files and boundaries

- `bb-receipt-inventory-core.mjs`: pure ESM, shared by browser and Cloudflare backend. No DOM, window, filesystem, network or global catalogue writes.
- `bb-receipt-inventory.js`: normal-script browser adapter, exposes `window.BBReceiptInventory` and injectable `BBReceiptInventoryFactory` for tests. It imports the core lazily. `normalizeDraft` and `canonicalOptions` are **async**; the UI must await them.
- `tests/basketboss-receipt-inventory-core.test.mjs`: core and adapter verification, including legacy surplus, idempotent projection and local rollback.
- Backend worker did not save API/SQL files before quota failure; the existing `bb-price-scan.js` remains the old price-only UI. Root must implement these pieces.

For HTTP confirmation validation import `validateReceiptConfirmation(body,{catalog,canonicalize})`. It enforces the public action/field allowlists, bounds, classification, canonical/unit mapping, legacy IDs and adjustment signs, and returns the sanitized confirmation body. Do not pass HTTP rows directly to the UI-only `prepareReceiptConfirmation`: HTTP rows intentionally have no `reviewed` property. `normalizeStockMap` validates full absolute pantry snapshots. Authentication, Premium, legitimate scope, request byte limits, atomic SQL, idempotency claims and revision conflicts remain backend responsibilities.

## Authenticated API

Endpoint: `GET /api/receipt-inventory` and `POST /api/receipt-inventory`. Bearer session authentication, same-origin/no-store. Server verifies Premium and derives the actual user or legitimate linked household scope; client actor IDs never authorize anything.

Recovery probe: `GET /api/receipt-inventory?receiptId=<pending-receipt-id>` returns the current full inventory plus the matching `receiptId`, `receiptFound:true` and original `receiptRevision` when committed. If not found, return `receiptFound:false` (no fabricated commit revision). A missing probe can still race an in-flight transaction: the adapter keeps the pending identity and does not assume the receipt was cancelled.

Confirmation body:

```json
{
  "action": "confirm_receipt",
  "requestId": "stable-idempotency-key",
  "receiptId": "stable-draft-id",
  "shopSessionId": "shop-session-explicitly-linked-by-review-or-null",
  "market": "UK",
  "currency": "GBP",
  "retailer": "reviewed store name",
  "purchasedAt": "reviewed timestamp or null",
  "receiptTotal": 1.25,
  "adjustments": [],
  "inventoryBaseline": {"stock":{"pasta|g":300},"expectedRevision":0,"initialize":true},
  "lines": [{
    "lineId": "line-1", "kind": "food", "canonicalKey": "pasta",
    "name": "Pasta", "brand": "", "quantity": 500, "unit": "g",
    "packCount": 1, "packQuantity": 500, "packUnit": "g",
    "pricePaid": 1.25, "priceType": "regular", "location": "cupboard",
    "legacyCredit": {"id": "shop-session|pasta|g", "quantity": 300, "unit": "g"}
  }]
}
```

`kind` is `food` or `essential`; hard household exclusions can never become food. `pricePaid` is the **total paid for this line across its packCount**, not a unit-pack price. A genuinely free, reviewed purchase line may have zero price and still contribute measured food; zero-price rows never yield a learned regular pack price. `priceType` is `regular`, `promotion`, or `unknown`. Counts/contents/units must be explicitly reviewed, never copied from a guide pack or invented. Food with unknown amounts stays pending and must be measured or deselected before confirmation. Refunds, discounts, tax and totals cannot create positive inventory. A canonical name plus exact unit must exist in the server's canonical pack catalogue.

Essentials can keep unknown quantity/unit as null because their reviewed paid amount still belongs in the separate non-food subtotal. Strict positive measured-quantity and canonical-pack validation applies to food inventory lines; do not accidentally reject priced essentials merely because the receipt omitted a pack size.

`receiptTotal` is the reviewed actual total or null. `adjustments` contains only explicitly reviewed non-product rows: `{lineId,kind:"discount"|"refund"|"tax",amount,description}`. These rows contribute neither inventory nor learned pack prices; preserve them as bounded receipt metadata. Grand-total rows are never appended again as adjustments. Store actual receiptTotal as the final receipt-budget spend when supplied, retain food/essential line subtotals separately, and avoid guessing how basket-level discounts or included VAT allocate across categories. Include receiptTotal and adjustments in the receipt semantic hash.

Response to GET or a successful confirmation:

```json
{
  "ok": true, "duplicate": false, "receiptId": "stable-draft-id",
  "scope": {"kind": "user", "id": "verified-user-id"},
  "initialized": true, "inventoryRevision": 1, "receiptRevision": 1,
  "inventory": [{"stockKey":"pasta|g","canonicalKey":"pasta","quantity":500,"unit":"g","location":"cupboard","revision":1}],
  "stock": {"pasta|g":500},
  "essentials": [], "priceObservations": [],
  "pantryReview": {"required":true,"shopSessionId":"shop-session","confirmedAt":null},
  "credits": [{"lineId":"line-1","purchasedQuantity":500,"priorCreditedQuantity":300,"addedQuantity":200}]
}
```

`stock` is the **complete authoritative measured inventory**, including explicitly synchronized manual/FinishShop baseline stock and receipt additions. It is not merely a receipt-owned delta: that would lose the historical 300 g on another device. If returning changed keys only, include `projectionMode:"patch"`; full snapshots are strongly preferred for bootstrap and duplicate recovery. GET returns `initialized` plus a monotonically increasing scope-wide `inventoryRevision`. A receipt response also returns its original committed `receiptRevision`, even when the current inventory revision has advanced. Essentials include their reviewed spend and remain separate from food; expose their own subtotal and include both food and essentials in receipt/weekly budget totals.

The receipt transaction first validates `inventoryBaseline.expectedRevision` against the locked scope revision, then initializes/reconciles the exact full local measured baseline and applies the net receipt addition atomically. `initialize:true` is accepted only while that inventory scope is uninitialized. Thus existing local 300 g + server-empty + receipt 500 g with 300 g legacy credit becomes **server 500 g**, not server 200 g. Client applies the returned 500 g relative to the accepted 300 g baseline, so local also becomes 500 g; an empty second device GET receives the same full 500 g.

For a later receipt, an explicit local manual change from 500 to 550 g is submitted as the next revision-checked baseline before adding the next purchase. This preserves and synchronizes manual edits. A first attach to already initialized cloud inventory with nonempty, unowned local stock is ambiguous: the adapter returns `receipt_initial_pantry_merge_required`, and the host must show an explicit Pantry merge rather than adding two potentially overlapping inventories. Pure GET does not silently upload local consumption/manual edits; the host's Pantry confirmation must call `confirmPantry` to synchronize those absolute quantities.

Deduplicate the **receipt semantic payload** before applying a baseline or checking its now-stale revision. Exclude synchronization-only `inventoryBaseline` (and the transport request identity) from the receipt semantic hash; changing reviewed receipt lines still returns 409. A retry may legitimately contain a newer local baseline because the first result or a GET has already projected it. Returning `receiptRevision` lets the adapter compare its locally applied `inventoryRevision`: if already at/after that receipt revision, it uses the existing cloud baseline instead of adding the receipt twice. A cloud commit whose local write failed still applies once from the originally submitted local baseline on retry.

The adapter persists a small actor-scoped pending-confirmation intent **before** POST. This contains only normalized receipt metadata and the captured measured baseline, never image data or tokens; no stock is incremented before server success. Successful local projection removes the intent in the same journalled transaction. If cloud commit succeeds but storage rolls back, or the connection disappears after commit, the intent survives a reload. A receiptId GET probe proves which accepted baseline to use for recovery: e.g. local550/cloud500 +100 becomes cloud650, and recovery applies from captured550, not old cloud500 (which would incorrectly produce700). A new unrelated receipt or Pantry confirmation is blocked while that intent is unresolved. `getPendingConfirmation()` exposes same-actor recovery metadata for UI/host coordination.

If both the local full inventory differs from its last applied cloud snapshot **and** the remote revision advanced, ordinary GET returns `receipt_local_remote_pantry_merge_required` rather than adding two absolute snapshots. Show an explicit Pantry merge. Late/stale server responses cannot roll the applied revision backwards. The recovery probe is the exception when it proves the server committed the exact captured local baseline.

`confirm_pantry` is a separate POST action: `{action:"confirm_pantry",stock:{"pasta|g":500},expectedRevision:1,shopSessionId}`. Validate the complete reviewed absolute stock against the scope-wide expected revision, return 409 on stale data, increment `inventoryRevision` and clear `pantryReview.required`. Do not reuse receipt-increment logic for absolute pantry edits. `BBReceiptInventory.confirmPantry` accepts that same stock/revision shape and applies the response relative to the captured local baseline, not as a second receipt increment.

## Required server transaction and suggested tables

These table names are proposed, not a saved migration: `receipt_inventory_receipts` (scope + receipt ID and unique request ID, normalized payload hash, stored outcome), `receipt_inventory_lines` (reviewed immutable line provenance), `receipt_inventory_stock` (scope + canonical stock key, quantity and revision), `receipt_inventory_legacy_claims` (scope + legacy event ID, claiming receipt, canonical key/unit, allocated quantity), `receipt_inventory_essentials`, and `receipt_inventory_price_observations` (scope/market/store/currency/brand/exact pack).

Use one transactional RPC to validate, claim idempotency/legacy events, synchronize the revision-checked measured baseline, increment stock, save essentials/prices and mark Pantry review required. Store an initialized flag and scope-wide inventory revision. Unique constraints and row locking make concurrent requests safe. Same receipt/request + same semantic payload returns duplicate without touching baseline or inventory; same identity + changed receipt semantics returns 409. Validate all lines before mutation. A failed partial SQL batch must never leave half a receipt committed. RLS/service authorization must scope every table and RPC to the verified actor or linked household; do not accept a client-selected scope.

Legacy credit can span multiple food rows in one receipt: a 600 g historical credit against three 200 g rows must net zero additions, not credit only the first row. The core allocates one historical event across rows, so `legacyCredit.id` can repeat **within the same receipt**; quantities sum to at most that historical event's credit. Backend must aggregate/claim the event once per receipt and reject or ignore reuse by another receipt, with exact canonical key/unit/session matching. Never subtract arbitrary existing manual stock.

Price observations use exact scope + market + retailer + currency + brand + packQuantity + packUnit. `normalizePriceObservation` exports the shared shape, including `packPrice`, `priceType`, `eligibleForRegularPrice`, and `source`. Unknown pack counts do not yield a learned pack price. Promotions and unknown prices are preserved separately and do not overwrite normal prices. Receipt observations never mutate the public `BBPriceV19.catalog`. The adapter's `getLearnedPrice` uses only regular observations for the active actor and exact pack/store, with a median and an outlier filter once sufficient samples exist.

## Scanner UI contract

Parser result: `receiptInventory.items` rows accept `lineId,name,brand,kind` (`food|essential|unknown`), `canonicalKey,quantity,unit,packCount,packQuantity,packUnit,pricePaid,priceType,confidence,notes`; top-level `currency,retailer,purchasedAt`.

`await BBReceiptInventory.normalizeDraft(raw,{market,retailer})` returns `{version,receiptId,market,retailer,currency,receiptTotal,transactionAt,purchasedAt,shopSessionId,lines,totals,pendingLineIds}`. Each row has `id,description,classification` (`food|essential|ignore|pending`), `canonicalKey,quantity,unit,packQuantity,packUnit,packCount,unitPrice,lineTotal,pricePaid,sourceKind,selected,reviewed,issues` plus display notes. `unitPrice` is per pack; `lineTotal`/`pricePaid` is the whole line. When pack edits change quantity, update or clear the stale direct `quantity/unit`; conflicting measured totals are deliberately rejected.

Keep photo/base64 and drafts only in memory. Review food versus non-food, mappings, amounts, store, currency and prices. Set `reviewed:true` for accepted rows. Explicitly link an earlier FinishShop session only when this receipt corresponds to that purchase; do not net an unrelated shopping trip's credit. `cancelDraft(draft)` changes no inventory.

`await commitReviewedReceipt(draft,{idempotencyKey,signal})` posts the normalized confirmation. Stable receipt/request identity is retained for retries. Success is `{ok:true,committed:true,duplicate,receiptId,localApplied,needsPantryConfirmation,projection?,summary,syncRequired?,localError?}`. A server commit may succeed while local storage fails or the context changes: then `committed:true,localApplied:false,syncRequired:true`; show "receipt saved; refresh pantry" rather than "stock added" or "nothing saved". Network abort can leave server outcome unknown; retain the request identity and reconcile/retry rather than assuming rollback of a server transaction.

Errors with `commitUnknown:true,recoveryRequired:true,receiptId` indicate an uncertain network/server outcome and a persisted pending intent. A definitive non-timeout HTTP4xx clears that attempt's pending intent; the database must have performed no partial mutation. Cancelling a dialog while its already-confirmed request completes defers local application and leaves recovery metadata; it cannot promise to undo a completed cloud transaction. `cancelDraft` returns `cloudConfirmationPending` for this distinction.

## Required host bridge / pending integration

Configure the adapter with:

```js
BBReceiptInventory.configure({
  getSession: () => ({access_token, expires_at, user:{id}}),
  getContext: () => ({market, retailer, shopSessionId}),
  getCatalog: () => BBPriceV19.catalog,
  canonicalize: name => BBPriceV19.canonical(name),
  getFinishShopCredits: () => parsedLegacyReceiptLedger,
  onProjection: ({stock,inventory,essentials,pantryReview,scope}) => { /* reload app state and render */ }
});
```

The defaults can read the saved cloud session and existing pack catalogue, but `getContext` is mandatory before use. `canonicalOptions()` is async and returns exact `{key,name,units[]}` choices. `synchronize()` fetches cloud state (probing a pending receipt when necessary) and applies a verified projection. `recoverLocalTransaction()` restores an interrupted same-actor local write before retrying cloud sync; its allowlist prevents a tampered journal from touching authentication or unrelated keys. `getCachedProjection()` returns data only for the active actor's current owner marker.

The adapter writes actor+scope-scoped cache, measured pantry, Kitchen projection, a Pantry-review marker and FinishShop coverage metadata with a recovery journal/rollback. Cloud mutation precedes receipt inventory writes. It applies `currentLocal + nextFullServerStock - acceptedBaseline` for a newly committed receipt, preserving edits that happened locally while the network request was pending. For ordinary GET or an already projected duplicate, it uses the previous applied full server stock as baseline. Existing 300 g transferred + a reviewed 500 g receipt contributes only 200 g more, while the cloud still holds the correct full 500 g. It writes a same-session legacy coverage guard so FinishShop cannot later add already-receipted surplus again.

Root must wire `onProjection` to rehydrate the actual in-memory `bb307Stock` and Kitchen before rendering; this adapter intentionally does not mutate app lexical variables or auto-mark any shopping checkboxes. Root must enforce the new Shop **Confirm Pantry** gate before meal reconciliation: the existing `receiptReviewRequired` local marker alone does not change existing Shop code. Existing historical `credited` values are preserved for audit; the current-week availability helper must honor confirmed receipt coverage when the reviewed Pantry quantities supersede old surplus eligibility.

The host must block legacy FinishShop transfer while `getPendingConfirmation()` is nonempty (including another tab). Otherwise a same-purchase legacy surplus could be added locally during an unresolved receipt request and later mistaken for an unrelated manual change. After successful confirmation the written legacy coverage guard prevents the later transfer. Ordinary manual stock edits made while a request is pending are preserved, but require subsequent revision-checked Pantry confirmation to synchronize to other devices.

The adapter uses same-actor Web Locks automatically when `navigator.locks` exists (or an injected `locks` host is configured). Host legacy mutations can join `withInventoryLock(() => legacyMutation())`; do not wrap the adapter's already-locked methods again because Web Locks are not re-entrant. Older environments without Web Locks have same-tab deduplication plus authoritative backend revision checks, but the host must serialize/disable competing-tab legacy mutation paths before claiming fully coordinated cross-tab writes. Render/sync listeners should wait while the actor's local recovery journal exists; multi-key localStorage writes have recovery semantics, not database-style isolation from unrelated legacy writers.

## Validation limits and response invariants

Core: at most200 receipt rows; quantities at most1,000,000 base units per food key; whole numbers for counts; at most2,000 stock keys; finite decimal inputs only (no booleans/arrays/hex coercion); receipt/accepted-spend maximum100,000 currency units; identity lengths120/160 characters. Stock keys contain one separator and a valid canonical food name/base unit, never prototype-reserved names or recognized household products. No mass-to-volume conversion or catalogue-pack inference is performed. Server must impose a request-byte limit before JSON parsing as well as these semantic limits.

Response: `initialized` must be boolean; scope/receipt/inventory revisions must be safe nonnegative integers (`receiptRevision>=1` and no later than current inventory revision). A user scope ID must match the authenticated actor; household legitimacy remains the backend's responsibility. Inventory rows must agree with `stock`, carry canonical key/unit, valid storage location and finite quantities. Reject oversized arrays (inventory2000, essentials500, observations2000); paginate/history-limit on the backend rather than returning unbounded history.

Price observations need `scopeId`, exact market/retailer/currency/brand, normalized `packQuantity,packUnit`, explicit `packCount`, positive `packPrice` and `priceType`; malformed/cross-scope observations are ignored. A regular observation is eligible only within that exact actor/store/pack context, and promotions remain distinct. Unlisted server properties, photo data and tokens are never copied into the receipt cache.

Receipt row `lineTotal` is the public draft's authoritative total-price editor; keep its `pricePaid` alias and any derived `unitPrice` consistent when the UI edits prices. The parser's supplied `pricePaid` is accepted on the initial normalization. Receipt totals/discount/refund/tax rows must not be mistaken for products; `totals.taxLines` reports tax separately because UK included-VAT versus US added-sales-tax cannot be guessed. Use the reviewed actual receipt total for the receipt's final budget amount, and explain any reconciliation difference.

Account/household switching must call the host's normal account-local state reset/reload before applying a different receipt projection. Adapter refuses another actor's active projection and refuses a changed household scope rather than mixing stock. It does not silently delete manual Free pantry data or infer ownership of unscoped legacy stock. Cross-tab UI should synchronize only after the account/context has been rechecked. Do not cache receipt photos/base64 or access tokens in the new receipt cache/journal.

## Remaining before release

Implement and test transactional backend/SQL, authenticated full-receipt Vision schema, scanner UI, account-switch host reset, Shop Confirm Pantry bridge, app reload/render hooks, and exact user/store pack-price lookup integration. Test on mobile, cancellation, concurrent retries, server 409, expired login, storage quota/rollback, and legacy FinishShop both before and after receipt. No deployment or end-to-end completion is claimed by these files.

## Local verification checkpoint

`node tests/basketboss-receipt-inventory-core.test.mjs` currently passes30 cases, and `node --test tests/basketboss-receipt-inventory-core.test.mjs` plus syntax checks pass. The test server is an explicit in-memory model of the agreed transactional contract, not a production API or database verification. Cases cover shared HTTP validation, full-stock bootstrap/cross-device state, manual baseline synchronization, retries and GET recovery after quota/network failures, duplicate/concurrent confirmation, refund/discount exclusion and actual totals, household exclusion, exact alias/unit mapping, numeric/prototype/payload limits, account/scope/revision isolation, cancellation, journal key restrictions, two-tab lock orchestration, cosmetic stock-key ordering and photo/token exclusion. All four implementation/checkpoint files remain untracked/unstaged at this checkpoint; no Git mutation or deployment was performed.
