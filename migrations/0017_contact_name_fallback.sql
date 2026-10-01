-- Never present a private WhatsApp LID as a contact name.
UPDATE contacts
SET name = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE name = phone
   OR (chat_lid IS NOT NULL AND name = chat_lid)
   OR name LIKE '%@lid';
