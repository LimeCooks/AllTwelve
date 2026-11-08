import type { TeamDatabase } from '@/db/client';
export class RevisionError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
const tables = {
  play: 'plays',
  formation: 'formations',
  book: 'playbooks',
} as const;
type Kind = keyof typeof tables;
type Row = Record<string, string | number | null>;
const ordered = (row: Row) =>
  Object.fromEntries(
    Object.entries(row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
const columns = {
  book: [
    'id',
    'team_id',
    'name',
    'side',
    'archived',
    'created_at',
    'updated_at',
  ],
  formation: [
    'id',
    'team_id',
    'name',
    'unit',
    'personnel',
    'layout_json',
    'created_at',
  ],
  play: [
    'id',
    'team_id',
    'playbook_id',
    'formation_id',
    'name',
    'unit',
    'category',
    'family',
    'concept',
    'diagram_json',
    'notes',
    'created_at',
    'updated_at',
  ],
};
export async function recordVersion(
  kind: Kind,
  row: Row,
  assignments: Row[] = [],
) {
  const values = Object.fromEntries(
    columns[kind].map((column) => [column, row[column]]),
  );
  const entries = assignments
    .map((a) => ({
      id: a.id,
      position: a.position,
      title: a.title,
      detail: a.detail,
      sort_order: a.sort_order,
    }))
    .sort((a, b) =>
      String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0,
    );
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([ordered(values), entries.map(ordered)]),
    ),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export async function revisionSnapshot(
  db: TeamDatabase,
  kind: Kind,
  id: string,
) {
  const table = tables[kind];
  const row = await db
    .prepare(`SELECT * FROM ${table} WHERE id = ? AND team_id = ?`)
    .bind(id, db.teamId)
    .first<Row>();
  if (!row)
    throw new RevisionError(
      'This record is no longer available. Your draft is still open.',
      404,
    );
  const assignments =
    kind === 'play'
      ? (
          await db
            .prepare(
              'SELECT id,position,title,detail,sort_order FROM play_assignments WHERE play_id = ? ORDER BY id',
            )
            .bind(id)
            .all<Row>()
        ).results
      : [];
  const version = await recordVersion(kind, row, assignments);
  return { row, assignments, version };
}
export async function revisionGuard(
  db: TeamDatabase,
  kind: Kind,
  id: string,
  expected: unknown,
  desired: {
    side?: unknown;
    unit?: unknown;
    scope?: unknown;
    operation?: 'save' | 'copy' | 'delete';
  } = {},
) {
  const operation = desired.operation ?? 'save';
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
    throw new RevisionError(
      operation === 'save'
        ? 'Reload this record before saving. Your draft is still open.'
        : `Reload this record before ${operation === 'copy' ? 'duplicating' : 'deleting'} it.`,
      400,
    );
  const snapshot = await revisionSnapshot(db, kind, id);
  if (snapshot.version !== expected)
    throw new RevisionError(
      operation === 'save'
        ? 'This record changed on another device. Download your draft, then reload the latest saved version.'
        : 'This record changed on another device. Close this dialog and reload the latest saved version before continuing.',
    );
  const table = tables[kind],
    guardId = crypto.randomUUID();
  const columns = Object.keys(snapshot.row);
  // Column names come only from the fixed database schema, never request input.
  const condition = columns
    .map((column) => `${table}."${column}" IS ?`)
    .join(' AND ');
  const values: (string | number | null)[] = columns.map(
    (column) => snapshot.row[column],
  );
  let extra = '';
  if (kind === 'play') {
    extra += ` AND (SELECT json_group_array(json_array(id,position,title,detail,sort_order)) FROM (SELECT id,position,title,detail,sort_order FROM play_assignments WHERE play_id = ? ORDER BY id)) = ?`;
    values.push(
      id,
      JSON.stringify(
        snapshot.assignments.map((a) => [
          a.id,
          a.position,
          a.title,
          a.detail,
          a.sort_order,
        ]),
      ),
    );
    if (operation !== 'copy')
      extra += ` AND NOT EXISTS(SELECT 1 FROM install_items i JOIN install_packages k ON k.id = i.package_id WHERE i.play_id = plays.id AND k.published_at IS NOT NULL)`;
  }
  if (kind === 'formation' && operation !== 'copy')
    extra += ` AND NOT EXISTS(SELECT 1 FROM plays p JOIN install_items i ON i.play_id = p.id JOIN install_packages k ON k.id = i.package_id WHERE p.formation_id = formations.id AND k.published_at IS NOT NULL)`;
  if (
    kind === 'book' &&
    desired.side !== undefined &&
    desired.side !== snapshot.row.side
  )
    extra +=
      ' AND NOT EXISTS(SELECT 1 FROM plays p WHERE p.playbook_id = playbooks.id)';
  if (
    kind === 'formation' &&
    operation === 'save' &&
    (desired.unit !== snapshot.row.unit ||
      desired.scope !==
        (JSON.parse(String(snapshot.row.layout_json)).scope ?? 'team'))
  )
    extra +=
      ' AND NOT EXISTS(SELECT 1 FROM plays p WHERE p.formation_id = formations.id)';
  if (operation === 'delete') {
    if (kind === 'play')
      extra +=
        ' AND NOT EXISTS(SELECT 1 FROM install_items i WHERE i.play_id = plays.id)';
    if (kind === 'formation')
      extra +=
        ' AND NOT EXISTS(SELECT 1 FROM plays p WHERE p.formation_id = formations.id)';
    if (kind === 'book')
      extra +=
        ' AND NOT EXISTS(SELECT 1 FROM plays p WHERE p.playbook_id = playbooks.id)';
  }
  // A failed NOT NULL assertion aborts the entire D1 batch, including assignments.
  // CASE placeholders precede the final timestamp placeholder.
  const statement = db
    .prepare(
      `INSERT INTO workspace_state (id,team_id,state_key,value_json,updated_at) VALUES (?,?,?,CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${condition}${extra}) THEN '{}' ELSE NULL END,?)`,
    )
    .bind(
      guardId,
      db.teamId,
      'pb-save-' + guardId,
      ...values,
      new Date().toISOString(),
    );
  const wrap = (statements: D1PreparedStatement[]) => [
    statement,
    ...statements,
    db
      .prepare('DELETE FROM workspace_state WHERE id = ? AND team_id = ?')
      .bind(guardId, db.teamId),
  ];
  const failure = (error: unknown) =>
    error instanceof Error &&
    error.message.includes('workspace_state.value_json')
      ? new RevisionError(
          operation === 'save'
            ? 'This record changed or was published while saving. Your draft is still open. Download it before reloading.'
            : 'This record changed or gained linked work before the action completed. Nothing was copied or deleted. Close this dialog and reload before continuing.',
        )
      : error;
  return {
    snapshot,
    wrap,
    failure,
    async commit(statements: D1PreparedStatement[]) {
      try {
        await db.batch(wrap(statements));
      } catch (error) {
        throw failure(error);
      }
    },
  };
}
