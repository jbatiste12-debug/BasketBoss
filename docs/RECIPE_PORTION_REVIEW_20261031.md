# Recipe portion review — 31 October 2026

## Status

This is an initial audit of the 100 public recipes in `recipes.json`, not a set of approved dietary recommendations. No recipe quantities, serving counts, shopping calculations or saved user plans were changed by this review. The earlier removal of recipe price labels remains in place.

The 221 protected Premium recipes are outside this audit: their complete ingredient records are not in the public catalogue. They need the same review through an authorised source before the full catalogue can be described as reviewed.

## Findings from the current recipes

The accompanying [ingredient audit](recipe-portion-audit-20261031.csv) covers all 730 public ingredient lines. Its per-serving amounts are simple arithmetic using each recipe's current listed serving count; they do not establish that the listed servings are appropriate.

| Creamy garlic parmesan chicken pasta, currently serves 4 | Whole recipe | Per listed serving |
| --- | --- | --- |
| Chicken breast | 500 g | 125 g |
| Penne pasta | 500 g | 125 g |
| Double cream | 300 ml | 75 ml |
| Parmesan | 1 block | Cannot calculate a weight without defining the block |

The ingredient list does not explicitly label the pasta weight as dry or cooked. Its method adds the penne to stock to simmer, which suggests a dry starting weight; make that explicit during recipe review rather than relying on an inference.

One-pan tomato basil orzo lists 400 g orzo for four servings, or 100 g per listed serving, and specifies mozzarella as `1 ball`. Several other pasta dishes list 500 g for four servings. These are priorities for checking against appropriate main-meal guidance and testing as complete dishes, not proof that every one is incorrect.

The CSV distinguishes 333 ingredient lines with an explicit leading mass or volume, 265 count/household measures, 126 lines needing quantity-wording review, and 6 optional/seasoning lines. A wording-review flag is not a nutrition verdict: it also catches understandable counts such as a six-pack of buns. Nine cheese ingredient lines use a block or ball without a gram weight. Counts such as eggs and cloves can remain counts where that is useful; cheese blocks need a defined recipe amount independently of retail pack size.

## Evidence to obtain before changing quantities

- NHS Eatwell guidance for overall balance and its scope across meals or days. A food-group portion is not automatically the right amount for every main dish.
- British Dietetic Association or British Nutrition Foundation guidance with explicit adult serving examples and clearly stated dry/raw/cooked weights.
- Suitable child guidance before introducing child serving options. Do not automatically count every household member as an adult or invent a universal child multiplier.
- Dish-specific recipe references and a cooking review for pasta, protein, vegetables, sauce and seasoning together. General guidance alone does not demonstrate that a revised recipe works.

For every benchmark, record the exact page title, URL, access date, population, weight state and whether it describes an example serving, a daily target or another measure. Do not label BasketBoss recipes "NHS approved" on the basis of using general guidance.

## Intended recipe and shopping behaviour

1. Review each recipe's ingredient amounts and base yield together. Keep a clear distinction between ordinary dinner servings, intentional double batches, desserts and side dishes.
2. Store explicit amounts needed for the dish, including grams for cheese and the dry/raw/cooked state where relevant. Do not use a shop pack as an undefined recipe quantity.
3. Scale that reviewed recipe for the selected servings. Keep portion choice adjustable rather than presenting one amount as suitable for everyone.
4. Aggregate ingredient needs across the plan, account for pantry stock, then round the remaining purchases to retail packs. Recipe use, pack purchase and remainder are different quantities.
5. Keep prices in Shop and the total budget, as agreed. Reviewing portions should improve shopping quantities without restoring dish price labels.

## Source-access blocker

The attempted NHS Eatwell page request was denied by the environment's HTTP proxy on 31 October 2026:

`https://www.nhs.uk/live-well/eat-well/food-guidelines-and-food-labels/the-eatwell-guide/`

No NHS, BDA or BNF serving recommendations have been independently retrieved or verified in this task. The network draft now adds only `www.nhs.uk`, `www.bda.uk.com` and `www.nutrition.org.uk`, preserving the package-manager preset and existing setup instructions. That draft save does not apply access or publish an environment. Source verification and proposed quantity changes remain pending access.
