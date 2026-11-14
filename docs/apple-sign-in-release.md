# Sign in with Apple release requirements

The first implementation is native iOS only. PWA email sign-up and login remain available. No Apple or Supabase configuration, policy or migration is changed by this code.

The app offers Apple only when all three checks pass: the Supabase Apple provider is enabled; the iOS native bridge is available; and `/api/auth/apple-config` reports `available: true`, `nativeOnly: true`, `deletionReady: true`. Until configuration is approved and completed, the existing email forms remain usable.

Required configuration, to be reviewed and approved before changing production:

- Enable Sign in with Apple on the existing Apple Developer App ID `uk.co.basketboss.app`. Refresh its provisioning profiles. The Xcode target includes the corresponding entitlement.
- Create or identify a **Sign in with Apple** signing key for that App ID. It is separate from the App Store/StoreKit API key. Keep the `.p8` private key in the server secret store, never source control, chat, build output or the public web bundle.
- Configure server environment values `APPLE_SIGN_IN_ENABLED=true`, `APPLE_SIGN_IN_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`, `APPLE_SIGN_IN_CLIENT_ID=uk.co.basketboss.app`, and secret `APPLE_SIGN_IN_PRIVATE_KEY`. The helper creates a short-lived five-minute Apple client-secret JWT per deletion request; no long-lived client secret is shipped in the app.
- Enable the Supabase Apple provider and add `uk.co.basketboss.app` as an allowed native client ID. Leave existing email/provider/redirect settings intact. Browser Apple OAuth is deliberately not activated by this release.
- Confirm the existing account-deletion readiness RPC and journal are available. No new database schema is required.

Native sign-in generates a secure nonce and request state, validates the native response state and passes the ID token and raw nonce to Supabase. Supabase verification and the existing session manager remain the only account/session authority.

For Apple-linked accounts, Delete Account first asks Apple for fresh authorization. Before starting the existing deletion journal, the server verifies the Apple JWT signature against Apple's HTTPS JWKS, issuer, exact native audience, recent issued-at/expiry, nonce and subject against the freshly authenticated Supabase identity. It exchanges the authorization code, checks the returned ID token belongs to the same subject/nonce, and revokes Apple's refresh token. Tokens and codes are never written to storage or logs. An unconfigured or failed revocation leaves the account and saved data intact. Existing email password deletion remains unchanged.

A durable pending deletion can be resumed by its verified owner without acquiring another Apple authorization code. No resume request can create a new deletion journal. Completed jobs keep the existing idempotent response behavior.

Before enabling the production gate, test on a physical signed iPhone: new Apple signup with Hide My Email, returning Apple login, cancellation/retry, sign-out/account switch, household access, and Delete Account including cancellation, successful revocation and a network-interrupted retry. Test email signup/login/deletion again. Portable/browser tests and unsigned simulator compilation do not prove live Apple authorization or provisioning works.

Apple requirements: [Offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/) and [Token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens).
