import { getWorkspaceAccess } from '@/db/client';
import { isPrototype } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import {
  createTeamInvitation,
  listTeamAccess,
  revokeTeamAccess,
} from '@/lib/team-invitations';
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof WorkspaceAccessError
          ? error.message
          : 'Team access could not be confirmed. Reload before retrying.',
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
async function owner() {
  if (isPrototype())
    throw new WorkspaceAccessError(
      'Manage real team access in the private pilot.',
      409,
    );
  return getWorkspaceAccess('access.manage');
}
export async function GET() {
  try {
    const { database, identity, grant } = await owner();
    return Response.json(await listTeamAccess(database, identity, grant), {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const { database, identity, grant } = await owner();
    const invitation = await createTeamInvitation(
      database,
      identity,
      grant,
      await request.json(),
    );
    return Response.json(
      { invitation },
      { status: 201, headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const { database, identity, grant } = await owner();
    const body = (await request.json()) as {
      kind?: unknown;
      id?: unknown;
      version?: unknown;
    };
    if (
      !body ||
      !['invitation', 'membership'].includes(String(body.kind)) ||
      typeof body.id !== 'string'
    )
      throw new WorkspaceAccessError('Choose an access record to revoke.', 400);
    const saved = await revokeTeamAccess(
      database,
      identity,
      grant,
      body.kind as 'invitation' | 'membership',
      body.id,
      body.version,
    );
    return Response.json(
      { saved },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
