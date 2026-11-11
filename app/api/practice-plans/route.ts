import { getCoachingDatabase as getDatabase, type TeamDatabase } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import { getGameplanSnapshot } from '@/lib/gameplan-records';
import { validGameplanId } from '@/lib/named-gameplans';
import {
  practiceFromGameplan,
  type PracticeGameplanSource,
} from '@/lib/practice-generation';

class PracticeInputError extends Error {}
function failure(error: unknown) {
  const status =
    error instanceof WorkspaceAccessError
      ? error.status
      : error instanceof PracticeInputError || error instanceof SyntaxError
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
    gameplanSource?: unknown;
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
    gameplanSource: sourceInfo(plan.gameplanSource),
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

function sourceInfo(value: unknown): PracticeGameplanSource | null {
  if (value === undefined || value === null) return null;
  const source = value as PracticeGameplanSource;
  if (
    !validGameplanId(source.id) ||
    typeof source.title !== 'string' ||
    !source.title ||
    !/^[a-f0-9]{64}$/.test(source.version)
  )
    throw new Error('Saved practice source is incomplete.');
  return { id: source.id, title: source.title, version: source.version };
}
async function creationDigest(body: Record<string, unknown>) {
  const source = body.generateFrom as
    | { id?: unknown; version?: unknown }
    | undefined;
  const value = JSON.stringify([
    text(body.title),
    text(body.practiceDate),
    Boolean(source || body.generated),
    source ? [source.id, source.version] : body.blocks,
  ]);
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
function validatePracticeEnvelope(body: Record<string, unknown>) {
  if (body.generated !== undefined && typeof body.generated !== 'boolean')
    throw new PracticeInputError('The generation flag must be true or false.');
  details(
    body.generateFrom === undefined
      ? body
      : { ...body, blocks: [], generated: true },
  );
}
async function preparePractice(
  db: TeamDatabase,
  body: Record<string, unknown>,
  existing?: PlanRow,
) {
  const prior = existing
    ? (JSON.parse(existing.plan_json) as {
        generated?: boolean;
        gameplanSource?: unknown;
        creationDigest?: string;
      })
    : null;
  // Manual changes affect the script, not its recorded origin.
  let source = sourceInfo(prior?.gameplanSource);
  let predicate = '1',
    values: (string | null)[] = [];
  let content = body;
  if (body.generateFrom !== undefined) {
    const requested = body.generateFrom as {
      id?: unknown;
      version?: unknown;
    } | null;
    if (
      !requested ||
      !validGameplanId(requested.id) ||
      typeof requested.version !== 'string' ||
      !/^[a-f0-9]{64}$/.test(requested.version)
    )
      throw new PracticeInputError(
        'Choose a saved gameplan and reload its current revision.',
      );
    const snapshot = await getGameplanSnapshot(db, requested.id);
    if (!snapshot.plan)
      throw new WorkspaceAccessError(
        'The source gameplan is unavailable.',
        404,
      );
    if (snapshot.plan.archived)
      throw new WorkspaceAccessError(
        'Restore this archived gameplan before generating practice.',
        409,
      );
    if (snapshot.plan.version !== requested.version)
      throw new WorkspaceAccessError(
        'The source gameplan changed. Refresh the source list and review it before generating practice.',
        409,
      );
    const plays = (
      await db
        .prepare('SELECT id, name, unit FROM plays WHERE team_id=?')
        .bind(db.teamId)
        .all<{ id: string; name: string; unit: string }>()
    ).results;
    let generatedBlocks;
    try {
      generatedBlocks = practiceFromGameplan(snapshot.plan.state, plays);
    } catch (error) {
      throw new PracticeInputError(
        error instanceof Error
          ? error.message
          : 'The source gameplan is incomplete.',
      );
    }
    content = { ...body, generated: true, blocks: generatedBlocks };
    source = {
      id: snapshot.plan.id,
      title: snapshot.plan.title,
      version: snapshot.plan.version,
    };
    predicate = snapshot.predicate;
    values = snapshot.values;
  } else if (body.generated === true && !prior?.generated)
    throw new PracticeInputError(
      'Choose the source gameplan to generate this practice.',
    );
  const fields = details(content);
  return {
    ...fields,
    predicate,
    values,
    duration: fields.savedBlocks.reduce(
      (total, block) => total + Number.parseInt(block[1], 10),
      0,
    ),
    data: {
      blocks: fields.savedBlocks,
      generated: Boolean(content.generated),
      gameplanSource: source,
      ...(prior?.creationDigest
        ? { creationDigest: prior.creationDigest }
        : {}),
    },
  };
}
export async function POST(request: Request) {
  try {
    const db = await getDatabase(),
      body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new PracticeInputError('Enter valid practice details.');
    validatePracticeEnvelope(body);
    const id = body.id === undefined ? crypto.randomUUID() : text(body.id);
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      )
    )
      throw new PracticeInputError(
        'Start a new practice or reload its saved record.',
      );
    const fingerprint = await creationDigest(body);
    const previous = await db
      .prepare(`${planSelect} WHERE id=? AND team_id=?`)
      .bind(id, db.teamId)
      .first<PlanRow>();
    if (previous) {
      if (
        (JSON.parse(previous.plan_json) as { creationDigest?: string })
          .creationDigest !== fingerprint
      )
        throw new WorkspaceAccessError(
          'This practice creation already contains different work. Reload the saved list before trying again.',
          409,
        );
      return Response.json({
        ...(await payload(db)),
        savedPlanId: id,
        replayed: true,
      });
    }
    const prepared = await preparePractice(db, body);
    const created = await db
      .prepare(
        `INSERT INTO practice_plans (id, team_id, game_id, title, practice_date, duration_minutes, plan_json) SELECT ?,?,NULL,?,?,?,? WHERE ${prepared.predicate} ON CONFLICT(id) DO NOTHING RETURNING id`,
      )
      .bind(
        id,
        db.teamId,
        prepared.title,
        prepared.date,
        prepared.duration,
        JSON.stringify({ ...prepared.data, creationDigest: fingerprint }),
        ...prepared.values,
      )
      .first();
    if (!created) {
      const winner = await db
        .prepare(`${planSelect} WHERE id=? AND team_id=?`)
        .bind(id, db.teamId)
        .first<PlanRow>();
      if (
        winner &&
        (JSON.parse(winner.plan_json) as { creationDigest?: string })
          .creationDigest === fingerprint
      )
        return Response.json({
          ...(await payload(db)),
          savedPlanId: id,
          replayed: true,
        });
      throw new WorkspaceAccessError(
        'The source gameplan or practice creation changed while saving. Reload before retrying.',
        409,
      );
    }
    return Response.json(
      { ...(await payload(db)), savedPlanId: id },
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: Request) {
  try {
    const db = await getDatabase(),
      body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new PracticeInputError('Enter valid practice details.');
    const id = text(body.id);
    if (!id) throw new PracticeInputError('Choose a practice plan to update.');
    const existing = await db
      .prepare(`${planSelect} WHERE id=? AND team_id=?`)
      .bind(id, db.teamId)
      .first<PlanRow>();
    if (!existing)
      throw new WorkspaceAccessError('Practice plan not found.', 404);
    validatePracticeEnvelope(body);
    if (typeof body.version !== 'string' || !body.version)
      throw new PracticeInputError(
        'Reload the practice plan before saving changes.',
      );
    if (body.version !== (await version(existing)))
      throw new WorkspaceAccessError(
        'This practice plan changed on another device. Your changes have not been saved. Reload before retrying.',
        409,
      );
    const prepared = await preparePractice(db, body, existing);
    const updated = await db
      .prepare(
        `UPDATE practice_plans SET title=?, practice_date=?, duration_minutes=?, plan_json=? WHERE id=? AND team_id=? AND title=? AND practice_date=? AND plan_json=? AND (${prepared.predicate}) RETURNING id`,
      )
      .bind(
        prepared.title,
        prepared.date,
        prepared.duration,
        JSON.stringify(prepared.data),
        id,
        db.teamId,
        existing.title,
        existing.practice_date,
        existing.plan_json,
        ...prepared.values,
      )
      .first();
    if (!updated)
      throw new WorkspaceAccessError(
        'The practice plan or source gameplan changed while saving. Your draft is retained. Reload before retrying.',
        409,
      );
    return Response.json({ ...(await payload(db)), savedPlanId: id });
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
