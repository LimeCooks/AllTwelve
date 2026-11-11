import { getWorkspaceAccess } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import { playerLearning, acknowledgeLearning } from '@/lib/player-learning';
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof WorkspaceAccessError
          ? error.message
          : 'Your learning material could not be loaded. Please retry.',
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
export async function GET() {
  try {
    const { database, grant } = await getWorkspaceAccess(
      'player.assigned.read',
    );
    return Response.json(await playerLearning(database, grant), {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const { database, grant } = await getWorkspaceAccess(
      'player.own-review.write',
    );
    return Response.json(
      await acknowledgeLearning(database, grant, await request.json()),
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
