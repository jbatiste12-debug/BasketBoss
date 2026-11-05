# Cook content audit — 5 November 2026

Every complete public recipe in `recipes.json` was reviewed against its ingredient names, all ordered method instructions, and the ingredient notes exposed by Cook. This is an editorial and consistency review, not kitchen testing. Baseline: `fecb5ce041e9`.

## Observed coverage and changes

- 100 current public recipes reviewed, 730 ingredient lines, and four duplicate dessert records reconciled.
- 90 methods corrected; the other ten methods retained after review. Each corrected `method` has the same ordered text in `steps`.
- 254 misleading ingredient prep notes corrected across 90 recipes. They previously included drying stock as meat, toasting breadcrumbs and bread flour at assembly, melting cold crumble butter, zesting orange juice, and treating overnight oats as batter or hot sauce. Replacements follow the actual recipe method. 98 public records have some content change; `salmon` and `pan-gnocchi-spinach` required none.
- No ingredient names, amounts, units, prices, totals, serving counts, timings, images, allergy metadata or recipe titles were changed. The normalized ingredient database was not changed. Existing numeric timings and doneness/storage advice were retained; duplicate safeguards were combined into one appropriate instruction.
- Four duplicate desserts have methods, steps and ingredient prep notes synchronized to their canonical public records; their independent price estimates are preserved.

The reported prawn problem is corrected in both `prawn-linguine` and `date-garlic-prawns`: dry prawns before cooking, reserve pasta water after pasta cooks, and give one prawn-cooking instruction with its doneness criteria. `tuscan-salmon` and `pan-teriyaki-salmon` dry the fish before searing. Slow-cooker loading now precedes the cooking phase; meatballs are formed once; tofu is pressed once; stir-fry preparation comes before frying; final citrus, herbs and assembly follow cooking. Legitimate separate phases such as brown, set aside, return and simmer remain separate.

## Verification and concrete unresolved content

The current source audit reports **0 consistency/content errors**, **15 author-review findings**, and **77 existing normalized quantity-review flags**. Missing oven settings were exposed without inventing temperatures or cooking durations. Existing pack/quantity questions remain outside this content-only correction.

| Rule | Recipe | Author decision still needed |
| --- | --- | --- |
| pack-quantity | `creamy-pasta` | Parmesan: 1 block; confirm the actual recipe amount, not just the purchased container. |
| pack-quantity | `lemon-chicken-orzo` | Chicken stock: 1 carton; confirm the actual recipe amount, not just the purchased container. |
| pack-quantity | `mushroom-risotto` | Vegetable stock: 1 carton; confirm the actual recipe amount, not just the purchased container. |
| pack-quantity | `mushroom-risotto` | Parmesan: 1 block; confirm the actual recipe amount, not just the purchased container. |
| pack-quantity | `sweet-potato-soup` | Vegetable stock: 1 carton; confirm the actual recipe amount, not just the purchased container. |
| stuffing-shell-size | `spinach-ricotta-shells` | Method fills shells, but the ingredient does not specify large stuffing shells. Confirm intended shape without changing quantities. |
| pack-quantity | `sausage-lentil-stew` | Stock: 1 carton; confirm the actual recipe amount, not just the purchased container. |
| pack-quantity | `chicken-noodle-soup` | Stock: 1 carton; confirm the actual recipe amount, not just the purchased container. |
| cooking-settings | `chicken-katsu-curry` | The baking option supplies no oven temperature. An author-tested setting is needed; no temperature or cooking duration has been invented. |
| pack-quantity | `aubergine-parmigiana` | Parmesan: 1 block; confirm the actual recipe amount, not just the purchased container. |
| cooking-settings | `miso-salmon-rice` | The baking option supplies no oven temperature. An author-tested setting is needed; no temperature or cooking duration has been invented. |
| cooking-settings | `family-chicken-wraps` | The baking option supplies no oven temperature. An author-tested setting is needed; no temperature or cooking duration has been invented. |
| title-time | `extra-15-minute-pesto-tortellini` | Title says 15-minute; recorded total is 20 minutes. |
| pack-quantity | `extra-lentil-shepherdless-pie` | Vegetable stock: 1 standard pack (check recipe); confirm the actual recipe amount, not just the purchased container. |
| sequential-timing | `extra-lentil-shepherdless-pie` | 35 minutes does not allow preparation, dried-lentil cooking and the stated 15–20-minute potato boil followed by a 20–25-minute bake. Re-time with the author; no replacement total has been invented. |

The audit now screens exact duplicate steps/sentences, explicit initial prep after cooking, drying advice appended after searing, reserving cooking water before pasta cooks, unlisted cornflour, grated-parsley boilerplate, cooked-fish searing advice, one-pot pasta water, ingredient-note mismatches, and dessert source drift. These narrow rules support manual review; they do not claim to detect every culinary issue.

Verified with `node scripts/audit-recipe-instructions.mjs` and 35 passing focused tests across the instruction audit, private export loader and private audit CI. Regressions cover the reported prawn/salmon order, retained rice-storage guidance, false cooking-water chronology, duplicate actions, contradictory prep notes, separate cooking phases, and private summary redaction. A structured comparison against the baseline confirmed that public source fields outside `method`, `steps` and `culinary_prep_notes` are unchanged.

## Protected catalogue limitation

The 500 primary image IDs and WebP signatures are present. This document is the detailed ledger for the **100 public recipes**. The current protected 400 records were subsequently read through the trusted-main, dedicated-token D1 audit at commit `c72cfe3f1c5be7f6df7a99705dfdafef12790c35` (run `42075016412`), with source rows hash `61733dd3cbb63f56dabad75572b54739c8fd39edf90bea0e468e24db3be2be68`. Their complete editorial review and encrypted release are tracked separately in the full 500-recipe audit record.

Private plaintext stays outside the checkout under restricted permissions. The temporary encrypted snapshot transport was removed after verified retrieval; recurring CI retains only aggregate normalization counts. No protected recipe content is included in this public ledger.

## Complete public review ledger

“Prep notes” counts corrected ingredient notes, independently of whether the method needed a change.

| Recipe ID | Method disposition | Prep notes | Concrete method correction |
| --- | --- | ---: | --- |
| `fajitas` | Corrected | 1 | Move tray spacing before roasting; retain the chicken check once. |
| `chicken-burgers` | Corrected | 3 | Combine crust/doneness wording; garlic belongs in the mayonnaise. |
| `creamy-pasta` | Corrected | 2 | Remove nonexistent separate pasta water from the one-pot stock method. |
| `sausage-gnocchi` | Reviewed; retained | 1 | No clear method defect found in this content review. |
| `pulled-pork` | Corrected | 0 | Load the cooker once; cook before shredding; reduce sauce once. |
| `beef-chilli` | Corrected | 2 | Consolidate rice measurement and mince checks; finish lime before serving. |
| `stir-fry` | Corrected | 2 | Prepare ginger/noodles first; fry chicken once; add lime after sauces heat. |
| `salmon` | Reviewed; retained | 0 | No clear method defect found in this content review. |
| `steak` | Corrected | 1 | Prepare butter/garlic before cooking but baste after searing; rest once. |
| `tuscan-salmon` | Corrected | 0 | Dry fish before searing; remove repeated searing advice; finish after simmering. |
| `traybake-sausage` | Corrected | 0 | Cut and arrange vegetables once; consolidate sausage checks. |
| `chickpea-curry` | Corrected | 2 | Bloom ginger/spices before liquids; consolidate final texture checks. |
| `fishcakes` | Corrected | 3 | Remove raw-fish searing advice from cooked-salmon fishcakes; retain storage advice. |
| `pesto-gnocchi` | Corrected | 0 | Prepare garlic/tomatoes once; reserve water before draining; toss once. |
| `tomato-mozzarella-pasta` | Corrected | 0 | Reserve cooking water before draining for the later sauce. |
| `lemon-chicken-orzo` | Corrected | 2 | Remove premature spoon-coating sauce advice; retain chicken safeguard once. |
| `beef-meatballs` | Corrected | 2 | Form meatballs once; consolidate repeated mince doneness checks. |
| `veggie-fried-rice` | Corrected | 2 | Prepare before heating; scramble/fry/return in order; retain rice storage limits. |
| `lentil-bolognese` | Corrected | 2 | Remove premature aromatic/sauce finish; keep lentil tenderness and sauce checks. |
| `crispy-fish-tacos` | Corrected | 4 | Cut/coat fish once; remove unrelated simmered-filling advice. |
| `mushroom-risotto` | Corrected | 2 | Cook garlic before rice/stock; remove sauce-finishing before liquid. |
| `honey-garlic-tofu` | Corrected | 2 | Press/cube tofu once; glaze before off-heat lime and assembly. |
| `chicken-pesto-wraps` | Corrected | 3 | Remove unrelated aromatic sauce advice; check chicken before slicing. |
| `sweet-potato-soup` | Corrected | 2 | Check softness before blending; add lemon before serving. |
| `prawn-linguine` | Corrected | 0 | Dry prawns before cooking; cook pasta before reserving water; state prawn doneness once. |
| `turkey-chilli` | Corrected | 3 | Use mince-specific doneness wording once; lime follows cooking. |
| `halloumi-grain-bowls` | Corrected | 3 | Slice/sear halloumi once; dress fresh vegetables at assembly. |
| `bbq-chicken-pizza` | Corrected | 1 | Consolidate bake checks; mix vinegar into sauce before assembly. |
| `breakfast-shakshuka` | Corrected | 1 | Reduce sauce after cooking vegetables; crack eggs when wells are ready. |
| `banana-oat-pancakes` | Corrected | 4 | Mash once; combine the flip/centre-doneness directions. |
| `baked-potato-beans` | Corrected | 1 | Prick/split potatoes once; add paprika while beans heat. |
| `greek-chicken-tray` | Corrected | 0 | Remove salad-dressing advice from roasting; retain one chicken safeguard. |
| `teriyaki-beef-noodles` | Corrected | 1 | Prepare before heating; sear beef once; ginger before sauce; lime last. |
| `spinach-ricotta-shells` | Corrected | 1 | Explicitly wilt/squeeze spinach before mixing the filling. |
| `coconut-lentil-dhal` | Corrected | 2 | Bloom spices before adding liquid; remove repeated sauce reduction advice. |
| `roast-veg-couscous` | Corrected | 4 | Chop once; remove fresh-salad advice from vegetables being roasted. |
| `pork-apple-tray` | Corrected | 1 | Cut before roasting; coat chops once; consolidate safety/resting. |
| `sausage-lentil-stew` | Corrected | 2 | Prepare vegetables before cooking; chop parsley; remove premature sauce finish. |
| `chicken-noodle-soup` | Corrected | 2 | Ginger before stock; cook raw chicken before noodles; consolidate safeguards. |
| `baked-feta-orzo` | Corrected | 1 | Remove unrelated aromatic sauce advice from boiling orzo. |
| `chicken-katsu-curry` | Corrected | 5 | Flatten/coat once; ginger belongs in the sauce; retain chicken check. |
| `loaded-nachos` | Corrected | 2 | Remove roasting-space advice from prep; add cold toppings after baking. |
| `broccoli-cheddar-soup` | Corrected | 2 | Chop parsley; remove repeated simmer/soften advice; keep cheese on low heat. |
| `tuna-sweetcorn-pasta` | Corrected | 3 | Reserve water after pasta cooks; remove sauce-tossing from initial prep. |
| `aubergine-parmigiana` | Corrected | 0 | Prepare before roasting/layering; cook garlic sauce once; rest once. |
| `pesto-salmon-potatoes` | Reviewed; retained | 1 | No clear method defect found in this content review. |
| `chorizo-chickpea-stew` | Corrected | 2 | Slice once; soften onion before garlic/spices; remove premature stew finish. |
| `miso-salmon-rice` | Corrected | 1 | Prepare glaze before baking; final glaze brushing occurs during cooking. |
| `falafel-pitas` | Corrected | 4 | Prepare salad/dressing once; remove unlisted tahini alternative. |
| `slow-beef-stew` | Corrected | 1 | Dry/cut before browning; slow-cook after loading; remove unlisted cornflour. |
| `slow-chicken-curry` | Corrected | 5 | Load once; put final spinach timing inside the slow-cooking phase. |
| `slow-lamb-tagine` | Corrected | 3 | Brown before transfer/slow-cook; chop parsley rather than grating it. |
| `slow-bolognese` | Corrected | 5 | Consolidate browning/loading; chop parsley rather than grating it. |
| `slow-honey-chicken` | Corrected | 5 | Mix/load/cook/reduce once; remove unlisted cornflour suggestion. |
| `slow-veggie-chilli` | Corrected | 4 | Prepare before loading; remove unlisted lime/chilli advice. |
| `date-garlic-prawns` | Corrected | 3 | Dry before cooking; reserve pasta water after cooking; state prawn doneness once. |
| `date-duck-orange` | Corrected | 3 | Score/start cold once; make mash before serving; make glaze once. |
| `date-pesto-gnocchi` | Corrected | 3 | Combine repeated warming, water-loosening and burrata assembly advice. |
| `date-lemon-chicken` | Corrected | 3 | Flatten/sear once; consolidate doneness before returning to sauce. |
| `date-stuffed-peppers` | Corrected | 6 | Heat oven first; consolidate filling, spacing and baking. |
| `pan-lemon-chicken` | Corrected | 4 | Consolidate preparation, final juices and resting; retain one safety check. |
| `pan-sausage-rice` | Corrected | 3 | Slice before browning; consolidate rice cooking and final checks. |
| `pan-tomato-orzo` | Corrected | 3 | Remove premature spoon-coating sauce finish before adding liquid. |
| `pan-teriyaki-salmon` | Corrected | 3 | Dry before searing; finish cooking salmon before final sesame oil/serving. |
| `pan-gnocchi-spinach` | Reviewed; retained | 0 | No clear method defect found in this content review. |
| `pan-fajita-rice` | Corrected | 3 | Cut chicken before browning; off-heat lime follows final cooking. |
| `family-chicken-wraps` | Corrected | 4 | Keep chicken safeguard once; remove nonexistent stated cooking time advice. |
| `family-sweet-sour` | Corrected | 2 | Prepare ginger before cooking; remove bottled-sauce mixing advice. |
| `extra-air-fryer-crispy-chicken-tenders` | Corrected | 4 | Prepare chicken/egg before coating; cook once. |
| `extra-air-fryer-salmon-bites` | Corrected | 4 | Cube before coating; combine glaze/sesame oil/serving. |
| `extra-air-fryer-garlic-parmesan-potatoes` | Corrected | 2 | Complete final Parmesan cooking before lemon/parsley finish. |
| `extra-air-fryer-turkey-meatballs` | Corrected | 4 | Consolidate forming/spacing; retain timings and meat checks. |
| `extra-15-minute-pesto-tortellini` | Corrected | 1 | Cook before reserving water; reserve once; finish Parmesan once. |
| `extra-speedy-beef-udon-noodles` | Corrected | 2 | Ginger joins garlic before noodles; lime follows final heating. |
| `extra-creamy-lemon-tuna-pasta` | Corrected | 1 | Cook before reserving water; add tuna once; lemon gradually. |
| `extra-garlic-chickpea-flatbreads` | Reviewed; retained | 3 | No clear method defect found in this content review. |
| `extra-lentil-shepherdless-pie` | Corrected | 4 | Remove tray-spacing advice applied to a topped pie. |
| `extra-tomato-butter-bean-stew` | Corrected | 2 | Chop parsley before cooking; remove repeated sauce-phase advice. |
| `extra-greek-chicken-protein-bowls` | Corrected | 3 | Remove unlisted-herb advice; consolidate assembly/lemon finish. |
| `extra-turkey-chilli-quinoa-bowls` | Corrected | 2 | Cook onion before blooming spices; use mince-specific check once. |
| `extra-cottage-cheese-egg-muffins` | Reviewed; retained | 4 | No clear method defect found in this content review. |
| `extra-seared-tuna-edamame-bowls` | Corrected | 2 | Cook edamame once; dry tuna before searing; assemble after resting. |
| `extra-herb-roast-chicken-dinner` | Corrected | 2 | Consolidate preparation; retain weight guidance and safety checks. |
| `extra-mustard-roast-beef-with-veg` | Corrected | 1 | Consolidate joint preparation, seasoning, roasting and resting. |
| `extra-maple-glazed-gammon-roast` | Corrected | 2 | Time vegetables before serving; retain cured-colour warning. |
| `extra-rosemary-roast-lamb-shoulder` | Corrected | 5 | Prepare potatoes before lamb finishes; roast during final phase/rest. |
| `extra-sticky-orange-chicken` | Corrected | 4 | Cook rice alongside; retain chicken safeguard once. |
| `extra-korean-beef-bulgogi-bowls` | Corrected | 4 | Remove repeated searing advice; retain bubbling marinade/cooked-through check. |
| `extra-blueberry-overnight-oats` | Reviewed; retained | 4 | No clear method defect found in this content review. |
| `extra-smoked-salmon-scrambled-eggs` | Reviewed; retained | 1 | No clear method defect found in this content review. |
| `extra-spinach-feta-breakfast-wraps` | Corrected | 1 | Beat/cook eggs before parsley; remove spinach searing and repeated assembly. |
| `extra-apple-cinnamon-baked-oats` | Reviewed; retained | 5 | No clear method defect found in this content review. |
| `dessert-chocolate-brownies` | Corrected | 2 | Merge duplicate flour-folding advice. |
| `dessert-sticky-toffee-pudding` | Corrected | 6 | Merge duplicate flour-folding advice. |
| `dessert-lemon-drizzle-cake` | Corrected | 4 | Merge duplicate flour-folding advice. |
| `dessert-apple-crumble` | Reviewed; retained | 6 | No clear method defect found in this content review. |
| `family-chocolate-chip-banana-traybake` | Corrected | 4 | Merge duplicate flour-folding advice. |
| `family-apple-cinnamon-crumble-muffins` | Corrected | 6 | Move gentle-folding advice to combining wet and dry ingredients. |
| `baking-classic-banana-bread` | Corrected | 3 | Merge duplicate flour-folding advice. |
| `baking-soft-cinnamon-rolls` | Corrected | 8 | Remove repeated advance kneading/rising instruction. |
