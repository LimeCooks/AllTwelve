DELETE FROM calendar_events
WHERE team_id = 'north-shore-varsity'
  AND id IN (
    'cfa5f7fc-e8b0-4585-8e38-f6cf2d46b9cb',
    'bf71ffb2-5806-4b2f-baa5-6dce99d4a769'
  );

INSERT OR IGNORE INTO app_migrations (id, applied_at)
VALUES ('0009_remove_qa_calendar', CURRENT_TIMESTAMP);
