import {
  type TeamDatabase,
  WorkspaceAccessError,
} from '@/lib/workspace-identity';
import { GAMEPLAN_KEY, validateGameplan } from '@/lib/gameplan-state';
import {
  GAMEPLAN_RECORD_PREFIX,
  PREVIOUS_GAMEPLAN_ID,
  validGameplanId,
  type NamedGameplan,
  type GameplanWrite,
} from '@/lib/named-gameplans';
type Row = { value_json: string; updated_at: string; state_key: string };
const oldKey = 'gameplan-week-5-v2';
const hash = async (raw: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
export function gameplanInput(value: unknown): GameplanWrite {
  const body = value as GameplanWrite | null;
  if (!body || !validGameplanId(body.id) || typeof body.archived !== 'boolean')
    throw new WorkspaceAccessError(
      'Choose a gameplan and a valid archive state.',
      400,
    );
  const title = text(body.title),
    opponent = text(body.opponent),
    date = text(body.date);
  if (
    !title ||
    title.length > 120 ||
    opponent.length > 200 ||
    (date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date + 'T12:00:00Z')) ||
        new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date))
  )
    throw new WorkspaceAccessError(
      'Enter a gameplan title, an optional opponent, and a valid optional date.',
      400,
    );
  let state;
  try {
    state = validateGameplan(body.state);
  } catch {
    throw new WorkspaceAccessError('The gameplan content is incomplete.', 400);
  }
  if (
    state.included.length > 2000 ||
    state.included.some((id) => !id || id.length > 200) ||
    new Set(state.included).size !== state.included.length ||
    state.objectives.length > 200 ||
    state.objectives.some(
      (objective) =>
        !objective.title.trim() ||
        objective.title.length > 200 ||
        objective.detail.length > 4000 ||
        objective.target.length > 200,
    ) ||
    state.callBuckets.length > 200 ||
    state.callBuckets.some(
      (bucket) =>
        !bucket.name.trim() ||
        bucket.name.length > 120 ||
        bucket.plays.length > 200 ||
        bucket.plays.some((play) => !play || play.length > 200) ||
        new Set(bucket.plays).size !== bucket.plays.length,
    )
  )
    throw new WorkspaceAccessError(
      'Use valid objectives, call-sheet sections and distinct saved references within the supported limits.',
      400,
    );
  const result: GameplanWrite = {
    id: body.id,
    title,
    opponent,
    date,
    archived: body.archived,
    state: {
      filmSelection: state.filmSelection ?? 'all',
      unit: state.unit,
      included: state.included,
      objectives: state.objectives,
      callBuckets: state.callBuckets,
    },
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 200000)
    throw new WorkspaceAccessError('This gameplan is too large to save.', 413);
  return result;
}
async function rawRecord(db: TeamDatabase, key: string) {
  return db
    .prepare(
      'SELECT state_key, value_json, updated_at FROM workspace_state WHERE team_id=? AND state_key=?',
    )
    .bind(db.teamId, key)
    .first<Row>();
}
async function present(row: Row): Promise<NamedGameplan> {
  const value = JSON.parse(row.value_json) as NamedGameplan;
  if (
    row.state_key !== GAMEPLAN_RECORD_PREFIX + value.id ||
    !value.createdAt ||
    !value.updatedAt ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isFinite(Date.parse(value.updatedAt))
  )
    throw new Error('Invalid saved gameplan');
  return {
    ...gameplanInput(value),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: await hash(row.value_json),
  };
}
async function previous(db: TeamDatabase) {
  const [active, legacy] = await Promise.all([
    rawRecord(db, GAMEPLAN_KEY),
    rawRecord(db, oldKey),
  ]);
  const activeValue = active ? JSON.parse(active.value_json) : null;
  // Keep the fallback's raw value for the atomic guard without parsing obsolete
  // content when a newer active plan is already authoritative.
  const value = activeValue ?? (legacy ? JSON.parse(legacy.value_json) : null);
  const state = value === null ? null : validateGameplan(value);
  const time =
    (activeValue !== null ? active?.updated_at : legacy?.updated_at) ??
    new Date(0).toISOString();
  return {
    active: active?.value_json ?? null,
    legacy: legacy?.value_json ?? null,
    plan: state
      ? ({
          id: PREVIOUS_GAMEPLAN_ID,
          title: 'Previous gameplan',
          opponent: '',
          date: '',
          archived: false,
          createdAt: time,
          updatedAt: time,
          state,
          previous: true,
          version: await hash(
            JSON.stringify([
              active?.value_json ?? null,
              legacy?.value_json ?? null,
            ]),
          ),
        } satisfies NamedGameplan)
      : null,
  };
}
export async function getGameplan(db: TeamDatabase, id: string) {
  return (await getGameplanSnapshot(db, id)).plan;
}
export async function getGameplanSnapshot(db: TeamDatabase, id: string) {
  const row = await rawRecord(db, GAMEPLAN_RECORD_PREFIX + id);
  if (row)
    return {
      plan: await present(row),
      predicate:
        '(SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?) IS ?',
      values: [db.teamId, row.state_key, row.value_json],
    };
  if (id !== PREVIOUS_GAMEPLAN_ID)
    return { plan: null, predicate: '0', values: [] };
  const prior = await previous(db);
  return {
    plan: prior.plan,
    predicate:
      '(SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?) IS ? AND (SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?) IS ? AND NOT EXISTS(SELECT 1 FROM workspace_state WHERE team_id=? AND state_key=?)',
    values: [
      db.teamId,
      GAMEPLAN_KEY,
      prior.active,
      db.teamId,
      oldKey,
      prior.legacy,
      db.teamId,
      GAMEPLAN_RECORD_PREFIX + id,
    ],
  };
}
export async function listGameplans(db: TeamDatabase) {
  const rows = await db
    .prepare(
      'SELECT state_key, value_json, updated_at FROM workspace_state WHERE team_id=? AND state_key LIKE ? ORDER BY updated_at DESC, state_key',
    )
    .bind(db.teamId, GAMEPLAN_RECORD_PREFIX + '%')
    .all<Row>();
  const plans = await Promise.all(rows.results.map(present));
  if (!plans.some((plan) => plan.id === PREVIOUS_GAMEPLAN_ID)) {
    const prior = (await previous(db)).plan;
    if (prior) plans.push(prior);
  }
  return plans;
}
const sameContent = (plan: NamedGameplan, value: GameplanWrite) =>
  JSON.stringify({
    id: plan.id,
    title: plan.title,
    opponent: plan.opponent,
    date: plan.date,
    archived: plan.archived,
    state: plan.state,
  }) === JSON.stringify(value);
async function checkReferences(
  db: TeamDatabase,
  value: GameplanWrite,
  existing: NamedGameplan | null,
) {
  const plays = (
    await db
      .prepare('SELECT id, unit FROM plays WHERE team_id=?')
      .bind(db.teamId)
      .all<{ id: string; unit: string }>()
  ).results;
  const earlier = new Set(
    existing?.state.callBuckets.flatMap((bucket) => bucket.plays) ?? [],
  );
  for (const reference of value.state.callBuckets.flatMap(
    (bucket) => bucket.plays,
  )) {
    const play = plays.find((play) => play.id === reference);
    if (!play && !earlier.has(reference))
      throw new WorkspaceAccessError(
        'Choose plays saved in this team’s playbook.',
        400,
      );
    if (
      play &&
      play.unit !== value.state.unit &&
      (!earlier.has(reference) || existing?.state.unit !== value.state.unit)
    )
      throw new WorkspaceAccessError(
        'Remove plays from another unit before changing this gameplan’s unit.',
        400,
      );
  }
  const clips = (
    await db
      .prepare(
        'SELECT c.id FROM film_clips c JOIN film_assets a ON a.id=c.film_asset_id WHERE a.team_id=?',
      )
      .bind(db.teamId)
      .all<{ id: string }>()
  ).results;
  for (const id of value.state.included)
    if (
      !clips.some((clip) => clip.id === id) &&
      !existing?.state.included.includes(id)
    )
      throw new WorkspaceAccessError(
        'Choose film observations saved in this team.',
        400,
      );
}
export async function saveGameplanRecord(
  db: TeamDatabase,
  raw: unknown,
  update: boolean,
) {
  const value = gameplanInput(raw),
    expected = (raw as { version?: unknown }).version;
  const existingRow = await rawRecord(db, GAMEPLAN_RECORD_PREFIX + value.id);
  const existing = existingRow
    ? await present(existingRow)
    : value.id === PREVIOUS_GAMEPLAN_ID
      ? (await previous(db)).plan
      : null;
  if (!update) {
    if (value.id === PREVIOUS_GAMEPLAN_ID)
      throw new WorkspaceAccessError(
        'Use the previous gameplan to preserve its saved content.',
        400,
      );
    if (existing) {
      if (sameContent(existing, value)) return existing;
      throw new WorkspaceAccessError(
        'This gameplan ID already contains different work. Reload before trying again.',
        409,
      );
    }
  } else {
    if (!existing) throw new WorkspaceAccessError('Gameplan not found.', 404);
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
      throw new WorkspaceAccessError(
        'Reload this gameplan before saving changes.',
        400,
      );
    if (existing.archived && value.archived && !sameContent(existing, value))
      throw new WorkspaceAccessError(
        'Restore this archived gameplan before editing it.',
        409,
      );
    if (existing.version !== expected) {
      if (sameContent(existing, value)) return existing;
      throw new WorkspaceAccessError(
        'This gameplan changed on another device. Your draft was not saved. Reload the saved plan before retrying.',
        409,
      );
    }
  }
  await checkReferences(db, value, existing);
  const now = new Date().toISOString(),
    serialized = JSON.stringify({
      ...value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  let saved;
  if (existingRow)
    saved = await db
      .prepare(
        'UPDATE workspace_state SET value_json=?, updated_at=? WHERE team_id=? AND state_key=? AND value_json=? RETURNING state_key',
      )
      .bind(
        serialized,
        now,
        db.teamId,
        existingRow.state_key,
        existingRow.value_json,
      )
      .first();
  else if (value.id === PREVIOUS_GAMEPLAN_ID) {
    const prior = await previous(db);
    if (prior.plan?.version !== expected)
      throw new WorkspaceAccessError(
        'The previous gameplan changed. Reload before saving.',
        409,
      );
    saved = await db
      .prepare(
        `INSERT INTO workspace_state (id, team_id, state_key, value_json, updated_at) SELECT ?,?,?,?,? WHERE (SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?) IS ? AND (SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?) IS ? ON CONFLICT(team_id,state_key) DO NOTHING RETURNING state_key`,
      )
      .bind(
        `state-${db.teamId}-${GAMEPLAN_RECORD_PREFIX}${value.id}`,
        db.teamId,
        GAMEPLAN_RECORD_PREFIX + value.id,
        serialized,
        now,
        db.teamId,
        GAMEPLAN_KEY,
        prior.active,
        db.teamId,
        oldKey,
        prior.legacy,
      )
      .first();
  } else
    saved = await db
      .prepare(
        'INSERT INTO workspace_state (id, team_id, state_key, value_json, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(team_id,state_key) DO NOTHING RETURNING state_key',
      )
      .bind(
        `state-${db.teamId}-${GAMEPLAN_RECORD_PREFIX}${value.id}`,
        db.teamId,
        GAMEPLAN_RECORD_PREFIX + value.id,
        serialized,
        now,
      )
      .first();

  if (!saved)
    throw new WorkspaceAccessError(
      'This gameplan changed while saving. Your draft was retained. Reload before retrying.',
      409,
    );
  const confirmed = await getGameplan(db, value.id);
  if (!confirmed) throw new Error('The saved gameplan could not be confirmed');
  return confirmed;
}
