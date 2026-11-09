import { getCoachingDatabase as getDatabase, type TeamDatabase } from '@/db/client';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
class InstallInputError extends Error {}
async function version(row: PackageRow) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([row.name, row.unit, row.due_at, row.published_at]),
    ),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

type PackageRow = {
  id: string;
  name: string;
  unit: string;
  due_at: string;
  published_at: string | null;
};
type ItemRow = {
  id: string;
  play_id: string | null;
  title: string;
  unit: string | null;
  total: number;
  complete: number;
};
type ReviewRow = {
  id: string;
  install_item_id: string;
  athlete_id: string;
  first_name: string;
  last_name: string;
  position: string;
  reviewed_at: string | null;
  assignment_acknowledged_at: string | null;
  note_acknowledged_at: string | null;
};
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

function packageFields(body: Record<string, unknown>) {
  const name = text(body.name),
    unit = text(body.unit) || 'Team',
    dueAt = text(body.dueAt);
  if (!name || name.length > 100)
    throw new InstallInputError('Enter an install name of 1–100 characters.');
  if (!['Team', 'Offence', 'Defence', 'Special teams'].includes(unit))
    throw new InstallInputError('Choose a valid unit.');
  if (
    dueAt &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt) ||
      Number.isNaN(Date.parse(`${dueAt}T12:00:00Z`)) ||
      new Date(`${dueAt}T12:00:00Z`).toISOString().slice(0, 10) !== dueAt)
  )
    throw new InstallInputError('Choose a valid due date or leave it blank.');
  return { name, unit, dueAt };
}

async function getPackage(database: TeamDatabase, id: string) {
  const row = await database
    .prepare(
      'SELECT id, name, unit, due_at, published_at FROM install_packages WHERE id = ? AND team_id = ?',
    )
    .bind(id, database.teamId)
    .first<PackageRow>();
  if (!row)
    throw new InstallInputError(
      'Install not found. Refresh and choose an existing install.',
    );
  return row;
}

async function payload(database: TeamDatabase, requestedId = '') {
  const result = await database
    .prepare(
      'SELECT id, name, unit, due_at, published_at FROM install_packages WHERE team_id = ? ORDER BY rowid DESC',
    )
    .bind(database.teamId)
    .all<PackageRow>();
  const selected = requestedId
    ? result.results.find((row) => row.id === requestedId)
    : result.results[0];
  if (requestedId && !selected)
    throw new InstallInputError('Install not found.');
  const packageId = selected?.id ?? '';
  const [items, reviews] = await Promise.all([
    database
      .prepare(`SELECT i.id, i.play_id, COALESCE(p.name, i.title) AS title, i.position_group AS unit,
      COUNT(r.id) AS total, SUM(CASE WHEN r.reviewed_at IS NOT NULL AND r.assignment_acknowledged_at IS NOT NULL AND r.note_acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) AS complete
      FROM install_items i LEFT JOIN plays p ON p.id = i.play_id LEFT JOIN athlete_reviews r ON r.install_item_id = i.id
      WHERE i.package_id = ? GROUP BY i.id ORDER BY i.sort_order, i.id`)
      .bind(packageId)
      .all<ItemRow>(),
    database
      .prepare(`SELECT r.id, r.install_item_id, r.athlete_id, a.first_name, a.last_name, a.position, r.reviewed_at, r.assignment_acknowledged_at, r.note_acknowledged_at
      FROM athlete_reviews r JOIN athletes a ON a.id = r.athlete_id JOIN install_items i ON i.id = r.install_item_id
      WHERE i.package_id = ? AND a.team_id = ? ORDER BY a.last_name, a.first_name`)
      .bind(packageId, database.teamId)
      .all<ReviewRow>(),
  ]);
  const pack = async (row: PackageRow) => ({
    version: await version(row),
    id: row.id,
    name: row.name,
    unit: row.unit,
    dueAt: row.due_at,
    publishedAt: row.published_at,
  });
  return {
    packages: await Promise.all(result.results.map(pack)),
    package: selected ? await pack(selected) : null,
    items: items.results.map((item) => ({
      id: item.id,
      playId: item.play_id,
      title: item.title,
      type: 'Play',
      group: item.unit ?? 'Team',
      due: selected?.due_at || 'No due date',
      reviewCount: item.total,
      complete: item.total ? Math.round((item.complete / item.total) * 100) : 0,
    })),
    reviews: reviews.results.map((review) => ({
      id: review.id,
      itemId: review.install_item_id,
      athleteId: review.athlete_id,
      name: `${review.first_name} ${review.last_name}`,
      position: review.position,
      initials: `${review.first_name[0] ?? ''}${review.last_name[0] ?? ''}`,
      reviewed: Boolean(review.reviewed_at),
      assignment: Boolean(review.assignment_acknowledged_at),
      note: Boolean(review.note_acknowledged_at),
      acknowledged: Boolean(
        review.reviewed_at &&
        review.assignment_acknowledged_at &&
        review.note_acknowledged_at,
      ),
    })),
  };
}

const failure = (error: unknown) =>
  Response.json(
    {
      error:
        error instanceof WorkspaceAccessError ||
        error instanceof InstallInputError
          ? error.message
          : 'Unable to access installs. Please retry.',
    },
    {
      status:
        error instanceof WorkspaceAccessError
          ? error.status
          : error instanceof InstallInputError
            ? 400
            : 500,
    },
  );

export async function GET(request: Request) {
  try {
    return Response.json(
      await payload(
        await getDatabase(),
        new URL(request.url).searchParams.get('packageId') ?? '',
      ),
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = await getDatabase();
    if (body.kind === 'package') {
      const fields = packageFields(body),
        id = crypto.randomUUID();
      await database
        .prepare(
          'INSERT INTO install_packages (id, team_id, game_id, name, unit, due_at, published_at) VALUES (?, ?, NULL, ?, ?, ?, NULL)',
        )
        .bind(id, database.teamId, fields.name, fields.unit, fields.dueAt)
        .run();
      return Response.json(await payload(database, id), { status: 201 });
    }
    const packageId = text(body.packageId);
    if (!packageId)
      throw new InstallInputError('Choose an install before adding a play.');
    const install = await getPackage(database, packageId);
    if (install.published_at)
      throw new InstallInputError(
        'Published installs are locked. Create another install for new teaching material.',
      );
    const playIds = Array.from(
      new Set(
        Array.isArray(body.playIds)
          ? body.playIds.map(text)
          : [text(body.playId)],
      ),
    );
    if (!playIds.length || playIds.length > 200 || playIds.some((id) => !id))
      throw new InstallInputError('Choose 1–200 saved plays.');
    const selectedPlays = await Promise.all(
      playIds.map((id) =>
        database
          .prepare(
            'SELECT id, name, unit FROM plays WHERE id = ? AND team_id = ?',
          )
          .bind(id, database.teamId)
          .first<{ id: string; name: string; unit: string }>(),
      ),
    );
    if (selectedPlays.some((play) => !play))
      throw new InstallInputError(
        'One or more saved plays could not be found.',
      );
    if (
      selectedPlays.some(
        (play) => install.unit !== 'Team' && install.unit !== play!.unit,
      )
    )
      throw new InstallInputError(
        `This install is for ${install.unit}. Choose matching plays or a Team install.`,
      );
    await database.batch(
      selectedPlays.map((play) =>
        database
          .prepare(`INSERT INTO install_items (id, package_id, play_id, title, item_type, position_group, sort_order)
      SELECT ?, ?, ?, ?, 'Play', ?, COALESCE(MAX(sort_order), -1) + 1 FROM install_items WHERE package_id = ?
      HAVING NOT EXISTS (SELECT 1 FROM install_items WHERE package_id = ? AND play_id = ?) AND EXISTS (SELECT 1 FROM install_packages p WHERE p.id = ? AND p.team_id = ? AND p.published_at IS NULL AND (p.unit = 'Team' OR p.unit = ?))`)
          .bind(
            crypto.randomUUID(),
            packageId,
            play!.id,
            play!.name,
            play!.unit,
            packageId,
            packageId,
            play!.id,
            packageId,
            database.teamId,
            play!.unit,
          ),
      ),
    );
    const saved = await payload(database, packageId);
    if (playIds.some((id) => !saved.items.some((item) => item.playId === id)))
      return Response.json(
        {
          error:
            'This install changed before the plays could be added. Reload and retry.',
        },
        { status: 409 },
      );
    return Response.json(saved, { status: 200 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = await getDatabase(),
      packageId = text(body.packageId);
    const install = await getPackage(database, packageId);
    if (body.kind === 'publish') {
      if (install.published_at)
        return Response.json(await payload(database, packageId));
      const items = await database
        .prepare(
          'SELECT id, position_group FROM install_items WHERE package_id = ?',
        )
        .bind(packageId)
        .all<{ id: string; position_group: string }>();
      if (!items.results.length)
        throw new InstallInputError('Add at least one play before publishing.');
      const athletes = await database
        .prepare('SELECT id, unit FROM athletes WHERE team_id = ?')
        .bind(database.teamId)
        .all<{ id: string; unit: string }>();
      const recipients = items.results.flatMap((item) =>
        athletes.results
          .filter(
            (athlete) =>
              item.position_group === 'Team' ||
              item.position_group === athlete.unit,
          )
          .map((athlete) => ({ item, athlete })),
      );
      if (
        items.results.some(
          (item) => !recipients.some((entry) => entry.item.id === item.id),
        )
      )
        throw new InstallInputError(
          'Every play needs at least one matching roster athlete before publishing.',
        );
      const eligible = `p.published_at IS NULL AND EXISTS (SELECT 1 FROM install_items i WHERE i.package_id = p.id) AND NOT EXISTS (SELECT 1 FROM install_items i LEFT JOIN plays q ON q.id = i.play_id AND q.team_id = p.team_id WHERE i.package_id = p.id AND (q.id IS NULL OR q.unit != i.position_group OR (p.unit != 'Team' AND p.unit != q.unit))) AND NOT EXISTS (SELECT 1 FROM install_items i WHERE i.package_id = p.id AND NOT EXISTS (SELECT 1 FROM athletes a WHERE a.team_id = p.team_id AND (i.position_group = 'Team' OR i.position_group = a.unit)))`;
      await database.batch([
        database
          .prepare(`INSERT OR IGNORE INTO athlete_reviews (id, install_item_id, athlete_id, reviewed_at, assignment_acknowledged_at, note_acknowledged_at)
          SELECT lower(hex(randomblob(16))), i.id, a.id, NULL, NULL, NULL FROM install_packages p JOIN install_items i ON i.package_id = p.id JOIN athletes a ON a.team_id = p.team_id AND (i.position_group = 'Team' OR i.position_group = a.unit)
          WHERE p.id = ? AND p.team_id = ? AND ${eligible}`)
          .bind(packageId, database.teamId),
        database
          .prepare(
            `UPDATE install_packages AS p SET published_at = ? WHERE p.id = ? AND p.team_id = ? AND ${eligible}`,
          )
          .bind(new Date().toISOString(), packageId, database.teamId),
      ]);
      const saved = await payload(database, packageId);
      if (!saved.package?.publishedAt)
        return Response.json(
          {
            error:
              'This install or its roster changed before publication. Reload and check its recipients.',
          },
          { status: 409 },
        );
      return Response.json(saved);
    } else if (body.kind === 'package') {
      if (install.published_at)
        return Response.json(
          {
            error:
              'This install was published on another device and its details are locked. Reload to see the published version.',
          },
          { status: 409 },
        );
      const fields = packageFields(body);
      if (typeof body.version !== 'string')
        throw new InstallInputError(
          'Reload the install before editing its details.',
        );
      if (body.version !== (await version(install)))
        return Response.json(
          {
            error:
              'Install details changed on another device. Your draft was not saved. Reload the latest install before retrying.',
          },
          { status: 409 },
        );
      const incompatible = await database
        .prepare(
          'SELECT id FROM install_items WHERE package_id = ? AND position_group != ? LIMIT 1',
        )
        .bind(packageId, fields.unit)
        .first();
      if (fields.unit !== 'Team' && incompatible)
        throw new InstallInputError(
          'Remove plays from other units before changing the install unit.',
        );
      const updated = await database
        .prepare(
          "UPDATE install_packages SET name = ?, unit = ?, due_at = ? WHERE id = ? AND team_id = ? AND published_at IS NULL AND name = ? AND unit = ? AND due_at = ? AND (? = 'Team' OR NOT EXISTS (SELECT 1 FROM install_items i WHERE i.package_id = install_packages.id AND i.position_group != ?)) RETURNING id",
        )
        .bind(
          fields.name,
          fields.unit,
          fields.dueAt,
          packageId,
          database.teamId,
          install.name,
          install.unit,
          install.due_at,
          fields.unit,
          fields.unit,
        )
        .first();
      if (!updated)
        return Response.json(
          {
            error: 'This install changed while saving. Reload before retrying.',
          },
          { status: 409 },
        );
    } else {
      return Response.json(
        {
          error:
            'Player acknowledgements require a linked, authenticated athlete account. Coach previews are read-only.',
        },
        { status: 403 },
      );
    }
    return Response.json(await payload(database, packageId));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = await getDatabase(),
      packageId = text(body.packageId);
    const install = await getPackage(database, packageId);
    if (install.published_at)
      throw new InstallInputError(
        'Published installs cannot be deleted or have plays removed.',
      );
    if (body.kind === 'item') {
      const removed = await database
        .prepare(
          'DELETE FROM install_items WHERE id = ? AND package_id = ? AND EXISTS (SELECT 1 FROM install_packages p WHERE p.id = install_items.package_id AND p.published_at IS NULL) RETURNING id',
        )
        .bind(text(body.itemId), packageId)
        .first();
      if (!removed)
        return Response.json(
          {
            error:
              'The play was removed or the install was published on another device. Reload before retrying.',
          },
          { status: 409 },
        );
      return Response.json(await payload(database, packageId));
    }
    if (body.kind !== 'package')
      throw new InstallInputError('Choose an install or play to remove.');
    const removed = await database
      .prepare(
        'DELETE FROM install_packages WHERE id = ? AND team_id = ? AND published_at IS NULL RETURNING id',
      )
      .bind(packageId, database.teamId)
      .first();
    if (!removed)
      return Response.json(
        {
          error:
            'This install was removed or published on another device. Reload before retrying.',
        },
        { status: 409 },
      );
    return Response.json(await payload(database));
  } catch (error) {
    return failure(error);
  }
}
