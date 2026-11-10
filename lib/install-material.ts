import {
  WorkspaceAccessError,
  type TeamDatabase,
} from '@/lib/workspace-identity';
import { validatePlayDiagram } from '@/lib/validate-play';
import type { Drawing, Assignment } from '@/lib/play-designer';

export const installMaterialKey = (id: string) => 'install-published-v1:' + id;
export type InstallMaterial = Drawing & {
  id: string;
  name: string;
  unit: string;
  notes: string;
  assignments: Assignment[];
};
type SnapshotItem = {
  itemId: string;
  playId: string;
  name: string;
  unit: string;
  notes: string;
  diagramJson: string;
  assignments: Assignment[];
};
export type PublishedMaterial = {
  version: 1;
  packageId: string;
  publishedAt: string;
  items: SnapshotItem[];
};

// Evaluated inside the publication transaction, after all current items and
// assignments are known. It preserves source bytes instead of a mutable link.
export const publishedMaterialSql = `json_object(
  'version',1,'packageId',p.id,'publishedAt',?,
  'items',json((SELECT json_group_array(json_object(
    'itemId',x.id,'playId',q.id,'name',q.name,'unit',q.unit,
    'notes',q.notes,'diagramJson',q.diagram_json,
    'assignments',json((SELECT json_group_array(json_object(
      'id',a.id,'position',a.position,'title',a.title,'detail',a.detail
    )) FROM (SELECT id,position,title,detail FROM play_assignments
      WHERE play_id=q.id ORDER BY sort_order,id) a))
  )) FROM (SELECT id,play_id FROM install_items WHERE package_id=p.id ORDER BY sort_order,id) x
    JOIN plays q ON q.id=x.play_id AND q.team_id=p.team_id))
)`;

export function materialPlay(item: SnapshotItem): InstallMaterial {
  const drawing = JSON.parse(item.diagramJson) as Record<string, unknown>;
  validatePlayDiagram({ ...drawing, assignments: item.assignments });
  return {
    id: item.playId,
    name: item.name,
    unit: item.unit,
    notes: item.notes,
    assignments: item.assignments,
    diagramVersion: drawing.diagramVersion === 2 ? 2 : 1,
    fieldPosition:
      typeof drawing.fieldPosition === 'number' ? drawing.fieldPosition : 55,
    players: drawing.players as Drawing['players'],
    routes: drawing.routes as Drawing['routes'],
    zones: drawing.zones as Drawing['zones'],
    labels: drawing.labels as Drawing['labels'],
    showOpponent: drawing.showOpponent === true,
    opponentPlayers: drawing.opponentPlayers as Drawing['opponentPlayers'],
  };
}

export async function publishedMaterial(
  database: TeamDatabase,
  packageId: string,
  publishedAt: string,
): Promise<PublishedMaterial | null> {
  const row = await database
    .prepare(
      'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
    )
    .bind(database.teamId, installMaterialKey(packageId))
    .first<{ value_json: string }>();
  // Old publications did not retain their source. Never manufacture a history.
  if (!row) return null;
  try {
    return parsePublishedMaterial(row.value_json, packageId, publishedAt);
  } catch {
    throw new WorkspaceAccessError(
      'The published teaching version could not be read. Refresh or ask your coach to check the install.',
      500,
    );
  }
}

export function parsePublishedMaterial(
  raw: string,
  packageId: string,
  publishedAt: string,
): PublishedMaterial {
  const value = JSON.parse(raw) as PublishedMaterial;
  if (
    !value ||
    value.version !== 1 ||
    value.packageId !== packageId ||
    value.publishedAt !== publishedAt ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    new Set(value.items.map((item) => item.itemId)).size !== value.items.length
  )
    throw new Error('Saved published material is invalid.');
  for (const item of value.items) {
    if (
      !item ||
      typeof item.itemId !== 'string' ||
      !item.itemId ||
      typeof item.playId !== 'string' ||
      !item.playId ||
      typeof item.name !== 'string' ||
      !['Offence', 'Defence', 'Special teams', 'Team'].includes(item.unit) ||
      typeof item.notes !== 'string' ||
      typeof item.diagramJson !== 'string' ||
      !Array.isArray(item.assignments)
    )
      throw new Error('Saved published material is invalid.');
    materialPlay(item);
  }
  return value;
}
