# Private 500-recipe catalogue activation

The production code is on `main`. Activating the expanded catalogue requires
400 Premium records in the isolated D1 table
`bb_private_premium_recipes_500_v1`, alongside the existing 100 public recipes.
The legacy `bb_private_premium_recipes` table stays unchanged for installed
clients and saved recipe IDs.

GitHub Actions uses the `github-pages` environment's
`CLOUDFLARE_API_TOKEN` secret and optional `CLOUDFLARE_ACCOUNT_ID` variable.
The token needs Pages Read and D1 Edit on the BasketBoss account. Neither the
token nor a decryption key is committed or printed.

`Check Cloudflare catalogue connection` discovers the Pages project serving
`basketboss.co.uk`, its production `BILLING_DB` binding, current deployment
commit and catalogue counts. Its notices expose only non-secret metadata and
a public encryption recipient. Account discovery can be bypassed by setting
the non-secret account ID variable.

The private catalogue is transported as encrypted structured rows in
`.github/private-catalogue/recipes-500.sealed.json`. Domain-separated HKDF
derives an X25519 recipient from the existing high-entropy Cloudflare token;
an ephemeral X25519 key and AES-256-GCM protect each envelope. The import also
pins the approved plaintext and generated SQL hashes: knowing the public key
does not authorize a different catalogue. Token rotation requires obtaining
the new public recipient and resealing the bundle.

`Activate private 500-recipe catalogue` runs only on `main`, in the same
environment, with serialized imports. A push changing the sealed bundle
activates it; manual runs default to read-only `inspect` mode. It verifies:

- Approved release, source commit, payload hash, SQL hash and all 400 rows.
- Current production binding and deployment containing the reviewed release.
- All 221 original Premium IDs and their unchanged legacy content.
- Atomic whole-file import through pinned Wrangler 4.156.0.
- Exact stored IDs, order, recipe JSON and normalization for all 400 rows.
- Live landing copy, 100 public recipes, Premium authentication guard and a
  representative new WebP image.

Plaintext SQL exists only in a restricted runner temporary directory and is
removed in `finally`. The rollback snapshot is encrypted before its artifact
upload and retained for seven days. No plaintext recipes or SQL are uploaded
as artifacts. Retain the original token securely if that encrypted snapshot
must be decrypted after token rotation.

The workflow emits a `database-verified` notice before checking public routes,
so a later website-check failure can be distinguished from a failed import.
It does not simulate a real subscriber login. Re-running an already matching
release verifies it without importing it again.
