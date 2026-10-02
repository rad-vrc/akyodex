-- Apply explicitly before enabling budgeted inference. Re-running preserves state.
CREATE TABLE IF NOT EXISTS ai_budget_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  limit_neurons INTEGER NOT NULL CHECK (limit_neurons BETWEEN 1 AND 8000)
);
INSERT OR IGNORE INTO ai_budget_config VALUES (1, 0, 8000);
CREATE TABLE IF NOT EXISTS ai_budget_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0 AND units <= 8000),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS ai_budget_completion ON ai_budget_reservations(completed_at);
