-- Preserve the number actually used for an outbound send. It must be known
-- before an existing WhatsApp message can be edited or deleted for everyone.
ALTER TABLE messages ADD COLUMN recipient_phone TEXT;
ALTER TABLE messages ADD COLUMN edited_at TEXT;
ALTER TABLE messages ADD COLUMN deleted_at TEXT;
ALTER TABLE messages ADD COLUMN recipient_mismatch_at TEXT;
ALTER TABLE messages ADD COLUMN mutation_token TEXT;

-- Keep WhatsApp private IDs distinct from numeric phone numbers.
ALTER TABLE contacts ADD COLUMN chat_lid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_chat_lid ON contacts(chat_lid) WHERE chat_lid IS NOT NULL;
