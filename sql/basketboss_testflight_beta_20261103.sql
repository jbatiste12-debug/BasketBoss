-- Additive D1/SQLite schema, also ensured lazily by the activation endpoint.
-- No purchase, paid subscription or existing customer record is changed.
CREATE TABLE IF NOT EXISTS bb_testflight_beta_grants (
 proof_hash TEXT PRIMARY KEY,
 user_id TEXT UNIQUE,
 started_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 application_version TEXT NOT NULL,
 receipt_created_at_ms INTEGER NOT NULL,
 revoked_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS bb_testflight_beta_grants_user ON bb_testflight_beta_grants(user_id);
