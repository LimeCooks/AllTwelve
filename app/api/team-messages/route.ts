import { getWorkspaceAccess } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import { teamMessages, writeTeamMessage } from '@/lib/team-messages';
import { isPrototype } from '@/lib/request-identity';
async function access() {
  if (isPrototype())
    throw new WorkspaceAccessError(
      'Use the local pilot accounts for connected team conversations.',
      409,
    );
  return getWorkspaceAccess('communication.use');
}
const failure = (error: unknown) =>
  Response.json(
    {
      error:
        error instanceof WorkspaceAccessError
          ? error.message
          : 'Team conversations could not be loaded. Please retry.',
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
export async function GET(request: Request) {
  try {
    const { database, identity, grant } = await access();
    const params = new URL(request.url).searchParams;
    return Response.json(
      await teamMessages(
        database,
        identity,
        grant,
        params.get('conversationId') ?? '',
        params.get('before') ?? '',
      ),
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const { database, identity, grant } = await access();
    return Response.json(
      await writeTeamMessage(database, identity, grant, await request.json()),
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
