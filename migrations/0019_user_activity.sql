CREATE TABLE user_login_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ended_at TEXT,
  last_page TEXT
);

CREATE TABLE user_page_visits (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES user_login_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX idx_user_login_sessions_user_started ON user_login_sessions(user_id, started_at DESC);
CREATE INDEX idx_user_login_sessions_last_seen ON user_login_sessions(last_seen_at DESC);
CREATE INDEX idx_user_page_visits_session_started ON user_page_visits(session_id, started_at DESC);
CREATE INDEX idx_user_page_visits_user_started ON user_page_visits(user_id, started_at DESC);
