# Current 500-recipe catalogue audit — 2 November 2026

All **500 current recipes** received a full ingredient/method source review: the 100 public records and the 400 current Premium records read from the versioned production D1 table. The review covered **4,227 ingredient lines**. Historical records were used only for provenance and were not substituted for the current Premium source.

This is a source consistency and usability review, not a kitchen test or a safety/allergen certification. Apparent timing, pack-size, normalization and equipment-capacity questions that need author judgement remain explicit follow-ups.

## Results and disposition

| Area | Reviewed result | Disposition |
| --- | --- | --- |
| Public recipe methods | 100 reviewed; 39 records corrected in the initial pass | Changes are in `recipes.json`; four duplicate dessert records were aligned with their canonical public records. |
| Current Premium methods | 400 reviewed; 376 method/steps refinements proposed; 15 pass without change and 9 require author review without a method patch | Prepared in a separate encrypted correction bundle. Many refinements address serving-dependent wording, sequencing or repeated generic prose; this is not a claim that 376 recipes were unsafe. |
| Automated instruction consistency checks | Current Premium source: 10 rule findings; corrected candidate: 0 | All known rule findings are resolved in the candidate; an automatic pass does not replace the full-read review. |
| Canonical quantities and metadata | All 400 IDs/order, ingredients, servings, numeric times, prices and other fields preserved | Normalized ingredient JSON remains byte-for-byte unchanged. Only `method` and `steps` change in the Premium candidate, and they remain identical. |
| Remaining private author follow-ups | 215 entries affecting 187 recipes | Includes practical timing/batch checks, ambiguous pack or conversion bases, preparation-note scaling, capacity and metadata questions. These are review flags, not 215 established defects. |
| Remaining public author follow-ups | 12 source-review findings from the initial pass | Retained with the public audit report. |
| Images | All 500 primary photos decoded and visually inspected | Five problem photographs replaced and eight swapped assignments corrected, improving 13 recipe presentations. |

The listed catalogue totals put 387 of 500 recipes at one hour or less. That is a statement about the recorded estimates; timing follow-ups below still require checking. Everyday Favourites remains the largest editorial collection, and the existing weekly auto-fill policy limits Try the World dishes to occasional inclusion, at most one.

## Types of corrections

- Removed copied flour, glaze, roasting, kneading or aromatic/sauce directions that did not belong to the dish or its listed ingredients.
- Put preparation, cooking, reserved clean ingredients, assembly and finishing steps in their actual order, including ingredients that had been listed but never used.
- Preserved cooking temperatures, time estimates and food checks while making doneness and leftover reheating directions clearer where the source process required it.
- Replaced fixed base-serving ingredient allocations and bowl/bun/crepe counts with proportional preparation and serving instructions, so the method follows the servings selected in Cook.
- Kept conversational half/third/quarter allocations. Unnecessarily awkward proportions were rephrased; precision-critical baking allocations remain flagged for author handling.

Two app-level issues were also corrected: complete current recipe methods are now authoritative rather than having generic sentences appended at display time, and Cook ingredient counts can show usable fractions instead of rounding them to whole purchases. Shopping pack calculations remain separate, and legacy callers retain the existing whole-item rounding option.

## Important remaining author checks

Examples with concrete source evidence include:

- `family-beef-mince-and-potato-hotpot`: its stated 60 minutes is shorter than its explicit sequential cooking phases even before preparation and browning.
- `extra-roasted-vegetable-quinoa-bake`: the oven setting is missing; none was invented in the method correction.
- `baking-chocolate-orange-marble-loaf`: an explicit parenthetical baking-powder gram amount conflicts with an inferred normalized conversion.
- `fennel-rice-stuffed-squid`: squid tube size and capacity need checking against the stated stuffing quantity.
- `vanilla-creme-brulee`: cooling/chilling allowances and ramekin fill capacity need a practical check.
- `raspberry-vanilla-baked-alaska`: freezing assumptions, vessel size and embedded base-serving egg/sugar allocations need author confirmation.

The complete private follow-up list is retained with the encrypted candidate rather than publishing protected recipe instructions or ingredient lists. The pre-existing normalized `needs_review` flags are also retained; they were not silently treated as verified measurements.

## Source and release boundaries

The read-only connection succeeded in [GitHub Actions run 41507583952](https://github.com/jbatiste12-debug/BasketBoss/actions/runs/41507583952), attempt 1, at commit `27e4086ad254b174bd3a9b8ab494d30e3c3f6a69`. It read exactly 400 current Premium rows and 3,497 ingredient lines. The downloaded encrypted snapshot was authenticated and its repository, branch, commit, run and attempt were checked before opening it privately.

- Original current Premium rows SHA-256: `61733dd3cbb63f56dabad75572b54739c8fd39edf90bea0e468e24db3be2be68`.
- Corrected candidate rows SHA-256: `da464fbc6607c77cd2569052876c0a5cc3c622383dfbaa0bf35cb7a083c7f684`.
- Public correction metadata: `.github/private-catalogue/recipes-500-audit-corrections.manifest.json`.
- Protected correction bundle: `.github/private-catalogue/recipes-500-audit-corrections.sealed.json`.

The new bundle is separate from the existing activation bundle. It is encrypted to the existing catalogue deployment recipient, uses original-row hash guards, and does **not** trigger activation. Plaintext snapshots, method proposals and review notes remain outside the public checkout. No production database row was changed by this audit.

See [the photo audit](RECIPE_PHOTO_AUDIT_20261102.md), [the initial public instruction pass](RECIPE_INSTRUCTION_AUDIT_20261102.md), and `scripts/prepare-private-recipe-corrections.mjs` for the checked offline preparation path.
