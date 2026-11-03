-- D1 / SQLite only. Review/apply before enabling BB_TTS_ENABLED.
-- Leases contain a speech hash and random claim; no prompt, account or audio.
CREATE TABLE IF NOT EXISTS bb_tts_cache_leases (
 clip_id TEXT PRIMARY KEY,
 lease_token TEXT NOT NULL,
 locked_until_ms INTEGER NOT NULL
);
-- Uses the same account-deletion-cleaned usage table as the existing AI tools.
-- Cache hits consume no generation allowance. No existing limits are changed.
CREATE TABLE IF NOT EXISTS bb_ai_daily_usage (
 day_utc TEXT NOT NULL,
 actor TEXT NOT NULL,
 action TEXT NOT NULL,
 used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
 PRIMARY KEY(day_utc,actor,action)
);
