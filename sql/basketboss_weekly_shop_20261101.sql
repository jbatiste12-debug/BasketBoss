-- D1 / SQLite only. Isolated allowance metadata; no shopping contents or billing changes.
-- The authenticated endpoint can prepare these exact additive objects lazily.
CREATE TABLE IF NOT EXISTS bb_weekly_shop_trips (
 actor_hash TEXT NOT NULL,
 week_start TEXT NOT NULL,
 session_id TEXT NOT NULL,
 started_at_ms INTEGER NOT NULL,
 PRIMARY KEY(actor_hash,week_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS bb_weekly_shop_sessions ON bb_weekly_shop_trips(actor_hash,session_id);
