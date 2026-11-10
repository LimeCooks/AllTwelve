import { getCoachingDatabase as getDatabase } from '@/db/client';
import type { CalendarEventRecord, CalendarEventType } from '@/types/domain';
import { WorkspaceAccessError } from '@/lib/workspace-identity';

class CalendarInputError extends Error {}
function failure(error: unknown) {
  const status =
    error instanceof WorkspaceAccessError
      ? error.status
      : error instanceof CalendarInputError || error instanceof SyntaxError
        ? 400
        : 500;
  return Response.json(
    {
      error:
        status === 500
          ? 'Unable to access the schedule. Please retry.'
          : error instanceof Error
            ? error.message
            : 'Unable to save the event.',
    },
    { status, headers: { 'cache-control': 'private, no-store' } },
  );
}
function timestamp(value: unknown) {
  const raw = text(value);
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  if (
    !match ||
    Number.isNaN(Date.parse(raw)) ||
    Number.isNaN(Date.parse(`${match[1]}T12:00:00Z`)) ||
    new Date(`${match[1]}T12:00:00Z`).toISOString().slice(0, 10) !== match[1]
  )
    throw new CalendarInputError(
      'Choose a valid start and end time with a time zone.',
    );
  return new Date(raw).toISOString();
}

type CalendarEventRow = {
  id: string;
  title: string;
  event_type: CalendarEventType;
  starts_at: string;
  ends_at: string;
  location: string;
  notes: string;
};

const eventSelect = `SELECT id, title, event_type, starts_at, ends_at, location, notes
  FROM calendar_events`;

const baseline = (row: CalendarEventRow) => [
  row.title,
  row.event_type,
  row.starts_at,
  row.ends_at,
  row.location,
  row.notes,
];
const baselineSql =
  'title=? AND event_type=? AND starts_at=? AND ends_at=? AND location=? AND notes=?';
async function version(row: CalendarEventRow) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([row.id, ...baseline(row)])),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
async function present(row: CalendarEventRow): Promise<CalendarEventRecord> {
  return {
    id: row.id,
    version: await version(row),
    title: row.title,
    eventType: row.event_type,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    location: row.location,
    notes: row.notes,
  };
}

function isEventType(value: unknown): value is CalendarEventType {
  return (
    value === 'film' ||
    value === 'install' ||
    value === 'practice' ||
    value === 'game' ||
    value === 'staff' ||
    value === 'travel' ||
    value === 'meeting'
  );
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET(request?: Request) {
  try {
    const database = await getDatabase();
    const id = request ? new URL(request.url).searchParams.get('id') : null;
    if (id !== null) {
      const row = await database
        .prepare(`${eventSelect} WHERE id=? AND team_id=?`)
        .bind(id, database.teamId)
        .first<CalendarEventRow>();
      return row
        ? Response.json(
            { event: await present(row) },
            { headers: { 'cache-control': 'private, no-store' } },
          )
        : Response.json({ error: 'Event not found.' }, { status: 404 });
    }
    const result = await database
      .prepare(`${eventSelect} WHERE team_id = ? ORDER BY starts_at`)
      .bind(database.teamId)
      .all<CalendarEventRow>();
    return Response.json(
      {
        events: (await Promise.all(result.results.map(present))).sort(
          (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
        ),
      },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

async function saveEvent(request: Request, update: boolean) {
  try {
    const database = await getDatabase();
    const body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new CalendarInputError('Enter valid event details.');
    const id = update
      ? text(body.id)
      : body.id === undefined
        ? crypto.randomUUID()
        : text(body.id);
    if (
      !update &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      )
    )
      throw new CalendarInputError('Use a valid new event request.');
    let existing: CalendarEventRow | null = null;
    if (update) {
      if (!id) throw new CalendarInputError('Event id is required.');
      existing = await database
        .prepare(`${eventSelect} WHERE id = ? AND team_id = ?`)
        .bind(id, database.teamId)
        .first<CalendarEventRow>();
      if (!existing)
        return Response.json({ error: 'Event not found.' }, { status: 404 });
    }
    const title = text(body.title);
    const eventType = body.eventType;
    const startsAt = timestamp(body.startsAt);
    const endsAt = timestamp(body.endsAt);
    const location = text(body.location);
    const notes = text(body.notes);
    if (!title || title.length > 200)
      throw new CalendarInputError(
        'Enter an event title of up to 200 characters.',
      );
    if (!isEventType(eventType))
      throw new CalendarInputError('Choose a valid event type.');
    if (location.length > 500 || notes.length > 10000)
      throw new CalendarInputError('Use a shorter location or event note.');
    if (Date.parse(endsAt) <= Date.parse(startsAt))
      throw new CalendarInputError('The event must end after it starts.');
    let row: CalendarEventRow | null;
    if (update) {
      if (
        typeof body.version !== 'string' ||
        !/^[a-f0-9]{64}$/.test(body.version)
      )
        throw new CalendarInputError('Reload the saved event before editing.');
      if (body.version !== (await version(existing!)))
        throw new WorkspaceAccessError(
          'This event changed on another device. Your draft was not saved. Review the latest saved event before retrying.',
          409,
        );
      row = await database
        .prepare(
          `UPDATE calendar_events SET title = ?, event_type = ?, starts_at = ?, ends_at = ?, location = ?, notes = ? WHERE id = ? AND team_id = ? AND ${baselineSql} RETURNING id,title,event_type,starts_at,ends_at,location,notes`,
        )
        .bind(
          title,
          eventType,
          startsAt,
          endsAt,
          location,
          notes,
          id,
          database.teamId,
          ...baseline(existing!),
        )
        .first<CalendarEventRow>();
      if (!row)
        throw new WorkspaceAccessError(
          'This event changed or was removed while saving. Your draft was not saved. Review the latest saved event.',
          409,
        );
    } else {
      const receipt = 'calendar-created-v1:' + id;
      await database.batch([
        database
          .prepare(
            `INSERT INTO calendar_events (id, team_id, game_id, title, event_type, starts_at, ends_at, location, notes)
       SELECT ?, ?, NULL, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS(SELECT 1 FROM workspace_state WHERE team_id=? AND state_key=?) ON CONFLICT(id) DO NOTHING`,
          )
          .bind(
            id,
            database.teamId,
            title,
            eventType,
            startsAt,
            endsAt,
            location,
            notes,
            database.teamId,
            receipt,
          ),
        database
          .prepare(`INSERT INTO workspace_state(id,team_id,state_key,value_json,updated_at)
          SELECT lower(hex(randomblob(16))),?,?,?,? WHERE EXISTS(SELECT 1 FROM calendar_events WHERE id=? AND team_id=? AND ${baselineSql})
          ON CONFLICT(team_id,state_key) DO NOTHING`)
          .bind(
            database.teamId,
            receipt,
            JSON.stringify({ id }),
            new Date().toISOString(),
            id,
            database.teamId,
            title,
            eventType,
            startsAt,
            endsAt,
            location,
            notes,
          ),
      ]);
      {
        row = await database
          .prepare(`${eventSelect} WHERE id=? AND team_id=?`)
          .bind(id, database.teamId)
          .first<CalendarEventRow>();
        if (
          !row ||
          JSON.stringify(baseline(row)) !==
            JSON.stringify([
              title,
              eventType,
              startsAt,
              endsAt,
              location,
              notes,
            ])
        )
          throw new WorkspaceAccessError(
            'That event request was already used. Refresh the schedule before creating another event.',
            409,
          );
      }
    }
    return Response.json(
      { event: await present(row) },
      { status: update ? 200 : 201 },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  return saveEvent(request, false);
}
export async function PUT(request: Request) {
  return saveEvent(request, true);
}

export async function DELETE(request: Request) {
  try {
    const id = text(new URL(request.url).searchParams.get('id'));
    if (!id) throw new CalendarInputError('Event id is required.');
    const database = await getDatabase();
    const existing = await database
      .prepare(`${eventSelect} WHERE id = ? AND team_id = ?`)
      .bind(id, database.teamId)
      .first<CalendarEventRow>();
    if (!existing)
      return Response.json({ error: 'Event not found.' }, { status: 404 });
    const expected = request.headers.get('x-chalktalk-calendar-version');
    if (!expected || !/^[a-f0-9]{64}$/.test(expected))
      throw new CalendarInputError(
        'Reload the saved event before removing it.',
      );
    if (expected !== (await version(existing)))
      throw new WorkspaceAccessError(
        'This event changed on another device. Review the latest saved event before removing it.',
        409,
      );
    const removed = await database
      .prepare(
        `DELETE FROM calendar_events WHERE id = ? AND team_id = ? AND ${baselineSql} RETURNING id`,
      )
      .bind(id, database.teamId, ...baseline(existing))
      .first();
    if (!removed)
      throw new WorkspaceAccessError(
        'This event changed or was removed while deleting. Refresh the schedule.',
        409,
      );
    return Response.json({ deleted: id });
  } catch (error) {
    return failure(error);
  }
}
