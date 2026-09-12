ALTER TABLE conversations ADD COLUMN waiting_since TEXT;
ALTER TABLE conversations ADD COLUMN service_status TEXT NOT NULL DEFAULT 'new' CHECK (service_status IN ('new', 'in_progress', 'waiting_customer', 'resolved'));

UPDATE conversations
SET waiting_since = last_message_at
WHERE unread_count > 0 AND last_message_at IS NOT NULL;

UPDATE conversations
SET service_status = CASE WHEN assignee_id IS NOT NULL THEN 'in_progress' ELSE 'new' END;

CREATE INDEX IF NOT EXISTS idx_conversations_assignee ON conversations(assignee_id);
CREATE INDEX IF NOT EXISTS idx_conversations_service_status ON conversations(service_status);
