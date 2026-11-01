-- D1 / SQLite migration. This is NOT a Supabase/Postgres migration.
-- Apply to the existing BILLING_DB binding before enabling Apple billing.
-- No existing Paddle, founder, account or household rows are modified.
CREATE TABLE IF NOT EXISTS bb_apple_account_tokens (
 user_id TEXT PRIMARY KEY,
 app_account_token TEXT NOT NULL UNIQUE,
 created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bb_apple_subscriptions (
 environment TEXT NOT NULL CHECK(environment IN ('Production','Sandbox')),
 original_transaction_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 app_account_token TEXT NOT NULL,
 latest_transaction_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 plan TEXT NOT NULL CHECK(plan IN ('monthly','annual','founder')),
 status TEXT NOT NULL CHECK(status IN ('active','expired','billing_retry','grace_period','revoked')),
 expires_at_ms INTEGER NOT NULL,
 grace_expires_at_ms INTEGER,
 revoked_at_ms INTEGER,
 cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0,1)),
 apple_signed_at_ms INTEGER NOT NULL,
 last_verified_at_ms INTEGER NOT NULL,
 PRIMARY KEY(environment,original_transaction_id)
);
CREATE INDEX IF NOT EXISTS bb_apple_subscriptions_user ON bb_apple_subscriptions(user_id,environment);
CREATE TABLE IF NOT EXISTS bb_apple_notifications (
 environment TEXT NOT NULL CHECK(environment IN ('Production','Sandbox')),
 notification_uuid TEXT NOT NULL,
 original_transaction_id TEXT,
 signed_at_ms INTEGER NOT NULL,
 processed_at_ms INTEGER NOT NULL,
 PRIMARY KEY(environment,notification_uuid)
);
CREATE TABLE IF NOT EXISTS bb_apple_schema (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
INSERT OR IGNORE INTO bb_apple_schema(id,version) VALUES(1,1);
