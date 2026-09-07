ALTER TABLE users ADD COLUMN avatar_key TEXT;
ALTER TABLE users ADD COLUMN instagram TEXT;
ALTER TABLE users ADD COLUMN professional_role TEXT;
ALTER TABLE users ADD COLUMN registration_source TEXT NOT NULL DEFAULT 'admin' CHECK (registration_source IN ('admin', 'self'));

CREATE UNIQUE INDEX idx_users_instagram ON users(instagram) WHERE instagram IS NOT NULL;
CREATE INDEX idx_sessions_presence ON sessions(user_id, last_seen_at DESC);

CREATE TABLE contact_documents (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_contact_documents_contact ON contact_documents(contact_id, created_at DESC);
