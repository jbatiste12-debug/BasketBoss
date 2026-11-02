# Family dinner catalogue direction — 2 November 2026

## User direction and release boundary

The user wants variety within a practical UK/US family dinner catalogue: a clear majority of familiar British, Irish, Scottish and popular American meals, most ready within 60 minutes, with international discovery and special meals clearly labelled. Familiar dishes such as pasta, pizza, fajitas and mild curry can remain everyday choices; the group is an editorial household-use category, not a claim of national origin.

This is a proposed next update. The current production release and TestFlight 1.0 (3) stay unchanged until the update is reviewed. No live recipe table, subscription entitlement, ingredient quantity, serving scale, existing recipe ID or saved plan is changed here.

## Working targets for the review

Use approximately 80% familiar everyday dinners (including familiar Indian and Thai takeaway favourites), 10% Try the World, and 10% Special Occasion as an editorial target, not a verified statement about the current catalogue. Count dinners separately from desserts, breakfast, baking, snacks and sides. Roasts and slow-cooker meals remain available as familiar options with a Weekend & Slow Cooking label.

Aim for at least 80% of dinner recipes to be ready within 60 minutes. Treat the time as elapsed preparation plus cooking and required waiting, rather than hands-on cooking alone. Use the recipe's recorded time; do not invent shorter times to meet the target. Longer dishes need clear elapsed time and weekend/slow-cooking presentation.

Assess full records against supermarket ingredient availability in both UK and US, practical substitutions, adjustable heat, complete meal composition, portion measurements and realistic method steps. Browse membership is not kitchen testing, nutrition advice or a promise that every child will enjoy a meal.

## Evidence available and limits

- The current public recipe source contains 100 Free recipes.
- The historical 321-record baseline is available at `9458903c4ba06fc54a558fbe05886bfa5326ab98:recipes.json`. It is a source for initial editorial grouping, not proof of all current live Premium fields.
- The 179 newer additions are identifiable by release image slugs not present in that baseline. Their complete Premium records are encrypted locally. Initial groups for those additions are title-based presentation decisions, pending full ingredient/method and timing review.
- Initial baseline screen: 235 everyday candidates with listed time <=60 minutes; 23 familiar longer/weekend meals; 15 special/date-night meals; 47 other meals; one potato side requiring correction.
- Initial new-addition title screen: 21 familiar candidates, 117 Try the World candidates, 19 special candidates, 20 desserts and two other meals needing review. These are not counts of fully reviewed, timed, live dinner records.

The newer additions lean heavily toward international discovery. Labelling is the first step; reaching the working balance may require simplifying or replacing selected dishes after complete records are reviewed. Retain stable IDs for existing saved meals; do not reuse an old recipe ID for an unrelated replacement.

## Next-build implementation

`bb-recipe-editorial.js` supplies explicit stable-ID browse membership. The client computes time labels from the actual accessible record: valid explicit prep + cook times take precedence over `mins`. Partial/invalid explicit times do not fall back to an apparently faster time. Unknown recipes are not automatically asserted to be familiar or reviewed.

Discover adds Everyday Favourites, Try the World, Special Occasion, 60 Minutes or Less, Weekend & Slow Cooking, and Sides. Editorial labels remain visible alongside saved personal collections. They do not unlock Premium content or certify method quality. The auto-fill update below limits occasional international dishes while preserving independent rotation histories. Editorial group counts still need a complete ingredient/method review; this draft does not replace recipes to claim the target catalogue mix.

Air-fryer garlic parmesan potatoes is corrected to Side dishes, excluded from automatic dinners, and its unrelated sauce instruction removed. Ingredients and quantities are preserved.

## Priority full-record review

Start with Nigerian steamed bean puddings with eggs; Persian herb and kidney-bean beef stew; Persian aubergine and yellow split-pea khoresh; walnut and pomegranate chicken fesenjan. Keep suitable dishes as Try the World; assess whether to simplify methods/ingredients or replace them only after reading the complete recipes. Review quail, lobster, barberry-rice and similar involved dishes for Special Occasion.

Before describing the catalogue as fully reviewed, obtain all current authorised Premium records, record classification totals and actual elapsed-time coverage, review methods and side/main routing, and kitchen-test or accurately qualify timing claims. The known egg-muffin/pancake flour wording and undefined cheese-block measurements remain review items rather than silently altered recipes in this labels update.

## Draft validation

1,057 automated checks passed with zero failures (two skips and two TODOs). Native web packaging and portable iOS verification passed; this does not establish a signed Mac/device build. Browser checks at 320, 390 and 768 pixels confirmed the 60-minute filter, side-dish routing, badge fit and no application errors. A separate integration check confirmed saved personal collections retain editorial labels. The native bundle remains Free records only; Premium methods and ingredients are not added to public assets.

## Kids' Meals selection

The user requested a separate kids' meal selection, including familiar fish-and-chips-style dinners. The draft adds one visible Kids' Meals collection and badge, backed by 23 existing complete-meal candidates plus explicit kid-friendly dinner metadata. The old Kid Friendly collection label is accepted for saved personal collections and mapped to the new visible name, without rewriting saved data or showing duplicate category buttons.

Examples include the existing fish fingers with wedges and peas, chicken goujons with wedges and peas, macaroni cheese, meatballs with spaghetti, mini cottage pies, tortilla pizzas, cheesy bean quesadillas, mild chicken korma with rice and chicken-and-rice bake. No exact fish-and-chips record exists in the locally available source; do not claim a new one has been authored. Use the existing complete fish-finger meal rather than relabelling an unrelated record. Keep adjustable household servings: no assumed age-based or child portion multiplier is introduced.

This is an editorial browsing selection, not allergy, nutrition or age certification. An explicit `kidFriendly:false`, a non-dinner category or a side-dish flag blocks membership. A mild-sounding recipe name alone cannot grant the label. Method and portion review remains needed, including generic text in several historical records and the breadcrumb cod's listed timing. No Premium access changes are made.


## Occasional international auto-fill policy

The user requested dishes outside the everyday UK/US family selection only occasionally, with at most one across an automatically filled week. Each proposal gets a single 25% opportunity to include an occasional dish; retries do not reroll it, and inclusion is never forced. If the preceding confirmed auto-fill contained an occasional dish, the next proposal contains none. International Special Occasion additions share the quota, so their browse label cannot bypass it. Familiar popular curry/pizza dishes stay in the ordinary pool.

Existing manually selected World meals count toward the cap. Filling remaining days cannot add a second; if a user manually chose multiple such meals, preserve those choices and add no further World meals. Users can continue choosing any accessible recipes manually in Discover.

Familiar and occasional recipes rotate as independent cohorts in the existing account-scoped, single history record. An exhausted familiar cohort can restart without waiting for rarely chosen World dishes. Narrow ingredient/time/child filters cannot reset a cohort until all its eligible recipes are consumed. Ordinary swaps retain the original ungrouped behavior. Preview/cancellation writes nothing; confirmation retains plan snapshots, access/classification checks, concurrent-write checks and rollback if saving fails. Basic, Premium-filtered and older budget auto-fill use the same policy and confirmation safeguards.

Policy validation: 1,074 automated checks passed, with two skips and two TODOs and no failures. Regression coverage includes rare allowance/cooldown, no rerolls across retries, at-most-one for ordinary and Premium filters, existing manual one/two World choices, unloaded known IDs, familiar-cohort exhaustion, cancellation, stale classification and optimistic history saves. Browser checks at 320/390/768 pixels confirmed actual auto-fill confirmation/cancellation as well as the browse filters. Native web packaging and portable iOS verification passed; no signed device build or live deployment is claimed.

## Centred mobile page

The user reported lateral page movement while swiping on the Plan list. Browser measurements with seven dinners and five servings showed no root overflow at 320/360/390/393/430/768 pixels, so the report may include iOS edge elasticity rather than ordinary layout width alone.

The draft adds a compatible horizontal overflow fallback and root horizontal overscroll suppression, bounds Plan wrappers/cards/summaries to their container, and gives filled-row description grids a shrinkable minmax track with wrapping titles. Empty-day grids retain their existing layout. The native bridge disables always-on horizontal bounce and enables directional locking without changing vertical bounces or replacing WebView delegates. No global touch-action restriction or touch interception is added; Discover retains its intentional left/right pointer swipes.

Validation: all 118 related native/viewport/persistence checks passed, as did native packaging and portable iOS verification. Twelve browser cases (PWA and native web bundle at six widths) confirmed root and card fit, visible controls, zero horizontal scrolling after attempted movement, vertical scrolling and working Discover swipes in both directions. Physical iPhone edge-bounce verification and a signed Xcode build remain outstanding for this next-build draft. The existing live PWA and TestFlight build are unchanged.


## Stronger familiar-dinner balance

The user requested fewer specialist international dishes, more regular Western meals, and more Indian/Thai favourites familiar to English households. The working dinner target is revised to roughly 80% Everyday Favourites, 10% Try the World and 10% Special Occasion; this is an authoring target, not a measured live-catalogue claim. British, Irish, Scottish and popular American dishes should still make up the majority of the overall dinner collection. Familiar Indian and Thai choices belong in Everyday Favourites and do not use the occasional World quota.

The draft adds a Curry & Thai Favourites browse selection containing ten existing familiar curry/dhal/Thai recipes. These already have baseline records; their recipes, quantities, IDs and entitlement are unchanged. This is presentation/selection work, not ten newly authored recipes or a completed content rebalance.

A concrete next authoring batch should favour six regular Western dinners and four familiar Indian/Thai dishes:

| Candidate new dinner | Authoring direction |
| --- | --- |
| Sausages, mash and onion gravy | Complete familiar family meal; include vegetables |
| Gammon steak, egg and chips | Practical ordinary supermarket ingredients; include vegetables |
| Homemade beef cheeseburgers with wedges | Distinct from the existing chicken-burger recipe |
| Chicken Kyiv with mash and green vegetables | Clear achievable method; explicit poultry cooking check |
| Chicken chasseur with rice | Familiar chicken/mushroom/tomato family dinner |
| Beef and onion pasties with vegetables | Account for filling preparation, cooling and baking time |
| Butter chicken curry with rice | Distinguish the method/flavour from existing tikka masala; do not confuse with garlic-butter chicken noodles |
| Chicken jalfrezi with rice | Adjustable chilli and accessible peppers/onions |
| Chicken pad Thai | Use a practical complete noodle dish, with substitutions accurately described |
| Chicken massaman curry with rice | Practical ingredients and honest elapsed time |

These titles are authoring candidates, not newly shipped records. Aim for <=60 minutes total, but establish each duration from its complete method. Before adding/replacing records, compare full current Premium recipes for conceptual duplicates, write and normalise ingredients/methods/servings, commission matching images and validate shopping/portion scaling. Do not overwrite an existing saved recipe ID with an unrelated dish or delete meals from users' saved plans. The protected current Premium records remain unavailable locally beyond the historical baseline, so full replacements are still pending that review. Current production and TestFlight 1.0 (3) stay unchanged.

Curry/Thai selection validation: all 33 relevant editorial, Discover and auto-fill tests passed. Native web packaging passed. Browser checks at 320/390/768px confirmed the new selection, kids/time filters, centred badge fit and actual auto-fill confirmation/cancellation. The user confirmed Indian and Thai favourites as the intended direction.

## Hold and move Plan dinners

Hold a filled day's badge for 450 ms, drag onto another day and release. Dropping onto an empty day moves the dinner; an occupied day swaps the two dinners. Per-day serving overrides follow the corresponding meal, including a deliberate null override; recipe-level portions and other days remain unchanged. Expanded days also offer Move dinner with an accessible destination dialog and clear swap labels. Ordinary taps still expand/collapse the day.

The pure move model proposes changes without writing. The host rechecks the account, plan, serving amounts, completion records, custom notes, access and batch/leftover links before one save. Cooked dinners, custom-note days and meals linked to batch cooking or saved leftovers are protected until the relevant link is removed. Failed saves restore the original plan/portion state; a changed account or plan during a hold rejects the drop. Desserts, lunches, cooking receipts and stock are not rewritten. The older day dropdown uses this same host.

Only the day badge reserves touch movement. Card scrolling and Discover swipes remain available. An active drag scrolls vertically near the viewport edges, avoids the fixed dock, and cancels on Escape, pointer cancellation, lost capture, app blur, hidden page, disconnected source or viewport width changes. Height-only address-bar changes retain the drag. Drop highlighting, a safe-text floating label, live status and a keyboard-accessible dialog provide feedback.

Validation before the login follow-up: 1,094 automated checks passed, two skipped and two TODOs, zero failures. Browser checks at 320/390/768 px confirmed empty-day moves, occupied-day swaps, serving preservation, Escape cancellation, ordinary taps and no page errors. Independent Chromium touch input at 390 px verified pointer cancellation, protected target rejection, dialog cancellation, stale-plan rejection, edge scrolling, fixed-dock rejection, movement before the hold, app rerender and height/width resize behavior. Those cancellation/failure paths wrote nothing to the plan; edge scrolling remained vertical. Native packaging includes the model, gesture script and CSS. Physical iPhone gesture checks in a newly signed build remain outstanding; the current TestFlight build is unchanged.

## Keep sign-in across app restarts

The client restored saved credentials without renewing an expired access token on launch or foreground resume. Its old renewal catch also erased the saved session after any network/server error. The fix adds a shared session lifecycle for the main app, Make a Meal and native Membership screens. It renews on startup, foreground, native resume and reconnection; schedules renewal before expiry; deduplicates requests and uses Web Locks where available for cross-tab rotation. Fetch/body reads have a 15-second timeout.

Temporary offline, network, rate-limit and server failures retain saved credentials and retry. Only an explicit recognised rejection of the refresh token clears the saved session. Account identity while reconnecting does not grant Premium or server access: those still require a valid token and the existing server membership verification. The account/onboarding presentation does not ask for credentials during ordinary renewal, and can show the sign-in form after a confirmed rejection. Explicit sign-out remains signed out across reopening; an unsuccessful local sign-out reports failure instead of claiming success.

Stored-session snapshots and generation checks prevent late responses from restoring a logged-out, switched or deleting account. Raw deletion locks apply before deferred UI initialization. Unchanged membership/session notifications do not discard a valid token rotation, and cancellation of deletion reschedules a pending renewal safely. Plans, stock and entitlement settings are unchanged by the session helper. No live auth settings or user accounts were modified.

Forty-one targeted lifecycle, deletion and onboarding checks passed. Independent browser checks passed for expired-token launch renewal, document restart, offline preservation, online recovery and explicit sign-out, with zero page errors. Secondary Make a Meal renewal also passed; native-web checks additionally covered the generated Membership page. This establishes the client behavior with isolated auth responses, not a physical iPhone or live-account end-to-end result.

Combined final validation: 1,110 automated checks passed, with two skips and two TODOs and zero failures. Native web packaging and portable iOS verification passed with 878 bundled files and only the public 100 Free recipe records. App and index entry points match byte-for-byte, syntax and diff checks pass. A new signed Xcode/device build and physical iPhone close/reopen and drag checks are still required before release. The draft does not update production or TestFlight 1.0 (3).
