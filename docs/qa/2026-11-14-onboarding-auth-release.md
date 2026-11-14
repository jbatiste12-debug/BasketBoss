BasketBoss onboarding, account recovery and UI release audit — 14 November 2026

Application source: `c350b8ec6a96ca1d8236a2e2eabbd5478a04bcfc`.
Native handoff: 1.0.3 (45). Catalogue compatibility remains 1.0.2. The launcher prepares a separate checkout; it does not upload or change the current App Store submission.

Findings

| Status | Finding and evidence |
|---|---|
| Confirmed | Guest recipes, planning and shopping already worked locally. Downloads do not necessarily create Supabase accounts. No anonymous authentication was added. |
| Confirmed | Signup was easy to miss and Return always submitted Sign in. Explicit signup/login modes and a short optional welcome now use the original verified Supabase/session owners (`bb-auth-flow.js`, `bb-onboarding-v2.js`). |
| Confirmed | Production web/native configuration identifies the same project, `kbhyosxuvlcazyzzinqv`. Public settings initially showed email enabled, confirmation required and Apple disabled. The owner subsequently began manual Apple configuration; its final live readiness still needs checking. No credentials were reported. |
| Confirmed | A genuinely new user test reached production Authentication and became email-confirmed. Confirmation mail was delivered. At the last read-only account check there was no successful server session or cloud kitchen row for that account. The browser-recovery fixes therefore need a real follow-up sign-in check. The test address is excluded from this report. |
| Confirmed | Local profile switching omitted four old recovery/migration keys from isolation, allowing an old week to reappear after primary state was cleared. They now follow the original actor archive and are excluded from cloud kitchen backup payloads (`bb-receipt-host.js`). Existing raw data is preserved; no pantry or account was deleted. |
| Confirmed | Account Settings used a static Sign in label and offered cloud backup actions without relevant saved data. Labels now follow the remembered session; backup actions appear only for actual saved data or actionable issues. Verified login enters the app while background cloud connection completes. |
| Confirmed | A failed confirmation link gave generic feedback. A browser remembering another account could also hide the recovery form. Recovery now offers an independently verified email sign-in/account switch and retains the old account on failure (`bb-auth-flow.js`). |
| Confirmed | Read-only database inspection found owner-scoped authenticated RLS on kitchen and planner-extras tables, empty kitchen defaults and no sample-plan insertion trigger. Cloud queries pin the verified actor. There was no evidence that the new account received another user's server row. |
| Hypothesis | Opening a private-Safari signup link in a different Gmail/browser context can lose the PKCE verifier; an expired/reused link is another possibility. The observed confirmed account and bounded invalid-link log do not prove the precise original failure. |
| Confirmed | The old recipe placeholder implied Premium status. It now neutrally says to check recipe access or choose another meal; it does not grant membership. |
| Confirmed | Analytics could miss an already-rendered welcome because its deferred script precedes the funnel script. Startup now replays only an actually visible welcome through existing once-only flags. |

Experience and security

The welcome says “Your weekly shop, sorted. 👑”, shows the three benefits, and offers free exploration, email account creation, Sign in, and direct native Apple authorization when ready. Setup remains optional. Existing users skip automatic onboarding; Help replay and partner paths remain intact. Contextual, dismissible signup prompts follow genuine first plan/list creation. No preview uses another account's data.

Email signup/login preserves the real SDK, verified-user checks, confirmed-email requirement, single session manager, PKCE, duplicate-submission guards, safe callbacks and error recovery. Cloud conflict choices remain explicit. No production provider, SMTP setting, template, schema, migration or RLS policy was changed by this work. A proposed token-hash confirmation email template is documented separately and has NOT been applied: `docs/auth-confirm-signup-token-hash-proposal.md`.

Native Apple login uses random nonce/state, checked native authorization, Supabase ID-token verification and existing session persistence. The button requires the configured provider, native bridge and account-deletion readiness. Apple-only deletion reauthenticates, validates Apple's signed identity, exchanges the code and revokes its token before the existing durable deletion journal. Capacitor plugin payload logging is disabled. Web Apple OAuth was not enabled. See `docs/apple-sign-in-release.md`.

Monthly/annual trial labels require StoreKit to return a real eligible zero-price seven-day introductory offer. Renewal price/period come from Apple; the customer confirms the subscription and renewal terms. The owner reports configuring both offers in App Store Connect. Actual purchase-sheet currency follows the purchasing storefront; USD was not relabelled as GBP. See `docs/apple-seven-day-trial.md`.

UI changes

- My Week: existing next-week action/info sit visually in the header; preferences are compact; mode controls have soft active pills; Auto-fill is primary and Add meal secondary; full instructions remain in expandable tips. The same controls, parents, handlers and dynamic bindings remain in place.
- Day plan: existing native disclosure/actions form a bottom sheet, with collapsed real ingredient counts, compact optional-meal/utility actions and Day done below. The same signup reminder is dismissible at the top. Keyboard viewport changes, nested modal yielding and existing badge gesture timing remain supported. The dock is dimmed below the sheet instead of covering Day done.
- Batch cooking: successful saves open Plan; linked portions display the actual recipe and source day as filled cards. Source time/serving controls and existing per-day serving overrides are preserved. The original batch scaling and single source-day deduction remain authoritative.
- At home: All is first/default; In stock/Weekly essentials reuse their handlers. Add food and the real guarded receipt entry are separate prominent actions. The original food-photo scan remains separately labelled. Empty-state chips open the existing prefilled quantity editor; they do not invent stock or save until confirmation. Review & restock remains above At home in a compact form. The trial badge appears only when the native read-only StoreKit eligibility gate is true; PWA/unknown/ineligible users see Premium.

The app is vanilla JavaScript/CSS, not a React/Tailwind component. Complete source files are supplied. `bb-home.js` remains byte-identical to the pre-refactor baseline (SHA-256 `6ef580b0821a489f32e581d2078fe9fa7d67204c410b63751659a65fa4d65d50`). Recipe scaling, stock conversion, canonical matching and pantry subtraction functions were not rewritten.

Privacy-conscious funnel

The existing bodyless, allowlisted first-party endpoint measures first instrumented app open, welcome viewed, signup screen, chosen method, accepted attempt, pending confirmation, verified persisted signup-intent completion, safe failure category, first plan and first list. It sends no email, password, token, account ID, recipe content or installation identifier. Local flags deduplicate milestones/reloads. Metrics are best-effort aggregate events, not an exactly-once server ledger; signup success does not claim proof of a new Auth insertion because Supabase obscures existing-email signup responses. Privacy disclosure was updated.

Verification

| Check | Result |
|---|---|
| Full sequential non-browser suite | 4,230 tests: 4,215 passed, zero failures, 13 skips and two existing TODOs. |
| Final sequential browser release checks | 32 passed, zero failures/cancellations/skips, in one clean sequential run with an explicit Chromium executable. Covers real SDK auth/recovery, batch/source portions, original day actions, ingredient counts, Day-done hit targets, At home tabs/search/groups/selection/restock, six quick-add drafts, save and Premium receipt gating. |
| Extra visual audit | My Week at390/320/844px: all103 original controls, live bindings and business data retained;13 touch targets checked; popovers/modes/Autofill/next-week cancellation/Add meal/Sunday dock clearance passed. At home/day sheet at390/320/768px: quick-add cancellation/save, live counts, filters, essential mode, receipt upgrade gate, dynamic ingredients and Day-done hit target passed with no page errors. All requests were fulfilled locally. |
| Offer/editor/receipt focused checks | 96 existing focused tests plus the new read-only native offer-gate test passed. Day-sheet/funnel18 tests passed. These overlap the full suite. |
| Build45 launcher | Eight passed, zero failures; pinned source includes all account and UI fixes. Historical Build43/44 launchers remain unchanged. |
| Assets | Rebuilt native100-Free shell, generated700 native bundle (200Free/500Premium,1,168 files), and public PWA/cache inventory. Twelve checked shared assets match native bytes; onboarding retains only the two documented existing native copy substitutions. Entry documents match. No private recipe bundle. |
| Native compilation | The account-safety source passed unsigned Release simulator compilation in GitHub Actions run43628374026. The later layout revision changes shared web assets, not Swift; its final CI result must be checked separately. No signed-device Apple authorization, purchase, deletion or archive was claimed here. |
| Previous live PWA proof | Account-safety commit8635abbdff205bf4b0332a49f9c96e48f279fd41 deployed successfully; live public parity passed after the deployment completed. The initial stale-manifest deployment race was retried only after deploy success. Final layout deployment/parity is recorded separately. |

A wider CI run exposed two pre-existing screenshot writes to `/workspace`, which is unavailable on GitHub runners. They now use an optional screenshot directory or the system temporary directory. No stock assertions were weakened. An initial local kitchen test group lacked the Chromium executable setting; rerunning with `/usr/bin/chromium` passed all seven checks.

Some optional full-suite checks need PostgreSQL fixtures, device/simulator or Swift tooling; skipped checks do not establish production behavior. The separate live private-Cook audit remains blocked by its dedicated read credential (`cook_method_audit_protected_read_denied`); this was not bypassed and no broader token was substituted.

Before submission

1. Complete the Apple capability/provisioning, Supabase native bundle-ID provider configuration and separate server Sign-In key readiness from the linked guide. Keep the .p8 key in server secrets, outside chat/source. No database migration is required.
2. Verify the controlled new account signs in, Settings shows its account, its cloud data is empty or its own, and logout/relogin preserves isolation. Test email confirmation in the actual browser/app context. Do not disable confirmation or weaken RLS.
3. On a signed iPhone/iPad test Apple signup/login/cancellation, Hide My Email, household access and Apple-only account deletion. Check both eligible seven-day offers, ineligible fallback, restoration, actual renewal currency and price in Apple's sheet.
4. Use the updated Build45 launcher. If45 has already been uploaded, choose a higher unused build. Test before Archive; the launcher does not upload. Ordinary ios:sync must not overwrite the prepared700 assets.
5. Correct the public App Store recipe counts and remove the expedited-review request from customer-facing What's New. Keep review requests in Apple's correspondence. Describe Apple login/trials as shipped only when configured and device-tested.


Budget clarity and live Apple setup follow-up

The reported £406.06 is the weekly combined calculation, while £99.40 is the remaining buying estimate. The ledger includes current and explicitly completed shops recorded during the same Mon–Sun week. It checks actor, market and currency, deduplicates trip/row identities, and replaces receipt-covered estimates. Repeated test shops are a plausible source; the exact device ledger was not inspected, so the difference is not asserted to be actual paid spending. The old trailing plus meant unresolved prices.

Budget & household now puts the same Left to buy amount as the ring first. Recorded known costs, date range, combined estimate and target comparison sit inside a closed “Recorded spending & weekly total” disclosure. Pending prices use explanatory text. The read-only adapter obtains recorded costs by calling the existing ledger budget with zero base/empty lines, then combines them with the current UI buying estimate in cents. This keeps pack, manual-price and guide-price display overrides consistent without changing the core budget, receipts or stock. Missing ledger data retains the original combined estimate with an explicit unavailable breakdown; recorded costs are never inferred by subtraction.

Validation:61 focused budget/pack/ledger tests passed;58 Apple/session tests passed;11 sequential real-browser regressions passed (budget edits, partial buys, pack/custom prices, fallback guides, offline stock, partner/lead pantry and planner tabs). Eight core source files and three existing calculation helpers remain byte-identical to their pre-fix hashes. PWA and700 native assets rebuilt; seven checked shared assets match. No private recipe bundle.

The preceding b4 full CI run found four old UI test flows using pre-sheet/pre-All interactions. Tests now expand the real ingredients disclosure before checking six sausage pieces, target the All tab rather than its enclosing section, and close the day modal before keyboard tab navigation. Quantity, state, node, handler and history assertions are preserved. Those affected cases pass in the11-test browser run. The new full CI result must be checked separately; the earlier four failures are not presented as a green full-suite result.

Build b4 also passed Debug/Release iOS compilation, hosted StoreKit simulator tests, Cook navigation and actual iOS keyboard checks. These do not prove live Apple authorization or subscription eligibility.

The owner reported completing Apple/Cloudflare settings, but the public endpoint still returned available:false. This confirms the server gate remained blocked at that check, without proving which credential or deletion prerequisite was incomplete. The endpoint now adds four safe booleans (appleConfiguration, accountDeletionConfiguration, accountDeletionChecked, accountDeletionReady). Existing availability behavior and readiness RPC short-circuiting remain unchanged; no IDs, keys, account information or raw errors are exposed. Production secrets/providers/schema were not changed by this code. The owner must refresh the deployed endpoint and complete the native-device sign-in test.

Latest Shopping UI revision — focused validation complete

Shopping names now lead each compact row. Buying uses a soft selector, the original price/menu/preset controls remain intact, and zero At home subtitles are hidden. Approximate fresh-produce counts read existing count weights; exact required weights remain visible. Unsupported bunch/punnet assumptions are not invented. These hints never drive purchase quantities, prices, stock identity or recipe deductions.

Validation: 98 focused quantity/pack/completion/catalogue/native-staging/cache tests passed. A further 65 auth/keyboard/cache unit checks passed after the keyboard CSS change. The 19 existing shopping/budget/essentials browser regressions passed. Three new real-app cases passed at320/390/1024px, checking typography,44px hit targets, independent controls, Bought/progress, stock reversal, essentials routing, Copy/Finish and final-row clearance. Six distinct onboarding browser cases passed across the reduced-viewport email/password probes and the existing native-smoke identifier flow. All browser runners were sequential and all test network requests stayed local.

The first three new browser checks exposed test assumptions: ordinary menu-event bubbling was mistaken for checkbox mutation, and a mobile-only start-button selector was used on iPad. Tests now assert actual tick/stock invariance and use the existing responsive shopping owner on iPad. Production event handlers were unchanged. An initial native staging test exhausted temporary disk space; the unchanged case passed using a separate scratch volume.

Eight core files and three existing calculation function slices remain byte-identical to the pre-fix baseline. PWA and1172-file public native700 assets were rebuilt; seven shared UI/core files match byte-for-byte, including the final auth CSS. Current PWA content hashes match the HTML and precache. No private recipe bundle was included. Twenty fresh opaque RGB screenshots were checked at1206x2622 and2048x2732 and packaged as two10-image ZIPs, using fictional local sample data.

Native keyboard gate: CI at0270beaf passed compliance, native compile/archive, Cook and the StoreKit bridge but failed fresh-onboarding email-focus Sign in reachability. The valid Swift selector was checked against that exact commit. Email focus protected only the field while additional auth content put the action below the reduced viewport; password focus had a separate CTA visibility adjustment. A CSS-only correction keeps the SAME visible auth action sticky in the existing onboarding scroller. Both focused fields pass the reduced-viewport browser probes at320/390px. Real UIKit keyboard verification of this corrected source remains pending; do not describe it as a green iOS keyboard run or bypass it before submission.

The owner reported that Apple sign-in works after completing native-device setup. This is user-confirmed, not independent verification of every authorization, purchase, restore or Apple-only deletion path. No production provider, Supabase policy/schema, secrets or email template was changed by these UI edits. The proposed token-hash email template remains approval-required.

Final application source: 70696857376c38401cb3bfcbd41051e93a50d21a. The separate handoff commit pins the Build45 launcher to this source.
