# Pantry running balance and compatible units

The pantry persists between weeks. Reviewed receipts and Finish Shop add actual
purchases, including household essentials. Confirm cooked deducts the meal once;
Day done deducts the remaining planned dinner, lunch and dessert together. A batch
uses its full cooked servings once; linked leftover meals do not consume the raw
ingredients again. Clearing or restoring a week does not clear stock.

Shop has a two-field **Add item to buy** form: Item and Quantity to buy. This is
an additional purchase request, independent of what is already at home. Examples:
`4`, `500 g`, `2 packs`, `1 bag (500 g)` or `2x400g`. Known contents can be entered
in the same quantity field. Checking Bought is reversible; only a confirmed
purchase deposit fulfills the request. Partial and unpurchased requests carry to
the next trip. An older receipt cannot fulfill the new trip's request.

## Unit rules

One shared, read-only proposal engine is used for cooking, automatic shopping
shortfalls and Auto-fill stock preferences:

- Metric aliases convert exactly, such as kg to g and litres to ml.
- A reviewed package uses its own contents, such as 2 packs of 500 g. Cooking
  750 g leaves half a physical pack. Retail price-guide sizes are not treated
  as proof of what the user owns.
- Volume and weight convert only with food-specific density. Counts use a
  supplied item weight or the existing whole-produce estimate. Spoon measures
  use existing ingredient-specific rules. Estimates and their basis appear
  before confirmation.
- Different recipe requirements share the same physical balance, so a pack
  cannot be allocated twice. Raw/cooked/frozen ingredient states stay distinct.
- Unknown contents, incompatible units or conflicting reviewed facts leave
  that stock unchanged and show a review message. Compatible quantities can
  still deduct. Invalid data blocks consumption without changing stored stock.
- Physical source keys and precision are retained locally. Cloud stock accepts
  fractional counts and small residual balances; purchase counts remain whole
  numbers. Unsupported cloud units or ambiguous package merges retain the local
  update with a sync notice.

Auto-fill gives +3 per distinct available non-staple food, -6 if planned in the
last 7 days, -3 in days 8–14, and -4 for yesterday's exact main protein. Salt,
pepper, oil and water do not earn pantry points. These are weighted preferences:
otherwise eligible recipes remain selectable. Scoring reserves only a private
proposal ledger and never spends the real pantry.

## Deployment and verification

Production still uses the base receipt SQL. Apply these in order before the
matching client and Cloudflare API:

1. `supabase/migrations/20261102183209_receipt_auto_stock_policy.sql`
2. `supabase/migrations/20261104074737_pantry_fractional_stock_balances.sql`

The production audit was read-only; these migrations have not been applied.
The fractional migration changes stock validation without rewriting inventory,
while keeping receipt purchase validation and service authorization strict.

The new UI needs a new iOS build; the existing immutable `testflight-build7`
tag does not contain this feature. This branch retains the current native
version until the next release is cut. Xcode signing and TestFlight upload
remain on the owner's Mac.

Tests cover shared conversion, physical allocations, unknown/conflicting facts,
Cook and Day done idempotency, manual purchases/partial receipts/trip rollover,
Auto-fill weighting, cloud projection and actual PostgreSQL validation. Browser
checks exercise the two-field form and all-day deduction through reload.
