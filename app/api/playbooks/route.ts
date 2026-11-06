import { getDatabase, TEAM_ID } from '@/db/client';

type PlayRow = {
  id: string;
  playbook_id: string | null;
  formation_id: string | null;
  formation: string | null;
  name: string;
  unit: string;
  category: string;
  family: string;
  concept: string;
  diagram_json: string;
  notes: string;
  updated_at: string;
};

type AssignmentRow = {
  id: string;
  play_id: string;
  position: string;
  title: string;
  detail: string;
  sort_order: number;
};

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function parseDiagram(value: string) {
  try {
    const diagram = JSON.parse(value) as Record<string, unknown>;
    return {
      routes: Array.isArray(diagram.routes) ? diagram.routes : [],
      players: Array.isArray(diagram.players) ? diagram.players : [],
      zones: Array.isArray(diagram.zones) ? diagram.zones : [],
      labels: Array.isArray(diagram.labels) ? diagram.labels : [],
      fieldPosition: typeof diagram.fieldPosition === 'number' ? diagram.fieldPosition : 55,
      showOpponent: Boolean(diagram.showOpponent),
    };
  } catch {
    return { routes: [], players: [], zones: [], labels: [], fieldPosition: 55, showOpponent: false };
  }
}

function validSide(value: unknown) {
  return value === 'Offence' || value === 'Defence' || value === 'Special teams' || value === 'Scout';
}

function validFamily(value: unknown) {
  return value === 'Unassigned' || value === 'Run' || value === 'Pass' || value === 'RPO' || value === 'Screen';
}

async function payload(database: D1Database) {
  const [bookResult, formationResult, playResult, assignmentResult] = await Promise.all([
    database.prepare(
      `SELECT b.id, b.name, b.side, b.archived, b.updated_at,
        COUNT(p.id) AS play_count, COUNT(DISTINCT p.formation_id) AS formation_count
       FROM playbooks b LEFT JOIN plays p ON p.playbook_id = b.id
       WHERE b.team_id = ? GROUP BY b.id ORDER BY b.archived, b.created_at`,
    ).bind(TEAM_ID).all<Record<string, string | number>>(),
    database.prepare(
      `SELECT f.id, f.name, f.unit, f.personnel, f.layout_json, COUNT(p.id) AS play_count
       FROM formations f LEFT JOIN plays p ON p.formation_id = f.id
       WHERE f.team_id = ? GROUP BY f.id ORDER BY f.created_at`,
    ).bind(TEAM_ID).all<Record<string, string | number>>(),
    database.prepare(
      `SELECT p.id, p.playbook_id, p.formation_id, f.name AS formation, p.name, p.unit,
        p.category, p.family, p.concept, p.diagram_json, p.notes, p.updated_at
       FROM plays p LEFT JOIN formations f ON f.id = p.formation_id
       WHERE p.team_id = ? ORDER BY p.created_at`,
    ).bind(TEAM_ID).all<PlayRow>(),
    database.prepare(
      `SELECT a.id, a.play_id, a.position, a.title, a.detail, a.sort_order
       FROM play_assignments a JOIN plays p ON p.id = a.play_id
       WHERE p.team_id = ? ORDER BY a.play_id, a.sort_order`,
    ).bind(TEAM_ID).all<AssignmentRow>(),
  ]);

  const assignments = assignmentResult.results.reduce<Record<string, AssignmentRow[]>>((groups, row) => {
    (groups[row.play_id] ??= []).push(row);
    return groups;
  }, {});
  return {
    books: bookResult.results.map((row) => ({
      id: String(row.id), name: String(row.name), side: String(row.side), archived: Boolean(row.archived),
      plays: Number(row.play_count), formations: Number(row.formation_count), updated: String(row.updated_at),
    })),
    formations: formationResult.results.map((row) => ({
      id: String(row.id), name: String(row.name), unit: String(row.unit), personnel: String(row.personnel), count: Number(row.play_count),
      players: parseDiagram(String(row.layout_json)).players,
    })),
    plays: playResult.results.map((row, variant) => {
      const diagram = parseDiagram(row.diagram_json);
      return {
        id: row.id, playbookId: row.playbook_id ?? 'offence', formationId: row.formation_id,
        name: row.name, formation: row.formation ?? 'Unassigned', unit: row.unit,
        category: row.category, family: row.family, concept: row.concept, variant,
        routes: diagram.routes, players: diagram.players, zones: diagram.zones, labels: diagram.labels,
        fieldPosition: diagram.fieldPosition, showOpponent: diagram.showOpponent,
        notes: row.notes,
        assignments: (assignments[row.id] ?? []).map((item) => ({
          id: item.id, position: item.position, title: item.title, detail: item.detail, sortOrder: item.sort_order,
        })),
      };
    }),
  };
}

export async function GET() {
  try {
    const database = await getDatabase();
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load playbooks.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const database = await getDatabase();
    const now = new Date().toISOString();
    if (body.kind === 'book') {
      const name = text(body.name);
      if (!name) throw new Error('Playbook name is required.');
      if (!validSide(body.side)) throw new Error('Choose a valid playbook system.');
      const id = crypto.randomUUID();
      await database.prepare(
        `INSERT INTO playbooks (id, team_id, name, side, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).bind(id, TEAM_ID, name, body.side, now, now).run();
      return Response.json(await payload(database), { status: 201 });
    }
    if (body.kind === 'play') {
      const name = text(body.name, 'Untitled play');
      const playbookId = text(body.playbookId, 'offence');
      const formationId = text(body.formationId) || null;
      const category = text(body.category, 'Uncategorized');
      const family = validFamily(body.family) ? body.family : 'Unassigned';
      const concept = text(body.concept, 'New concept');
      const id = crypto.randomUUID();
      const book = await database.prepare('SELECT id, side FROM playbooks WHERE id = ? AND team_id = ?').bind(playbookId, TEAM_ID).first<{ id: string; side: string }>();
      if (!book) throw new Error('Playbook not found.');
      await database.prepare(
        `INSERT INTO plays (id, team_id, playbook_id, formation_id, name, unit, category, family, concept, diagram_json, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      ).bind(id, TEAM_ID, playbookId, formationId, name, book.side, category, family, concept, JSON.stringify({ routes: [], players: [], zones: [], labels: [], fieldPosition: 55, showOpponent: false }), now, now).run();
      return Response.json({ ...(await payload(database)), createdId: id }, { status: 201 });
    }
    if (body.kind === 'formation') {
      const name = text(body.name);
      const unit = text(body.unit, 'Offence');
      const personnel = text(body.personnel, 'Custom personnel');
      if (!name) throw new Error('Formation name is required.');
      const id = crypto.randomUUID();
      await database.prepare(
        `INSERT INTO formations (id, team_id, name, unit, personnel, layout_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, TEAM_ID, name, unit, personnel, JSON.stringify({ field: 'canadian', players: Array.isArray(body.players) ? body.players : [] }), now).run();
      return Response.json({ ...(await payload(database)), createdId: id }, { status: 201 });
    }
    throw new Error('Choose whether to create a playbook, formation, or play.');
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to create record.' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const database = await getDatabase();
    if (body.kind === 'formation') {
      const id = text(body.id);
      const name = text(body.name);
      if (!id || !name) throw new Error('Formation id and name are required.');
      await database.prepare(
        `UPDATE formations SET name = ?, personnel = ?, layout_json = ? WHERE id = ? AND team_id = ?`,
      ).bind(name, text(body.personnel, 'Custom personnel'), JSON.stringify({ field: 'canadian', players: Array.isArray(body.players) ? body.players : [] }), id, TEAM_ID).run();
      return Response.json(await payload(database));
    }
    if (body.kind === 'book') {
      const id = text(body.id);
      const name = text(body.name);
      if (!id || !name || !validSide(body.side)) throw new Error('Valid playbook details are required.');
      await database.prepare('UPDATE playbooks SET name = ?, side = ?, archived = ?, updated_at = ? WHERE id = ? AND team_id = ?')
        .bind(name, body.side, body.archived ? 1 : 0, new Date().toISOString(), id, TEAM_ID).run();
      return Response.json(await payload(database));
    }
    const id = text(body.id);
    if (!id) throw new Error('Play id is required.');
    const name = text(body.name);
    const formationId = text(body.formationId) || null;
    const category = text(body.category, 'Uncategorized');
    const family = validFamily(body.family) ? body.family : 'Unassigned';
    const concept = text(body.concept);
    if (!name || !concept) throw new Error('Play name and concept are required.');
    const diagram = {
      routes: Array.isArray(body.routes) ? body.routes : [],
      players: Array.isArray(body.players) ? body.players : [],
      zones: Array.isArray(body.zones) ? body.zones : [],
      labels: Array.isArray(body.labels) ? body.labels : [],
      fieldPosition: typeof body.fieldPosition === 'number' ? Math.min(110, Math.max(0, body.fieldPosition)) : 55,
      showOpponent: Boolean(body.showOpponent),
    };
    const assignmentInput = Array.isArray(body.assignments) ? body.assignments as Record<string, unknown>[] : [];
    const existing = await database.prepare('SELECT id FROM plays WHERE id = ? AND team_id = ?').bind(id, TEAM_ID).first();
    if (!existing) return Response.json({ error: 'Play not found.' }, { status: 404 });
    await database.prepare(
      `UPDATE plays SET formation_id = ?, name = ?, category = ?, family = ?, concept = ?, diagram_json = ?, notes = ?, updated_at = ?
       WHERE id = ? AND team_id = ?`,
    ).bind(formationId, name, category, family, concept, JSON.stringify(diagram), text(body.notes), new Date().toISOString(), id, TEAM_ID).run();
    await database.prepare('DELETE FROM play_assignments WHERE play_id = ?').bind(id).run();
    const assignments = assignmentInput.map((item, index) => ({
      id: text(item.id) || crypto.randomUUID(), position: text(item.position, `P${index + 1}`).toUpperCase(),
      title: text(item.title, 'New assignment'), detail: text(item.detail), sortOrder: index,
    }));
    if (assignments.length) {
      await database.batch(assignments.map((assignment) => database.prepare(
        `INSERT INTO play_assignments (id, play_id, position, title, detail, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(assignment.id, id, assignment.position, assignment.title, assignment.detail, assignment.sortOrder)));
    }
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to save play.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.id);
    const kind = text(body.kind);
    if (!id || !['play', 'formation', 'book'].includes(kind)) throw new Error('A valid record is required.');
    const database = await getDatabase();
    if (kind === 'formation') {
      const used = await database.prepare('SELECT COUNT(*) AS count FROM plays WHERE formation_id = ?').bind(id).first<{ count: number }>();
      if ((used?.count ?? 0) > 0) return Response.json({ error: 'Move or delete this formation’s plays first.' }, { status: 409 });
      await database.prepare('DELETE FROM formations WHERE id = ? AND team_id = ?').bind(id, TEAM_ID).run();
    } else if (kind === 'play') {
      await database.prepare('DELETE FROM plays WHERE id = ? AND team_id = ?').bind(id, TEAM_ID).run();
    } else {
      const used = await database.prepare('SELECT COUNT(*) AS count FROM plays WHERE playbook_id = ?').bind(id).first<{ count: number }>();
      if ((used?.count ?? 0) > 0) return Response.json({ error: 'Delete or move this playbook’s plays first.' }, { status: 409 });
      await database.prepare('DELETE FROM playbooks WHERE id = ? AND team_id = ?').bind(id, TEAM_ID).run();
    }
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete record.' }, { status: 400 });
  }
}
