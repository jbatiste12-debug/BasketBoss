-- Execute in basketboss-billing-live D1 before enabling AI.
CREATE TABLE IF NOT EXISTS bb_ai_daily_usage (
  day_utc TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('scan','generate','all')),
  used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),
  PRIMARY KEY(day_utc,actor,action)
);
