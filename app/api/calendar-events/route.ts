import { getDatabase } from '@/db/client';
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
    { status },
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

function present(row: CalendarEventRow): CalendarEventRecord {
  return {
    id: row.id,
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

export async function GET() {
  try {
    const database = await getDatabase();
    const result = await database
      .prepare(`${eventSelect} WHERE team_id = ? ORDER BY starts_at`)
      .bind(database.teamId)
      .all<CalendarEventRow>();
    return Response.json({
      events: result.results
        .map(present)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const database = await getDatabase();
    const body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new CalendarInputError('Enter valid event details.');
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
    const id = crypto.randomUUID();
    await database
      .prepare(
        `INSERT INTO calendar_events (id, team_id, game_id, title, event_type, starts_at, ends_at, location, notes)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
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
      )
      .run();
    const row = await database
      .prepare(`${eventSelect} WHERE id = ? AND team_id = ?`)
      .bind(id, database.teamId)
      .first<CalendarEventRow>();
    return Response.json({ event: row ? present(row) : null }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
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
    await database
      .prepare('DELETE FROM calendar_events WHERE id = ? AND team_id = ?')
      .bind(id, database.teamId)
      .run();
    return Response.json({ deleted: id });
  } catch (error) {
    return failure(error);
  }
}
