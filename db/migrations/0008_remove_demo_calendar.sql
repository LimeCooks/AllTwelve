DELETE FROM calendar_events
WHERE team_id = 'north-shore-varsity'
  AND id IN (
    'calendar-film-review',
    'calendar-base-install',
    'calendar-full-pads',
    'calendar-situational-practice',
    'calendar-hamilton-game',
    'calendar-staff-grading'
  );

INSERT OR IGNORE INTO app_migrations (id, applied_at)
VALUES ('0008_remove_demo_calendar', CURRENT_TIMESTAMP);
