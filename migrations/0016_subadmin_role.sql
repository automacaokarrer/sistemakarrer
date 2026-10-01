-- Managers are subadministrators: they may view settings but never manage users.
UPDATE users
SET can_settings = 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE role = 'manager';
