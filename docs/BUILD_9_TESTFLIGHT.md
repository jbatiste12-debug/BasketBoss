# BasketBoss 1.0 (9) — faster conversational Cook Mentor

Build 9 includes all build 8 functionality and the “Your kitchen, made simple”
welcome. The latest source is `testflight-build9-fast-mentor` on
`fix/confirmed-cook-pantry` (PR #40). Earlier release tags remain unchanged.

Cook Mentor now requests an opt-in text stream and starts natural speech after
complete sentences become available, while the rest of the answer is still
being generated. It prefetches one next sentence and plays clips in order.
Stop, interruption, backgrounding, account changes and recipe changes cancel
both the request and queued audio. An interrupted model answer is marked
incomplete and is not added to follow-up history. Voice failure retains the
written reply and offers the existing retry control.

iOS detects about 550 ms of actual quiet microphone input after recognized
speech, rather than waiting 950 ms after changed text plus Apple's finalization.
Adaptive noise thresholds help distinguish kitchen background sound from speech.
The microphone stays paused for the whole spoken answer, including network gaps.
Browser recognition endpoint timing remains controlled by the browser.

The provider prompt is 37% shorter; recent history keeps up to two complete
exchanges within 1,800 characters. Exact serving-scaled ingredient quantities,
all method steps and recipe safety constraints remain available. Private mentor
text/audio stays uncached and is never persisted by this pipeline. Existing
membership, deletion and generation allowance checks still apply to each
synthesis request; sentence splitting can use multiple requests per reply.

Supported browsers can play validated MP3 bytes progressively. Native iOS and
unsupported browsers buffer each short sentence clip before playback. Legacy
clients keep their JSON response, and the new client accepts an older server's
JSON response using the same request. Production needs the matching server
streaming deployment; the native VAD and playback changes require a new Apple
build. Deterministic fixtures prove overlap, not a production latency guarantee.

Plan uses a single branding row with BasketBoss, region, membership and Settings.
Membership is still read from the verified account state; compact labels retain
full accessible descriptions and existing actions. The green My Week card is
first, followed by a single row of Budget & household settings, Meal preferences
and Ingredients to avoid pills, then Auto-fill My Week / Add a meal and the dinner
schedule. Saved weeks, Saved meals and Check At home stay below the schedule.
Saved tools close on Plan entry; ordinary Plan updates retain the active pane.

My Week describes a saved target directly, for example “£24.30 under your £150
budget · 7/7 dinners planned”. It shows estimated At home savings only where stock
avoids quoted shopping packs. The ring uses the full shopping estimate after
usable pantry stock, including lunches and selected essentials; Bought ticks do
not reduce it again. Partial ownership can reduce the required quantity without
changing cost if the same number of packs must still be bought. An unset budget
asks the user to set one, and genuinely incomplete prices/recipe amounts are
labelled “priced so far” rather than claiming a guaranteed under-budget result.

The original budget and household controls open from their pill. Original
Auto-fill and ingredient-filter rules remain intact. How Auto-fill works and the
gold pantry-only auto-fill action sit behind ⓘ. Popovers close with Escape or an
outside tap and remain above the dock. Flow labels use Plan → At home → Shop.
Phone and tablet browser checks verify one header row, accessible touch targets,
working region/settings/membership controls, the weekly plan above the fold and
unchanged plan/stock data from layout changes.

At home now opens a compact quantity editor beside the food tile you tap.
Use the amount, unit and −/+ controls there, then Done; valid amounts update
Shopping automatically. Each Cupboard, Fridge and Freezer section ends with a
compact item count and editable stock summary. Custom foods use one inline
Item name + Qty + Unit + Add row. Existing subcategories and container-content
review remain available; quantities use the same guarded pantry ledger. UK/US
summaries use regional display units, while opening an editor or choosing a
display unit leaves physical stock untouched. Steppers add a canonical converted
delta, avoiding roundtrip loss through a rounded pounds/cups display.

Shop's main circle marks the displayed purchase amount as bought in one tap.
The ••• drawer contains Enter different amount, Already have enough and My usual
product. Its amount field appears only when requested. A smaller amount leaves
the rest to buy; a larger purchase credits the full actual amount to At home
when Finish shop completes. Separate partial-purchase inputs and provisional-pack
warnings have been removed from the aisle flow.

Plan, Discover, At home, Shop and Cook open at the top on navigation, including
the separate Cook page. Main screens use the document scroller, with 110 px plus
the device safe area below their content. In-store and guided-Cook overlays keep
their own scrolling and action clearance. Ordinary quantity saves do not reset
scroll position or steal keyboard focus.

Shop now ends with a collapsed **Check your cupboard** section for culinary
staples required by the planned week. Unknown/in-stock staples do not add an
active item or budget cost by default. Explicit Low/Out or **+ Add to list** adds
one bottle/jar/pack, using a full-container regional price guide. Promoting then
marking the same item Low still produces one restock; ordinary manual top-ups
remain additional purchases. Promoted items leave the reminder section, and
actual purchases fulfil the request once.

Shop meal labels use clean days such as “For: Mon · Thu”, with “Pantry top-up”
when there is no meal attribution. Developer/source-review wording is removed
from those labels and quantity names; unresolved source quantities remain
available in the existing review/details flow rather than being discarded.
Runny/clear honey now matches pantry Honey, preserving a single cupboard identity.

Cupboard, Fridge and Freezer food rows now ask only for the amount already at
home and its unit (or staple stock status/container count). “Total needed” is
editable only in Weekly essentials. Food requirements continue to come from the
meal plan; additional purchases use Shop → Add item to buy. Editing owned food
amounts does not create a new manual food target. Existing explicitly saved
requests, stock, receipts and household targets are retained.

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

Saved weeks and Saved meals remain compact tab-style buttons below the dinner
plan. Both start closed. Switching preserves draft names and existing save/load
and delete actions. The pantry balance, Day done, manual Shop, receipt handling,
weighted Auto-fill, unit conversion and earlier AI/Premium features are inherited
from build 8. See BUILD_8_TESTFLIGHT.md for details.

## Verification

Full automated suite: 1,942 passed, zero failures, one Swift-only fixture skipped
on Linux, and two existing TODO cases. The fixture is required on macOS and
executes the production Swift endpoint detector. Native packaging and portable
iOS checks pass: 914 assets, 100 Free recipes, no private Premium recipe bundle.
Actual microphone sensitivity, noisy kitchens and perceived response speed need
device testing. Xcode compile/sign/upload is not performed in this Linux workspace.

## Mac upload

Use Xcode 26+, Node 22+ and CocoaPods. This fresh checkout preserves local changes
in previous folders:

```sh
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build9-XXXXXX")" &&
git clone --depth 1 --branch testflight-build9-fast-mentor \
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
passed at 320 and 390 px. Browser checks cover all five tabs, cross-page Cook
navigation, a single main scroller, in-store action clearance, inline editing,
partial and larger purchases, and the displayed tin quantity. Repeated UK/US
checks verify canonical container merges, incomplete drafts and stale-account
guards. Existing UK/US receipt-review checks remain unchanged.
Signing and actual iOS WebView/device checks remain for the Mac/CI.

## Premium server repair

The Apple SDK startup repair (PR #46) and online certificate-check transport
repair (PR #47) are deployed separately on production main; the latter merge is
`611970db12967aafa87921a6667a055674c1926e`. The official verifier keeps Apple
roots, signature, revocation and certificate freshness checks. Signed fixtures
pass in real workerd with online checks enabled. The user has now confirmed that Premium works after deployment. The separate
post-deploy probe was queued at the earlier handoff; the successful user retry
confirms the activation path.
These server repairs work with existing clients that have the beta button. This
client source tag does not redeploy that backend.

The matching streaming server update is merged separately in PR #48 at
`832594bd8ea54beb3f6b43c2ef8672ffc3e8cfe5`. It retains old JSON/native buffered
responses. The production deployment and post-deploy CI are tracked on that
merge; merging alone is not a live provider/device latency measurement.

## Backend prerequisite

Cloud pantry sync still needs the matching Cloudflare API deployment and these
Supabase migrations, in order:

1. 20261102183209_receipt_auto_stock_policy.sql
2. 20261104074737_pantry_fractional_stock_balances.sql

The production audit was read-only. The welcome/layout changes do not deploy
those migrations or the API. Until rollout, incompatible cloud validation leaves
the locally recorded pantry update intact with a review notice.
