# Family dinner catalogue direction — 2 November 2026

## User direction and release boundary

The user wants variety within a practical UK/US family dinner catalogue: a clear majority of familiar British, Irish, Scottish and popular American meals, most ready within 60 minutes, with international discovery and special meals clearly labelled. Familiar dishes such as pasta, pizza, fajitas and mild curry can remain everyday choices; the group is an editorial household-use category, not a claim of national origin.

This is a proposed next update. The current production release and TestFlight 1.0 (3) stay unchanged until the update is reviewed. No live recipe table, subscription entitlement, ingredient quantity, serving scale, existing recipe ID or saved plan is changed here.

## Working targets for the review

Use approximately 70% familiar everyday dinners, 20% Try the World, and 10% Special Occasion as an editorial target, not a verified statement about the current catalogue. Count dinners separately from desserts, breakfast, baking, snacks and sides. Roasts and slow-cooker meals remain available as familiar options with a Weekend & Slow Cooking label.

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

Discover adds Everyday Favourites, Try the World, Special Occasion, 60 Minutes or Less, Weekend & Slow Cooking, and Sides. Editorial labels remain visible alongside saved personal collections. They do not unlock Premium content or certify method quality. Existing automatic rotation and its full-pool/history contract are retained: this change does not claim to rebalance the automatic planner or the underlying catalogue.

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
