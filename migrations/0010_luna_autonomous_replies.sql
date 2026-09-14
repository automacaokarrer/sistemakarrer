PRAGMA foreign_keys = ON;

CREATE TABLE luna_autonomous_replies (
  inbound_message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  outbound_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'skipped', 'failed')),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_luna_autonomous_conversation
ON luna_autonomous_replies(conversation_id, created_at DESC);
