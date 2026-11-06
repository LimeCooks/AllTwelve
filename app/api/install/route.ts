import { getDatabase, TEAM_ID } from '@/db/client';

type ItemRow = {
  id: string;
  play_id: string | null;
  title: string;
  item_type: string;
  position_group: string | null;
  sort_order: number;
  total_reviews: number;
  completed_reviews: number;
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

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

async function payload(database: D1Database) {
  const packageRow = await database.prepare(
    `SELECT id, name, unit, due_at, published_at FROM install_packages WHERE id = 'install-week-5' AND team_id = ?`,
  ).bind(TEAM_ID).first<Record<string, string | null>>();
  const [itemResult, reviewResult] = await Promise.all([
    database.prepare(
      `SELECT i.id, i.play_id, i.title, i.item_type, i.position_group, i.sort_order,
        COUNT(r.id) AS total_reviews,
        SUM(CASE WHEN r.reviewed_at IS NOT NULL AND r.assignment_acknowledged_at IS NOT NULL AND r.note_acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_reviews
       FROM install_items i LEFT JOIN athlete_reviews r ON r.install_item_id = i.id
       WHERE i.package_id = 'install-week-5' GROUP BY i.id ORDER BY i.sort_order`,
    ).all<ItemRow>(),
    database.prepare(
      `SELECT r.id, r.install_item_id, r.athlete_id, a.first_name, a.last_name, a.position,
        r.reviewed_at, r.assignment_acknowledged_at, r.note_acknowledged_at
       FROM athlete_reviews r JOIN athletes a ON a.id = r.athlete_id
       JOIN install_items i ON i.id = r.install_item_id
       WHERE i.package_id = 'install-week-5' ORDER BY a.number`,
    ).all<ReviewRow>(),
  ]);
  return {
    package: packageRow ? {
      id: packageRow.id, name: packageRow.name, unit: packageRow.unit,
      dueAt: packageRow.due_at, publishedAt: packageRow.published_at,
    } : null,
    items: itemResult.results.map((item) => ({
      id: item.id, playId: item.play_id, title: item.title, type: item.item_type,
      group: item.position_group ?? 'Team', due: packageRow?.due_at ? new Date(packageRow.due_at).toLocaleDateString('en-CA', { weekday: 'short' }) : 'Not set',
      complete: item.total_reviews ? Math.round(item.completed_reviews / item.total_reviews * 100) : 0,
    })),
    reviews: reviewResult.results.map((review) => ({
      id: review.id, itemId: review.install_item_id, athleteId: review.athlete_id,
      initials: `${review.first_name[0] ?? ''}${review.last_name[0] ?? ''}`.toUpperCase(),
      name: `${review.first_name} ${review.last_name}`, position: review.position,
      reviewed: Boolean(review.reviewed_at), assignment: Boolean(review.assignment_acknowledged_at),
      note: Boolean(review.note_acknowledged_at), acknowledged: Boolean(review.reviewed_at && review.assignment_acknowledged_at && review.note_acknowledged_at),
    })),
  };
}

export async function GET() {
  try {
    const database = await getDatabase();
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load install.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const playId = text(body.playId);
    if (!playId) throw new Error('Choose a play to add.');
    const database = await getDatabase();
    const play = await database.prepare('SELECT id, name, unit FROM plays WHERE id = ? AND team_id = ?').bind(playId, TEAM_ID).first<{ id: string; name: string; unit: string }>();
    if (!play) return Response.json({ error: 'Play not found.' }, { status: 404 });
    const existing = await database.prepare("SELECT id FROM install_items WHERE package_id = 'install-week-5' AND play_id = ?").bind(playId).first<{ id: string }>();
    const itemId = existing?.id ?? crypto.randomUUID();
    if (!existing) {
      const order = await database.prepare("SELECT COUNT(*) AS count FROM install_items WHERE package_id = 'install-week-5'").first<{ count: number }>();
      await database.prepare(
        `INSERT INTO install_items (id, package_id, play_id, title, item_type, position_group, sort_order)
         VALUES (?, 'install-week-5', ?, ?, 'Play', ?, ?)`,
      ).bind(itemId, play.id, play.name, play.unit, order?.count ?? 0).run();
      const athletes = await database.prepare('SELECT id FROM athletes WHERE team_id = ? AND unit = ?').bind(TEAM_ID, play.unit).all<{ id: string }>();
      if (athletes.results.length) {
        await database.batch(athletes.results.map((athlete) => database.prepare(
          `INSERT OR IGNORE INTO athlete_reviews (id, install_item_id, athlete_id, reviewed_at, assignment_acknowledged_at, note_acknowledged_at)
           VALUES (?, ?, ?, NULL, NULL, NULL)`,
        ).bind(crypto.randomUUID(), itemId, athlete.id)));
      }
    }
    return Response.json({ ...(await payload(database)), itemId }, { status: existing ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to add install item.' }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const itemId = text(body.itemId);
    const athleteId = text(body.athleteId);
    const step = text(body.step);
    if (!itemId || !athleteId || !['play', 'assignment', 'note', 'all'].includes(step)) throw new Error('Install item, athlete, and review step are required.');
    const database = await getDatabase();
    const review = await database.prepare(
      `SELECT r.id FROM athlete_reviews r JOIN install_items i ON i.id = r.install_item_id
       WHERE r.install_item_id = ? AND r.athlete_id = ? AND i.package_id = 'install-week-5'`,
    ).bind(itemId, athleteId).first<{ id: string }>();
    if (!review) return Response.json({ error: 'Review record not found.' }, { status: 404 });
    const now = new Date().toISOString();
    const column = step === 'play' ? 'reviewed_at' : step === 'assignment' ? 'assignment_acknowledged_at' : 'note_acknowledged_at';
    if (step === 'all') {
      await database.prepare('UPDATE athlete_reviews SET reviewed_at = ?, assignment_acknowledged_at = ?, note_acknowledged_at = ? WHERE id = ?').bind(now, now, now, review.id).run();
    } else {
      await database.prepare(`UPDATE athlete_reviews SET ${column} = CASE WHEN ${column} IS NULL THEN ? ELSE NULL END WHERE id = ?`).bind(now, review.id).run();
    }
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update review.' }, { status: 400 });
  }
}
