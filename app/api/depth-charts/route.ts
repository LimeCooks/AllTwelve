import { getDatabase, type TeamDatabase } from '@/db/client';
import type { AthleteStatus, AthleteUnit, DepthAssignmentRecord, DepthChartPayload, DepthRosterAthlete } from '@/types/domain';

type ChartRow = {
  id: string;
  name: string;
  unit: AthleteUnit;
  formation: string;
  published_at: string | null;
};

type AssignmentRow = {
  id: string;
  position: string;
  rank: number;
  x: number;
  y: number;
  athlete_id: string;
  first_name: string;
  last_name: string;
  athlete_number: number | null;
  athlete_status: AthleteStatus;
};

type RosterRow = {
  id: string;
  number: number | null;
  first_name: string;
  last_name: string;
  position: string;
  unit: AthleteUnit;
  status: AthleteStatus;
};

async function readDepthChart(database: TeamDatabase): Promise<DepthChartPayload> {
  const chart = await database.prepare(
    `SELECT dc.id, dc.name, dc.unit, f.name AS formation, dc.published_at
     FROM depth_charts dc
     JOIN formations f ON f.id = dc.formation_id
     WHERE dc.id = ? AND dc.team_id = ?`,
  ).bind('depth-offence-doubles', database.teamId).first<ChartRow>();
  if (!chart) throw new Error('The saved Doubles depth chart is unavailable.');

  const assignmentRows = await database.prepare(
    `SELECT da.id, da.position, da.rank, da.x, da.y, a.id AS athlete_id,
       a.first_name, a.last_name, a.number AS athlete_number, a.status AS athlete_status
     FROM depth_assignments da
     JOIN athletes a ON a.id = da.athlete_id
     WHERE da.depth_chart_id = ?
     ORDER BY da.rank, da.y, da.x`,
  ).bind(chart.id).all<AssignmentRow>();
  const rosterRows = await database.prepare(
    `SELECT id, number, first_name, last_name, position, unit, status
     FROM athletes WHERE team_id = ? ORDER BY CASE WHEN number IS NULL THEN 1 ELSE 0 END, number, last_name`,
  ).bind(database.teamId).all<RosterRow>();

  const assignments: DepthAssignmentRecord[] = assignmentRows.results.map((row) => ({
    id: row.id,
    position: row.position,
    rank: row.rank,
    x: row.x,
    y: row.y,
    athleteId: row.athlete_id,
    athleteName: `${row.first_name} ${row.last_name}`,
    athleteInitials: `${row.first_name[0] ?? ''}${row.last_name[0] ?? ''}`.toUpperCase(),
    athleteNo: row.athlete_number,
    athleteStatus: row.athlete_status,
  }));
  const athletes: DepthRosterAthlete[] = rosterRows.results.map((row) => ({
    id: row.id,
    no: row.number,
    name: `${row.first_name} ${row.last_name}`,
    position: row.position,
    unit: row.unit,
    status: row.status,
  }));
  return {
    chart: { id: chart.id, name: chart.name, unit: chart.unit, formation: chart.formation, publishedAt: chart.published_at },
    assignments,
    athletes,
  };
}

export async function GET() {
  try {
    return Response.json(await readDepthChart(await getDatabase()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load the depth chart.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { assignmentId?: unknown; athleteId?: unknown };
    const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId : '';
    const athleteId = typeof body.athleteId === 'string' ? body.athleteId : '';
    if (!assignmentId || !athleteId) throw new Error('Choose a depth-chart slot and athlete.');
    const database = await getDatabase();
    const target = await database.prepare(
      `SELECT da.id, da.athlete_id, da.depth_chart_id
       FROM depth_assignments da JOIN depth_charts dc ON dc.id = da.depth_chart_id
       WHERE da.id = ? AND dc.team_id = ?`,
    ).bind(assignmentId, database.teamId).first<{ id: string; athlete_id: string; depth_chart_id: string }>();
    if (!target) return Response.json({ error: 'Depth-chart slot not found.' }, { status: 404 });
    const athlete = await database.prepare('SELECT id FROM athletes WHERE id = ? AND team_id = ?').bind(athleteId, database.teamId).first();
    if (!athlete) return Response.json({ error: 'Athlete not found.' }, { status: 404 });

    const occupied = await database.prepare(
      'SELECT id FROM depth_assignments WHERE depth_chart_id = ? AND athlete_id = ? AND id != ?',
    ).bind(target.depth_chart_id, athleteId, target.id).first<{ id: string }>();
    if (occupied) {
      await database.batch([
        database.prepare('UPDATE depth_assignments SET athlete_id = ? WHERE id = ?').bind(target.athlete_id, occupied.id),
        database.prepare('UPDATE depth_assignments SET athlete_id = ? WHERE id = ?').bind(athleteId, target.id),
      ]);
    } else {
      await database.prepare('UPDATE depth_assignments SET athlete_id = ? WHERE id = ?').bind(athleteId, target.id).run();
    }
    return Response.json(await readDepthChart(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update the depth chart.' }, { status: 400 });
  }
}
