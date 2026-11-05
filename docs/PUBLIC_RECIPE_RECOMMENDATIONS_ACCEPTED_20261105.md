# Accepted public recipe recommendations — 5 November 2026

The user authorized culinary recommendations and their acceptance for the author-review findings. This change resolves the 15 public findings affecting 13 recipes. Quantities, temperatures and timings below are editorial recommendations based on the ingredients and cooking sequence; they have not been kitchen tested. Total times are estimates and depend on preparation speed, ingredient size, packet instructions and equipment. The remaining 87 public recipe records are unchanged.

All 13 recipes continue to serve four. Stable recipe IDs, ingredient names, shopping keys, dietary metadata and allergen guidance are preserved. Ingredient amounts remain in the scalable ingredient lists and normalized records. Methods use those listed amounts, proportions or per-piece dimensions so a different household serving count does not inherit a fixed four-person stock or cheese amount.

| Recipe | Accepted recommendation and reason | Estimated total |
| --- | --- | --- |
| Creamy garlic parmesan chicken pasta | Replace “1 block” Parmesan with 80 g, finely grated and stirred in off the heat. Specify even chicken pieces, gradual water additions during the one-pot pasta stage and a measurable chicken completion check. | 30 min |
| Lemon chicken orzo | Replace “1 carton” chicken stock with 1200 ml, sufficient to cook the listed 500 g dry orzo. Start the chicken with a splash of the measured stock in a non-stick pan, then add the rest; this assigns a workable method without introducing unlisted frying oil. | 30 min |
| Creamy mushroom risotto | Replace the stock carton with 1000 ml vegetable stock and the Parmesan block with 60 g. Add warm stock gradually, using water only if the rice needs more liquid; stir cheese in off the heat. These resolve two findings. | 35 min |
| Roasted sweet potato soup | Specify 1000 ml vegetable stock, 2 cm vegetable pieces and roasting at 200°C / 180°C fan for 25–30 minutes before a brief stock simmer and blending. Allow preparation and blending time. | 50 min |
| Spinach ricotta pasta bake | Specify 250 g large stuffing shells (conchiglioni), keeping the ingredient name “Pasta shells” and its existing shopping key. This supplies a practical amount of large shells for the listed ricotta and squeezed spinach. Cook slightly short of packet time, fill, and bake at 190°C / 170°C fan for about 20 minutes. | 45 min |
| Sausage & lentil stew | Replace the stock carton with 1000 ml. Use rendered sausage fat and a splash of stock to soften vegetables, then simmer the dried lentils until fully tender, normally 25–30 minutes. Include preparation and browning in the total. | 50 min |
| Chicken noodle soup | Specify 1500 ml prepared stock to accommodate the dry noodles and vegetables. Define the listed chicken as boneless 2 cm pieces and the celery as 300 g, replacing its undefined bunch while retaining the former normalized 300 g amount. Soften vegetables in some of the measured stock, then poach chicken and cook noodles. | 30 min |
| Chicken katsu-style curry | Use a single oven route at 200°C / 180°C fan for 20–25 minutes with chicken flattened to about 1.5 cm. The existing ingredients contain no shallow-frying oil. Cook the sauce and rice in parallel and discard coating ingredients that touched raw chicken. | 40 min |
| Aubergine parmigiana | Replace the Parmesan block with 50 g. Roast 1 cm aubergine rounds at 220°C / 200°C fan until soft, then assemble and bake at 190°C / 170°C fan for 15–20 minutes. Include the initial roast and resting time. | 55 min |
| Miso-glazed salmon rice bowls | Define baking at 200°C / 180°C fan for about 12–15 minutes, depending on fillet thickness, until opaque, cooked through and flaking in the thickest part. Reserve clean glaze before touching raw fish; cook rice and broccoli in parallel. | 25 min |
| Crispy chicken Caesar wraps | Bake 1.5 cm strips at 200°C / 180°C fan for 18–20 minutes. Allocate a quarter of the existing dressing to bind crumbs and reserve three quarters for the salad, with separate raw-chicken utensils. Existing dressing and allergen guidance are retained. | 30 min |
| 20-minute pesto tortellini | Rename the former “15-minute” title to match its existing 20-minute total. Keep the stable `extra-15-minute-pesto-tortellini` ID, ingredients and method. | 20 min |
| Lentil shepherdless pie | Replace the unspecified stock pack with 600 ml. Simmer dried lentils until fully tender, boil and mash potatoes alongside, then bake the assembled hot pie at 200°C / 180°C fan for about 20 minutes. Replace the implausible 35-minute total with approximately 65 minutes; older lentils can take longer. These resolve two findings. | 65 min |

Chicken and sausage methods use a thickest-part thermometer check of 75°C held for 30 seconds, with additional cooking if needed. Salmon has a fully cooked visual endpoint. The temperatures and cooking windows are recommendations, not claims that these particular recipes have passed a kitchen test.

## Indicative cost calculations

Only catalogue estimates change. No saved user prices, pantry quantities or shopping preferences are written. A former undefined block or carton has no reliable conversion rate, so explicit existing catalogue quantities provide a proportional rate instead:

| Ingredient use | Existing comparator | Proportional catalogue estimate |
| --- | --- | --- |
| Parmesan, creamy pasta | Tortellini: 50 g for £1.47; normalized hint £1.25 | 80 g: £2.35; normalized hint £2.00 |
| Parmesan, risotto | Same 50 g comparator | 60 g: £1.76; normalized hint £1.50 |
| Parmesan, parmigiana | Same 50 g comparator | 50 g: £1.47; normalized hint £1.25 |
| Chicken stock, orzo | Creamy pasta: 600 ml for £0.83; normalized hint £0.70 | 1200 ml: £1.66; normalized hint £1.40 |
| Vegetable stock, risotto and sweet potato soup | Tomato orzo: 500 ml for £0.59; normalized hint £0.50 | Each 1000 ml: £1.18; normalized hint £1.00 |
| Generic stock, sausage stew | The same prepared vegetable-stock comparator, used as a pricing proxy | 1000 ml: £1.18; normalized hint £1.00 |
| Generic stock, chicken noodle soup | The prepared chicken-stock comparator, used as a pricing proxy | 1500 ml: £2.08; normalized hint £1.75 |
| Vegetable stock, lentil pie | Tomato orzo prepared-stock comparator | 600 ml: £0.71; normalized hint £0.60 |
| Large pasta shells | Existing shell line: 500 g for £1.77; normalized hint £1.50 | 250 g: £0.89; normalized hint £0.75 |

Every accepted recipe's `cost` is the sum of its ingredient estimates, rounded to pennies. Existing regional CI estimate/range fields are adjusted proportionally by the new ingredient-cost subtotal divided by the previous ingredient-cost subtotal, preserving each recipe's own regional relationships. Per-serving fields are recalculated. Historical source-base fields are preserved. These remain unverified indicative prices; the prepared-stock and specialty-shell comparators are not retailer quotes.

The nine formerly ambiguous stock/Parmesan lines, the explicit celery amount and the large-shell amount have source-aligned normalized units and cleared ambiguity flags. Unrelated normalized-review flags remain visible. No dessert copy is affected.

## Verification

The source audit reports 100 public recipes, 730 ingredient lines, four consistent dessert copies, zero consistency errors and zero public author-review findings. Regression fixtures still reject undefined packs, absent oven settings, a 35-minute dried-lentil pie, title/time mismatches and unspecified stuffing-shell sizes.

Focused tests exercise the new quantities through the actual shopping and pantry functions for both app entry points in UK and US markets. Three Parmesan uses combine to 150 g; 100 g pantry stock leaves 50 g to buy. Two generic stock uses combine to 1750 ml; 500 ml pantry stock leaves 1250 ml to buy. A half recipe of large shells needs 125 g under the existing key; 100 g pantry stock leaves 25 g. These calculations run before whole-pack purchasing and leave saved pantry data unchanged.

This document covers the public source changes. Protected recipe recommendations and any publication/import verification are recorded separately.
