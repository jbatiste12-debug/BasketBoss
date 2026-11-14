# Proposed signup confirmation email — approval required

This is a reviewable email-template proposal. It has not been applied to Supabase, and it changes no provider, redirect configuration, expiry, database policy or user data.

## Purpose and evidence

The current app requests signup with PKCE. Its code verifier belongs to the originating browser or iOS WebView. An email opened in another browser, Private Browsing context or email app can therefore confirm the email on the server but fail to establish the app session. A confirmed account followed by successful manual password sign-in is consistent with this; it does not prove the exact cause of any particular failed link.

The existing callback supports `verifyOtp({token_hash, type: 'signup'})`, followed by an independent Supabase `getUser` check before the session can be saved. The proposed email uses this existing path, with no dependency on the originating PKCE verifier.

## Exact proposed change

After reviewing and approving it, replace only the **Confirm signup** email body in the production Supabase project's Authentication email templates with [auth-confirm-signup-token-hash-proposal.html](auth-confirm-signup-token-hash-proposal.html). A suitable subject is **Confirm your BasketBoss email**. Preserve a copy of the existing subject and body for rollback. Do not change the recovery, magic-link, invitation or email-change templates.

The one confirmation button uses this fixed owned HTTPS destination:

```html
https://basketboss.co.uk/app#token_hash={{ .TokenHash }}&amp;type=signup
```

The fragment keeps the token out of the initial HTTP request, ordinary server request logs and HTTP referrers. The app captures it before analytics, removes it from the address bar, verifies the one-time bearer token with Supabase and independently verifies the resulting user before saving a session. Never replace this with code that trusts the URL, creates a local session or marks an email as verified without Supabase verification.

## Trade-offs to approve

- This intentionally allows signup confirmation in a different browser from the signup request. The confirmation link is consequently a bearer credential: anyone possessing an unused valid link can complete the confirmation session. Supabase's existing expiry and one-use verification remain authoritative. Do not log real links or tokens, add tracking redirects, or send them to third-party link services.
- The fixed HTTPS link confirms the email in the browser that opens it. It does not transfer that browser's private session into the iPhone app. The email explicitly tells iPhone users to return to BasketBoss and sign in with their email and password. Native Apple sign-in is a separate optional path.
- This does not establish that the observed live failure was caused by PKCE, expiry, a mail scanner or a reused link. The improved error screen now offers password sign-in without claiming an unknown failure was expiry.
- A mail security scanner that executes the full app could still consume a one-time confirmation link. A subsequently reused link must show recoverable guidance, never grant a session. Manual password sign-in remains available for a confirmed account.

## Concrete verification and rollout checks

`tests/basketboss-onboarding-auth-browser.test.mjs` includes the actual bundled Supabase SDK in a generated 700-recipe app, with all network requests fulfilled locally. Its fresh-context confirmation case asserts that there is no PKCE verifier, the SDK calls `/auth/v1/verify` with the token hash, the returned user passes `getUser`, the saved session survives reload, the URL is scrubbed, and reuse is rejected. The originating browser is never silently signed in.

Before any approved production rollout, render a Supabase test email and verify that the GoTrue `{{ .TokenHash }}` placeholder produces the expected owned link. Use a disposable fresh account to test Safari, Gmail/in-app browser, Private Browsing and the iPhone app handoff. Confirm a new Auth record and verification state through an authorized aggregate/test-account check. Do not include the real recipient, password, token or confirmation URL in screenshots or logs.

If validation fails, restore the previous **Confirm signup** subject/body. Existing email/password sign-in and the native Apple readiness gates remain unchanged.
