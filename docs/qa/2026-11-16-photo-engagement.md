# Photo-first activation and pantry value

Prepared on a development branch; not deployed or uploaded to Apple.

## Implemented

- Confirmed Free accounts receive two food-photo scan attempts in total. The server owns the count using the existing D1 usage table, with atomic lifetime limits, deletion guards, human verification and the existing global daily cap. Invalid input, failed verification and a full global cap do not spend an attempt. Once sent to AI, an attempt counts even if the provider fails.
- Premium keeps its existing daily allowance. Receipt scanning, generated AI recipes and meal images remain Premium. No subscription price, offer, payment provider or billing configuration changed.
- Welcome leads with Snap your fridge, while preserving optional Apple/email signup, manual entry and account-free recipe browsing. Uploading a free scan requires a confirmed account; no anonymous account is created.
- Photo upload still requires consent. Detected foods and checked quantities need review before saving. Unknown quantities never become measured stock.
- The completed last scan remains saveable after its remaining allowance reaches zero. Changing account, token or deletion state invalidates stale review.
- Reviewed foods reveal actual catalogue matches, including missing-ingredient and food-safety guidance. The original recipe drawer and handlers are retained.
- A first handoff prepares a missing planner through the original application save owner. Existing valid plans stay byte-identical; corrupt data, account changes or save failure stop the handoff.
- A dismissible post-shop card reports measured pantry coverage and estimated full-pack shopping avoided. It captures stock before purchases, excludes uncertain quantities/prices and never counts new purchase credits. It appears only after a successful explicit Finish, including the receipt path.
- The value baseline is memory-only. Reloading an already-started purchased session intentionally suppresses a retrospective claim.

## Native human verification

The iOS web view uses capacitor://localhost, while API verification expects basketboss.co.uk. The native helper hosts only the human check in an HTTPS iframe on the official website. Its messages are bound to the exact frame source, HTTPS sender origin and a fresh cryptographic nonce. No account credentials, photographs or pantry data are passed to the frame. Server verification remains mandatory.

The hosted frame uses a wildcard delivery target to support opaque native WebKit receiver origins; CSP restricts framing and the native receiver performs all three checks above. Reset, expiry, cancellation and account changes discard old checks.

## Verification

- 283 selected unit/security/stock/planner regression checks passed.
- 22 catalogue-700 web/native build and integrity checks passed.
- Three browser checks passed for the real app-to-photo-to-recipe handoff, manual entry and stale-account isolation.
- Seven browser checks passed for guest activation, SDK email verification, optional Apple entry and keyboard layouts.
- Two Plan browser checks passed at 390px and 320px, including options, budget panels, day controls, scrolling and unchanged saved data.
- The actual PWA700 and native700 assets built successfully; no private recipe bundle was included.
- Source and native copies of the new shared modules and Plan CSS/JS match. app.html and index.html match each other.
- Production Supabase schema, policies, providers and records were not changed. Routing, pricing configuration and payment handlers remain unchanged.

The separate codex/plan-clean-20261116 branch contains only the requested Plan visual refresh, independently releasable from this feature work.

## Before release

Run the free scan on an actual iPhone after the matching hosted endpoint is deployed. Verify the managed human check, camera permission, review, final free scan, manual alternative and account change. Linux browser tests and native asset compilation do not prove WKWebView or Apple-device behaviour. No Xcode archive or App Store upload was performed here.

Verified billing analytics remain parked. No reminder, sharing, payment analytics, URL migration or Supabase policy work was introduced by this change. Companion-created plans still use their existing analytics behaviour; extending that measurement is a separate task.
