# BasketBoss email confirmation and password recovery

The client uses pinned Supabase JS 2.119.0. Supabase verifies callback credentials before BasketBoss stores a session. Signup, sign-in, resend and reset requests share a submission lock. Email requests have a 60-second client cooldown; Supabase and the mail provider still enforce their own limits.

## Supabase dashboard settings

In Authentication → URL Configuration, keep the production Site URL on the BasketBoss domain. Add these owned return destinations to Redirect URLs (the trailing glob permits the SDK's query parameters):

- `https://www.basketboss.co.uk/app**`
- `https://basketboss.co.uk/app**`
- `basketboss://auth/callback**`

Keep the normal `{{ .ConfirmationURL }}` links in the confirmation and password-recovery templates so Supabase can verify the link and honor the request's return destination. Both web and native callers now provide an explicit return URL. Existing links returning to the landing page are securely forwarded into the app.

The client also accepts `token_hash` with `type=signup`, `email` or `recovery`, PKCE `code`/`sb_flow_id`, and legacy access/refresh-token fragments. URL credentials are removed before analytics and are never cached by the PWA worker. Callback credentials are consumed once from a short-lived transient envelope. Native cold and warm launch links both use the same verified flow, including when the app was showing Cook.

PKCE code links must return to the browser/app where the flow started; a missing verifier produces recovery instructions rather than accepting an unverified session. A recovery session opens Set a new password and is not promoted to the ordinary app session until the password update succeeds. Normal verified confirmation opens Plan and shows the welcome message.

## Mail delivery

Verify the sending domain in Resend and connect its SMTP details in Supabase Authentication → Email → SMTP Settings. Retain existing Zoho receiving MX records. Check the actual Supabase Auth email rate limit against the provider's allowance. Domain verification alone does not connect the sender.

No SMTP credentials, Auth settings, confirmation requirements, user records or Premium grants were changed by the client release. Enter SMTP credentials directly in the provider/Supabase dashboards.

## Controlled live check after configuration

1. Create an account using a real inbox you control. Repeated taps should send one signup request and show Check your email with Resend disabled during cooldown.
2. Confirm the email: web returns to Plan; on iOS, test both a running app and a closed app. The welcome message must follow successful Supabase verification.
3. Sign out, choose Forgot password, request a reset, follow the link and save a new password. Confirm the old password fails and the new password signs in.
4. Verify expired links and unavailable-network errors offer a recovery path. Confirm existing saved plans and membership remain intact.

Automated tests use mocked HTTP and synthetic identities. They send no emails and do not validate live delivery or Apple signing.

References: https://supabase.com/docs/guides/auth/redirect-urls and https://supabase.com/docs/guides/auth/auth-smtp
