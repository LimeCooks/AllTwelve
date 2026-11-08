import { getDatabase, type TeamDatabase } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import {
  emptyDepthLayouts,
  parseDepthLayouts,
  depthUnits,
} from '@/lib/depth-layout';

type StateRow = { state_key: string; value_json: string; updated_at: string };
type Athlete = {
  id: string;
  no: number | null;
  name: string;
  position: string;
  unit: string;
  status: string;
};
const KEY = 'depth-layouts-v3';
async function version(raw: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
async function load(db: TeamDatabase) {
  const [saved, roster] = await Promise.all([
    db
      .prepare(
        "SELECT state_key, value_json, updated_at FROM workspace_state WHERE team_id = ? AND (state_key IN (?, ?) OR state_key LIKE 'depth-note-%') ORDER BY state_key",
      )
      .bind(db.teamId, KEY, 'depth-layouts-v2')
      .all<StateRow>(),
    db
      .prepare(
        "SELECT id, number AS no, first_name || ' ' || last_name AS name, position, unit, status FROM athletes WHERE team_id = ? ORDER BY number IS NULL, number, last_name, first_name, id",
      )
      .bind(db.teamId)
      .all<Athlete>(),
  ]);
  const current = saved.results.find((row) => row.state_key === KEY);
  const legacy = saved.results.find(
    (row) => row.state_key === 'depth-layouts-v2',
  );
  const legacyValue =
    !current && legacy ? (JSON.parse(legacy.value_json) as unknown) : null;
  if (
    legacyValue !== null &&
    (typeof legacyValue !== 'object' || Array.isArray(legacyValue))
  )
    throw new Error('Invalid saved alignment');
  const layouts = current
    ? parseDepthLayouts(JSON.parse(current.value_json))
    : legacyValue
      ? parseDepthLayouts({
          ...emptyDepthLayouts(),
          ...(legacyValue as Record<string, unknown>),
        })
      : emptyDepthLayouts();
  if (!current)
    for (const unit of depthUnits)
      for (const slot of layouts[unit]) {
        const key = `depth-note-${unit.toLowerCase().replaceAll(' ', '-')}-${slot.id}`;
        const note = saved.results.find((row) => row.state_key === key);
        if (note) {
          const text = JSON.parse(note.value_json) as unknown;
          if (text !== null && typeof text !== 'string')
            throw new Error('Invalid role notes');
          slot.notes = text ?? '';
        }
      }
  return {
    layouts,
    athletes: roster.results,
    version: await version(
      current
        ? `v3:${current.value_json}`
        : `legacy:${JSON.stringify(saved.results)}`,
    ),
    raw: current?.value_json ?? null,
  };
}
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof WorkspaceAccessError
          ? error.message
          : 'Saved depth charts could not be loaded. Please retry.',
    },
    { status: error instanceof WorkspaceAccessError ? error.status : 500 },
  );
}
export async function GET() {
  try {
    const { raw: _, ...data } = await load(await getDatabase());
    return Response.json(data, {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: Request) {
  try {
    const db = await getDatabase();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: 'Enter valid depth-chart details.' },
        { status: 400 },
      );
    }
    if (!body || typeof body.version !== 'string')
      return Response.json(
        { error: 'Load the saved chart before editing.' },
        { status: 400 },
      );
    let layouts;
    try {
      layouts = parseDepthLayouts(body.layouts);
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'Invalid alignment.',
        },
        { status: 400 },
      );
    }
    const current = await load(db);
    if (body.version !== current.version)
      return Response.json(
        {
          error:
            'This chart changed on another device. Your draft is retained. Reload the saved chart before trying again.',
        },
        { status: 409 },
      );
    const rosterIds = new Set(current.athletes.map((athlete) => athlete.id));
    if (
      depthUnits.some((unit) =>
        layouts[unit].some(
          (slot) => slot.athleteId && !rosterIds.has(slot.athleteId),
        ),
      )
    )
      return Response.json(
        {
          error:
            'An assigned athlete is unavailable. Choose an athlete from this team or mark the role unassigned.',
        },
        { status: 400 },
      );
    const serialized = JSON.stringify(layouts);
    if (serialized.length > 250000)
      return Response.json(
        { error: 'This depth chart is too large to save.' },
        { status: 413 },
      );
    const saved = await db
      .prepare(`INSERT INTO workspace_state (id, team_id, state_key, value_json, updated_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN athletes a ON a.id=j.value AND a.team_id=? WHERE a.id IS NULL)
      ON CONFLICT(team_id, state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      WHERE workspace_state.value_json = ? RETURNING value_json`)
      .bind(
        `state-${db.teamId}-${KEY}`,
        db.teamId,
        KEY,
        serialized,
        new Date().toISOString(),
        JSON.stringify([
          ...new Set(
            depthUnits.flatMap((unit) =>
              layouts[unit].map((slot) => slot.athleteId).filter(Boolean),
            ),
          ),
        ]),
        db.teamId,
        current.raw,
      )
      .first();
    if (!saved)
      return Response.json(
        {
          error:
            'This chart or its roster changed. Your draft is retained. Reload the saved chart before trying again.',
        },
        { status: 409 },
      );
    const { raw: _, ...data } = await load(db);
    return Response.json(data);
  } catch (error) {
    return failure(error);
  }
}
