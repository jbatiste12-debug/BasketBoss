# Household invitation email

Optional transactional invitations use Resend. Supabase Auth's existing Resend
SMTP setup does **not** configure this separate API integration. No Auth users,
subscription records, prices, household feature flags or database schema are
changed by the email helper.

## Activation

Configure these server-side environment settings for the intended production
Cloudflare Pages project, then redeploy. Do not put a secret in client files, Git,
screenshots or chat.

| Setting | Required value |
| --- | --- |
| `BB_HOUSEHOLD_INVITE_EMAIL_ENABLED` | Exact string `true`; absent or anything else leaves sending off |
| `RESEND_API_KEY` | A Resend API key with permission to send from your verified domain; use a sending-only key |
| `BB_HOUSEHOLD_INVITE_EMAIL_FROM` | Your verified sender, for example `BasketBoss <invite@your-verified-domain>` |

Use a sender domain already verified in your Resend account. Existing Supabase
SMTP settings do not populate Cloudflare's API key: configure the Resend API key
directly in Cloudflare. Keep provider account quotas enabled. This implementation has not inspected or changed live secrets,
verified a sender, sent a real email, or confirmed inbox delivery.

Missing settings return a successful saved invitation with `email_sent:false`
and `email_status:"not_configured"`. The invited person can still sign in with
their confirmed invited email and review the pending invitation in the app.

## Access and invitation lifetime

The email contains only `https://www.basketboss.co.uk/app#partner-sharing`.
It contains no auth token, invitation capability, household identifier or
automatic acceptance. Signing in with the invited confirmed email is required.
Existing server checks remain authoritative: current session, eligible owner,
pending invite, matching confirmed email, no existing household, seven-day
expiry, revocation and household isolation. Native users can open BasketBoss
and use Settings > Household Partner Sharing if the web link opens Safari.

Before sending, the server rereads the exact pending invitation and household
owned by the authenticated actor. An expired, revoked, accepted, reassigned or
unreadable invitation will not trigger an email. Revocation immediately removes
acceptance eligibility; it cannot recall an email already accepted by Resend.

## Duplicate and send-volume protection

The Resend `Idempotency-Key` is a SHA-256 digest of the verified owner's UUID and
the server's UTC hour, prefixed with `bb-household-invite/`. It does not contain
the recipient, household or invite revision. All server instances use the same
key for that owner and hour. The fixed plain-text body contains no timestamps,
invite IDs, user names or user-written content.

Under Resend's documented 24-hour idempotency contract:

- Repeating the same recipient/payload returns the existing acceptance without
  sending a second email, including concurrent/retried requests.
- Changing the recipient or sender in the same hour conflicts with the existing
  key; no second message is sent. The new invitation remains available in-app.
- A new owner/hour has a new key. This bounds accepted unique messages to one per
  owner per UTC hour bucket (24 per UTC day; two can occur close to a boundary).
  It does not limit HTTP request volume or replace provider-wide sending quotas.

A provider idempotency conflict returns `email_status:"rate_limited"` and a
`retry_after_seconds` value until the next UTC hour. Do not change the key to
bypass a conflict, add recipient/revision to it, retry with a random key, or add
variable text to the payload. A concurrent processing conflict can be retried
with the same key; until confirmed the UI must say email is unconfirmed.

## Response contract

Existing saved-invite fields are preserved. New optional fields:

| Field | Meaning |
| --- | --- |
| `email_available` | Server email settings are present and syntactically valid; not proof the provider or sender works |
| `email_sent` | Legacy field: `true` only when Resend accepted the request; never proof of delivery |
| `email_status` | `accepted`, `not_configured`, `not_sent`, `unavailable`, or `rate_limited` |
| `message` | Honest user-facing save/email status |
| `invite_url` / `invite_expires_at` | Generic entry link and actual expiry, only after validated pending-record readback |
| `retry_after_seconds` | Present on a provider idempotency conflict |

No delivery webhook is added, so bounces, inbox delivery and opening are unknown.
Provider failures and timeouts preserve the successful invitation save. No
email address, provider response, provider message ID or secret is logged.

## Verification

Run `node --test tests/basketboss-household-email.test.mjs` with mock requests.
Tests cover exact opt-in, fail-closed readbacks, origin/auth/Premium gates,
verified ownership, concurrency, changed recipients, retries, hourly separation,
provider failure and truthful status. They send no real email.

Official provider contracts:

- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://resend.com/docs/api-reference/errors
