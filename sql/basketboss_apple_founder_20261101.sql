-- D1 / SQLite. Apply after the existing production Founder slot schema.
-- Does not create, reset, resize or refill the production bb_founder_slots pool.
CREATE TABLE IF NOT EXISTS bb_apple_founder_claims (
  claim_id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('Production','Sandbox')),
  user_id TEXT NOT NULL,
  app_account_token TEXT NOT NULL,
  slot_no INTEGER NOT NULL CHECK (slot_no BETWEEN 1 AND 25),
  reservation_token_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved','confirmed','retired')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (environment,user_id),
  UNIQUE (environment,app_account_token),
  UNIQUE (environment,slot_no)
);
CREATE INDEX IF NOT EXISTS bb_apple_founder_claims_user ON bb_apple_founder_claims(user_id);
CREATE TABLE IF NOT EXISTS bb_apple_founder_transactions (
  environment TEXT NOT NULL CHECK (environment IN ('Production','Sandbox')),
  original_transaction_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  claim_id TEXT NOT NULL REFERENCES bb_apple_founder_claims(claim_id),
  linked_at_ms INTEGER NOT NULL,
  PRIMARY KEY (environment,original_transaction_id)
);
CREATE INDEX IF NOT EXISTS bb_apple_founder_transactions_user ON bb_apple_founder_transactions(user_id);
-- TestFlight / sandbox purchases NEVER reserve or consume a production place.
CREATE TABLE IF NOT EXISTS bb_apple_founder_sandbox_slots (
  slot_no INTEGER PRIMARY KEY CHECK (slot_no BETWEEN 1 AND 25),
  state TEXT NOT NULL CHECK (state IN ('available','reserved','active','retired')),
  user_id TEXT,
  reservation_token_hash TEXT,
  paddle_subscription_id TEXT,
  reservation_expires_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO bb_apple_founder_sandbox_slots(slot_no,state) VALUES
 (1,'available'),(2,'available'),(3,'available'),(4,'available'),(5,'available'),
 (6,'available'),(7,'available'),(8,'available'),(9,'available'),(10,'available'),
 (11,'available'),(12,'available'),(13,'available'),(14,'available'),(15,'available'),
 (16,'available'),(17,'available'),(18,'available'),(19,'available'),(20,'available'),
 (21,'available'),(22,'available'),(23,'available'),(24,'available'),(25,'available');
