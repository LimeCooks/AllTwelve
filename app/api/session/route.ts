import { getRawDatabase } from '@/db/client';
import { isPrototype, requestIdentity } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import { workspaceGrants } from '@/lib/team-permissions';
import {
  pendingTeamInvitations,
  hasTeamAccessHistory,
} from '@/lib/team-invitations';

export async function GET(request?: Request) {
  try {
    const user = await requestIdentity();
    if (isPrototype())
      return Response.json(
        { mode: 'prototype', user, team: { id: 'local-prototype' } },
        { headers: { 'cache-control': 'no-store' } },
      );
    const database = await getRawDatabase();
    const grants = await workspaceGrants(database, user);
    const hint = request
      ? (new URL(request.url).searchParams.get('team') ??
        request.headers.get('x-alltwelve-team-id') ??
        '')
      : '';
    const grant = hint
      ? grants.find((grant) => grant.teamId === hint)
      : (grants.find((grant) => grant.role === 'owner') ??
        (grants.length === 1 ? grants[0] : null));
    if (hint && !grant)
      throw new WorkspaceAccessError(
        'You no longer have access to that team. Open the workspace without a team selection to choose another.',
        403,
      );
    const team = grant
      ? {
          id: grant.teamId,
          name: grant.teamName,
          shortName: grant.shortName,
          season: grant.season,
          role: grant.role,
          athleteId: grant.athleteId,
        }
      : null;
    const invitations = await pendingTeamInvitations(database, user);
    const canCreateTeam =
      !grants.length && !(await hasTeamAccessHistory(database, user));
    return Response.json(
      {
        mode: 'pilot',
        user,
        team,
        workspaces: grants.map((grant) => ({
          id: grant.teamId,
          name: grant.teamName,
          season: grant.season,
          role: grant.role,
        })),
        invitations,
        canCreateTeam,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to load your account.',
      },
      { status: error instanceof WorkspaceAccessError ? error.status : 500 },
    );
  }
}
