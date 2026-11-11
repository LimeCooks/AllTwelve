import { getRawDatabase } from '@/db/client';
import { isPrototype, requestIdentity } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import { workspaceGrants } from '@/lib/team-permissions';
import { hasTeamAccessHistory } from '@/lib/team-invitations';

export async function POST(request: Request) {
  try {
    const user = await requestIdentity();
    if (isPrototype())
      return Response.json(
        { error: 'Team onboarding runs in the separate pilot environment.' },
        { status: 409 },
      );
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const season = typeof body.season === 'string' ? body.season.trim() : '';
    if (!name || name.length > 100 || !/^\d{4}$/.test(season))
      return Response.json(
        {
          error:
            'Enter a team name (up to 100 characters) and a four-digit season.',
        },
        { status: 400 },
      );
    const database = await getRawDatabase();
    const existing = await database
      .prepare('SELECT team_id FROM workspace_owners WHERE user_id = ?')
      .bind(user.id)
      .first();
    if (existing)
      return Response.json(
        { error: 'Your team already exists. Reload to open it.' },
        { status: 409 },
      );
    if (
      (await workspaceGrants(database, user)).length ||
      (await hasTeamAccessHistory(database, user))
    )
      throw new WorkspaceAccessError(
        'Open your existing team or ask its owner for a current invitation instead of creating a separate workspace.',
        409,
      );
    const teamId = crypto.randomUUID(),
      now = new Date().toISOString();
    const shortName = name.split(/\s+/).slice(0, 3).join(' ');
    const settings = {
      teamName: name,
      season,
      level: '',
      city: '',
      province: '',
      colour: 'navy',
      notifications: true,
      practiceFacility: '',
      homeField: '',
      teamRoom: '',
    };
    await database.batch([
      database
        .prepare(
          'INSERT INTO teams (id, name, short_name, season, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(teamId, name, shortName, season, now),
      database
        .prepare(
          'INSERT INTO workspace_owners (user_id, team_id, created_at) VALUES (?, ?, ?)',
        )
        .bind(user.id, teamId, now),
      database
        .prepare(
          'INSERT INTO workspace_state (id, team_id, state_key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(
          crypto.randomUUID(),
          teamId,
          'team-settings',
          JSON.stringify(settings),
          now,
        ),
    ]);
    return Response.json(
      { team: { id: teamId, name, shortName, season } },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WorkspaceAccessError
            ? error.message
            : 'Unable to create your team. Retry or reload to check whether it was created.',
      },
      { status: error instanceof WorkspaceAccessError ? error.status : 500 },
    );
  }
}
