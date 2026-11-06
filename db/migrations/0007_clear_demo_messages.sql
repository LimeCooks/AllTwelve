DELETE FROM `workspace_state`
WHERE `team_id` = 'team-north-shore'
  AND `state_key` IN ('message-centre', 'messages-team');
