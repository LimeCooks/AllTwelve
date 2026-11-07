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
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new PracticeInputError('Enter valid practice details.');
  if (body.generated !== undefined && typeof body.generated !== 'boolean')
    throw new PracticeInputError('The generation flag must be true or false.');
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
        !(
          block[0] === 'TBD' || /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(block[0])
        ) ||
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

async function version(row: PlanRow) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([row.title, row.practice_date, row.plan_json]),
    ),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function present(row: PlanRow) {
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
    version: await version(row),
  };
}

async function payload(database: TeamDatabase) {
  const result = await database
    .prepare(
      `${planSelect} WHERE team_id = ? ORDER BY practice_date DESC, title`,
    )
    .bind(database.teamId)
    .all<PlanRow>();
  return { plans: await Promise.all(result.results.map(present)) };
}

export async function GET() {
  try {
    const database = await getDatabase();
    return Response.json(await payload(database), {
      headers: { 'cache-control': 'private, no-store' },
    });
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
      .prepare(`${planSelect} WHERE id = ? AND team_id = ?`)
      .bind(id, database.teamId)
      .first<PlanRow>();
    if (!existing)
      return Response.json(
        { error: 'Practice plan not found.' },
        { status: 404 },
      );
    if (!body.version || typeof body.version !== 'string')
      throw new PracticeInputError('Reload the plan before saving changes.');
    if (body.version !== (await version(existing)))
      return Response.json(
        {
          error:
            'This practice plan changed on another device. Your changes have not been saved. Reload the latest plan before retrying.',
        },
        { status: 409 },
      );
    const updated = await database
      .prepare(
        `UPDATE practice_plans SET title = ?, practice_date = ?, duration_minutes = ?, plan_json = ? WHERE id = ? AND team_id = ? AND title = ? AND practice_date = ? AND plan_json = ? RETURNING id`,
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
        existing.title,
        existing.practice_date,
        existing.plan_json,
      )
      .first();
    if (!updated)
      return Response.json(
        {
          error:
            'This practice plan changed while saving. Reload the latest plan before retrying.',
        },
        { status: 409 },
      );
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
      .prepare(`${planSelect} WHERE id = ? AND team_id = ?`)
      .bind(id, database.teamId)
      .first<PlanRow>();
    if (!existing)
      return Response.json(
        { error: 'Practice plan not found.' },
        { status: 404 },
      );
    const expectedVersion = new URL(request.url).searchParams.get('version');
    if (!expectedVersion)
      throw new PracticeInputError('Reload the plan before deleting it.');
    if (expectedVersion !== (await version(existing)))
      return Response.json(
        {
          error:
            'This plan changed on another device. Reload before deleting it.',
        },
        { status: 409 },
      );
    const deleted = await database
      .prepare(
        'DELETE FROM practice_plans WHERE id = ? AND team_id = ? AND title = ? AND practice_date = ? AND plan_json = ? RETURNING id',
      )
      .bind(
        id,
        database.teamId,
        existing.title,
        existing.practice_date,
        existing.plan_json,
      )
      .first();
    if (!deleted)
      return Response.json(
        { error: 'This plan changed while deleting. Reload before retrying.' },
        { status: 409 },
      );
    return Response.json(await payload(database));
  } catch (error) {
    return failure(error);
  }
}
