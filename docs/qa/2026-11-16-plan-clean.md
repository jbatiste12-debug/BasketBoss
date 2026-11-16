# My Week visual refresh

This branch contains only the Plan presentation change requested on 16 November.
It is independent of the separately approved photo-onboarding and scan allowance work.

- Keep the BasketBoss logo and existing location, account and navigation controls.
- Make the original live week total prominent; hide its former decorative SVG ring.
- Keep Auto-fill as the primary action and retain both existing planning modes.
- Use a native More options disclosure to reveal the existing preference and Add meal controls.
- Preserve every planning control's original DOM parent, identity and event handler.
- Compact the original schedule cards without replacing recipe data or day interactions.
- Preserve the document scroller and bottom-navigation clearance.

Verification:

- Four presentation tests passed: control identity/parents/handlers, idempotence, validation visibility and unrelated-view isolation.
- Two browser checks passed at 390px and 320px: original tabs, day controls, budget panels, More options, scrolling and saved-data invariants.
- The real catalogue-700 PWA and native bundles built successfully.
- Native Plan JS/CSS match the source bytes.
- app.html and index.html match the published baseline exactly after substituting only the two Plan asset version references.
- Routing, billing, pantry and recipe-planning source files match the published baseline.

Preview fixtures use an actual catalogue recipe and its calculated shopping estimate. They do not write production data.
No production deployment, App Store upload or provider configuration change is part of this branch.
