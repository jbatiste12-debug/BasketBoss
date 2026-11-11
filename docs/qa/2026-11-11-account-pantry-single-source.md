# One At home pantry and account sync — 11 November 2026

**Status: PASS — local sequential regression, protected math isolation and rebuilt asset parity.** Live publication is recorded separately in the release packet.

## Inventory authority

The current measured pantry shown in At home supplies planned-meal and shopping credit. A routine reminder, a failed cloud refresh or an older saved snapshot does not turn its known physical quantities into zero or insert absent foods. Actual pending receipt recovery, unreadable records, account isolation/deletion and an unconnected scope transition remain protected.

The separate Confirm Your Pantry form and ordinary review banner are removed from the active app flow. Compatibility APIs retain their default behavior for existing isolated integrations; the app enables the new account mode. Shopping and Day done do not ask the user to select device versus saved quantities. Any genuine sync attention is handled inside Account & cloud sync, with one current-pantry action and no per-food entry form.

## Durable edits and shared updates

Manual At home saves prepare the existing absolute-stock outbox from the persisted pre-edit pantry and commit its expected bytes within the existing local save/rollback boundary before an asynchronous retry. Removing a food, or every food, remains an explicit target after reconnect/restart. The existing scope/revision CAS protects online writes. A remote conflict preserves local intent instead of replacing it with the old saved balance or silently adding both amounts.

Linked eligible accounts already use one household scope on the server. A single coalesced foreground refresh now reads that scope automatically, drains pending local writes first and pauses on genuine conflicts. The lifecycle wakes on login, foreground/resume, reconnect and household changes, with a four-second foreground polling interval. Hidden/offline/deleting/signed-out sessions pause. This uses the existing authenticated API; it is not a new WebSocket subscription and does not change backend schema, RLS or paid-feature eligibility.

An explicit Account action can connect a changed account/household scope. The previous scope's pantry and pending intent are backed up first. Only the freshly fetched destination stock is adopted under its scope/revision CAS; personal stock is never summed or uploaded into another household. Actor/session and local-state preconditions protect the request and local projection boundary. Old scoped pending intent is retired in the existing recoverable projection transaction, with its archived copy retained.

## Premium household lead

The Premium inviter leads the shared household. Successful invite/accept actions connect the already server-authorized scope. Only a verified owner may initialize a new, empty, revision-zero household from their current At home pantry. The client verifies authenticated household status and its matching ID, and the API independently rejects invitee first writes until the lead initializes the pantry. Invitees wait and then adopt the lead's pantry through ordinary foreground refresh; their separate personal stock is backed up rather than merged.

An already initialized household, including an intentionally empty one, always supplies its own stock. Replaying invite/accept events never reseeds it from a stale device. The same scope/revision CAS protects races; existing RPC calculations, RLS and subscription eligibility are unchanged. One existing backend fixture now represents a lead-initialized household; all its assertions are preserved.

## Recipe display

Discover's recipe display now renders editorial pack counts as pieces only when the normalized ingredient explicitly records the same number in `each`. Six pork sausages and six buns show **6 each**. Real broccoli packages and weight packs keep their existing meaning. Recipe source data, normalized quantities, serving calculations, price tables and the global formatter remain unchanged.

## Verification scope

Focused browser coverage exercises the reported absent chicken/lime/peppers and four sausages through offline save, reload, reconnect and Shop's two-sausage deficit. It also exercises two isolated linked-account contexts in both directions, an unrelated account, and an open Buying draft through idle polling. Focused host tests cover conflicts, timeouts, duplicate taps, safe scope adoption and preservation of archived intent; manual-save tests use the real host and adapter.

Two existing browser cases previously required the now-removed in-Shop review form. Their interaction expectations are updated to the explicitly requested Account-only workflow; their exact stock, purchase and duplicate-credit assertions are retained. One separate household-repair browser case explicitly selects the legacy API mode to retain its original cloud-blocking assertions; new Account-mode conflict and physical-stock behavior are covered independently. All existing calculation assertions remain unchanged. The final run completed with zero failures and no remaining failing selectors.

The final isolation certificate rechecks the same 14 protected calculation functions and eight complete core/catalogue files against `0b8ff949265f2f0f31f3606ec5a288b5c462ad31`. No signed archive, fresh physical-device run, production purchase or App Store upload is claimed by a Linux/web certificate.

## Final local evidence

- One clean sequential full run: **4,241 tests discovered; 4,238 passed; zero failures; zero cancellations; 1 skipped; 2 TODOs**, completed in 820.03 seconds. The existing Swift-only Linux skip and existing TODOs are disclosed separately and are not claimed as passing coverage.
- Actual-app browser paths passed for absent old foods, offline/reload/reconnect, two-way linked-household stock, unrelated-account isolation, lead-first initialization, no stale personal overwrite, and Buying edits across idle polling and reload.
- Rebuilt parity: **201 compiled client assets; 1,160 native files; 1,159 native manifest entries; 33 PWA manifest entries; 235 precache URLs**. Source app/index mirrors match.
- All 14 protected calculation functions and eight complete core/catalogue files are byte-identical to the frozen baseline. The receipt projection calculation function is also unchanged; the adapter adds only optional scope-connection preconditions at its existing boundary.
- Version remains **1.0.2 (43)**. Publication/deployment and the immutable Mac launcher pin are certified separately after the source push. Signed Xcode archive, physical iPhone behavior, real paid StoreKit transactions and App Store submission remain Mac/device actions.
