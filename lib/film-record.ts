import type { TeamDatabase } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
type Row = Record<string, unknown>;
const assetColumns = [
  'id',
  'game_id',
  'title',
  'storage_key',
  'duration_seconds',
  'status',
  'created_at',
];
const clipColumns = [
  'id',
  'film_asset_id',
  'play_id',
  'clip_number',
  'start_seconds',
  'end_seconds',
  'odk',
  'down',
  'distance',
  'yard_line',
  'result',
  'tags_json',
];
const orderedClips = (clips: Row[]) =>
  [...clips]
    .sort((a, b) =>
      String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0,
    )
    .map((row) => clipColumns.map((column) => row[column]));
export async function filmRecordVersion(asset: Row, clips: Row[]) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([
        assetColumns.map((column) => asset[column]),
        orderedClips(clips),
      ]),
    ),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export async function markFilmForDeletion(
  db: TeamDatabase,
  id: string,
  expected: unknown,
) {
  const asset = await db
    .prepare('SELECT * FROM film_assets WHERE id = ? AND team_id = ?')
    .bind(id, db.teamId)
    .first<Row>();
  if (!asset)
    throw new WorkspaceAccessError(
      'Film record not found. Reload the library to check whether it was already removed.',
      404,
    );
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
    throw new WorkspaceAccessError('Reload this film before deleting it.', 400);
  // A pending removal is the durable retry marker for the already confirmed action.
  if (asset.status === 'deleting') return asset;
  const clips = (
    await db
      .prepare('SELECT * FROM film_clips WHERE film_asset_id = ? ORDER BY id')
      .bind(id)
      .all<Row>()
  ).results;
  if ((await filmRecordVersion(asset, clips)) !== expected)
    throw new WorkspaceAccessError(
      'This film or its clips changed. Reload the library and review it before deleting.',
      409,
    );
  const guardId = crypto.randomUUID(),
    condition = assetColumns.map((column) => `a.${column} IS ?`).join(' AND ');
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO workspace_state(id,team_id,state_key,value_json,updated_at) VALUES(?,?,?,CASE WHEN EXISTS(SELECT 1 FROM film_assets a WHERE a.team_id = ? AND ${condition} AND (SELECT COUNT(*) FROM film_clips WHERE film_asset_id = ?) = ? AND NOT EXISTS(SELECT 1 FROM film_clips c LEFT JOIN json_each(?) j ON json_extract(j.value,'$[0]') = c.id WHERE c.film_asset_id = ? AND (j.value IS NULL OR ${clipColumns.map((column, index) => `c.${column} IS NOT json_extract(j.value,'$[${index}]')`).join(' OR ')}))) THEN '{}' ELSE NULL END,?)`,
        )
        .bind(
          guardId,
          db.teamId,
          'film-delete-check-' + guardId,
          db.teamId,
          ...assetColumns.map((column) => asset[column]),
          id,
          clips.length,
          JSON.stringify(orderedClips(clips)),
          id,
          new Date().toISOString(),
        ),
      db
        .prepare(
          "UPDATE film_assets SET status = 'deleting' WHERE id = ? AND team_id = ?",
        )
        .bind(id, db.teamId),
      db
        .prepare('DELETE FROM workspace_state WHERE id = ? AND team_id = ?')
        .bind(guardId, db.teamId),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('workspace_state.value_json')
    )
      throw new WorkspaceAccessError(
        'This film or its clips changed while deletion was starting. Reload before retrying.',
        409,
      );
    throw error;
  }
  return asset;
}
