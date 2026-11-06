DELETE FROM `athletes`
WHERE `team_id` = 'team-north-shore'
  AND `id` IN (
    'ath-jordan-lee',
    'ath-marcus-brown',
    'ath-noah-tremblay',
    'ath-liam-chen',
    'ath-andre-joseph',
    'ath-evan-macdonald',
    'ath-cole-fraser',
    'ath-sam-okafor',
    'ath-jay-ahmed',
    'ath-ravi-patel',
    'ath-aiden-peters',
    'ath-taj-singh',
    'ath-michel-savoie',
    'ath-ben-clarke',
    'ath-malik-white'
  );
