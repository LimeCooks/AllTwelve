import { getCoachingDatabase as getDatabase } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import {
  getGameplan,
  listGameplans,
  saveGameplanRecord,
} from '@/lib/gameplan-records';
import { validGameplanId } from '@/lib/named-gameplans';
const response = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'cache-control': 'private, no-store' },
  });
function failure(error: unknown) {
  return response(
    {
      error:
        error instanceof WorkspaceAccessError
          ? error.message
          : error instanceof SyntaxError
            ? 'Enter valid gameplan details.'
            : 'Saved gameplans could not be read or confirmed. Reload before editing.',
    },
    error instanceof WorkspaceAccessError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 500,
  );
}
export async function GET(request?: Request) {
  try {
    const db = await getDatabase(),
      id = request ? new URL(request.url).searchParams.get('id') : null;
    if (id !== null) {
      if (!validGameplanId(id))
        throw new WorkspaceAccessError('Choose a saved gameplan.', 400);
      const plan = await getGameplan(db, id);
      if (!plan) throw new WorkspaceAccessError('Gameplan not found.', 404);
      return response({ plan });
    }
    return response({ plans: await listGameplans(db) });
  } catch (error) {
    return failure(error);
  }
}
async function save(request: Request, update: boolean) {
  try {
    const db = await getDatabase();
    return response(
      { plan: await saveGameplanRecord(db, await request.json(), update) },
      update ? 200 : 201,
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  return save(request, false);
}
export async function PUT(request: Request) {
  return save(request, true);
}
