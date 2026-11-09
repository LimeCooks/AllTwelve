import {
  WorkspaceAccessError,
  type TeamDatabase,
} from '@/lib/workspace-identity';
import type { WorkspaceGrant } from '@/lib/team-permissions';
import { validatePlayDiagram } from '@/lib/validate-play';
import type { Drawing, Assignment } from '@/lib/play-designer';

export type PlayerLearningItem = {
  id: string;
  itemId: string;
  package: { id: string; name: string; dueAt: string; publishedAt: string };
  title: string;
  reviewed: boolean;
  assignment: boolean;
  note: boolean;
  version: string;
  play:
    | (Drawing & {
        id: string;
        name: string;
        notes: string;
        assignments: Assignment[];
      })
    | null;
};
export type PlayerLearning = {
  athlete: { id: string; name: string; position: string; unit: string };
  items: PlayerLearningItem[];
};
type ReviewRow = {
  id: string;
  install_item_id: string;
  package_id: string;
  package_name: string;
  due_at: string;
  published_at: string;
  title: string;
  play_id: string | null;
  play_name: string | null;
  diagram_json: string | null;
  notes: string | null;
  reviewed_at: string | null;
  assignment_acknowledged_at: string | null;
  note_acknowledged_at: string | null;
};
async function revision(
  row: Pick<
    ReviewRow,
    'id' | 'reviewed_at' | 'assignment_acknowledged_at' | 'note_acknowledged_at'
  >,
) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([
        row.id,
        row.reviewed_at,
        row.assignment_acknowledged_at,
        row.note_acknowledged_at,
      ]),
    ),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
function boundAthlete(grant: WorkspaceGrant, database: TeamDatabase) {
  if (
    grant.role !== 'player' ||
    !grant.athleteId ||
    grant.teamId !== database.teamId
  )
    throw new WorkspaceAccessError('A linked player account is required.', 403);
  return grant.athleteId;
}
export async function playerLearning(
  database: TeamDatabase,
  grant: WorkspaceGrant,
): Promise<PlayerLearning> {
  const athleteId = boundAthlete(grant, database);
  const athlete = await database
    .prepare(
      'SELECT id, first_name, last_name, position, unit FROM athletes WHERE id=? AND team_id=?',
    )
    .bind(athleteId, database.teamId)
    .first<{
      id: string;
      first_name: string;
      last_name: string;
      position: string;
      unit: string;
    }>();
  if (!athlete)
    throw new WorkspaceAccessError(
      'Your roster profile is unavailable. Contact your coach.',
      403,
    );
  const rows = await database
    .prepare(`SELECT r.id, r.install_item_id, k.id AS package_id, k.name AS package_name,
    k.due_at, k.published_at, i.title, p.id AS play_id, p.name AS play_name, p.diagram_json, p.notes,
    r.reviewed_at, r.assignment_acknowledged_at, r.note_acknowledged_at
    FROM athlete_reviews r JOIN install_items i ON i.id=r.install_item_id
    JOIN install_packages k ON k.id=i.package_id
    LEFT JOIN plays p ON p.id=i.play_id AND p.team_id=k.team_id
    WHERE r.athlete_id=? AND k.team_id=? AND k.published_at IS NOT NULL
    ORDER BY k.published_at DESC, k.id, i.sort_order, i.id`)
    .bind(athleteId, database.teamId)
    .all<ReviewRow>();
  const assignmentRows = await database
    .prepare(`SELECT DISTINCT a.id, a.play_id, a.position, a.title, a.detail, a.sort_order
    FROM play_assignments a JOIN plays p ON p.id=a.play_id JOIN install_items i ON i.play_id=p.id
    JOIN install_packages k ON k.id=i.package_id AND k.team_id=p.team_id
    JOIN athlete_reviews r ON r.install_item_id=i.id
    WHERE r.athlete_id=? AND k.team_id=? AND k.published_at IS NOT NULL ORDER BY a.sort_order,a.id`)
    .bind(athleteId, database.teamId)
    .all<Assignment & { play_id: string }>();
  const assignments = new Map<string, Assignment[]>();
  for (const row of assignmentRows.results) {
    const list = assignments.get(row.play_id) ?? [];
    list.push({
      id: row.id,
      position: row.position,
      title: row.title,
      detail: row.detail,
    });
    assignments.set(row.play_id, list);
  }
  const items = await Promise.all(
    rows.results.map(async (row): Promise<PlayerLearningItem> => {
      let play: PlayerLearningItem['play'] = null;
      if (row.play_id && row.play_name && row.diagram_json) {
        // Corrupt material stays unavailable; never substitute a sample diagram.
        try {
          const drawing = JSON.parse(row.diagram_json) as Record<
            string,
            unknown
          >;
          validatePlayDiagram(drawing);
          play = {
            id: row.play_id,
            name: row.play_name,
            notes: row.notes ?? '',
            assignments: assignments.get(row.play_id) ?? [],
            diagramVersion: drawing.diagramVersion === 2 ? 2 : 1,
            fieldPosition:
              typeof drawing.fieldPosition === 'number'
                ? drawing.fieldPosition
                : 55,
            players: drawing.players as Drawing['players'],
            routes: drawing.routes as Drawing['routes'],
            zones: drawing.zones as Drawing['zones'],
            labels: drawing.labels as Drawing['labels'],
            showOpponent: drawing.showOpponent === true,
            opponentPlayers:
              drawing.opponentPlayers as Drawing['opponentPlayers'],
          };
        } catch {
          play = null;
        }
      }
      return {
        id: row.id,
        itemId: row.install_item_id,
        package: {
          id: row.package_id,
          name: row.package_name,
          dueAt: row.due_at,
          publishedAt: row.published_at,
        },
        title: row.play_name ?? row.title,
        reviewed: Boolean(row.reviewed_at),
        assignment: Boolean(row.assignment_acknowledged_at),
        note: Boolean(row.note_acknowledged_at),
        version: await revision(row),
        play,
      };
    }),
  );
  return {
    athlete: {
      id: athlete.id,
      name: `${athlete.first_name} ${athlete.last_name}`,
      position: athlete.position,
      unit: athlete.unit,
    },
    items,
  };
}

export async function acknowledgeLearning(
  database: TeamDatabase,
  grant: WorkspaceGrant,
  raw: unknown,
) {
  const athleteId = boundAthlete(grant, database);
  const body = raw as {
    id?: unknown;
    version?: unknown;
    kind?: unknown;
    athleteId?: unknown;
  } | null;
  const columns = {
    reviewed: 'reviewed_at',
    assignment: 'assignment_acknowledged_at',
    note: 'note_acknowledged_at',
  } as const;
  if (
    !body ||
    typeof body.id !== 'string' ||
    typeof body.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.version) ||
    !Object.hasOwn(columns, String(body.kind)) ||
    body.athleteId !== undefined
  )
    throw new WorkspaceAccessError(
      'Review your own assignment before acknowledging it.',
      400,
    );
  const current = await playerLearning(database, grant);
  const item = current.items.find((item) => item.id === body.id);
  if (!item)
    throw new WorkspaceAccessError(
      'Assignment not found for your account.',
      404,
    );
  if (!item.play)
    throw new WorkspaceAccessError(
      'This material is unavailable. Ask your coach to check it.',
      409,
    );
  const kind = body.kind as keyof typeof columns;
  if (item[kind]) return current; // Retrying an acknowledgement never changes its timestamp.
  if (item.version !== body.version)
    throw new WorkspaceAccessError(
      'Your review changed on another device. Refresh before continuing.',
      409,
    );
  const column = columns[kind];
  const times = await reviewTimes(database, body.id);
  if ((await revision(times)) !== body.version)
    throw new WorkspaceAccessError(
      'Your review changed on another device. Refresh before continuing.',
      409,
    );
  const saved = await database
    .prepare(`UPDATE athlete_reviews SET ${column}=?
    WHERE id=? AND athlete_id=? AND reviewed_at IS ? AND assignment_acknowledged_at IS ? AND note_acknowledged_at IS ?
    AND EXISTS(SELECT 1 FROM install_items i JOIN install_packages k ON k.id=i.package_id JOIN plays p ON p.id=i.play_id AND p.team_id=k.team_id
      WHERE i.id=athlete_reviews.install_item_id AND k.team_id=? AND k.published_at IS NOT NULL)
    AND EXISTS(SELECT 1 FROM team_memberships m JOIN athletes a ON a.id=m.athlete_id AND a.team_id=m.team_id
      WHERE m.team_id=? AND m.user_id=? AND m.athlete_id=? AND m.role='player' AND m.status='active') RETURNING id`)
    .bind(
      new Date().toISOString(),
      body.id,
      athleteId,
      times.reviewed_at,
      times.assignment_acknowledged_at,
      times.note_acknowledged_at,
      database.teamId,
      database.teamId,
      grant.userId,
      athleteId,
    )
    .first();
  if (!saved)
    throw new WorkspaceAccessError(
      'Your assignment or access changed. Refresh before continuing.',
      409,
    );
  return playerLearning(database, grant);
}
async function reviewTimes(database: TeamDatabase, id: string) {
  const row = await database
    .prepare(
      'SELECT id, reviewed_at, assignment_acknowledged_at, note_acknowledged_at FROM athlete_reviews WHERE id=?',
    )
    .bind(id)
    .first<
      Pick<
        ReviewRow,
        | 'id'
        | 'reviewed_at'
        | 'assignment_acknowledged_at'
        | 'note_acknowledged_at'
      >
    >();
  if (!row)
    throw new WorkspaceAccessError(
      'Assignment changed. Refresh before continuing.',
      409,
    );
  return row;
}
