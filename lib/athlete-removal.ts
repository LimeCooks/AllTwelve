import {
  type TeamDatabase,
  WorkspaceAccessError,
} from '@/lib/workspace-identity';

type Row = Record<string, unknown>;
async function accessTables(db: TeamDatabase) {
  const rows = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('team_memberships','team_invitations')",
    )
    .all<{ name: string }>();
  return new Set(rows.results.map((row) => row.name));
}
export async function athleteRemovalInfo(db: TeamDatabase, id: string) {
  const row = await db
    .prepare('SELECT * FROM athletes WHERE id=? AND team_id=?')
    .bind(id, db.teamId)
    .first<Row>();
  if (!row)
    throw new WorkspaceAccessError(
      'Athlete not found. Reload the roster to check whether it was already removed.',
      404,
    );
  const access = await accessTables(db);
  const links = await db
    .prepare(`SELECT
 (SELECT COUNT(*) FROM depth_assignments WHERE athlete_id=?) AS depthAssignments,
 (SELECT COUNT(*) FROM athlete_reviews WHERE athlete_id=?) AS installReviews,
 (SELECT COUNT(*) FROM workspace_state w WHERE w.team_id=? AND EXISTS(SELECT 1 FROM json_tree(CASE WHEN json_valid(w.value_json) THEN w.value_json ELSE 'null' END) j WHERE j.type='text' AND j.value=?)) AS savedReferences,
 (SELECT COUNT(*) FROM workspace_state WHERE team_id=? AND NOT json_valid(value_json)) AS unreadableRecords,
 ${access.has('team_memberships') ? '(SELECT COUNT(*) FROM team_memberships WHERE athlete_id=?)' : '0'} AS playerMemberships,
 ${access.has('team_invitations') ? '(SELECT COUNT(*) FROM team_invitations WHERE athlete_id=?)' : '0'} AS playerInvitations`)
    .bind(
      id,
      id,
      db.teamId,
      id,
      db.teamId,
      ...(access.has('team_memberships') ? [id] : []),
      ...(access.has('team_invitations') ? [id] : []),
    )
    .first<{
      depthAssignments: number;
      installReviews: number;
      savedReferences: number;
      unreadableRecords: number;
      playerMemberships: number;
      playerInvitations: number;
    }>();
  if (!links) throw new Error('Removal links could not be checked.');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify(
        Object.keys(row)
          .sort()
          .map((key) => [key, row[key]]),
      ),
    ),
  );
  const version = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return {
    row,
    version,
    links,
    blocked: Object.values(links).some((count) => count > 0),
  };
}
export async function removeUnusedAthlete(
  db: TeamDatabase,
  id: string,
  expected: unknown,
) {
  const info = await athleteRemovalInfo(db, id);
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
    throw new WorkspaceAccessError(
      'Reopen the removal confirmation before continuing.',
      400,
    );
  if (info.version !== expected)
    throw new WorkspaceAccessError(
      'This athlete changed. Reload the roster and review the entry before removing it.',
      409,
    );
  if (info.blocked)
    throw new WorkspaceAccessError(
      'This athlete has linked or unreadable saved work. Resolve those links before removing the roster entry.',
      409,
    );
  const columns = Object.keys(info.row).sort();
  const access = await accessTables(db);
  const removed = await db
    .prepare(`DELETE FROM athletes WHERE id=? AND team_id=? AND ${columns.map((column) => `"${column.replaceAll('"', '""')}" IS ?`).join(' AND ')}
 AND NOT EXISTS(SELECT 1 FROM depth_assignments WHERE athlete_id=?)
 AND NOT EXISTS(SELECT 1 FROM athlete_reviews WHERE athlete_id=?)
 AND NOT EXISTS(SELECT 1 FROM workspace_state WHERE team_id=? AND NOT json_valid(value_json))
 AND NOT EXISTS(SELECT 1 FROM workspace_state w WHERE w.team_id=? AND EXISTS(SELECT 1 FROM json_tree(CASE WHEN json_valid(w.value_json) THEN w.value_json ELSE 'null' END) j WHERE j.type='text' AND j.value=?))
 ${access.has('team_memberships') ? 'AND NOT EXISTS(SELECT 1 FROM team_memberships WHERE athlete_id=?)' : ''}
 ${access.has('team_invitations') ? 'AND NOT EXISTS(SELECT 1 FROM team_invitations WHERE athlete_id=?)' : ''} RETURNING id`)
    .bind(
      id,
      db.teamId,
      ...columns.map((column) => info.row[column]),
      id,
      id,
      db.teamId,
      db.teamId,
      id,
      ...(access.has('team_memberships') ? [id] : []),
      ...(access.has('team_invitations') ? [id] : []),
    )
    .first();
  if (!removed)
    throw new WorkspaceAccessError(
      'This athlete changed or gained linked work while removal was starting. Reload the roster before trying again.',
      409,
    );
}
