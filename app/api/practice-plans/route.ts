import { getDatabase, type TeamDatabase } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';

class PracticeInputError extends Error {}
function failure(error: unknown) {
  const status =
    error instanceof WorkspaceAccessError
      ? error.status
      : error instanceof PracticeInputError
        ? 400
        : 500;
  return Response.json(
    {
      error:
        error instanceof Error && status !== 500
          ? error.message
          : 'Unable to access the practice plan. Please retry.',
    },
    { status },
  );
}
function details(body: Record<string, unknown>) {
  const title = text(body.title);
  const date = text(body.practiceDate);
  if (!title || title.length > 120)
    throw new PracticeInputError(
      'Enter a practice title of up to 120 characters.',
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T12:00:00Z`)) ||
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new PracticeInputError('Choose a valid practice date.');
  if (
    !Array.isArray(body.blocks) ||
    body.blocks.length > 200 ||
    body.blocks.some(
      (block) =>
        !Array.isArray(block) ||
        block.length !== 5 ||
        block.some(
          (value) => typeof value !== 'string' || value.length > 4000,
        ) ||
        !block[2].trim() ||
        !/^\d{1,3} min$/.test(block[1]) ||
        Number.parseInt(block[1], 10) < 1 ||
        Number.parseInt(block[1], 10) > 600,
    )
  )
    throw new PracticeInputError(
      'Each segment needs a title and a duration between 1 and 600 minutes.',
    );
  return { title, date, savedBlocks: body.blocks as string[][] };
}

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
  return value
    .filter(Array.isArray)
    .map((block) => block.slice(0, 5).map((item) => String(item ?? '')));
}

function present(row: PlanRow) {
  const plan = JSON.parse(row.plan_json) as {
    blocks?: unknown;
    generated?: unknown;
  };
  if (
    !plan ||
    !Array.isArray(plan.blocks) ||
    plan.blocks.some(
      (block) =>
        !Array.isArray(block) ||
        block.length !== 5 ||
        block.some((value) => typeof value !== 'string'),
    )
  )
    throw new Error('Saved practice data is incomplete.');
  return {
    id: row.id,
    gameId: row.game_id,
    title: row.title,
    practiceDate: row.practice_date,
    durationMinutes: row.duration_minutes,
    blocks: blocks(plan.blocks),
    generated: Boolean(plan.generated),
  };
}

async function payload(database: TeamDatabase) {
  const result = await database
    .prepare(
      `${planSelect} WHERE team_id = ? ORDER BY practice_date DESC, title`,
    )
    .bind(database.teamId)
    .all<PlanRow>();
  return { plans: result.results.map(present) };
}

export async function GET() {
  try {
    const database = await getDatabase();
    return Response.json(await payload(database));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { title, date: practiceDate, savedBlocks } = details(body);
    const id = crypto.randomUUID();
    const duration = savedBlocks.reduce(
      (total, block) => total + (Number.parseInt(block[1], 10) || 0),
      0,
    );
    const database = await getDatabase();
    await database
      .prepare(
        `INSERT INTO practice_plans (id, team_id, game_id, title, practice_date, duration_minutes, plan_json)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        database.teamId,
        title,
        practiceDate,
        duration,
        JSON.stringify({
          blocks: savedBlocks,
          generated: Boolean(body.generated),
        }),
      )
      .run();
    return Response.json(
      { ...(await payload(database)), savedPlanId: id },
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = text(body.id);
    if (!id) throw new PracticeInputError('Choose a practice plan to update.');
    const { title, date, savedBlocks } = details(body);
    const duration = savedBlocks.reduce(
      (total, block) => total + (Number.parseInt(block[1], 10) || 0),
      0,
    );
    const database = await getDatabase();
    const existing = await database
      .prepare('SELECT id FROM practice_plans WHERE id = ? AND team_id = ?')
      .bind(id, database.teamId)
      .first();
    if (!existing)
      return Response.json(
        { error: 'Practice plan not found.' },
        { status: 404 },
      );
    await database
      .prepare(
        `UPDATE practice_plans SET title = ?, practice_date = ?, duration_minutes = ?, plan_json = ? WHERE id = ? AND team_id = ?`,
      )
      .bind(
        title,
        date,
        duration,
        JSON.stringify({
          blocks: savedBlocks,
          generated: Boolean(body.generated),
        }),
        id,
        database.teamId,
      )
      .run();
    return Response.json({ ...(await payload(database)), savedPlanId: id });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id')?.trim() ?? '';
    if (!id) throw new PracticeInputError('Choose a practice plan to delete.');
    const database = await getDatabase();
    const existing = await database
      .prepare('SELECT id FROM practice_plans WHERE id = ? AND team_id = ?')
      .bind(id, database.teamId)
      .first();
    if (!existing)
      return Response.json(
        { error: 'Practice plan not found.' },
        { status: 404 },
      );
    await database
      .prepare('DELETE FROM practice_plans WHERE id = ? AND team_id = ?')
      .bind(id, database.teamId)
      .run();
    return Response.json(await payload(database));
  } catch (error) {
    return failure(error);
  }
}
