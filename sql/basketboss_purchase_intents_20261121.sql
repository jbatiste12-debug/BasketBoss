-- Cloudflare D1 / SQLite only. Apply separately; runtime never creates tables.
-- Existing account-deletion journal/ref tables are required. No payment-provider
-- rows, products, prices, account entitlements or store subscriptions are changed.
CREATE TABLE IF NOT EXISTS bb_purchase_intent_slots (
 user_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
 billing_revision INTEGER NOT NULL DEFAULT 0 CHECK(billing_revision>=0),
 active_intent_id TEXT,
 updated_at_ms INTEGER NOT NULL,
 PRIMARY KEY(user_id,mode)
);
CREATE TABLE IF NOT EXISTS bb_purchase_intents (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 provider TEXT NOT NULL CHECK(provider IN ('apple','google_play','paddle')),
 product_id TEXT NOT NULL,
 base_plan_id TEXT,
 offer_id TEXT,
 protocol INTEGER NOT NULL CHECK(protocol=1),
 generation INTEGER NOT NULL CHECK(generation>0),
 phase TEXT NOT NULL CHECK(phase IN ('prepared','started','pending','unknown','completed','canceled')),
 version INTEGER NOT NULL CHECK(version>0),
 session_hash TEXT NOT NULL,
 capability_hash TEXT NOT NULL,
 deletion_ref_hash TEXT NOT NULL UNIQUE,
 billing_revision INTEGER NOT NULL,
 prepared_expires_at_ms INTEGER NOT NULL,
 created_at_ms INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL,
 reference_hash TEXT,
 pending_seen INTEGER NOT NULL DEFAULT 0 CHECK(pending_seen IN (0,1)),
 proof_seen INTEGER NOT NULL DEFAULT 0 CHECK(proof_seen IN (0,1)),
 last_action TEXT NOT NULL,
 last_request_version INTEGER,
 cause TEXT
);
-- Immutable identity/history: attempts are never reassigned or recycled. Only
-- their lifecycle snapshot changes; the append-only event log retains changes.
CREATE UNIQUE INDEX IF NOT EXISTS bb_purchase_intents_active
 ON bb_purchase_intents(user_id,mode) WHERE phase IN ('prepared','started','pending','unknown');
CREATE UNIQUE INDEX IF NOT EXISTS bb_purchase_intents_reference
 ON bb_purchase_intents(provider,mode,reference_hash) WHERE reference_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS bb_purchase_intents_user ON bb_purchase_intents(user_id,mode,created_at_ms);
CREATE TABLE IF NOT EXISTS bb_purchase_intent_events (
 event_id INTEGER PRIMARY KEY AUTOINCREMENT,
 intent_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 phase TEXT NOT NULL,
 action TEXT NOT NULL,
 cause TEXT,
 created_at_ms INTEGER NOT NULL,
 UNIQUE(intent_id,version)
);
CREATE TABLE IF NOT EXISTS bb_purchase_intent_proofs (
 provider TEXT NOT NULL CHECK(provider IN ('apple','google_play','paddle')),
 mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 reference_hash TEXT NOT NULL,
 user_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 intent_id TEXT,
 phase TEXT NOT NULL CHECK(phase IN ('pending','completed','canceled','unknown')),
 observed_at_ms INTEGER NOT NULL,
 PRIMARY KEY(provider,mode,reference_hash)
);
CREATE TABLE IF NOT EXISTS bb_purchase_intent_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
INSERT OR IGNORE INTO bb_purchase_intent_schema(id,version) VALUES(1,1);
