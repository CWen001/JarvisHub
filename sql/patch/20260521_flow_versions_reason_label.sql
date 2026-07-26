BEGIN;

ALTER TABLE flow_versions
	ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE flow_versions
	ADD COLUMN IF NOT EXISTS label TEXT;

UPDATE flow_versions SET reason = 'agent_turn'
	WHERE name LIKE 'agent-turn-%' AND reason = 'legacy';

UPDATE flow_versions SET reason = 'agent_explicit'
	WHERE name = 'agent-checkpoint' AND reason = 'legacy';

CREATE INDEX IF NOT EXISTS idx_flow_versions_flow_id_reason
	ON flow_versions(flow_id, reason);

COMMIT;
