import { NextRequest, NextResponse } from 'next/server';

import { getDatabase } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';

type WorkspaceStateRow = {
  state_key: string;
  value_json: string;
  updated_at: string;
};

function validKey(value: string | null): value is string {
  return Boolean(value && /^[a-z0-9][a-z0-9-]{1,79}$/i.test(value));
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (!validKey(key))
    return NextResponse.json(
      { error: 'A valid state key is required.' },
      { status: 400 },
    );

  try {
    const database = await getDatabase();
    const row = await database
      .prepare(
        'SELECT state_key, value_json, updated_at FROM workspace_state WHERE team_id = ? AND state_key = ?',
      )
      .bind(database.teamId, key)
      .first<WorkspaceStateRow>();

    if (!row) return NextResponse.json({ key, value: null, updatedAt: null });
    return NextResponse.json({
      key: row.state_key,
      value: JSON.parse(row.value_json),
      updatedAt: row.updated_at,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to load workspace state.';
    return NextResponse.json(
      { error: message },
      { status: error instanceof WorkspaceAccessError ? error.status : 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = (await request.json()) as { key?: string; value?: unknown };
    if (!validKey(payload.key ?? null))
      return NextResponse.json(
        { error: 'A valid state key is required.' },
        { status: 400 },
      );

    const valueJson = JSON.stringify(payload.value ?? null);
    if (valueJson.length > 250_000)
      return NextResponse.json(
        { error: 'This workspace record is too large.' },
        { status: 413 },
      );

    const database = await getDatabase();
    const updatedAt = new Date().toISOString();
    if (
      payload.key === 'private-conversations-v3' ||
      payload.key?.startsWith('pb-create-')
    )
      return NextResponse.json(
        {
          error:
            'Use the dedicated workspace service to save this protected record.',
        },
        { status: 403 },
      );
    const statements = [];
    if (payload.key === 'team-settings') {
      const settings = payload.value as {
        teamName?: unknown;
        season?: unknown;
      } | null;
      const name =
        typeof settings?.teamName === 'string' ? settings.teamName.trim() : '';
      const season =
        typeof settings?.season === 'string' ? settings.season.trim() : '';
      if (!name || name.length > 100 || !/^\d{4}$/.test(season))
        return NextResponse.json(
          {
            error:
              'Enter a team name (up to 100 characters) and a four-digit season.',
          },
          { status: 400 },
        );
      statements.push(
        database
          .prepare(
            'UPDATE teams SET name = ?, short_name = ?, season = ? WHERE id = ?',
          )
          .bind(
            name,
            name.split(/\s+/).slice(0, 3).join(' '),
            season,
            database.teamId,
          ),
      );
    }
    statements.push(
      database
        .prepare(
          `INSERT INTO workspace_state (id, team_id, state_key, value_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(team_id, state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .bind(
          `state-${database.teamId}-${payload.key}`,
          database.teamId,
          payload.key,
          valueJson,
          updatedAt,
        ),
    );
    await database.batch(statements);

    return NextResponse.json({
      key: payload.key,
      value: payload.value ?? null,
      updatedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to save workspace state.';
    return NextResponse.json(
      { error: message },
      { status: error instanceof WorkspaceAccessError ? error.status : 500 },
    );
  }
}
