# Optional owner household access

`BB_OWNER_HOUSEHOLD_ENABLED` is a server-only, default-OFF switch. Only its exact
string value `true`, together with the existing exact valid `BB_OWNER_USER_ID`,
lets the verified owner account create a shared household without a purchase.
This is complimentary sharing access, not an Apple or Paddle subscription.
Ordinary personal payment checks are unchanged unless a household caller
explicitly opts into this grant.

All existing production host/branch/tenant, confirmed-email, newest-session,
sharing feature, database and same-origin guards remain required. The owner's
account deletion journal must also be available and contain no deletion entry.
One accepted partner with the matching verified email inherits access and the
owner's existing AI allowance, without payment details or billing rights. Both
accounts use the same household receipt inventory scope. Apple Sandbox payments
alone still cannot enable sharing.

No configuration, accounts, catalogue, schema or live records are changed by
this patch. Deploying the patch leaves the switch OFF unless it is explicitly
configured separately. Removing the switch or setting it to `false` immediately
removes complimentary inherited access on the next server check; paid production
Paddle/Apple and valid persisted TestFlight access continue under existing rules.
Keep household records and saved plans during rollback.

Local regression coverage:

```sh
node --test tests/basketboss-owner-household.test.mjs \
tests/basketboss-household-production.test.mjs tests/basketboss-apple-access.test.mjs
```

Also run `tests/basketboss-testflight-beta-household.test.mjs` to preserve the
independent persisted TestFlight grant behavior.
