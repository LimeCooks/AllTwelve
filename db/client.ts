import { env } from 'cloudflare:workers';
import { isPrototype, requestIdentity } from '@/lib/request-identity';
import { requestWorkspaceId } from '@/lib/request-identity';
import {
  resolveWorkspaceGrant,
  requireTeamPermission,
  type TeamPermission,
  type WorkspaceGrant,
} from '@/lib/team-permissions';
import { scopedDatabase, WorkspaceAccessError } from '@/lib/workspace-identity';
export type { TeamDatabase } from '@/lib/workspace-identity';

const TEAM_ID = 'team-north-shore-2026';

const bootstrapStatements = [
  `CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    season TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS athletes (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    number INTEGER,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    position TEXT NOT NULL,
    unit TEXT NOT NULL,
    graduation_year INTEGER NOT NULL,
    height TEXT NOT NULL,
    weight_lb INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active',
    eligibility TEXT NOT NULL DEFAULT 'Cleared',
    attendance_percent INTEGER NOT NULL DEFAULT 100,
    install_percent INTEGER NOT NULL DEFAULT 0,
    email TEXT NOT NULL,
    phone TEXT,
    staff_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_athletes_team_number ON athletes(team_id, number) WHERE number IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_athletes_team_email ON athletes(team_id, email)',
  'CREATE INDEX IF NOT EXISTS idx_athletes_team_unit ON athletes(team_id, unit)',
  'CREATE INDEX IF NOT EXISTS idx_athletes_team_status ON athletes(team_id, status)',
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    opponent TEXT NOT NULL,
    kickoff_at TEXT NOT NULL,
    venue TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    home_away TEXT NOT NULL DEFAULT 'home'
  )`,
  'CREATE INDEX IF NOT EXISTS idx_games_team_kickoff ON games(team_id, kickoff_at)',
  `CREATE TABLE IF NOT EXISTS formations (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    personnel TEXT NOT NULL,
    layout_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_formations_team_name_unit ON formations(team_id, name, unit)',
  `CREATE TABLE IF NOT EXISTS playbooks (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    side TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_playbooks_team_side_archived ON playbooks(team_id, side, archived)',
  `CREATE TABLE IF NOT EXISTS plays (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    playbook_id TEXT REFERENCES playbooks(id) ON DELETE CASCADE,
    formation_id TEXT REFERENCES formations(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Uncategorized',
    family TEXT NOT NULL,
    concept TEXT NOT NULL,
    diagram_json TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_plays_team_unit_formation ON plays(team_id, unit, formation_id)',
  `CREATE TABLE IF NOT EXISTS play_assignments (
    id TEXT PRIMARY KEY NOT NULL,
    play_id TEXT NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
    position TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_play_assignment_position ON play_assignments(play_id, position)',
  'CREATE INDEX IF NOT EXISTS idx_play_assignment_order ON play_assignments(play_id, sort_order)',
  `CREATE TABLE IF NOT EXISTS install_packages (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    game_id TEXT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    due_at TEXT NOT NULL,
    published_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS install_items (
    id TEXT PRIMARY KEY NOT NULL,
    package_id TEXT NOT NULL REFERENCES install_packages(id) ON DELETE CASCADE,
    play_id TEXT REFERENCES plays(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    item_type TEXT NOT NULL,
    position_group TEXT,
    sort_order INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS athlete_reviews (
    id TEXT PRIMARY KEY NOT NULL,
    install_item_id TEXT NOT NULL REFERENCES install_items(id) ON DELETE CASCADE,
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    reviewed_at TEXT,
    assignment_acknowledged_at TEXT,
    note_acknowledged_at TEXT
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_athlete_review_item ON athlete_reviews(install_item_id, athlete_id)',
  `CREATE TABLE IF NOT EXISTS depth_charts (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    game_id TEXT,
    formation_id TEXT REFERENCES formations(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    published_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS depth_assignments (
    id TEXT PRIMARY KEY NOT NULL,
    depth_chart_id TEXT NOT NULL REFERENCES depth_charts(id) ON DELETE CASCADE,
    athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    position TEXT NOT NULL,
    rank INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_depth_assignment_slot ON depth_assignments(depth_chart_id, position, rank)',
  'CREATE INDEX IF NOT EXISTS idx_depth_assignment_athlete ON depth_assignments(athlete_id)',
  `CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    game_id TEXT,
    title TEXT NOT NULL,
    event_type TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    location TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
  )`,
  'CREATE INDEX IF NOT EXISTS idx_calendar_events_team_start ON calendar_events(team_id, starts_at)',
  `CREATE TABLE IF NOT EXISTS practice_plans (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    practice_date TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    plan_json TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_practice_plans_team_date ON practice_plans(team_id, practice_date)',
  `CREATE TABLE IF NOT EXISTS film_assets (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    storage_key TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'local-placeholder',
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_film_assets_team_created ON film_assets(team_id, created_at)',
  `CREATE TABLE IF NOT EXISTS film_clips (
    id TEXT PRIMARY KEY NOT NULL,
    film_asset_id TEXT NOT NULL REFERENCES film_assets(id) ON DELETE CASCADE,
    play_id TEXT REFERENCES plays(id) ON DELETE SET NULL,
    clip_number INTEGER NOT NULL,
    start_seconds REAL NOT NULL,
    end_seconds REAL NOT NULL,
    odk TEXT,
    down INTEGER,
    distance INTEGER,
    yard_line TEXT,
    result TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]'
  )`,
  'CREATE INDEX IF NOT EXISTS idx_film_clips_asset_number ON film_clips(film_asset_id, clip_number)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_film_clip_number_unique ON film_clips(film_asset_id, clip_number)',
  `CREATE TABLE IF NOT EXISTS workspace_state (
    id TEXT PRIMARY KEY NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    state_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_state_team_key ON workspace_state(team_id, state_key)',
] as const;

let ready: Promise<void> | undefined;

export async function getRawDatabase() {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error('The database binding is unavailable.');
  if (isPrototype()) {
    ready ??= initialize(database).catch((error) => {
      ready = undefined;
      throw error;
    });
    await ready;
  }
  return database;
}

export async function getDatabase() {
  return (await getWorkspaceAccess('owner.private')).database;
}

export async function getCoachingDatabase(requestedTeamId?: string) {
  return (await getWorkspaceAccess('coaching.read', requestedTeamId)).database;
}

export async function getWorkspaceAccess(
  permission: TeamPermission,
  requestedTeamId?: string,
) {
  const identity = await requestIdentity();
  const database = await getRawDatabase();
  if (isPrototype())
    return {
      database: scopedDatabase(database, TEAM_ID),
      identity,
      grant: {
        teamId: TEAM_ID,
        teamName: 'Local prototype',
        season: '',
        role: 'owner',
        userId: identity.id,
        athleteId: null,
      } as WorkspaceGrant,
    };
  const headerHint = await requestWorkspaceId();
  if (requestedTeamId && headerHint && requestedTeamId !== headerHint)
    throw new WorkspaceAccessError(
      'The request does not match the open team workspace.',
      400,
    );
  const hint = requestedTeamId ?? headerHint;
  const grant = await resolveWorkspaceGrant(database, identity, hint);
  if (!grant)
    throw new WorkspaceAccessError('Create your team to continue.', 409);
  requireTeamPermission(grant, permission);
  return { database: scopedDatabase(database, grant.teamId), identity, grant };
}

async function initialize(database: D1Database) {
  await database.prepare('PRAGMA foreign_keys = ON').run();
  await database
    .prepare(
      'CREATE TABLE IF NOT EXISTS app_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
    )
    .run();
  for (const statement of bootstrapStatements.slice(0, 2))
    await database.prepare(statement).run();

  const optionalFieldsMigration = await database
    .prepare('SELECT id FROM app_migrations WHERE id = ?')
    .bind('0001_optional_athlete_fields')
    .first();
  if (!optionalFieldsMigration) {
    const columns = await database
      .prepare('PRAGMA table_info(athletes)')
      .all<{ name: string; notnull: number }>();
    const numberColumn = columns.results.find(
      (column) => column.name === 'number',
    );
    const emailColumn = columns.results.find(
      (column) => column.name === 'email',
    );
    if (numberColumn?.notnull === 1 || emailColumn?.notnull === 0) {
      await database
        .prepare('ALTER TABLE athletes RENAME TO athletes_legacy')
        .run();
      await database.prepare(bootstrapStatements[1]).run();
      await database
        .prepare(
          `INSERT INTO athletes (
          id, team_id, number, first_name, last_name, position, unit, graduation_year,
          height, weight_lb, status, eligibility, attendance_percent, install_percent,
          email, phone, staff_note, created_at, updated_at
        ) SELECT id, team_id, number, first_name, last_name, position, unit, graduation_year,
          height, weight_lb, status, eligibility, attendance_percent, install_percent,
          COALESCE(NULLIF(email, ''), lower(replace(first_name || '.' || last_name, ' ', '')) || '+' || id || '@local.alltwelve'),
          phone, staff_note, created_at, updated_at FROM athletes_legacy`,
        )
        .run();
      await database.prepare('DROP TABLE athletes_legacy').run();
    }
    await database
      .prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .bind('0001_optional_athlete_fields', new Date().toISOString())
      .run();
  }
  for (const statement of bootstrapStatements.slice(2))
    await database.prepare(statement).run();

  const connectedPlaybooksMigration = await database
    .prepare('SELECT id FROM app_migrations WHERE id = ?')
    .bind('0003_connected_playbooks')
    .first();
  if (!connectedPlaybooksMigration) {
    const playColumns = await database
      .prepare('PRAGMA table_info(plays)')
      .all<{ name: string }>();
    if (!playColumns.results.some((column) => column.name === 'playbook_id')) {
      await database
        .prepare(
          'ALTER TABLE plays ADD COLUMN playbook_id TEXT REFERENCES playbooks(id) ON DELETE CASCADE',
        )
        .run();
    }
    if (!playColumns.results.some((column) => column.name === 'category')) {
      await database
        .prepare(
          "ALTER TABLE plays ADD COLUMN category TEXT NOT NULL DEFAULT 'Uncategorized'",
        )
        .run();
    }
    await database
      .prepare(
        'CREATE INDEX IF NOT EXISTS idx_plays_playbook_category ON plays(playbook_id, category)',
      )
      .run();
    await database
      .prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .bind('0003_connected_playbooks', new Date().toISOString())
      .run();
  }

  await database
    .prepare(
      `INSERT OR IGNORE INTO teams (id, name, short_name, season, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      TEAM_ID,
      'North Shore Wolves',
      'North Shore',
      '2026',
      '2026-08-29T00:00:00.000Z',
    )
    .run();

  const demoRosterMigration = await database
    .prepare('SELECT id FROM app_migrations WHERE id = ?')
    .bind('0005_remove_demo_roster')
    .first();
  if (!demoRosterMigration) {
    await database
      .prepare(
        `DELETE FROM athletes WHERE team_id = ? AND id IN (
        'ath-jordan-lee', 'ath-marcus-brown', 'ath-noah-tremblay', 'ath-liam-chen',
        'ath-andre-joseph', 'ath-evan-macdonald', 'ath-cole-fraser', 'ath-sam-okafor',
        'ath-jay-ahmed', 'ath-ravi-patel', 'ath-aiden-peters', 'ath-taj-singh',
        'ath-michel-savoie', 'ath-ben-clarke', 'ath-malik-white'
      )`,
      )
      .bind(TEAM_ID)
      .run();
    await database
      .prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .bind('0005_remove_demo_roster', new Date().toISOString())
      .run();
  }

  const cleanRosterMigration = await database
    .prepare('SELECT id FROM app_migrations WHERE id = ?')
    .bind('0006_clear_legacy_roster')
    .first();
  if (!cleanRosterMigration) {
    await database
      .prepare('DELETE FROM athletes WHERE team_id = ?')
      .bind(TEAM_ID)
      .run();
    await database
      .prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .bind('0006_clear_legacy_roster', new Date().toISOString())
      .run();
  }

  const cleanMessagesMigration = await database
    .prepare('SELECT id FROM app_migrations WHERE id = ?')
    .bind('0007_clear_demo_messages')
    .first();
  if (!cleanMessagesMigration) {
    await database
      .prepare(
        "DELETE FROM workspace_state WHERE team_id = ? AND state_key IN ('message-centre', 'messages-team')",
      )
      .bind(TEAM_ID)
      .run();
    await database
      .prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .bind('0007_clear_demo_messages', new Date().toISOString())
      .run();
  }

  const cleanCalendarMigration = await database
    .prepare('SELECT id FROM app_migrations WHERE id = ?')
    .bind('0008_remove_demo_calendar')
    .first();
  if (!cleanCalendarMigration) {
    await database
      .prepare(
        `DELETE FROM calendar_events WHERE team_id = ? AND id IN (
        'calendar-film-review', 'calendar-base-install', 'calendar-full-pads',
        'calendar-situational-practice', 'calendar-hamilton-game', 'calendar-staff-grading'
      )`,
      )
      .bind(TEAM_ID)
      .run();
    await database
      .prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .bind('0008_remove_demo_calendar', new Date().toISOString())
      .run();
  }

  const cleanQaCalendarMigration = await database
    .prepare('SELECT id FROM app_migrations WHERE id = ?')
    .bind('0009_remove_qa_calendar')
    .first();
  if (!cleanQaCalendarMigration) {
    await database
      .prepare(
        `DELETE FROM calendar_events WHERE team_id = ? AND id IN (
        'cfa5f7fc-e8b0-4585-8e38-f6cf2d46b9cb',
        'bf71ffb2-5806-4b2f-baa5-6dce99d4a769'
      )`,
      )
      .bind(TEAM_ID)
      .run();
    await database
      .prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .bind('0009_remove_qa_calendar', new Date().toISOString())
      .run();
  }

  const cleanInstallMigration = await database
    .prepare('SELECT id FROM app_migrations WHERE id = ?')
    .bind('0010_remove_demo_install')
    .first();
  if (!cleanInstallMigration) {
    await database
      .prepare("DELETE FROM install_items WHERE package_id = 'install-week-5'")
      .run();
    await database
      .prepare(
        "UPDATE install_packages SET game_id = NULL, name = 'Current install', due_at = '', published_at = NULL WHERE id = 'install-week-5' AND team_id = ?",
      )
      .bind(TEAM_ID)
      .run();
    await database
      .prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .bind('0010_remove_demo_install', new Date().toISOString())
      .run();
  }

  const cleanPlaybookMigration = await database
    .prepare('SELECT id FROM app_migrations WHERE id = ?')
    .bind('0011_remove_demo_playbooks')
    .first();
  if (!cleanPlaybookMigration) {
    await database
      .prepare(
        "DELETE FROM depth_charts WHERE team_id = ? AND id = 'depth-offence-doubles'",
      )
      .bind(TEAM_ID)
      .run();
    await database
      .prepare(
        "DELETE FROM plays WHERE team_id = ? AND id IN ('red-24','mesh-switch','northern-lights','boundary-sail','ace-counter','doubles-mesh','orbit-screen','empty-smoke','max-sail','qb-draw','sprint-flood','empty-power','boundary-slip','trips-glance','bunch-wheel','heavy-toss','doubles-stick','ace-play-action')",
      )
      .bind(TEAM_ID)
      .run();
    await database
      .prepare(
        "DELETE FROM formations WHERE team_id = ? AND id IN ('formation-offence-doubles','formation-offence-ace','formation-offence-trips-open','formation-offence-empty','formation-offence-tight-bunch','formation-offence-heavy')",
      )
      .bind(TEAM_ID)
      .run();
    await database
      .prepare(
        "DELETE FROM playbooks WHERE team_id = ? AND id IN ('offence','defence','special-teams','scout','2025-offence')",
      )
      .bind(TEAM_ID)
      .run();
    await database
      .prepare('INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)')
      .bind('0011_remove_demo_playbooks', new Date().toISOString())
      .run();
  }

  await database.prepare('PRAGMA optimize').run();
}

export { TEAM_ID };
