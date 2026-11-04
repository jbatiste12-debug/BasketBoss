# BasketBoss 1.0 (9) — live pantry sync and regional ingredient matching

Build 9 includes all build 8 functionality and the “Your kitchen, made simple”
welcome. The latest source is `testflight-build9-pantry-sync` on
`fix/confirmed-cook-pantry` (PR #40). Earlier release tags remain unchanged.

The latest update shares one grams-per-piece table between pantry calculations
and shopping display. Counted produce such as carrots and courgettes reduces
measured recipe requirements automatically. Valid At home quantity edits save
automatically; the quick-add picker's Done action and switching to Shop flush
pending edits. Incomplete/invalid input keeps the last saved balance intact.

Staples and condiments use In Stock / Low / Out plus container counts. Small
recipe spoonfuls check availability rather than deducting ml. Low/Out creates a
single restock requirement. A reviewed measured receipt line such as ketchup
800 ml matches the existing staple as one purchased container, editable before
confirmation. Explicit manual Shop top-ups remain additional purchases.

Measured ingredients use canonical grams, millilitres or count. UK/US recipe
presentation never rescales an existing balance. New informal purchases use
labelled regional pack estimates; reviewed contents override defaults. US cups
use ingredient-specific approximate weights for solids, not a generic liquid
density. Receipt review matches existing pantry names and preserves unknown
units/sources for review. Compatible sources merge into one active pantry row.

The repeatable audit (`npm run audit:pantry`) covers all 100 public recipes and
730 ingredient lines in UK and US modes, with no duplicate ingredient keys or
conversion failures among known quantities. Twelve ambiguous source amounts
(e.g. blocks, cartons and handfuls) remain explicit review items. See
[ingredient-region-audit.md](ingredient-region-audit.md) for the exact sources
and a full audit of At home quick-add tiles. An unknown amount is never silently
set to zero or assigned a made-up package size.

The welcome uses the established BasketBoss crowned-basket branding, Cook-page
forest/cream/gold styling and an existing recipe photograph. The four numbered
steps use the same icons and names as the app’s navigation. Money metaphors and
the cupboard illustration have been removed. The slide fits a 390 × 844 viewport;
shorter phones can scroll while keeping the primary action visible.

The first-use guide explains the real actions: start in Plan or choose recipes
in Discover; confirm quantities in At home; use the automatically reconciled
Shop list (including a simple eggs example) and optional additional manual top-ups; Finish shop or confirm a receipt to
restock; use Confirm cooked or Day done to record food used. Day done covers all
planned food that day. Leftovers and essentials are reviewed for the next week,
and remaining pantry stock carries forward.

On a fresh setup, the guide opens after completion and its action leads to Plan.
Existing completion state remains intact. Returning users can replay the welcome
from Settings → Replay welcome & setup, or open How BasketBoss Works. Viewing
these instructions does not change stock or meal plans.

Cupboard, Fridge, Freezer and the existing Weekly essentials each have editable
subcategories. Starter options include Tins & jars, Dairy & eggs, Batch meals,
Cleaning products and Laundry. Use Edit groups to add, rename, reorder or remove
groups. The Subcategory menu on an item changes its group; removing a group keeps
its items in Other items. Filters only change the view. Food stays separate from
household products, and quantities and shopping calculations remain with their
existing owners. Groups are saved on this device for the current account.

Manual At home quantities are actual remaining stock. Purchases add to that
balance; confirmed meals deduct from it once; the next shopping list calculates
the shortfall from the balance that remains. Category edits do not confirm,
replace or reset quantities, including unconfirmed drafts. Known compatible
units convert through the existing pipeline; unknown pack contents or conflicting
units keep their saved data and require review rather than a guessed deduction.

Weekly essentials now offers “Enter part of a bottle or pack” on a selected
household item. Enter containers remaining, the full container size and the
total containers needed. Saving converts ownership and its target together into
ml or grams, retaining the reviewed capacity. For example, half a 750 ml cleaner
is 375 ml; a reviewed 750 ml receipt adds once to give 1,125 ml. Half an older
500 ml bottle plus a new 750 ml bottle gives 1,000 ml. Changed pack sizes never
rescale existing measured ownership. Known conflicting brands/products stay
separate. Unknown capacities leave the prior balance unchanged.

Quantity checks also preserve fractional food pack balances and separate receipt
source records. Incompatible or unknown physical units remain intact with a
review message; compatible edits can still save. Purchase pack counts remain whole.

Saved weeks and Saved meals remain compact tab-style buttons above the dinner
plan. Both start closed. Switching preserves draft names and existing save/load
and delete actions. The pantry balance, Day done, manual Shop, receipt handling,
weighted Auto-fill, unit conversion and earlier AI/Premium features are inherited
from build 8. See BUILD_8_TESTFLIGHT.md for details.

## Verification

Full automated suite: 1,820 passed, no failures or skipped tests, two existing
TODO cases. Strict pantry TypeScript contracts passed. Native packaging and
portable iOS checks passed: 909 assets, 100 Free recipes, no private Premium
recipe bundle. The native Xcode compile/sign/upload is not performed here.

## Mac upload

Use Xcode 26+, Node 22+ and CocoaPods. This fresh checkout preserves local changes
in previous folders:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build9-XXXXXX")" &&
git clone --depth 1 --branch testflight-build9-pantry-sync \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

In Xcode confirm Version 1.0 / Build 9, team Jason Batiste (J25UTUATD2), and bundle
ID uk.co.basketboss.app. Select Any iOS Device (arm64), then Product → Archive.
In Organizer choose Distribute App → App Store Connect → Upload. After Apple
processing, assign build 9 to the TestFlight group and use
release-assets/build9-what-to-test.txt for tester notes.
If Build 9 has already been uploaded to Apple, increase the Build field to the
next unused number before archiving this updated source.

GitHub checks and unsigned archives do not perform the signed Apple upload.
Native CI for this source is tracked in PR #40. Local checks cover the full regression suite, strict pantry type contracts,
UK/US recipe audits and native packaging. Live quantity/Done/navigation checks
passed at 320 and 390 px; UK/US pantry and receipt review flows passed at 390 px.
Signing and actual iOS WebView/device checks remain for the Mac/CI.

## Backend prerequisite

Cloud pantry sync still needs the matching Cloudflare API deployment and these
Supabase migrations, in order:

1. 20261102183209_receipt_auto_stock_policy.sql
2. 20261104074737_pantry_fractional_stock_balances.sql

The production audit was read-only. The welcome/layout changes do not deploy
those migrations or the API. Until rollout, incompatible cloud validation leaves
the locally recorded pantry update intact with a review notice.
