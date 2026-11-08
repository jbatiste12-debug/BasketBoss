# Explicit 1.0.2 catalogue-700 native web build

`tools/catalogue700/build-client.mjs` prepares an isolated future client. It does not change `app.html`, `index.html`, the current native builder, either legacy Premium response, the existing price engine's aliases, or any production configuration. It does not import SQL, enable the new API, archive, upload or submit to Apple.

The input release must contain all 200 new images and a complete reviewed public catalogue:

- `manifest.json`: `schemaVersion:1`, `clientVersion:"1.0.2"`, the snake-case fields from `catalogue700Metadata()`, and 200 new-recipe metadata objects in `recipes`, each with `id`, `catalogueNumber`, `name`, canonical `image` and `sha256`.
- `free.recipes.json`: the exact 200 Free recipe array, beginning with the unchanged original 100.
- `free.normalized.json`: `{recipes:[...]}` containing the corresponding 200 positional normalizations.
- `planning-roles.json`: the exact 500 legacy IDs plus all 200 reviewed new roles.
- `pack-additions.json`: `{schemaVersion:1,ingredients:{...}}`, containing only new canonical exact food/unit pairs and honest indicative prices.
- `assets/`: the 200 new 1448 × 1086 WebPs under their existing canonical slug paths.

Run from the checkout, using an empty output directory outside it:

```sh
node tools/catalogue700/build-client.mjs \
  --source-root "$PWD" \
  --public-release "$PWD/catalogues/700/release" \
  --output-dir /tmp/basketboss-catalogue700-native
```

When `--source-root` is the normal checkout, the existing builder first prepares and verifies its unchanged 100-Free native bundle. When it is an existing verified native directory, that directory is used directly. The 700 tool then copies into a separate staging directory and modifies only that generated copy. An incomplete release, changed original Free prefix, wrong hash, unknown role, missing image, overlapping/nonempty output directory or stale transformation anchor stops the build.

The result contains exactly 200 Free recipes and no Premium recipe payload. Its loader requests only `/api/recipes/v700/premium?catalogue=700`, accepts exactly 500 matching Premium records, checks the version/release/Free hashes and all ordered IDs and normalization positions, and retains the existing account, token, delayed-response and logout guards. A tested portable SHA-256 fallback supports native WebViews without SubtleCrypto; a hash mismatch still denies private hydration while keeping Free usable. This public-data digest never replaces server/Apple entitlement or signature verification. Existing clients remain on their own 221/400 endpoints and exact counts.

The generated internal planning predicate, metadata function and Auto-Fill rotation all use the reviewed 700 roles. Every legacy ID delegates to the original predicate. The generated family/manual-batch category helper also consults those roles for the 200 new identities, so a new starter cannot enter a dinner-only path. Breakfast and other non-dinner roles remain excluded; the explicit savoury duck and Southern chicken-and-waffles dinners work without broad pancake/waffle exceptions.

Users' personal recipes remain supported: the existing local personal-recipe load point explicitly registers each loaded object, and that exact object keeps the original dinner predicate. A prefix or copied ID alone cannot register another object, and the API loader still rejects every ID outside its complete pinned official release. The official 700 count excludes these additional personal recipes. Neither meal roles nor personal registration grant Premium access.

Only the generated pricing script receives the new exact-pair guide overlay; the source engine, aliases and conversion rules remain unchanged. The generated native asset/query stamps and complete file inventory are recalculated. `verify700Client()` checks the resulting files, hashes, public payload, role binding and 200 materialized images.

**Archive staging must deliberately use this output.** On the Mac, use the dedicated wrapper instead of running ordinary sync afterward:

```sh
BB700_OUTPUT=$(mktemp -d /tmp/basketboss-catalogue700.XXXXXX)
node tools/catalogue700/sync-ios.mjs \
  --source-root "$PWD" \
  --public-release "$PWD/catalogues/700/release" \
  --output-dir "$BB700_OUTPUT"
```

The wrapper validates the complete public release before native changes, calls the unchanged standard iOS sync to preserve Capacitor/plugin setup, builds the separate 700 variant from that clean 100-Free native output, then verifies and stages it into `ios/App/App/public`. Native Cordova bridge files created by Capacitor are preserved and added to the checked inventory. A partial release fails before sync; a later failure restores the previous native public directory. `capacitor.config.json` stays byte-for-byte unchanged, and `dist/native` remains the legacy source bundle.

Normal `npm run ios:sync` always rebuilds and copies the legacy 100-Free bundle, so running it **after** this wrapper would replace the new client. The explicit 700 verifier detects such a replacement. Confirm the version, build number, actual staged catalogue and device behavior before archiving. Linux verification does not replace a macOS/Xcode/device check.

The new API must still be imported and pinned through the separate reviewed release procedure before this client can obtain its 500 Premium records. Until then its private hydration fails closed and Free remains available. Both first-time Apple subscription plans and their subscription group must accompany the new app version in the App Store Connect submission; a successful client build does not submit or approve them.


The generated planner also includes a 44 px circular-arrow control per planned dinner. It reuses Auto-Fill access, food preferences, speed/children filters, rotation and weekly variety rules. Basket quotes use the real current pantry, pack rounding and household quantities. A replacement must fit the weekly budget, or avoid increasing a week already over budget. Only the selected day changes; servings, other dinners and optional breakfast/dessert slots remain. Confirmed cooked days require undo first, and linked batch days require removing their link. Proposal previews write no stock or plan, stale-account responses are discarded, and failed persistence restores the old dinner and rotation. A bounded search can report that no suitable replacement was found; it never forces an ineligible meal.

Release evidence is in `catalogues/700/release/validation-summary.json` and `regression-summary.json`. The final portable run has 3,140 passing tests and zero failures, with the existing Linux Swift skip and two Paddle TODO cases explicitly recorded. Actual browser runs at 390, 880 and 1024 px hydrate all 700 recipes, show 50 breakfast options, load the new photos and preserve other meals, portions and inventory when replacing one dinner. The dedicated `ios-catalogue700-build.yml` uses the explicit 700 sync wrapper for independent archive/Cook, real keyboard and hosted StoreKit checks. Its macOS results and on-device subscription tests remain required before upload; portable checks do not prove a signed archive.

The ordinary native workflow still checks the legacy catalogue as a compatibility baseline. Its archive is explicitly labelled `legacy500`; use only the dedicated catalogue-700 build or the verified local wrapper output for this new release. Both workflows now verify build33 to match the Xcode project.
