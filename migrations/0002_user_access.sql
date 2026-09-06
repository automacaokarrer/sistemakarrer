ALTER TABLE users ADD COLUMN can_chat INTEGER NOT NULL DEFAULT 1 CHECK (can_chat IN (0, 1));
ALTER TABLE users ADD COLUMN can_leads INTEGER NOT NULL DEFAULT 1 CHECK (can_leads IN (0, 1));
ALTER TABLE users ADD COLUMN can_clients INTEGER NOT NULL DEFAULT 1 CHECK (can_clients IN (0, 1));
ALTER TABLE users ADD COLUMN can_settings INTEGER NOT NULL DEFAULT 0 CHECK (can_settings IN (0, 1));

UPDATE users SET can_settings = 1 WHERE role = 'admin';

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_password_reset_token ON password_reset_tokens(token_hash, expires_at, used_at);
