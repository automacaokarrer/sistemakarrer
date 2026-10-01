-- Subadministrators do not have access to Configurações.
UPDATE users
SET can_settings = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE role = 'manager';
