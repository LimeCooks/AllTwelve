import { getRawDatabase } from '@/db/client';
import { isPrototype, requestIdentity } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';

export async function GET() {
  try {
    const user = await requestIdentity();
    if (isPrototype())
      return Response.json(
        { mode: 'prototype', user, team: { id: 'local-prototype' } },
        { headers: { 'cache-control': 'no-store' } },
      );
    const database = await getRawDatabase();
    const team = await database
      .prepare(
        'SELECT t.id, t.name, t.short_name AS shortName, t.season FROM teams t JOIN workspace_owners o ON o.team_id = t.id WHERE o.user_id = ?',
      )
      .bind(user.id)
      .first();
    return Response.json(
      { mode: 'pilot', user, team: team ?? null },
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
