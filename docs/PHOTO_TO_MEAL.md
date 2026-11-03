# Photo to meal — build 6

Cook now starts with a single **Take or choose a photo** action. The previous decorative food hero, separate Scan/Create entry points, recipe-library finder and three-location pantry selector are replaced by one path:

1. Choose a food photo and tap **Find my ingredients**.
2. Review recognised names, correct mistakes and uncheck unwanted foods.
3. Tap **Generate meal & picture** to request a meal using this reviewed selection and an illustrative picture of that recipe.

The meal selection stays in memory and is separate from saved Pantry/At home, shopping and the plan. Previously saved ingredients are not imported into this meal. Duplicate spelling/case and safe plural variants are combined; raw/cooked and distinct food forms remain separate. Review accepts 1–12 names, each at most 60 characters, without silently truncating longer scanner labels.

The existing native file input and synchronous Premium/camera gesture gate remain in place. The tool is inline instead of a modal. Account changes, deletion, a replacement photo and review edits invalidate stale scan/recipe/image results; token identity is checked before a resized photo is submitted. Repeated taps cannot start duplicate meal requests.

Requests use the existing authenticated `only_have` recipe API for four servings. The server rejects compound-food substitutions such as chicken stock → chicken and instructs the model to use no unselected ingredients throughout the recipe. Method prose is model-constrained, not completely semantically validated. The picture uses the existing signed, account-bound ticket derived from the validated recipe; it never falls back to unrelated stock food art. If the picture fails, the written recipe remains visible.

The At home camera handoff (`bbscan=pantry`) keeps its separate explicit storage/quantity review. It does not create a meal or change stock until the user confirms that pantry operation.

Validation: real-controller regressions cover edited/unchecked inputs, bounds, duplicate names, no stock writes, consent cancellation and stale/account/deletion paths. Chromium passed the full mocked photo → review → meal → decoded-picture flow at 390px and 768px, plus keyboard entry and both pantry handoffs, with no page errors or pantry changes. These are synthetic auth/AI fixtures; genuine iPhone camera behaviour and live Gemini recipe/image generation still require the TestFlight device check.

The ingredient-matching backend is PR #35. This client remains version 1.0, build 6 and is included with the Premium beta unlock and earlier tester fixes in PR #33. The new source needs the final hosted native checks and a signed Xcode upload; earlier build artifacts do not contain this page update.
