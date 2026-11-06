import { getDatabase, TEAM_ID } from '@/db/client';

type PlanRow = {
  id: string;
  game_id: string | null;
  title: string;
  practice_date: string;
  duration_minutes: number;
  plan_json: string;
};

const planSelect = `SELECT id, game_id, title, practice_date, duration_minutes, plan_json FROM practice_plans`;

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function blocks(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.filter(Array.isArray).map((block) => block.slice(0, 5).map((item) => String(item ?? '')));
}

function present(row: PlanRow) {
  let plan: { blocks?: unknown; generated?: unknown } = {};
  try { plan = JSON.parse(row.plan_json) as typeof plan; } catch {}
  return {
    id: row.id, gameId: row.game_id, title: row.title, practiceDate: row.practice_date,
    durationMinutes: row.duration_minutes, blocks: blocks(plan.blocks), generated: Boolean(plan.generated),
  };
}

async function payload(database: D1Database) {
  const result = await database.prepare(`${planSelect} WHERE team_id = ? ORDER BY practice_date DESC, title`).bind(TEAM_ID).all<PlanRow>();
  return { plans: result.results.map(present) };
}

export async function GET() {
  try {
    const database = await getDatabase();
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load practice plans.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const title = text(body.title, 'Untitled practice');
    const practiceDate = text(body.practiceDate);
    if (!practiceDate || Number.isNaN(Date.parse(`${practiceDate}T12:00:00Z`))) throw new Error('Choose a valid practice date.');
    const id = crypto.randomUUID();
    const savedBlocks = blocks(body.blocks);
    const duration = savedBlocks.reduce((total, block) => total + (Number.parseInt(block[1], 10) || 0), 0);
    const database = await getDatabase();
    await database.prepare(
      `INSERT INTO practice_plans (id, team_id, game_id, title, practice_date, duration_minutes, plan_json)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    ).bind(id, TEAM_ID, title, practiceDate, duration, JSON.stringify({ blocks: savedBlocks, generated: Boolean(body.generated) })).run();
    return Response.json(await payload(database), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to create the practice plan.' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.id);
    if (!id) throw new Error('Choose a practice plan to update.');
    const savedBlocks = blocks(body.blocks);
    const duration = savedBlocks.reduce((total, block) => total + (Number.parseInt(block[1], 10) || 0), 0);
    const database = await getDatabase();
    await database.prepare(
      `UPDATE practice_plans SET title = ?, practice_date = ?, duration_minutes = ?, plan_json = ? WHERE id = ? AND team_id = ?`,
    ).bind(text(body.title, 'Untitled practice'), text(body.practiceDate), duration, JSON.stringify({ blocks: savedBlocks, generated: Boolean(body.generated) }), id, TEAM_ID).run();
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update the practice plan.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id')?.trim() ?? '';
    if (!id) throw new Error('Choose a practice plan to delete.');
    const database = await getDatabase();
    await database.prepare('DELETE FROM practice_plans WHERE id = ? AND team_id = ?').bind(id, TEAM_ID).run();
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete the practice plan.' }, { status: 400 });
  }
}
