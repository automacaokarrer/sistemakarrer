INSERT INTO user_login_sessions (id, user_id, started_at, last_seen_at, ended_at, last_page)
SELECT s.id,
  s.user_id,
  s.created_at,
  s.last_seen_at,
  CASE
    WHEN s.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN s.last_seen_at
    ELSE NULL
  END,
  NULL
FROM sessions s
WHERE NOT EXISTS (
  SELECT 1 FROM user_login_sessions tracked WHERE tracked.id = s.id
);
