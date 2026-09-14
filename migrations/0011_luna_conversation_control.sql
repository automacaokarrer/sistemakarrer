PRAGMA foreign_keys = ON;

ALTER TABLE conversations ADD COLUMN luna_autonomous_enabled INTEGER NOT NULL DEFAULT 0 CHECK (luna_autonomous_enabled IN (0, 1));
ALTER TABLE conversations ADD COLUMN luna_enabled_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN luna_enabled_at TEXT;

CREATE INDEX idx_conversations_luna_autonomous
ON conversations(luna_autonomous_enabled, service_status, assignee_id)
WHERE luna_autonomous_enabled = 1;
