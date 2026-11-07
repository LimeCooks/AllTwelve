import { getDatabase } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';

type Note = {
  id: string;
  clipId: string | null;
  text: string;
  createdAt: string;
};
type Notebook = { flaggedClipIds: string[]; notes: Note[] };
type Row = { value_json: string; updated_at: string };
const KEY = 'sideline-review-v3';
const empty = (): Notebook => ({ flaggedClipIds: [], notes: [] });
function parse(value: string): Notebook {
  const state = JSON.parse(value) as Notebook;
  if (
    !state ||
    !Array.isArray(state.flaggedClipIds) ||
    !state.flaggedClipIds.every((id) => typeof id === 'string') ||
    !Array.isArray(state.notes) ||
    !state.notes.every(
      (note) =>
        note &&
        typeof note.id === 'string' &&
        typeof note.text === 'string' &&
        typeof note.createdAt === 'string' &&
        (note.clipId === null || typeof note.clipId === 'string'),
    )
  )
    throw new Error('Invalid notebook');
  return state;
}
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof WorkspaceAccessError
          ? error.message
          : 'Unable to access saved sideline work. Please retry.',
    },
    {
      status: error instanceof WorkspaceAccessError ? error.status : 500,
    },
  );
}
export async function GET() {
  try {
    const db = await getDatabase();
    const row = await db
      .prepare(
        'SELECT value_json, updated_at FROM workspace_state WHERE team_id = ? AND state_key = ?',
      )
      .bind(db.teamId, KEY)
      .first<Row>();
    const legacy = await db
      .prepare(
        'SELECT value_json, updated_at FROM workspace_state WHERE team_id = ? AND state_key = ?',
      )
      .bind(db.teamId, 'sideline-session-v2')
      .first<Row>();
    const old = legacy
      ? (JSON.parse(legacy.value_json) as {
          notes?: unknown;
          flagged?: unknown;
        })
      : null;
    if (
      old &&
      (!Array.isArray(old.notes) ||
        !old.notes.every((note) => typeof note === 'string') ||
        !Array.isArray(old.flagged))
    )
      throw new Error('Invalid legacy notebook');
    return Response.json({
      ...(row ? parse(row.value_json) : empty()),
      legacyNotes: old?.notes ?? [],
      legacyFlagCount: Array.isArray(old?.flagged) ? old.flagged.length : 0,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const db = await getDatabase();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: 'Enter valid sideline details.' },
        { status: 400 },
      );
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return Response.json(
        { error: 'Enter valid sideline details.' },
        { status: 400 },
      );
    if (
      body.clipId !== undefined &&
      body.clipId !== null &&
      typeof body.clipId !== 'string'
    )
      return Response.json(
        { error: 'Choose a valid saved clip.' },
        { status: 400 },
      );
    const clipId =
      typeof body.clipId === 'string' && body.clipId.trim()
        ? body.clipId.trim()
        : null;
    if (body.action !== 'note' && body.action !== 'flag')
      return Response.json(
        { error: 'Choose a note or flag action.' },
        { status: 400 },
      );
    if (clipId) {
      const clip = await db
        .prepare(
          'SELECT c.id FROM film_clips c JOIN film_assets a ON a.id = c.film_asset_id WHERE c.id = ? AND a.team_id = ?',
        )
        .bind(clipId, db.teamId)
        .first();
      if (!clip)
        return Response.json(
          { error: 'Saved clip not found.' },
          { status: 404 },
        );
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (
      body.action === 'flag' &&
      (!clipId || typeof body.flagged !== 'boolean')
    )
      return Response.json(
        { error: 'Choose a saved clip and flag state.' },
        { status: 400 },
      );
    if (
      body.action === 'note' &&
      (!text || text.length > 1000 || !id || id.length > 100)
    )
      return Response.json(
        { error: 'Enter a note of up to 1,000 characters.' },
        { status: 400 },
      );
    // Compare-and-swap the original JSON, retrying competing writes. Appending a
    // note and flagging a clip on two devices cannot erase each other's work.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const row = await db
        .prepare(
          'SELECT value_json, updated_at FROM workspace_state WHERE team_id = ? AND state_key = ?',
        )
        .bind(db.teamId, KEY)
        .first<Row>();
      const state = row ? parse(row.value_json) : empty();
      if (body.action === 'note') {
        const duplicate = state.notes.find((note) => note.id === id);
        if (
          duplicate &&
          (duplicate.text !== text || duplicate.clipId !== clipId)
        )
          return Response.json(
            {
              error: 'That note has already been saved with different details.',
            },
            { status: 409 },
          );
        if (!duplicate)
          state.notes.push({
            id,
            clipId,
            text,
            createdAt: new Date().toISOString(),
          });
      } else {
        state.flaggedClipIds = state.flaggedClipIds.filter(
          (flag) => flag !== clipId,
        );
        if (body.flagged) state.flaggedClipIds.push(clipId!);
      }
      const serialized = JSON.stringify(state);
      if (serialized.length > 250000)
        return Response.json(
          { error: 'This sideline notebook has reached its storage limit.' },
          { status: 413 },
        );
      const saved = await db
        .prepare(`INSERT INTO workspace_state (id, team_id, state_key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(team_id, state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
        WHERE workspace_state.value_json = ? RETURNING value_json, updated_at`)
        .bind(
          `state-${db.teamId}-${KEY}`,
          db.teamId,
          KEY,
          serialized,
          new Date().toISOString(),
          row?.value_json ?? null,
        )
        .first<Row>();
      if (saved) return Response.json(parse(saved.value_json));
    }
    return Response.json(
      { error: 'Sideline work changed on another device. Please retry.' },
      { status: 409 },
    );
  } catch (error) {
    return failure(error);
  }
}
