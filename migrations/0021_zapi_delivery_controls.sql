-- Prevent duplicated outbound requests and concurrent processing of the same callback.
CREATE TABLE zapi_send_dedupe (
  dedupe_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed', 'uncertain')),
  message_id TEXT,
  provider_message_id TEXT,
  recipient_phone TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_zapi_send_dedupe_updated ON zapi_send_dedupe(updated_at DESC);

CREATE TABLE zapi_event_locks (
  event_key TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_zapi_event_locks_expires ON zapi_event_locks(expires_at);

-- Operational counters contain no message text, phone number, token or response body.
CREATE TABLE zapi_delivery_logs (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  http_status INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'provider_rejected', 'timeout', 'network_error')),
  error_code TEXT,
  latency_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_zapi_delivery_logs_created ON zapi_delivery_logs(created_at DESC);
