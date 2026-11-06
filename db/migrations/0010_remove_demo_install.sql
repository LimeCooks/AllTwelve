DELETE FROM install_items
WHERE package_id = 'install-week-5';

UPDATE install_packages
SET game_id = NULL,
    name = 'Current install',
    due_at = '',
    published_at = NULL
WHERE id = 'install-week-5'
  AND team_id = 'north-shore-varsity';

INSERT OR IGNORE INTO app_migrations (id, applied_at)
VALUES ('0010_remove_demo_install', CURRENT_TIMESTAMP);
