import { prepareCreation, CreationError } from '@/lib/playbook-creation';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import { getDatabase, type TeamDatabase } from '@/db/client';
import { validatePlayDiagram } from '@/lib/validate-play';
import { startingPlayers } from '@/lib/play-designer';

type PlayRow = {
  id: string;
  playbook_id: string | null;
  formation_id: string | null;
  formation: string | null;
  formation_layout_json: string | null;
  name: string;
  unit: string;
  category: string;
  family: string;
  concept: string;
  diagram_json: string;
  notes: string;
  updated_at: string;
  locked: number;
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

function errorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message.includes('UNIQUE constraint failed: formations')
    ? 'That formation and package already exist for this team or opponent. Choose a different name or package.'
    : message;
}

function parseDiagram(value: string) {
  try {
    const diagram = JSON.parse(value) as Record<string, unknown>;
    return {
      routes: Array.isArray(diagram.routes) ? diagram.routes : [],
      players: Array.isArray(diagram.players) ? diagram.players : [],
      zones: Array.isArray(diagram.zones) ? diagram.zones : [],
      labels: Array.isArray(diagram.labels) ? diagram.labels : [],
      fieldPosition:
        typeof diagram.fieldPosition === 'number' ? diagram.fieldPosition : 55,
      showOpponent: Boolean(diagram.showOpponent),
      diagramVersion: diagram.diagramVersion === 2 ? 2 : 1,
      opponentFormationId:
        typeof diagram.opponentFormationId === 'string'
          ? diagram.opponentFormationId
          : null,
      opponentPlayers: Array.isArray(diagram.opponentPlayers)
        ? diagram.opponentPlayers
        : [],
      formationName:
        typeof diagram.formationName === 'string' ? diagram.formationName : '',
      scope: diagram.scope === 'scout' ? 'scout' : 'team',
      opponent: typeof diagram.opponent === 'string' ? diagram.opponent : '',
      packageName:
        typeof diagram.packageName === 'string' ? diagram.packageName : '',
    };
  } catch {
    return {
      routes: [],
      players: [],
      zones: [],
      labels: [],
      fieldPosition: 55,
      showOpponent: false,
      diagramVersion: 1,
      opponentFormationId: null,
      opponentPlayers: [],
      formationName: '',
      scope: 'team',
      opponent: '',
      packageName: '',
    };
  }
}

function validSide(value: unknown) {
  return (
    value === 'Offence' ||
    value === 'Defence' ||
    value === 'Special teams' ||
    value === 'Scout'
  );
}

function validFamily(value: unknown) {
  return (
    typeof value === 'string' &&
    [
      'Unassigned',
      'Run',
      'Pass',
      'RPO',
      'Screen',
      'Coverage',
      'Pressure',
      'Run fit',
      'Kickoff',
      'Kick return',
      'Punt',
      'Punt return',
      'Field goal',
    ].includes(value)
  );
}

async function payload(database: TeamDatabase) {
  const [bookResult, formationResult, playResult, assignmentResult] =
    await Promise.all([
      database
        .prepare(
          `SELECT b.id, b.name, b.side, b.archived, b.updated_at,
        COUNT(p.id) AS play_count, COUNT(DISTINCT p.formation_id) AS formation_count
       FROM playbooks b LEFT JOIN plays p ON p.playbook_id = b.id
       WHERE b.team_id = ? GROUP BY b.id ORDER BY b.archived, b.created_at`,
        )
        .bind(database.teamId)
        .all<Record<string, string | number>>(),
      database
        .prepare(
          `SELECT f.id, f.name, f.unit, f.personnel, f.layout_json, COUNT(p.id) AS play_count
       FROM formations f LEFT JOIN plays p ON p.formation_id = f.id
       WHERE f.team_id = ? GROUP BY f.id ORDER BY f.created_at`,
        )
        .bind(database.teamId)
        .all<Record<string, string | number>>(),
      database
        .prepare(
          `SELECT p.id, p.playbook_id, p.formation_id, f.name AS formation, f.layout_json AS formation_layout_json, p.name, p.unit,
        p.category, p.family, p.concept, p.diagram_json, p.notes, p.updated_at,
        EXISTS(SELECT 1 FROM install_items i JOIN install_packages k ON k.id = i.package_id WHERE i.play_id = p.id AND k.published_at IS NOT NULL) AS locked
       FROM plays p LEFT JOIN formations f ON f.id = p.formation_id
       WHERE p.team_id = ? ORDER BY p.created_at`,
        )
        .bind(database.teamId)
        .all<PlayRow>(),
      database
        .prepare(
          `SELECT a.id, a.play_id, a.position, a.title, a.detail, a.sort_order
       FROM play_assignments a JOIN plays p ON p.id = a.play_id
       WHERE p.team_id = ? ORDER BY a.play_id, a.sort_order`,
        )
        .bind(database.teamId)
        .all<AssignmentRow>(),
    ]);

  const assignments = assignmentResult.results.reduce<
    Record<string, AssignmentRow[]>
  >((groups, row) => {
    (groups[row.play_id] ??= []).push(row);
    return groups;
  }, {});
  return {
    books: bookResult.results.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      side: String(row.side),
      archived: Boolean(row.archived),
      plays: Number(row.play_count),
      formations: Number(row.formation_count),
      updated: String(row.updated_at),
    })),
    formations: formationResult.results.map((row) => {
      const layout = parseDiagram(String(row.layout_json));
      return {
        ...layout,
        id: String(row.id),
        name: layout.formationName || String(row.name),
        unit: String(row.unit),
        personnel: String(row.personnel),
        count: Number(row.play_count),
      };
    }),
    plays: playResult.results.map((row, variant) => {
      const diagram = parseDiagram(row.diagram_json);
      return {
        id: row.id,
        playbookId: row.playbook_id ?? 'offence',
        formationId: row.formation_id,
        name: row.name,
        formation: row.formation_layout_json
          ? parseDiagram(row.formation_layout_json).formationName ||
            row.formation ||
            'Unassigned'
          : 'Unassigned',
        unit: row.unit,
        category: row.category,
        family: row.family,
        concept: row.concept,
        variant,
        routes: diagram.routes,
        players: diagram.players,
        zones: diagram.zones,
        labels: diagram.labels,
        fieldPosition: diagram.fieldPosition,
        showOpponent: diagram.showOpponent,
        diagramVersion: diagram.diagramVersion,
        opponentFormationId: diagram.opponentFormationId,
        opponentPlayers: diagram.opponentPlayers,
        notes: row.notes,
        locked: Boolean(row.locked),
        assignments: (assignments[row.id] ?? []).map((item) => ({
          id: item.id,
          position: item.position,
          title: item.title,
          detail: item.detail,
          sortOrder: item.sort_order,
        })),
      };
    }),
  };
}

export async function GET() {
  try {
    const database = await getDatabase();
    return Response.json(await payload(database), {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WorkspaceAccessError
            ? error.message
            : 'Unable to load playbooks. Please retry.',
      },
      { status: error instanceof WorkspaceAccessError ? error.status : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new CreationError('Enter valid creation details.', 400);
    const database = await getDatabase();
    const creation = await prepareCreation(database, body);
    if (creation.replay)
      return Response.json({
        ...(await payload(database)),
        createdId: creation.id,
      });
    const now = new Date().toISOString();
    if (body.kind === 'duplicate') {
      const sourceId = text(body.id);
      const source = await database
        .prepare('SELECT id, name FROM plays WHERE id = ? AND team_id = ?')
        .bind(sourceId, database.teamId)
        .first<{ id: string; name: string }>();
      if (!source) throw new Error('Play not found.');
      let id = creation.id;
      const sourceAssignments = await database
        .prepare(
          'SELECT position, title, detail, sort_order FROM play_assignments WHERE play_id = ?',
        )
        .bind(sourceId)
        .all<{
          position: string;
          title: string;
          detail: string;
          sort_order: number;
        }>();
      id = await creation.commit([
        database
          .prepare(
            `INSERT INTO plays (id, team_id, playbook_id, formation_id, name, unit, category, family, concept, diagram_json, notes, created_at, updated_at) SELECT ?, team_id, playbook_id, formation_id, ?, unit, category, family, concept, diagram_json, notes, ?, ? FROM plays WHERE id = ? AND team_id = ?`,
          )
          .bind(
            id,
            `${source.name} — copy`,
            now,
            now,
            sourceId,
            database.teamId,
          ),
        ...sourceAssignments.results.map((assignment) =>
          database
            .prepare(
              'INSERT INTO play_assignments (id, play_id, position, title, detail, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .bind(
              crypto.randomUUID(),
              id,
              assignment.position,
              assignment.title,
              assignment.detail,
              assignment.sort_order,
            ),
        ),
      ]);
      return Response.json(
        { ...(await payload(database)), createdId: id },
        { status: 201 },
      );
    }
    if (body.kind === 'book') {
      const name = text(body.name);
      if (!name) throw new Error('Playbook name is required.');
      if (!validSide(body.side))
        throw new Error('Choose a valid playbook system.');
      let id = creation.id;
      id = await creation.commit([
        database
          .prepare(
            `INSERT INTO playbooks (id, team_id, name, side, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
          )
          .bind(id, database.teamId, name, body.side, now, now),
      ]);
      return Response.json(
        { ...(await payload(database)), createdId: id },
        { status: 201 },
      );
    }
    if (body.kind === 'play') {
      const name = text(body.name, 'Untitled play');
      const playbookId = text(body.playbookId, 'offence');
      const formationId = text(body.formationId) || null;
      const category = text(body.category, 'Uncategorized');
      const family = validFamily(body.family) ? body.family : 'Unassigned';
      const concept = text(body.concept, 'New concept');
      let id = creation.id;
      const book = await database
        .prepare('SELECT id, side FROM playbooks WHERE id = ? AND team_id = ?')
        .bind(playbookId, database.teamId)
        .first<{ id: string; side: string }>();
      if (!book) throw new Error('Playbook not found.');
      const formation = formationId
        ? await database
            .prepare(
              'SELECT id, unit, layout_json FROM formations WHERE id = ? AND team_id = ?',
            )
            .bind(formationId, database.teamId)
            .first<{ id: string; unit: string; layout_json: string }>()
        : null;
      if (formationId && !formation) throw new Error('Formation not found.');
      if (
        formation &&
        (formation.unit !== book.side ||
          parseDiagram(formation.layout_json).scope !== 'team')
      )
        throw new Error(
          'Choose your team’s formation for this side of the ball.',
        );
      id = await creation.commit([
        database
          .prepare(
            `INSERT INTO plays (id, team_id, playbook_id, formation_id, name, unit, category, family, concept, diagram_json, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
          )
          .bind(
            id,
            database.teamId,
            playbookId,
            formationId,
            name,
            book.side,
            category,
            family,
            concept,
            JSON.stringify(
              formation
                ? {
                    ...parseDiagram(formation.layout_json),
                    routes: [],
                    zones: [],
                    labels: [],
                    showOpponent: false,
                  }
                : {
                    diagramVersion: 2,
                    routes: [],
                    players: startingPlayers(book.side),
                    zones: [],
                    labels: [],
                    fieldPosition: 55,
                    showOpponent: false,
                  },
            ),
            now,
            now,
          ),
      ]);
      return Response.json(
        { ...(await payload(database)), createdId: id },
        { status: 201 },
      );
    }
    if (body.kind === 'formation') {
      const name = text(body.name);
      const unit = text(body.unit, 'Offence');
      const personnel = text(body.personnel, 'Custom personnel');
      if (!name) throw new Error('Formation name is required.');
      if (!['Offence', 'Defence', 'Special teams'].includes(unit))
        throw new Error('Choose a side of the ball.');
      const scope = body.scope === 'scout' ? 'scout' : 'team';
      const opponent = text(body.opponent),
        packageName = text(body.packageName);
      if (scope === 'scout' && !opponent)
        throw new Error('Name the opponent for a scout formation.');
      const players = Array.isArray(body.players)
        ? body.players
        : startingPlayers(unit);
      const layout = {
        diagramVersion: 2,
        field: 'canadian',
        formationName: name,
        scope,
        opponent,
        packageName,
        fieldPosition: 55,
        players,
      };
      validatePlayDiagram(layout);
      let id = creation.id;
      id = await creation.commit([
        database
          .prepare(
            `INSERT INTO formations (id, team_id, name, unit, personnel, layout_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            database.teamId,
            JSON.stringify([name, scope, opponent, packageName]),
            unit,
            personnel,
            JSON.stringify(layout),
            now,
          ),
      ]);
      return Response.json(
        { ...(await payload(database)), createdId: id },
        { status: 201 },
      );
    }
    throw new Error('Choose whether to create a playbook, formation, or play.');
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Unable to create record.') },
      {
        status:
          error instanceof CreationError
            ? error.status
            : error instanceof WorkspaceAccessError
              ? error.status
              : 400,
      },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const database = await getDatabase();
    if (body.kind === 'formation') {
      const id = text(body.id);
      const name = text(body.name);
      if (!id || !name) throw new Error('Formation id and name are required.');
      validatePlayDiagram(body);
      const prior = await database
        .prepare(
          'SELECT unit, layout_json FROM formations WHERE id = ? AND team_id = ?',
        )
        .bind(id, database.teamId)
        .first<{ unit: string; layout_json: string }>();
      if (!prior) throw new Error('Formation not found.');
      const unit = text(body.unit, prior.unit),
        scope = body.scope === 'scout' ? 'scout' : 'team',
        opponent = text(body.opponent),
        packageName = text(body.packageName);
      if (
        !['Offence', 'Defence', 'Special teams'].includes(unit) ||
        (scope === 'scout' && !opponent)
      )
        throw new Error('Choose a side and name scout opponents.');
      if (
        unit !== prior.unit ||
        scope !== parseDiagram(prior.layout_json).scope
      ) {
        if (
          await database
            .prepare('SELECT id FROM plays WHERE formation_id = ? LIMIT 1')
            .bind(id)
            .first()
        )
          throw new Error(
            'Used formations cannot change side or ownership. Duplicate the formation instead.',
          );
      }
      if (
        await database
          .prepare(
            'SELECT i.id FROM install_items i JOIN install_packages k ON k.id = i.package_id JOIN plays p ON p.id = i.play_id WHERE p.formation_id = ? AND k.team_id = ? AND k.published_at IS NOT NULL LIMIT 1',
          )
          .bind(id, database.teamId)
          .first()
      )
        throw new Error(
          'This formation is used in a published install. Create a new formation to revise it.',
        );
      await database
        .prepare(
          `UPDATE formations SET name = ?, unit = ?, personnel = ?, layout_json = ? WHERE id = ? AND team_id = ?`,
        )
        .bind(
          JSON.stringify([name, scope, opponent, packageName]),
          unit,
          text(body.personnel, 'Custom personnel'),
          JSON.stringify({
            ...body,
            formationName: name,
            scope,
            opponent,
            packageName,
            players: Array.isArray(body.players) ? body.players : [],
          }),
          id,
          database.teamId,
        )
        .run();
      return Response.json(await payload(database));
    }
    if (body.kind === 'book') {
      const id = text(body.id);
      const name = text(body.name);
      if (!id || !name || !validSide(body.side))
        throw new Error('Valid playbook details are required.');
      const book = await database
        .prepare('SELECT side FROM playbooks WHERE id = ? AND team_id = ?')
        .bind(id, database.teamId)
        .first<{ side: string }>();
      if (!book) throw new Error('Playbook not found.');
      if (
        book.side !== body.side &&
        (await database
          .prepare('SELECT id FROM plays WHERE playbook_id = ? LIMIT 1')
          .bind(id)
          .first())
      )
        throw new Error(
          'A playbook with saved plays cannot change units. Create another playbook for that unit.',
        );
      await database
        .prepare(
          'UPDATE playbooks SET name = ?, side = ?, archived = ?, updated_at = ? WHERE id = ? AND team_id = ?',
        )
        .bind(
          name,
          body.side,
          body.archived ? 1 : 0,
          new Date().toISOString(),
          id,
          database.teamId,
        )
        .run();
      return Response.json(await payload(database));
    }
    const id = text(body.id);
    if (!id) throw new Error('Play id is required.');
    const name = text(body.name);
    const formationId = text(body.formationId) || null;
    const category = text(body.category, 'Uncategorized');
    const family = validFamily(body.family) ? body.family : 'Unassigned';
    const concept = text(body.concept);
    if (!name || !concept)
      throw new Error('Play name and concept are required.');
    validatePlayDiagram(body);
    const ownFormation = formationId
      ? await database
          .prepare(
            'SELECT id, unit, layout_json FROM formations WHERE id = ? AND team_id = ?',
          )
          .bind(formationId, database.teamId)
          .first<{ id: string; unit: string; layout_json: string }>()
      : null;
    if (formationId && !ownFormation) throw new Error('Formation not found.');
    const published = await database
      .prepare(
        'SELECT i.id FROM install_items i JOIN install_packages k ON k.id = i.package_id WHERE i.play_id = ? AND k.team_id = ? AND k.published_at IS NOT NULL LIMIT 1',
      )
      .bind(id, database.teamId)
      .first();
    if (published)
      return Response.json(
        {
          error:
            'This play belongs to a published install and is locked. Duplicate it to create a revised version.',
        },
        { status: 409 },
      );
    const diagram = {
      routes: Array.isArray(body.routes) ? body.routes : [],
      players: Array.isArray(body.players) ? body.players : [],
      zones: Array.isArray(body.zones) ? body.zones : [],
      labels: Array.isArray(body.labels) ? body.labels : [],
      fieldPosition:
        typeof body.fieldPosition === 'number'
          ? Math.min(110, Math.max(0, body.fieldPosition))
          : 55,
      showOpponent: Boolean(body.showOpponent),
      diagramVersion: body.diagramVersion === 2 ? 2 : 1,
      opponentFormationId: text(body.opponentFormationId) || null,
      opponentPlayers: Array.isArray(body.opponentPlayers)
        ? body.opponentPlayers
        : [],
    };
    const assignmentInput = Array.isArray(body.assignments)
      ? (body.assignments as Record<string, unknown>[])
      : [];
    const existing = await database
      .prepare('SELECT id, unit FROM plays WHERE id = ? AND team_id = ?')
      .bind(id, database.teamId)
      .first<{ id: string; unit: string }>();
    if (!existing)
      return Response.json({ error: 'Play not found.' }, { status: 404 });
    if (
      ownFormation &&
      (ownFormation.unit !== existing.unit ||
        parseDiagram(ownFormation.layout_json).scope !== 'team')
    )
      throw new Error(
        'Choose your team’s formation for this side of the ball.',
      );
    const assignments = assignmentInput.map((item, index) => ({
      id: crypto.randomUUID(),
      position: text(item.position, `P${index + 1}`).toUpperCase(),
      title: text(item.title, 'New assignment'),
      detail: text(item.detail),
      sortOrder: index,
    }));
    await database.batch([
      database
        .prepare(
          `UPDATE plays SET formation_id = ?, name = ?, category = ?, family = ?, concept = ?, diagram_json = ?, notes = ?, updated_at = ? WHERE id = ? AND team_id = ?`,
        )
        .bind(
          formationId,
          name,
          category,
          family,
          concept,
          JSON.stringify(diagram),
          text(body.notes),
          new Date().toISOString(),
          id,
          database.teamId,
        ),
      database
        .prepare('DELETE FROM play_assignments WHERE play_id = ?')
        .bind(id),
      ...assignments.map((assignment) =>
        database
          .prepare(
            `INSERT INTO play_assignments (id, play_id, position, title, detail, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            assignment.id,
            id,
            assignment.position,
            assignment.title,
            assignment.detail,
            assignment.sortOrder,
          ),
      ),
    ]);
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Unable to save play.') },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = text(body.id);
    const kind = text(body.kind);
    if (!id || !['play', 'formation', 'book'].includes(kind))
      throw new Error('A valid record is required.');
    const database = await getDatabase();
    if (kind === 'formation') {
      const used = await database
        .prepare('SELECT COUNT(*) AS count FROM plays WHERE formation_id = ?')
        .bind(id)
        .first<{ count: number }>();
      if ((used?.count ?? 0) > 0)
        return Response.json(
          { error: 'Move or delete this formation’s plays first.' },
          { status: 409 },
        );
      await database
        .prepare('DELETE FROM formations WHERE id = ? AND team_id = ?')
        .bind(id, database.teamId)
        .run();
    } else if (kind === 'play') {
      const installed = await database
        .prepare(
          'SELECT i.id FROM install_items i JOIN install_packages k ON k.id = i.package_id WHERE i.play_id = ? AND k.team_id = ? LIMIT 1',
        )
        .bind(id, database.teamId)
        .first();
      if (installed)
        return Response.json(
          {
            error:
              'Remove this play from draft installs first. Plays in published installs must be retained.',
          },
          { status: 409 },
        );
      await database
        .prepare('DELETE FROM plays WHERE id = ? AND team_id = ?')
        .bind(id, database.teamId)
        .run();
    } else {
      const used = await database
        .prepare('SELECT COUNT(*) AS count FROM plays WHERE playbook_id = ?')
        .bind(id)
        .first<{ count: number }>();
      if ((used?.count ?? 0) > 0)
        return Response.json(
          { error: 'Delete or move this playbook’s plays first.' },
          { status: 409 },
        );
      await database
        .prepare('DELETE FROM playbooks WHERE id = ? AND team_id = ?')
        .bind(id, database.teamId)
        .run();
    }
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to delete record.',
      },
      { status: 400 },
    );
  }
}
