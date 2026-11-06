import { getDatabase } from '@/db/client';
import type { CalendarEventRecord, CalendarEventType } from '@/types/domain';

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
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    notes: row.notes,
  };
}

function isEventType(value: unknown): value is CalendarEventType {
  return value === 'film' || value === 'install' || value === 'practice' || value === 'game' || value === 'staff' || value === 'travel' || value === 'meeting';
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET() {
  try {
    const database = await getDatabase();
    const result = await database.prepare(`${eventSelect} WHERE team_id = ? ORDER BY starts_at`).bind(database.teamId).all<CalendarEventRow>();
    return Response.json({ events: result.results.map(present) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load calendar events.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const title = text(body.title);
    const eventType = body.eventType;
    const startsAt = text(body.startsAt);
    const endsAt = text(body.endsAt);
    const location = text(body.location);
    const notes = text(body.notes);
    if (!title) throw new Error('Event title is required.');
    if (!isEventType(eventType)) throw new Error('Choose a valid event type.');
    if (!startsAt || !endsAt || Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) throw new Error('Choose a valid start and end time.');
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('The event must end after it starts.');
    const id = crypto.randomUUID();
    const database = await getDatabase();
    await database.prepare(
      `INSERT INTO calendar_events (id, team_id, game_id, title, event_type, starts_at, ends_at, location, notes)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, database.teamId, title, eventType, startsAt, endsAt, location, notes).run();
    const row = await database.prepare(`${eventSelect} WHERE id = ? AND team_id = ?`).bind(id, database.teamId).first<CalendarEventRow>();
    return Response.json({ event: row ? present(row) : null }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to create the event.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = text(new URL(request.url).searchParams.get('id'));
    if (!id) throw new Error('Event id is required.');
    const database = await getDatabase();
    const existing = await database.prepare(`${eventSelect} WHERE id = ? AND team_id = ?`).bind(id, database.teamId).first<CalendarEventRow>();
    if (!existing) return Response.json({ error: 'Event not found.' }, { status: 404 });
    await database.prepare('DELETE FROM calendar_events WHERE id = ? AND team_id = ?').bind(id, database.teamId).run();
    return Response.json({ deleted: id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to remove the event.' }, { status: 400 });
  }
}
