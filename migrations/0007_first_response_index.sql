CREATE INDEX IF NOT EXISTS idx_messages_first_response
ON messages(conversation_id, direction, created_at, id);
