import {
  WorkspaceAccessError,
  type WorkspaceIdentity,
} from '@/lib/workspace-identity';
import type { WorkspaceGrant } from '@/lib/team-permissions';

type InvitationRow = {
  id: string;
  team_id: string;
  email: string;
  role: 'staff' | 'player';
  athlete_id: string | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
};
export type MembershipRow = {
  id: string;
  team_id: string;
  user_id: string;
  email: string;
  name: string;
  role: 'staff' | 'player';
  athlete_id: string | null;
  invitation_id: string;
  status: 'active' | 'revoked';
  created_at: string;
  updated_at: string;
};
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const invitationEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export async function hasTeamAccessHistory(
  database: D1Database,
  identity: WorkspaceIdentity,
) {
  return Boolean(
    await database
      .prepare(
        'SELECT 1 FROM team_memberships WHERE user_id=? UNION ALL SELECT 1 FROM team_invitations WHERE email=? LIMIT 1',
      )
      .bind(identity.id, invitationEmail(identity.email))
      .first(),
  );
}
const version = async (row: object) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(row)),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
const invitationStatus = (
  row: InvitationRow,
  now = new Date().toISOString(),
) =>
  row.revoked_at
    ? 'revoked'
    : row.accepted_at
      ? 'accepted'
      : row.expires_at <= now
        ? 'expired'
        : 'pending';
const presentInvite = async (row: InvitationRow) => ({
  ...row,
  status: invitationStatus(row),
  version: await version(row),
});
const presentMember = async (row: MembershipRow) => ({
  ...row,
  version: await version(row),
});
async function ownerScope(
  database: D1Database,
  identity: WorkspaceIdentity,
  grant: WorkspaceGrant,
) {
  if (
    grant.userId !== identity.id ||
    grant.role !== 'owner' ||
    !(await database
      .prepare('SELECT 1 FROM workspace_owners WHERE user_id=? AND team_id=?')
      .bind(identity.id, grant.teamId)
      .first())
  )
    throw new WorkspaceAccessError(
      'Only this team’s owner can manage access.',
      403,
    );
}
export async function listTeamAccess(
  database: D1Database,
  identity: WorkspaceIdentity,
  grant: WorkspaceGrant,
) {
  await ownerScope(database, identity, grant);
  const [invitations, memberships] = await Promise.all([
    database
      .prepare(
        'SELECT * FROM team_invitations WHERE team_id=? ORDER BY created_at DESC,id',
      )
      .bind(grant.teamId)
      .all<InvitationRow>(),
    database
      .prepare(
        'SELECT * FROM team_memberships WHERE team_id=? ORDER BY created_at,id',
      )
      .bind(grant.teamId)
      .all<MembershipRow>(),
  ]);
  return {
    invitations: await Promise.all(invitations.results.map(presentInvite)),
    memberships: await Promise.all(memberships.results.map(presentMember)),
  };
}
export async function createTeamInvitation(
  database: D1Database,
  identity: WorkspaceIdentity,
  grant: WorkspaceGrant,
  raw: unknown,
) {
  await ownerScope(database, identity, grant);
  const body = raw as {
    id?: unknown;
    email?: unknown;
    role?: unknown;
    athleteId?: unknown;
  } | null;
  const email = invitationEmail(body?.email),
    role = body?.role,
    athleteId =
      typeof body?.athleteId === 'string' && body.athleteId
        ? body.athleteId
        : null;
  if (
    !body ||
    !uuid(body.id) ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (role !== 'staff' && role !== 'player') ||
    (role === 'staff' ? athleteId !== null : !athleteId)
  )
    throw new WorkspaceAccessError(
      'Choose a valid recipient, role and player profile when required.',
      400,
    );
  if (email === invitationEmail(identity.email))
    throw new WorkspaceAccessError(
      'You already own this team. Invite another account.',
      409,
    );
  const existing = await database
    .prepare('SELECT * FROM team_invitations WHERE id=?')
    .bind(body.id)
    .first<InvitationRow>();
  if (existing) {
    if (
      existing.team_id === grant.teamId &&
      existing.email === email &&
      existing.role === role &&
      existing.athlete_id === athleteId
    )
      return presentInvite(existing);
    throw new WorkspaceAccessError(
      'This invitation ID already contains different work. Reload access before retrying.',
      409,
    );
  }
  const now = new Date().toISOString();
  if (
    await database
      .prepare(
        'SELECT 1 FROM team_memberships WHERE team_id=? AND email=? AND status=?',
      )
      .bind(grant.teamId, email, 'active')
      .first()
  )
    throw new WorkspaceAccessError(
      'That account already has active team access.',
      409,
    );
  if (
    await database
      .prepare(
        'SELECT 1 FROM team_invitations WHERE team_id=? AND email=? AND role=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?',
      )
      .bind(grant.teamId, email, role, now)
      .first()
  )
    throw new WorkspaceAccessError(
      'That recipient already has a pending invitation for this role. Use or revoke it before creating another.',
      409,
    );
  if (
    role === 'player' &&
    !(await database
      .prepare('SELECT 1 FROM athletes WHERE id=? AND team_id=?')
      .bind(athleteId, grant.teamId)
      .first())
  )
    throw new WorkspaceAccessError(
      'Choose a player profile saved in this team.',
      400,
    );
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  const saved = await database
    .prepare(
      `INSERT INTO team_invitations(id,team_id,email,role,athlete_id,created_by,created_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_owners WHERE user_id=? AND team_id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM athletes WHERE id=? AND team_id=?)) AND NOT EXISTS(SELECT 1 FROM team_invitations WHERE team_id=? AND email=? AND role=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?) ON CONFLICT(id) DO NOTHING RETURNING *`,
    )
    .bind(
      body.id,
      grant.teamId,
      email,
      role,
      athleteId,
      identity.id,
      now,
      expires,
      identity.id,
      grant.teamId,
      athleteId,
      athleteId,
      grant.teamId,
      grant.teamId,
      email,
      role,
      now,
    )
    .first<InvitationRow>();
  if (!saved)
    throw new WorkspaceAccessError(
      'The invitation could not be confirmed. Reload access before retrying.',
      409,
    );
  return presentInvite(saved);
}
export async function revokeTeamAccess(
  database: D1Database,
  identity: WorkspaceIdentity,
  grant: WorkspaceGrant,
  kind: 'invitation' | 'membership',
  id: string,
  expected: unknown,
) {
  await ownerScope(database, identity, grant);
  if (kind !== 'invitation' && kind !== 'membership')
    throw new WorkspaceAccessError(
      'Choose a valid access record to revoke.',
      400,
    );
  if (
    !uuid(id) ||
    typeof expected !== 'string' ||
    !/^[a-f0-9]{64}$/.test(expected)
  )
    throw new WorkspaceAccessError(
      'Reload the access record before removing it.',
      400,
    );
  const table = kind === 'invitation' ? 'team_invitations' : 'team_memberships';
  const row = await database
    .prepare(`SELECT * FROM ${table} WHERE id=? AND team_id=?`)
    .bind(id, grant.teamId)
    .first<InvitationRow | MembershipRow>();
  if (!row) throw new WorkspaceAccessError('Access record not found.', 404);
  if ((await version(row)) !== expected)
    throw new WorkspaceAccessError(
      'This access record changed. Reload and review it before removing access.',
      409,
    );
  const now = new Date().toISOString();
  // Exact row comparisons prevent a stale revoke from removing a later grant.
  const columns = Object.keys(row);
  const predicate = columns.map((column) => `${column} IS ?`).join(' AND ');
  const set =
    kind === 'invitation' ? 'revoked_at=?' : "status='revoked',updated_at=?";
  const saved = await database
    .prepare(
      `UPDATE ${table} SET ${set} WHERE ${predicate} AND EXISTS(SELECT 1 FROM workspace_owners WHERE user_id=? AND team_id=?) RETURNING *`,
    )
    .bind(
      now,
      ...columns.map((column) => row[column as keyof typeof row]),
      identity.id,
      grant.teamId,
    )
    .first<InvitationRow | MembershipRow>();
  if (!saved)
    throw new WorkspaceAccessError(
      'Access changed while removing it. Reload before retrying.',
      409,
    );
  return kind === 'invitation'
    ? presentInvite(saved as InvitationRow)
    : presentMember(saved as MembershipRow);
}

export async function pendingTeamInvitations(
  database: D1Database,
  identity: WorkspaceIdentity,
) {
  const email = invitationEmail(identity.email);
  if (!email) return [];
  const rows = await database
    .prepare(
      'SELECT i.*,t.name AS team_name FROM team_invitations i JOIN teams t ON t.id=i.team_id WHERE i.email=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? ORDER BY i.created_at,i.id',
    )
    .bind(email, new Date().toISOString())
    .all<InvitationRow & { team_name: string }>();
  return Promise.all(
    rows.results.map(async (row) => {
      const { team_name, ...invitation } = row;
      return {
        id: row.id,
        teamId: row.team_id,
        teamName: team_name,
        role: row.role,
        athleteId: row.athlete_id,
        expiresAt: row.expires_at,
        version: await version(invitation),
      };
    }),
  );
}
export async function acceptTeamInvitation(
  database: D1Database,
  identity: WorkspaceIdentity,
  invitationId: unknown,
  expected: unknown,
) {
  if (!uuid(invitationId) || !invitationEmail(identity.email))
    throw new WorkspaceAccessError(
      'Sign in with the invited account before joining a team.',
      403,
    );
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
    throw new WorkspaceAccessError(
      'Reload and review this invitation before accepting.',
      400,
    );
  const invitation = await database
    .prepare('SELECT * FROM team_invitations WHERE id=?')
    .bind(invitationId)
    .first<InvitationRow>();
  if (!invitation || invitation.email !== invitationEmail(identity.email))
    throw new WorkspaceAccessError(
      'This invitation is not available for your account.',
      403,
    );
  if (invitation.accepted_by) {
    const member = await database
      .prepare(
        'SELECT * FROM team_memberships WHERE invitation_id=? AND user_id=? AND status=?',
      )
      .bind(invitationId, identity.id, 'active')
      .first<MembershipRow>();
    if (invitation.accepted_by === identity.id && member)
      return presentMember(member);
    throw new WorkspaceAccessError(
      'This invitation was already used or access was removed. Ask the team owner for a new invitation.',
      409,
    );
  }
  if ((await version(invitation)) !== expected)
    throw new WorkspaceAccessError(
      'This invitation changed. Reload and review it before accepting.',
      409,
    );
  if (invitationStatus(invitation) !== 'pending')
    throw new WorkspaceAccessError(
      'This invitation expired or was revoked. Ask the owner for a new one.',
      409,
    );
  if (
    await database
      .prepare('SELECT 1 FROM workspace_owners WHERE user_id=? AND team_id=?')
      .bind(identity.id, invitation.team_id)
      .first()
  )
    throw new WorkspaceAccessError('You already own this team.', 409);
  const now = new Date().toISOString(),
    memberId = crypto.randomUUID();
  const eligible =
    'i.id=? AND i.email=? AND i.team_id=? AND i.role=? AND i.athlete_id IS ? AND i.expires_at=? AND i.created_by=? AND i.created_at=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? AND EXISTS(SELECT 1 FROM workspace_owners o WHERE o.team_id=i.team_id AND o.user_id=i.created_by)';
  const values = [
    invitationId,
    invitation.email,
    invitation.team_id,
    invitation.role,
    invitation.athlete_id,
    invitation.expires_at,
    invitation.created_by,
    invitation.created_at,
    now,
  ];
  const statements = [
    database
      .prepare(
        `INSERT INTO team_memberships(id,team_id,user_id,email,name,role,athlete_id,invitation_id,status,created_at,updated_at) SELECT ?,i.team_id,?,?,?,i.role,i.athlete_id,i.id,'active',?,? FROM team_invitations i WHERE ${eligible} AND (i.role='staff' OR EXISTS(SELECT 1 FROM athletes a WHERE a.id=i.athlete_id AND a.team_id=i.team_id)) ON CONFLICT(team_id,user_id) DO UPDATE SET email=excluded.email,name=excluded.name,role=excluded.role,athlete_id=excluded.athlete_id,invitation_id=excluded.invitation_id,status='active',updated_at=excluded.updated_at WHERE team_memberships.status='revoked' RETURNING id`,
      )
      .bind(
        memberId,
        identity.id,
        invitation.email,
        identity.name,
        now,
        now,
        ...values,
      ),
    database
      .prepare(
        `UPDATE team_invitations AS i SET accepted_by=?,accepted_at=? WHERE ${eligible} AND EXISTS(SELECT 1 FROM team_memberships m WHERE m.invitation_id=i.id AND m.user_id=? AND m.status='active') RETURNING id`,
      )
      .bind(identity.id, now, ...values, identity.id),
    // Failure is an SQL error inside the transaction, rolling back both writes.
    database
      .prepare(
        "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM team_invitations i JOIN team_memberships m ON m.invitation_id=i.id WHERE i.id=? AND i.accepted_by=? AND m.user_id=? AND m.status='active') THEN 'null' ELSE 'Invitation acceptance not confirmed' END)",
      )
      .bind(invitationId, identity.id, identity.id),
  ];
  try {
    await database.batch(statements);
  } catch {
    throw new WorkspaceAccessError(
      'This invitation or membership changed while joining. Reload before retrying.',
      409,
    );
  }
  const member = await database
    .prepare(
      'SELECT * FROM team_memberships WHERE invitation_id=? AND user_id=? AND status=?',
    )
    .bind(invitationId, identity.id, 'active')
    .first<MembershipRow>();
  if (!member)
    throw new WorkspaceAccessError(
      'Team access could not be confirmed. Reload before retrying.',
      409,
    );
  return presentMember(member);
}
