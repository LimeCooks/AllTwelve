import { getRawDatabase } from '@/db/client';
import { isPrototype, requestIdentity } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import {
  acceptTeamInvitation,
  pendingTeamInvitations,
} from '@/lib/team-invitations';
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof WorkspaceAccessError
          ? error.message
          : 'Team invitations could not be confirmed. Reload before retrying.',
    },
    {
      status:
        error instanceof WorkspaceAccessError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 500,
      headers: { 'cache-control': 'private, no-store' },
    },
  );
}
async function signedIn() {
  const identity = await requestIdentity();
  if (isPrototype())
    throw new WorkspaceAccessError(
      'Real team invitations are available in the private pilot.',
      409,
    );
  return { database: await getRawDatabase(), identity };
}
export async function GET() {
  try {
    const { database, identity } = await signedIn();
    return Response.json(
      { invitations: await pendingTeamInvitations(database, identity) },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const { database, identity } = await signedIn();
    const body = (await request.json()) as { id?: unknown; version?: unknown };
    if (!body)
      throw new WorkspaceAccessError(
        'Review an invitation before joining a team.',
        400,
      );
    const membership = await acceptTeamInvitation(
      database,
      identity,
      body.id,
      body.version,
    );
    return Response.json(
      { membership },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
