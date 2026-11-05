# BasketBoss 1.0 (22) — contained Foods to avoid picker

Foods to avoid now opens a real modal with one scrollable list and stationary search, close and Done controls. The background meal plan stays at its saved position and is restored on close. Opening the picker does not focus search or summon the keyboard. The panel fits the visual viewport during explicit search entry. Ingredient choices, matching, saved preferences, existing meals and Premium access rules are unchanged.

Build 22 retains Build 21: tapping a meal opens it; only double-tapping its day badge requests guarded all-day completion. Portion/remove controls do not trigger completion. The hold-to-move dinner gesture remains available.

Verification: the complete local suite passed with 2,552 passing tests, zero failures, one platform skip and two existing TODOs. Browser checks at 320px, 375px and 768px verified one picker scroller, stable background at both scroll limits, explicit search focus, simulated keyboard viewport fitting, close/Escape/backdrop, saved choices, and a real planner rerender while the dialog remained modal. These browser keyboard checks simulate viewport changes rather than an iPhone software keyboard. The existing 12 day-gesture cases passed, including badge-only scope, card/control exclusion and long-press movement. Native packaging remains 935 files, 100 public recipes and no protected recipe bundle. Portable iOS verification passed; signing/upload require a Mac.

Discover starts with its search and category controls. The duplicate “Swipe your way to dinner” banner and repeated recipe-count badge have been removed. Swipe browsing and access rules are unchanged.

## Build on your Mac

```bash
bb_release_dir="$(mktemp -d "$HOME/BasketBoss-build22-XXXXXX")" &&
git -c http.version=HTTP/1.1 clone --depth 1 --branch testflight-build22-foods-picker \
  https://github.com/jbatiste12-debug/BasketBoss.git "$bb_release_dir" &&
cd "$bb_release_dir" &&
npm ci &&
npm run ios:sync &&
open ios/App/App.xcworkspace
```

Confirm Version 1.0 / Build 22, team Jason Batiste (J25UTUATD2), bundle `uk.co.basketboss.app`. Choose Any iOS Device (arm64), then Product → Archive → Distribute App → App Store Connect → Upload. If 22 has already been uploaded, use the next unused build number. Signing and the Apple upload require your Mac.
