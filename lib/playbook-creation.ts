import type { TeamDatabase } from '@/db/client';
export class CreationError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
type Ledger = { fingerprint: string; kind: string; createdId: string };
function canonical(value: unknown, depth = 0): unknown {
  if (depth > 24)
    throw new CreationError('Creation details are too deeply nested.', 400);
  if (Array.isArray(value))
    return value.map((item) => canonical(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item, depth + 1)]),
    );
  return value;
}
export async function prepareCreation(
  db: TeamDatabase,
  body: Record<string, unknown>,
) {
  const kind = String(body.kind),
    tables: Record<string, string> = {
      book: 'playbooks',
      play: 'plays',
      formation: 'formations',
      duplicate: 'plays',
    };
  if (!Object.hasOwn(tables, kind))
    throw new CreationError(
      'Choose a playbook, play, formation or duplicate.',
      400,
    );
  const id = crypto.randomUUID();
  if (body.creationId === undefined)
    return {
      id,
      replay: false,
      commit: async (statements: D1PreparedStatement[]) => {
        await db.batch(statements);
        return id;
      },
    };
  if (
    typeof body.creationId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{7,63}$/i.test(body.creationId)
  )
    throw new CreationError('Use a valid creation request ID.', 400);
  const { creationId, ...details } = body,
    key = 'pb-create-' + creationId;
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical(details))),
  );
  const fingerprint = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const read = async () => {
    const row = await db
      .prepare(
        'SELECT value_json FROM workspace_state WHERE team_id = ? AND state_key = ?',
      )
      .bind(db.teamId, key)
      .first<{ value_json: string }>();
    if (!row) return null;
    const ledger = JSON.parse(row.value_json) as Ledger;
    if (
      !ledger ||
      typeof ledger.createdId !== 'string' ||
      typeof ledger.fingerprint !== 'string' ||
      typeof ledger.kind !== 'string'
    )
      throw new Error('Invalid creation ledger.');
    if (ledger.fingerprint !== fingerprint || ledger.kind !== kind)
      throw new CreationError(
        'That creation request already has different details. Refresh before starting a new record.',
      );
    const record = await db
      .prepare(`SELECT id FROM ${tables[kind]} WHERE id = ? AND team_id = ?`)
      .bind(ledger.createdId, db.teamId)
      .first();
    if (!record)
      throw new CreationError(
        'This record was created and later removed. Refresh before creating another one.',
      );
    return ledger;
  };
  const prior = await read();
  if (prior)
    return {
      id: prior.createdId,
      replay: true,
      commit: async () => prior.createdId,
    };
  return {
    id,
    replay: false,
    commit: async (statements: D1PreparedStatement[]) => {
      try {
        await db.batch([
          db
            .prepare(
              'INSERT INTO workspace_state (id,team_id,state_key,value_json,updated_at) VALUES (?,?,?,?,?)',
            )
            .bind(
              `pbcreation-${db.teamId}-${creationId}`,
              db.teamId,
              key,
              JSON.stringify({ fingerprint, kind, createdId: id }),
              new Date().toISOString(),
            ),
          ...statements,
        ]);
        return id;
      } catch (error) {
        const raced = await read();
        if (raced) return raced.createdId;
        throw error;
      }
    },
  };
}
