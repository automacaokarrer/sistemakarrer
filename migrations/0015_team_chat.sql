CREATE TABLE team_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body TEXT,
  media_key TEXT UNIQUE,
  media_mime TEXT,
  mention_all INTEGER NOT NULL DEFAULT 0 CHECK (mention_all IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (body IS NOT NULL OR media_key IS NOT NULL)
);

CREATE TABLE team_message_mentions (
  message_id INTEGER NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX idx_team_message_mentions_user ON team_message_mentions(user_id, message_id);

CREATE TABLE team_chat_reads (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0
);
