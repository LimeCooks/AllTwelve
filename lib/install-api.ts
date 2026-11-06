import { getDatabase, type TeamDatabase } from '@/db/client';

type PackageRow = { id: string; name: string; unit: string; due_at: string; published_at: string | null };
type ItemRow = { id: string; play_id: string | null; title: string; unit: string | null; total: number; complete: number };
type ReviewRow = { id: string; install_item_id: string; athlete_id: string; first_name: string; last_name: string; position: string; reviewed_at: string | null; assignment_acknowledged_at: string | null; note_acknowledged_at: string | null };
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function packageFields(body: Record<string, unknown>) {
  const name = text(body.name), unit = text(body.unit) || 'Team', dueAt = text(body.dueAt);
  if (!name || name.length > 100) throw new Error('Enter an install name of 1–100 characters.');
  if (!['Team', 'Offence', 'Defence', 'Special teams'].includes(unit)) throw new Error('Choose a valid unit.');
  if (dueAt && (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt) || Number.isNaN(Date.parse(`${dueAt}T12:00:00Z`)) || new Date(`${dueAt}T12:00:00Z`).toISOString().slice(0, 10) !== dueAt)) throw new Error('Choose a valid due date or leave it blank.');
  return { name, unit, dueAt };
}

async function getPackage(database: TeamDatabase, id: string) {
  const row = await database.prepare('SELECT id, name, unit, due_at, published_at FROM install_packages WHERE id = ? AND team_id = ?').bind(id, database.teamId).first<PackageRow>();
  if (!row) throw new Error('Install not found. Refresh and choose an existing install.');
  return row;
}

async function payload(database: TeamDatabase, requestedId = '') {
  const result = await database.prepare('SELECT id, name, unit, due_at, published_at FROM install_packages WHERE team_id = ? ORDER BY rowid DESC').bind(database.teamId).all<PackageRow>();
  const selected = requestedId ? result.results.find((row) => row.id === requestedId) : result.results[0];
  if (requestedId && !selected) throw new Error('Install not found.');
  const packageId = selected?.id ?? '';
  const [items, reviews] = await Promise.all([
    database.prepare(`SELECT i.id, i.play_id, COALESCE(p.name, i.title) AS title, i.position_group AS unit,
      COUNT(r.id) AS total, SUM(CASE WHEN r.reviewed_at IS NOT NULL AND r.assignment_acknowledged_at IS NOT NULL AND r.note_acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) AS complete
      FROM install_items i LEFT JOIN plays p ON p.id = i.play_id LEFT JOIN athlete_reviews r ON r.install_item_id = i.id
      WHERE i.package_id = ? GROUP BY i.id ORDER BY i.sort_order, i.id`).bind(packageId).all<ItemRow>(),
    database.prepare(`SELECT r.id, r.install_item_id, r.athlete_id, a.first_name, a.last_name, a.position, r.reviewed_at, r.assignment_acknowledged_at, r.note_acknowledged_at
      FROM athlete_reviews r JOIN athletes a ON a.id = r.athlete_id JOIN install_items i ON i.id = r.install_item_id
      WHERE i.package_id = ? AND a.team_id = ? ORDER BY a.last_name, a.first_name`).bind(packageId, database.teamId).all<ReviewRow>(),
  ]);
  const pack = (row: PackageRow) => ({ id: row.id, name: row.name, unit: row.unit, dueAt: row.due_at, publishedAt: row.published_at });
  return {
    packages: result.results.map(pack), package: selected ? pack(selected) : null,
    items: items.results.map((item) => ({ id: item.id, playId: item.play_id, title: item.title, type: 'Play', group: item.unit ?? 'Team', due: selected?.due_at || 'No due date', reviewCount: item.total, complete: item.total ? Math.round(item.complete / item.total * 100) : 0 })),
    reviews: reviews.results.map((review) => ({ id: review.id, itemId: review.install_item_id, athleteId: review.athlete_id, name: `${review.first_name} ${review.last_name}`, position: review.position, initials: `${review.first_name[0] ?? ''}${review.last_name[0] ?? ''}`, reviewed: Boolean(review.reviewed_at), assignment: Boolean(review.assignment_acknowledged_at), note: Boolean(review.note_acknowledged_at), acknowledged: Boolean(review.reviewed_at && review.assignment_acknowledged_at && review.note_acknowledged_at) })),
  };
}

const failure = (error: unknown) => Response.json({ error: error instanceof Error ? error.message : 'Unable to save install.' }, { status: 400 });

export async function GET(request: Request) {
  try { return Response.json(await payload(await getDatabase(), new URL(request.url).searchParams.get('packageId') ?? '')); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const database = await getDatabase();
    if (body.kind === 'package') {
      const fields = packageFields(body), id = crypto.randomUUID();
      await database.prepare('INSERT INTO install_packages (id, team_id, game_id, name, unit, due_at, published_at) VALUES (?, ?, NULL, ?, ?, ?, NULL)').bind(id, database.teamId, fields.name, fields.unit, fields.dueAt).run();
      return Response.json(await payload(database, id), { status: 201 });
    }
    const packageId = text(body.packageId);
    if (!packageId) throw new Error('Choose an install before adding a play.');
    const install = await getPackage(database, packageId);
    if (install.published_at) throw new Error('Published installs are locked. Create another install for new teaching material.');
    const playIds = Array.from(new Set(Array.isArray(body.playIds) ? body.playIds.map(text) : [text(body.playId)]));
    if (!playIds.length || playIds.length > 200 || playIds.some((id) => !id)) throw new Error('Choose 1–200 saved plays.');
    const selectedPlays = await Promise.all(playIds.map((id) => database.prepare('SELECT id, name, unit FROM plays WHERE id = ? AND team_id = ?').bind(id, database.teamId).first<{ id: string; name: string; unit: string }>()));
    if (selectedPlays.some((play) => !play)) throw new Error('One or more saved plays could not be found.');
    if (selectedPlays.some((play) => install.unit !== 'Team' && install.unit !== play!.unit)) throw new Error(`This install is for ${install.unit}. Choose matching plays or a Team install.`);
    await database.batch(selectedPlays.map((play) => database.prepare(`INSERT INTO install_items (id, package_id, play_id, title, item_type, position_group, sort_order)
      SELECT ?, ?, ?, ?, 'Play', ?, COALESCE(MAX(sort_order), -1) + 1 FROM install_items WHERE package_id = ?
      HAVING NOT EXISTS (SELECT 1 FROM install_items WHERE package_id = ? AND play_id = ?)`).bind(crypto.randomUUID(), packageId, play!.id, play!.name, play!.unit, packageId, packageId, play!.id)));
    return Response.json(await payload(database, packageId), { status: 200 });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const database = await getDatabase(), packageId = text(body.packageId);
    const install = await getPackage(database, packageId);
    if (body.kind === 'publish') {
      if (install.published_at) return Response.json(await payload(database, packageId));
      const items = await database.prepare('SELECT id, position_group FROM install_items WHERE package_id = ?').bind(packageId).all<{ id: string; position_group: string }>();
      if (!items.results.length) throw new Error('Add at least one play before publishing.');
      const athletes = await database.prepare('SELECT id, unit FROM athletes WHERE team_id = ?').bind(database.teamId).all<{ id: string; unit: string }>();
      const recipients = items.results.flatMap((item) => athletes.results.filter((athlete) => item.position_group === 'Team' || item.position_group === athlete.unit).map((athlete) => ({ item, athlete })));
      if (items.results.some((item) => !recipients.some((entry) => entry.item.id === item.id))) throw new Error('Every play needs at least one matching roster athlete before publishing.');
      await database.batch([
        ...recipients.map(({ item, athlete }) => database.prepare('INSERT OR IGNORE INTO athlete_reviews (id, install_item_id, athlete_id, reviewed_at, assignment_acknowledged_at, note_acknowledged_at) VALUES (?, ?, ?, NULL, NULL, NULL)').bind(crypto.randomUUID(), item.id, athlete.id)),
        database.prepare('UPDATE install_packages SET published_at = ? WHERE id = ? AND team_id = ?').bind(new Date().toISOString(), packageId, database.teamId),
      ]);
    } else if (body.kind === 'package') {
      if (install.published_at) throw new Error('Published installs cannot be edited.');
      const fields = packageFields(body);
      const incompatible = await database.prepare('SELECT id FROM install_items WHERE package_id = ? AND position_group != ? LIMIT 1').bind(packageId, fields.unit).first();
      if (fields.unit !== 'Team' && incompatible) throw new Error('Remove plays from other units before changing the install unit.');
      await database.prepare('UPDATE install_packages SET name = ?, unit = ?, due_at = ? WHERE id = ? AND team_id = ?').bind(fields.name, fields.unit, fields.dueAt, packageId, database.teamId).run();
    } else {
      return Response.json({ error: 'Player acknowledgements require a linked, authenticated athlete account. Coach previews are read-only.' }, { status: 403 });
    }
    return Response.json(await payload(database, packageId));
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const database = await getDatabase(), packageId = text(body.packageId);
    const install = await getPackage(database, packageId);
    if (install.published_at) throw new Error('Published installs cannot be deleted or have plays removed.');
    if (body.kind === 'item') {
      await database.prepare('DELETE FROM install_items WHERE id = ? AND package_id = ?').bind(text(body.itemId), packageId).run();
      return Response.json(await payload(database, packageId));
    }
    if (body.kind !== 'package') throw new Error('Choose an install or play to remove.');
    await database.prepare('DELETE FROM install_packages WHERE id = ? AND team_id = ?').bind(packageId, database.teamId).run();
    return Response.json(await payload(database));
  } catch (error) { return failure(error); }
}
