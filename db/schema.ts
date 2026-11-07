import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  season: text('season').notNull(),
  createdAt: text('created_at').notNull(),
});

export const workspaceOwners = sqliteTable('workspace_owners', {
  userId: text('user_id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('idx_workspace_owner_team').on(table.teamId)]);

export const workspaceState = sqliteTable('workspace_state', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  stateKey: text('state_key').notNull(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_workspace_state_team_key').on(table.teamId, table.stateKey),
]);

export const athletes = sqliteTable('athletes', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  number: integer('number'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  position: text('position').notNull(),
  unit: text('unit').notNull(),
  graduationYear: integer('graduation_year').notNull(),
  height: text('height').notNull(),
  weightLb: integer('weight_lb').notNull(),
  status: text('status').notNull().default('Active'),
  eligibility: text('eligibility').notNull().default('Cleared'),
  attendancePercent: integer('attendance_percent').notNull().default(100),
  installPercent: integer('install_percent').notNull().default(0),
  email: text('email').notNull(),
  phone: text('phone'),
  staffNote: text('staff_note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_athletes_team_number').on(table.teamId, table.number).where(sql`${table.number} IS NOT NULL`),
  uniqueIndex('idx_athletes_team_email').on(table.teamId, table.email),
  index('idx_athletes_team_unit').on(table.teamId, table.unit),
  index('idx_athletes_team_status').on(table.teamId, table.status),
]);

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  opponent: text('opponent').notNull(),
  kickoffAt: text('kickoff_at').notNull(),
  venue: text('venue').notNull(),
  status: text('status').notNull().default('scheduled'),
  homeAway: text('home_away').notNull().default('home'),
}, (table) => [index('idx_games_team_kickoff').on(table.teamId, table.kickoffAt)]);

export const formations = sqliteTable('formations', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  personnel: text('personnel').notNull(),
  layoutJson: text('layout_json').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('idx_formations_team_name_unit').on(table.teamId, table.name, table.unit)]);

export const playbooks = sqliteTable('playbooks', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  side: text('side').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_playbooks_team_side_archived').on(table.teamId, table.side, table.archived)]);

export const plays = sqliteTable('plays', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  playbookId: text('playbook_id').references(() => playbooks.id, { onDelete: 'cascade' }),
  formationId: text('formation_id').references(() => formations.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  category: text('category').notNull().default('Uncategorized'),
  family: text('family').notNull(),
  concept: text('concept').notNull(),
  diagramJson: text('diagram_json').notNull(),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_plays_team_unit_formation').on(table.teamId, table.unit, table.formationId),
  index('idx_plays_playbook_category').on(table.playbookId, table.category),
]);

export const playAssignments = sqliteTable('play_assignments', {
  id: text('id').primaryKey(),
  playId: text('play_id').notNull().references(() => plays.id, { onDelete: 'cascade' }),
  position: text('position').notNull(),
  title: text('title').notNull(),
  detail: text('detail').notNull().default(''),
  sortOrder: integer('sort_order').notNull(),
}, (table) => [
  uniqueIndex('idx_play_assignment_position').on(table.playId, table.position),
  index('idx_play_assignment_order').on(table.playId, table.sortOrder),
]);

export const depthCharts = sqliteTable('depth_charts', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
  formationId: text('formation_id').references(() => formations.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  publishedAt: text('published_at'),
});

export const depthAssignments = sqliteTable('depth_assignments', {
  id: text('id').primaryKey(),
  depthChartId: text('depth_chart_id').notNull().references(() => depthCharts.id, { onDelete: 'cascade' }),
  athleteId: text('athlete_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
  position: text('position').notNull(),
  rank: integer('rank').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
}, (table) => [
  uniqueIndex('idx_depth_assignment_slot').on(table.depthChartId, table.position, table.rank),
  index('idx_depth_assignment_athlete').on(table.athleteId),
]);

export const installPackages = sqliteTable('install_packages', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  dueAt: text('due_at').notNull(),
  publishedAt: text('published_at'),
});

export const installItems = sqliteTable('install_items', {
  id: text('id').primaryKey(),
  packageId: text('package_id').notNull().references(() => installPackages.id, { onDelete: 'cascade' }),
  playId: text('play_id').references(() => plays.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  itemType: text('item_type').notNull(),
  positionGroup: text('position_group'),
  sortOrder: integer('sort_order').notNull(),
});

export const athleteReviews = sqliteTable('athlete_reviews', {
  id: text('id').primaryKey(),
  installItemId: text('install_item_id').notNull().references(() => installItems.id, { onDelete: 'cascade' }),
  athleteId: text('athlete_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
  reviewedAt: text('reviewed_at'),
  assignmentAcknowledgedAt: text('assignment_acknowledged_at'),
  noteAcknowledgedAt: text('note_acknowledged_at'),
}, (table) => [uniqueIndex('idx_athlete_review_item').on(table.installItemId, table.athleteId)]);

export const calendarEvents = sqliteTable('calendar_events', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  eventType: text('event_type').notNull(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  location: text('location').notNull(),
  notes: text('notes').notNull().default(''),
}, (table) => [index('idx_calendar_events_team_start').on(table.teamId, table.startsAt)]);

export const practicePlans = sqliteTable('practice_plans', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  practiceDate: text('practice_date').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  planJson: text('plan_json').notNull(),
}, (table) => [index('idx_practice_plans_team_date').on(table.teamId, table.practiceDate)]);

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  visibility: text('visibility').notNull().default('team'),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  authorName: text('author_name').notNull(),
  body: text('body').notNull(),
  attachmentType: text('attachment_type'),
  attachmentId: text('attachment_id'),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_messages_conversation_created').on(table.conversationId, table.createdAt)]);

export const filmAssets = sqliteTable('film_assets', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  storageKey: text('storage_key'),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  status: text('status').notNull().default('local-placeholder'),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_film_assets_team_created').on(table.teamId, table.createdAt)]);

export const filmClips = sqliteTable('film_clips', {
  id: text('id').primaryKey(),
  filmAssetId: text('film_asset_id').notNull().references(() => filmAssets.id, { onDelete: 'cascade' }),
  playId: text('play_id').references(() => plays.id, { onDelete: 'set null' }),
  clipNumber: integer('clip_number').notNull(),
  startSeconds: real('start_seconds').notNull(),
  endSeconds: real('end_seconds').notNull(),
  odk: text('odk'),
  down: integer('down'),
  distance: integer('distance'),
  yardLine: text('yard_line'),
  result: text('result'),
  tagsJson: text('tags_json').notNull().default('[]'),
}, (table) => [uniqueIndex('idx_film_clip_number_unique').on(table.filmAssetId, table.clipNumber)]);
