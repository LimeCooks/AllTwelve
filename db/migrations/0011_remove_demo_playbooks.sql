DELETE FROM depth_charts
WHERE team_id = 'team-north-shore' AND id = 'depth-offence-doubles';

DELETE FROM plays
WHERE team_id = 'team-north-shore'
  AND id IN (
    'red-24', 'mesh-switch', 'northern-lights', 'boundary-sail',
    'ace-counter', 'doubles-mesh', 'orbit-screen', 'empty-smoke',
    'max-sail', 'qb-draw', 'sprint-flood', 'empty-power',
    'boundary-slip', 'trips-glance', 'bunch-wheel', 'heavy-toss',
    'doubles-stick', 'ace-play-action'
  );

DELETE FROM formations
WHERE team_id = 'team-north-shore'
  AND id IN (
    'formation-offence-doubles', 'formation-offence-ace',
    'formation-offence-trips-open', 'formation-offence-empty',
    'formation-offence-tight-bunch', 'formation-offence-heavy'
  );

DELETE FROM playbooks
WHERE team_id = 'team-north-shore'
  AND id IN ('offence', 'defence', 'special-teams', 'scout', '2025-offence');

INSERT OR IGNORE INTO app_migrations (id, applied_at)
VALUES ('0011_remove_demo_playbooks', CURRENT_TIMESTAMP);
