PRAGMA foreign_keys = ON;

CREATE TABLE luna_memories (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source TEXT NOT NULL DEFAULT 'luna',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_luna_memories_context
ON luna_memories(contact_id, conversation_id, importance DESC, updated_at DESC);

CREATE TABLE luna_document_analyses (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  document_id TEXT,
  file_key TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image', 'pdf', 'audio_transcription')),
  document_type TEXT,
  status TEXT NOT NULL CHECK (status IN ('APPROVED', 'INCOMPLETE', 'UNREADABLE', 'REVIEW_REQUIRED', 'NOT_RELEVANT')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  summary TEXT NOT NULL,
  extracted_data_json TEXT NOT NULL DEFAULT '{}',
  problems_json TEXT NOT NULL DEFAULT '[]',
  pending_items_json TEXT NOT NULL DEFAULT '[]',
  analyzed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(contact_id, file_key, file_hash)
);

CREATE INDEX idx_luna_document_analyses_contact
ON luna_document_analyses(contact_id, updated_at DESC);

CREATE TABLE luna_pending_items (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  source_analysis_id TEXT REFERENCES luna_document_analyses(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

CREATE INDEX idx_luna_pending_items_context
ON luna_pending_items(contact_id, conversation_id, status, updated_at DESC);

CREATE TABLE luna_conversation_summaries (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  through_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE luna_runs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  input_type TEXT NOT NULL CHECK (input_type IN ('text', 'image', 'pdf', 'audio_transcription')),
  file_key TEXT,
  agent_id TEXT,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'cached')),
  error_code TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_luna_runs_contact ON luna_runs(contact_id, created_at DESC);
