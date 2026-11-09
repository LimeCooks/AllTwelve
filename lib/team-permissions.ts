import {
  WorkspaceAccessError,
  type WorkspaceIdentity,
} from '@/lib/workspace-identity';

export type TeamRole = 'owner' | 'staff' | 'player';
export type TeamPermission =
  | 'team.read'
  | 'coaching.read'
  | 'coaching.write'
  | 'access.manage'
  | 'settings.write'
  | 'backup.manage'
  | 'owner.private'
  | 'player.assigned.read'
  | 'player.own-review.write';
export type WorkspaceGrant = {
  teamId: string;
  teamName: string;
  shortName?: string;
  season: string;
  role: TeamRole;
  athleteId: string | null;
  userId: string;
};
const permissions = new Map<TeamRole, ReadonlySet<TeamPermission>>([
  [
    'owner',
    new Set([
      'team.read',
      'coaching.read',
      'coaching.write',
      'access.manage',
      'settings.write',
      'backup.manage',
      'owner.private',
    ]),
  ],
  ['staff', new Set(['team.read', 'coaching.read', 'coaching.write'])],
  [
    'player',
    new Set(['team.read', 'player.assigned.read', 'player.own-review.write']),
  ],
]);
export function hasTeamPermission(role: TeamRole, permission: TeamPermission) {
  return permissions.get(role)?.has(permission) ?? false;
}
export function requireTeamPermission(
  grant: WorkspaceGrant,
  permission: TeamPermission,
) {
  if (!hasTeamPermission(grant.role, permission))
    throw new WorkspaceAccessError(
      'Your team role does not allow this action.',
      403,
    );
}
type GrantRow = {
  team_id: string;
  name: string;
  short_name?: string;
  season: string;
  role: TeamRole;
  athlete_id: string | null;
  athlete_team_id?: string | null;
};
export async function workspaceGrants(
  database: D1Database,
  identity: WorkspaceIdentity,
): Promise<WorkspaceGrant[]> {
  const [owners, members] = await Promise.all([
    database
      .prepare(
        "SELECT t.id AS team_id, t.name, t.short_name, t.season, 'owner' AS role, NULL AS athlete_id FROM teams t JOIN workspace_owners o ON o.team_id=t.id WHERE o.user_id=?",
      )
      .bind(identity.id)
      .all<GrantRow>(),
    database
      .prepare(
        'SELECT t.id AS team_id, t.name, t.short_name, t.season, m.role, m.athlete_id, a.team_id AS athlete_team_id FROM teams t JOIN team_memberships m ON m.team_id=t.id LEFT JOIN athletes a ON a.id=m.athlete_id WHERE m.user_id=? AND m.status=?',
      )
      .bind(identity.id, 'active')
      .all<GrantRow>(),
  ]);
  const grants = new Map<string, WorkspaceGrant>();
  // An accidentally duplicated membership must never demote an actual owner.
  for (const row of [...owners.results, ...members.results]) {
    if (
      !['owner', 'staff', 'player'].includes(row.role) ||
      (row.role === 'player' &&
        (!row.athlete_id || row.athlete_team_id !== row.team_id))
    )
      throw new WorkspaceAccessError(
        'Your team access could not be verified. Contact the team owner.',
        403,
      );
    if (!grants.has(row.team_id))
      grants.set(row.team_id, {
        teamId: row.team_id,
        teamName: row.name,
        shortName: row.short_name,
        season: row.season,
        role: row.role,
        athleteId: row.athlete_id,
        userId: identity.id,
      });
  }
  return [...grants.values()];
}
export async function resolveWorkspaceGrant(
  database: D1Database,
  identity: WorkspaceIdentity,
  requestedTeamId = '',
) {
  const grants = await workspaceGrants(database, identity);
  if (requestedTeamId) {
    const grant = grants.find((grant) => grant.teamId === requestedTeamId);
    if (!grant)
      throw new WorkspaceAccessError(
        'You no longer have access to the selected team. Choose a team you belong to.',
        403,
      );
    return grant;
  }
  const owner = grants.find((grant) => grant.role === 'owner');
  if (owner) return owner;
  if (grants.length === 1) return grants[0];
  if (grants.length > 1)
    throw new WorkspaceAccessError('Choose the team workspace to open.', 409);
  return null;
}
