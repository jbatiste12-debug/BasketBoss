-- Cloudflare D1 / SQLite only. Apply separately before enabling Play billing.
-- No products, prices, subscriptions or existing customer rows are changed.
CREATE TABLE IF NOT EXISTS bb_google_play_account_tokens (
 user_id TEXT PRIMARY KEY,
 obfuscated_account_id TEXT NOT NULL UNIQUE,
 created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bb_google_play_lineages (
 lineage_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 obfuscated_account_id TEXT NOT NULL,
 head_token_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bb_google_play_subscriptions (
 token_hash TEXT PRIMARY KEY,
 purchase_token TEXT NOT NULL,
 user_id TEXT NOT NULL,
 obfuscated_account_id TEXT NOT NULL,
 lineage_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 base_plan_id TEXT NOT NULL,
 offer_id TEXT,
 plan TEXT NOT NULL CHECK(plan IN ('monthly','annual')),
 status TEXT NOT NULL CHECK(status IN ('active','canceled','grace_period','on_hold','paused','pending','pending_canceled','expired')),
 environment TEXT NOT NULL CHECK(environment IN ('test','production')),
 expires_at_ms INTEGER NOT NULL,
 cancel_at_period_end INTEGER NOT NULL CHECK(cancel_at_period_end IN (0,1)),
 acknowledged INTEGER NOT NULL CHECK(acknowledged IN (0,1)),
 replaced_by_hash TEXT,
 reconciliation_generation INTEGER NOT NULL,
 last_verified_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bb_google_play_subscriptions_user ON bb_google_play_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS bb_google_play_subscriptions_lineage ON bb_google_play_subscriptions(lineage_id);
CREATE TABLE IF NOT EXISTS bb_google_play_leases (
 token_hash TEXT PRIMARY KEY,
 generation INTEGER NOT NULL,
 locked_until_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bb_google_play_notifications (
 message_id TEXT PRIMARY KEY,
 token_hash TEXT,
 processed_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bb_google_play_schema (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
INSERT OR IGNORE INTO bb_google_play_schema(id,version) VALUES(1,1);
