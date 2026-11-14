BasketBoss onboarding, authentication and Apple release audit — 14 November 2026

Application source: `c52cc0e0583b1da7f0b345f6655c6293b4766a34`.
Next native marketing version/build: **1.0.3 (45)**. The UK App Store currently lists 1.0.2. The catalogue/client compatibility contract remains 1.0.2; the launcher updates the separate native marketing/build fields.

**Findings**

| Finding | Evidence and implication |
|---|---|
| Confirmed: downloads need not create accounts. | Guest recipes, planning and shopping already work locally. No anonymous Supabase account is created. Downloads cannot be equated with registrations. |
| Confirmed: signup was easy to miss. | The old quick welcome collapsed account access under an account question and promoted guest continuation. Return in either credentials field always submitted Sign in. `bb-onboarding-v2.js`, `bb-auth-flow.js`. |
| Confirmed: old analytics did not measure registrations. | They counted clicks/restored sessions and watched an obsolete confirmation-message element. `bb-funnel.js`. |
| Confirmed: production project matches the app. | Read-only public-settings CI verified production project `kbhyosxuvlcazyzzinqv`, email enabled and confirmation required. Source and native use the same public configuration. No credential values were reported. |
| Confirmed: registrations do reach production. | Aggregate Auth queries at audit start showed 19 accounts, 15 email-confirmed, 13 with a sign-in, and four account records created in the previous seven days. Records may include tests; these figures do not establish a download conversion rate. |
| Confirmed: Apple login was absent/disabled. | No Apple auth integration existed. Public provider settings initially reported Apple disabled. The owner is now configuring Apple; the initial observation must not be treated as the final live setting. |
| Confirmed: Apple needed deletion support. | Password-only deletion could not serve Apple-only accounts. Added fresh Apple reauthentication and token revocation before the existing durable deletion journal. |
| Confirmed: native bridge debug logs could expose credentials. | Capacitor logs plugin response payloads by default. iOS bridge logging is now disabled before returning Apple credentials. |
| Unconfirmed: email delivery or allowed redirects contributed to the gap. | Email confirmation is required. The owner reports SMTP configured, but real delivery and the complete provider redirect allowlist have not been independently verified. Pending confirmation normally creates an Auth record; it does not alone explain absent records. Cross-browser PKCE confirmation remains a possible activation problem. |

**Implemented experience**

The new quick welcome says “Your weekly shop, sorted. 👑”, explains the three benefits, and offers Explore BasketBoss Free, Create free account and Sign in. Household setup is optional. Guest exploration uses the existing local data and entitlement boundaries. A successful signup/login enters the app directly; returning accounts and completed older onboarding skip the automatic welcome. Partner invitation and explicit Help replay paths remain available.

The original email form and Supabase/session owners remain authoritative. Explicit signup/login modes control Return, primary action and password autocomplete. Loading, submission locks, network deadlines, validation, confirmation-pending, resend and recovery remain supported. Guest work uses the existing safe account-adoption path; account switches preserve isolation and cloud conflicts still require explicit choice. No RLS, schema, production provider or SMTP setting was changed by this code.

After genuine successful plan/list creation, guests receive a dismissible prompt to create a free account to save and sync across devices. Existing rendering, cloud restoration, failed saves and idempotent retries do not count as new creation. Recipe scaling, shopping deficits and pantry subtraction were not rewritten.

Apple authentication is native iOS first. Its secure random nonce/state, native authorization and Supabase ID-token exchange feed the existing verified-session persistence path. Apple appears only when its Supabase provider, native bridge and server deletion readiness all pass. PWA email signup/login remain available. See [Apple setup](../apple-sign-in-release.md).

The Apple paywall now reads a real zero-price seven-day introductory offer and current eligibility from StoreKit. Eligible users see “7 days free, then [Apple price]” and the selected renewal period. The Apple purchase sheet requires confirmation; the paid subscription renews automatically unless cancelled. Ineligible/missing offers retain normal subscription presentation. The owner reports configuring one-week free offers for both monthly and annual plans; signed-device verification is still required. Product IDs, purchase/restore and verified entitlement calculations remain unchanged. See [trial and currency setup](../apple-seven-day-trial.md).

Apple's sheet chooses currency using the purchasing storefront. Existing UK test settings are already `en_GB`/`GBR`; web base prices are GBP. USD was reported in Apple's own sheet. No dollar charge has been relabelled as pounds. Check the actual purchasing/Sandbox storefront and UK subscription pricing.

**Funnel measurement**

The existing first-party, bodyless `/api/funnel/{event}` transport now measures `first_app_open`, `onboarding_viewed`, `signup_screen_viewed`, method selection (email/Apple), actual accepted signup attempts, confirmation pending, verified signup-intent completion, fixed safe failure categories, first meal-plan creation and first shopping-list creation.

Only allowlisted names are sent. No passwords, tokens, emails, account IDs, recipe details or user content are transmitted. Local milestone flags provide reload deduplication without sending installation identifiers. The auth submission owner distinguishes legitimate retries. Metrics are best-effort aggregate requests, with at-most-once sends; they are not an exactly-once server ledger. `first_app_open` means first instrumented open per installation since rollout. `signup_succeeded` means a verified, persisted signup-intent completion, not proof of a newly inserted user: Supabase deliberately obscures existing-email signup responses. Restored sessions are not signup successes. Privacy disclosure was updated.

**Verification**

| Check | Result |
|---|---|
| Combined auth, session, account deletion, household adoption, native purchase/trial and onboarding tests | 614 passed, zero failures; two skipped. |
| Sequential generated-700 app + real bundled SDK browser tests | 15 passed, zero failures. Covers guest value, contextual signup, PKCE confirmation, duplicate taps, validation/retry, logout isolation/relogin restoration, Apple gates, narrow/landscape layouts and keyboard helper targets. All auth network traffic was locally fulfilled. |
| Build45 launcher/archive guards | Eight passed, zero failures. Verifies 1.0.3/45 preparation, idempotency, refusal of unexpected versions, archive metadata and historical launcher preservation. |
| Cache/funnel checks | 21 passed, zero failures; includes overlap with the combined group. |
| Native Apple compilation | Successful unsigned Release simulator compilation on macOS in GitHub Actions run `43621495041`. No archive or App Store upload performed. |
| Rebuild and parity | Verified 700 native bundle (200 Free/500 Premium), regenerated public PWA/cache inventory. Seven changed shared assets are byte-identical; onboarding differs only by the two documented existing native copy replacements. No unexpected differences or private recipe bundle. `app.html` and `index.html` remain identical. |
| Skipped checks | Real PostgreSQL deletion integration requires its optional local fixture; the Swift speech endpoint fixture requires a Swift compiler. The latter is unrelated to this auth change. Neither skip proves a production failure. |

No fresh production signup was submitted from this workspace: its outbound policy prevents direct access to the app/Supabase hosts. CI checked public settings read-only. The supplied fresh test inbox was checked without exposing its address and was unused. Real confirmation delivery, successful production Auth persistence and real Apple authorization/revocation remain manual release checks; local browser mocks and unsigned compilation do not establish them.

**Owner-side release steps**

1. Complete Apple Developer capability/provisioning, Supabase native bundle-ID provider setup and the separate server Sign-In key settings in [the Apple guide](../apple-sign-in-release.md). Keep private keys in the server secret store, never chat or source. No new database migration is required.
2. Perform a real controlled-inbox signup/confirmation/login/logout and verify its Auth record. Confirm links return to the originating browser/app; verify SMTP delivery and redirect allowlist if it fails. Do not disable confirmation or weaken policies to hide delivery problems.
3. Test new/returning Apple login, cancellation, Hide My Email, household access and account deletion/retry on a signed device. Check both seven-day subscription offers and the actual renewal currency/price in Apple's sheet.
4. Run the new launcher to prepare 1.0.3 (45). If build45 has already been uploaded, choose a higher unused build before upload. The public listing cannot reveal the highest uploaded build.
5. Create/select App Store version1.0.3, attach the tested build and submit manually. The launcher does not upload or alter the existing release.

The public App Store description still advertises older recipe counts and the current What's New includes an expedited-review request. Correct those in the next version's metadata. A suitable short What's New, once its advertised features are enabled and device-tested:

- Get started faster with a simpler welcome and clearer account signup.
- Create a free account to save and sync your meal plans and shopping lists.
- Sign in with Apple on iPhone and iPad.
- Eligible customers can try Apple Premium free for seven days, with clear renewal pricing.
- Account, shopping and onboarding reliability improvements.

Keep review requests in Apple's review correspondence, outside customer-facing release notes.
