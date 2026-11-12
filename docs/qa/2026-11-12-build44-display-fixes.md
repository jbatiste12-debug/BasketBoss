# Build 44 application: kitchen check and recipe piece labels

Status: PASS

The application includes the zero-stock review fix from
4844b72333718aacf22c54a3e72129ae793fa12c. Empty, unused ordinary food rows no
longer appear in the weekly kitchen check; pantry records and calculations stay
with their existing owners.

The additional change connects Plan's expanded ingredient summary and Cook's
display-local ingredient array to the existing `bbRecipeDisplayIngredientQuantity`
helper. It already relabels an editorial count such as `6 pack` to `6 each` only
when the normalized recipe independently confirms the same count as individual
pieces. Discover already used that helper. Genuine broccoli packages and metric
pack sizes retain their meanings. Cook's voice descriptions share the corrected
display array; pantry deduction still reads the original recipe and cook factor.

Exactly three display calls changed, mirrored in app.html and index.html.
Reversing those call substitutions reproduces the previous application HTML
byte-for-byte. No helper bodies, source/normalized recipe data, serving scaling,
canonical matching, subtraction, conversion factors or catalogue prices changed.

One clean sequential process passed 115 targeted tests, with zero failures,
cancellations or skips. A real browser test opens Plan, Cook preparation and
Discover and verifies six sausage pieces in every view, a six-each requirement,
unchanged pantry bytes and no committed cloud stock writes. Existing tests cover
other sausage/bun recipes, scaling, genuine packages, voice/cooking controls,
offline/shared pantry behavior and the new zero-row checks at 320/390px.

Source/index and local PWA/native parity pass: 204 client JS/CSS comparisons,
1,163 native files, 33 generated PWA manifest rows, 238 precache URLs. Cache:
2b64c94091721517df8fdb67df04cdd85fab6f7a90215e1641ec0668c7c4077a.

The separate Build 44 launcher prepares a fresh checkout, changes only its two
Xcode build settings from 43 to 44, preserves version 1.0.2 and verifies settings
before/after catalogue-700 sync. Build 43 source, launcher and submitted App Store
build are preserved. Apple signing, physical-device testing and submission are
performed on the Mac; these local checks do not claim a signed archive/upload.
