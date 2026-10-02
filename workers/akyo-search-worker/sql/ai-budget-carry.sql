-- First cutover only: replace the sentinel with the reviewed, rounded-up
-- Neuron bound (1..8000). Unedited SQL deliberately fails instead of importing 0.
WITH carry(units) AS (VALUES (REPLACE_WITH_VERIFIED_NEURONS))
INSERT INTO ai_budget_reservations (id, units, completed_at)
SELECT 'unguarded-cutover-v1', CASE WHEN typeof(carry.units) = 'integer' THEN carry.units END, unixepoch()
FROM ai_budget_config, carry WHERE id = 1 AND enabled = 0
ON CONFLICT(id) DO UPDATE SET
  units = MAX(ai_budget_reservations.units, excluded.units),
  completed_at = unixepoch()
WHERE ai_budget_reservations.completed_at IS NOT NULL
RETURNING id, units, completed_at;
