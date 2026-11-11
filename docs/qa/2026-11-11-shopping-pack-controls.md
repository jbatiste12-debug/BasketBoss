# Shopping pack controls and display isolation — 11 November 2026

This change separates the displayed recipe shortfall from the physical purchase
the shopper selects. It is a view and purchase-input upgrade; existing recipe,
inventory, reconciliation, conversion and purchase calculations are unchanged.

## Shopping rows

- The title, estimated price and existing details menu remain on the first line.
- The readable shortfall stays on the left. A green **Buying** button on the
  right opens inline choices for that item.
- Quantity labels use `BBShopPurchaseUI.formatDisplayQty()` only while rendering.
  Grams/ml display as whole amounts; counted needs use practical whole numbers
  or exact halves. Positive sub-gram amounts display as `<1 g`, not zero.
- The preset strip scrolls horizontally. Common presets save with one tap;
  pack-count and Custom edits have an explicit Save action. Custom quantity and
  total-price fields are hidden until Custom is selected.
- Preset buttons, steppers, Buying buttons and the details menu have 44 px touch
  targets. The expanded picker is omitted from printed lists.

For the actual chicken-burger recipe scaled from six to four servings:

| Value | Calculation/source value | Shopping display |
| --- | --- | --- |
| Chicken required | 666.666667 g | 667 g |
| Chicken already at home | 200 g | 200 g |
| Chicken shortfall | 466.666667 g | 467 g needed |
| Garlic shortfall | 1.333333 counted cloves | 2 cloves needed |
| Egg shortfall | 0.666667 each | 1 egg needed |

Formatting never becomes a new requirement or pantry balance. Cooking still
uses the original scaled quantities, including the original precision.

## Physical quantities and price overrides

Pack plans are optional UI state stored separately under
`basketboss_shop_pack_ui_v1`, scoped by actor, active shopping trip, item and
canonical unit. Existing inventory keys, arrays, receipts and trip ledgers are
not migrated or rewritten by rendering or choosing an unbought pack.

- `boughtQtyOverride` is a physical canonical quantity: six buns are `6 each`,
  and a 300 g tub is `300 g`. It is never a package count such as `1 pack`.
- The displayed `baseEstimatedPrice` comes from the unchanged catalogue quote.
  No selected override returns that exact original price.
- A selected quantity scales the UI estimate around the default visible
  purchase total. A manual `priceOverride` is the total for the selected
  purchase, including all packs; it is not multiplied again.
- Row prices, Shop headers, Shop overview and My Week's remaining estimate use
  the same optional display layer. Core summaries, historical spending, pantry
  savings, catalogue prices and price observations are unchanged.
- Manual prices are shopping estimate overrides. This layer does not rewrite
  receipt/expense history or publish a new catalogue price.

Example: with the existing £10.20 estimate for a default 1 kg chicken purchase,
selecting a 500 g pack displays £5.10. Selecting two packs doubles the estimate
for one identical pack. A manual total of £7.50 stays £7.50 for that selection.

Coleslaw's 300 g tub is a new UI shopping suggestion. The underlying catalogue
and pricing file remain byte-identical. Garlic's existing ten canonical cloves
are described as one bulb; the quantity is not changed to one clove or ten bulbs.
These are estimated shopping guides, and the user can select the actual pack.

## Confirming purchases

Saving a choice for an unticked item changes only optional UI state. The tick
then passes the selected physical amount through the existing purchase handler;
Finish continues to use the existing receipt/stock ownership path.

Verified cases include:

```text
Chicken: 200 g at home + selected 500 g purchase = 700 g
Finish and reopening: still 700 g, with no duplicate credit
Cooking: original 666.666667 g requirement is used

Brioche buns: select/buy 6 each for a four-bun meal
At home after purchase: 6 each
At home after confirming the meal: 2 each

Coleslaw: UI default 300 g tub, recipe uses 200 g
At home after purchase: 300 g
At home after confirming the meal: 100 g

Counted purchase: existing 5 + selected 2 × 6 pack = 17 each
Manual total price: £7.50, not £15
Finish and reopening: still 17 each
```

Account/trip/unit guards reject stale editors. A failed UI-state write does not
call the purchase handler; a failed purchase correction rolls back that UI
choice without overwriting a newer choice. A price-only edit with unchanged
quantity does not run another stock transaction, including after cooking.

## Regression evidence

- The existing calculation functions are compared byte-for-byte against the
  release baseline. This includes `bbShopNeedPresentation`, `bbShopExactQuantity`,
  `bbShopPurchasePack`, `bb84DisplayedPurchase`, `bb84SetPrimaryPurchase`,
  `bb321WeeklySummary`, `bb321UnifiedShop`, `bb307Plan`, `bbPartialRound`,
  `bbPartialSet`, `bbShopV7Reconcile`, `bb83TransferBought`,
  `bbHomeRecipeIngredients` and `bbHomeDayMeals`.
- Core pantry policy, canonical projection, deduction, home state, receipt core,
  receipt quantity and both catalogue/pricing data files remain byte-identical.
- Existing test assertions are unchanged. New tests cover pure formatting,
  isolated plans, price estimates, storage rollback, defaults, saved/shared text,
  actual purchase handlers and full browser flows at 320 px and 390 px.
- Browser checks include source immutability, no stock credit while choosing,
  Finish/reload idempotence, cooking leftovers, price/header agreement, readable
  copy output, narrow-screen geometry and hidden legacy text remaining hidden.
- Native packaging includes the new JS/CSS. The deployment workflow verifies
  the exact live Buying-control and shared-list asset bytes after publication.
