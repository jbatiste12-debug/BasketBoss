# Build 6 tester feedback

Prepared on the existing build 6 candidate; not merged, deployed or uploaded to TestFlight.

- **Garlic in Basket:** legacy `each` quantities become cloves or bulbs only when the recipe explicitly establishes that unit. Clove requirements combine before purchase rounding, with all source days retained and one shared pack charge. Bulbs remain separate; an unavailable bulb quote stays unavailable. Historical stock is never guessed or converted between bulbs and cloves.
- **At home reconciliation:** new selections use the planned unit. Selecting a name alone preserves an unknown amount and clearly explains that it has not reduced To buy. The explicit **Enough for this week** action records the displayed amount; whole-item buttons state the whole quantity being declared. Partial stock leaves only the difference to buy. Existing measured stock is preserved and repeated confirmation does not add it twice.
- **Cook navigation:** Prep and Cook are usable stage controls. **Ingredients & prep** opens the checklist from any cooking step; **Continue cooking** returns to the same step. Ingredient/tool ticks and the timer survive the round trip. Only finishing the recipe opens the existing pantry-deduction review, and context changes still cancel stale mentor replies.
- **Saved weeks:** Plan now exposes named full-week snapshots, such as **Week 1**, including days, servings, desserts, school lunches and custom notes. Using a saved week requires confirmation before replacement. The existing recipe-only saved selections remain available. Stock, prices, account credentials and cooking receipts are not copied into a saved week. Restoring uses one guarded plan/lunch/note/shopping transaction, preserves stock and receipt history, and archives old shopping marks. Failed or superseded writes retain newer data from other tabs.

The visible flow is **Plan → At home → Shop/Basket**. Saved weeks remain local to the current account on this device; loading a template does not replenish stock or import old purchase checkmarks.

## Verification

- 115 focused navigation, pantry, garlic, named-week, voice, Evening Pivot and landing-pricing checks passed.
- Complete portable suite: 1,471 tests; 1,461 passed, five existing failures, three skips and two existing TODOs. The same five failures were independently reproduced on the unmodified build 5 baseline: four viewport fixtures fail in the combined suite, and one onboarding assertion expects an obsolete asset version. No new full-suite failure remains.
- Native packaging and portable iOS verification passed: 896 public files, exactly 100 Free recipes, no private catalogue bundle.
- Actual local Chromium checks passed at 390 px and 768 px: visible named-week save/restore, retained day servings, Cook → Prep → same step, Honey/Lettuce explicit stock declarations and zero remaining need, one Garlic clove requirement, and no page errors. These used fictional local plans with external requests blocked; they do not prove online sync, iPhone speech or TestFlight behavior.

Apple hosted verification, signing/upload and physical-iPhone checks remain required. The current hosted workflow can be manually run on `fix/cook-mentor-reply-failure`; this environment cannot start it through its blocked CLI GitHub API, and the connected GitHub tool does not expose workflow dispatch.
