import { backupTables, safeMediaKey, type TeamBackup } from '@/lib/team-backup';

export class RecoveryError extends Error {}
export type RecoverySnapshot = Omit<TeamBackup, 'media'> & {
  media: (TeamBackup['media'][number] & { sha256: string })[];
};
const names = backupTables.map(([name]) => name);
const identifiers = (value: unknown) =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,199}$/i.test(value);
const sameKeys = (value: object, expected: string[]) =>
  JSON.stringify(Object.keys(value).sort()) ===
  JSON.stringify([...expected].sort());

// This deliberately has no live-workspace overwrite/merge mode. The first
// statement rechecks emptiness inside the same D1 transaction as every insert.
export async function planRecovery(
  database: D1Database,
  value: unknown,
  ownerId: string,
) {
  const snapshot = value as RecoverySnapshot | null;
  if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 200)
    throw new RecoveryError('A trusted recovery owner is required.');
  if (
    !snapshot ||
    snapshot.format !== 'chalktalk-team-backup' ||
    snapshot.version !== 1 ||
    !identifiers(snapshot.teamId) ||
    !identifiers(snapshot.id) ||
    typeof snapshot.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(snapshot.createdAt)) ||
    !snapshot.tables ||
    !sameKeys(snapshot.tables, names) ||
    !Array.isArray(snapshot.media) ||
    snapshot.media.length > 10000
  )
    throw new RecoveryError(
      'This backup does not match the supported recovery format.',
    );
  if (
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
    18 * 1024 * 1024
  )
    throw new RecoveryError(
      'The structured backup exceeds the supported recovery size.',
    );
  if (
    !Array.isArray(snapshot.tables.teams) ||
    snapshot.tables.teams.length !== 1 ||
    snapshot.tables.teams[0]?.id !== snapshot.teamId
  )
    throw new RecoveryError('Recovery requires exactly the backup’s own team.');
  const seenMedia = new Set<string>();
  let mediaBytes = 0;
  for (const file of snapshot.media) {
    if (
      !file ||
      typeof file.key !== 'string' ||
      !safeMediaKey(file.key) ||
      seenMedia.has(file.key) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > 512 * 1024 * 1024 ||
      typeof file.etag !== 'string' ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !file.etag ||
      file.etag.length > 200 ||
      typeof file.contentType !== 'string' ||
      file.contentType.length > 200 ||
      /[\r\n]/.test(file.contentType) ||
      typeof file.originalName !== 'string' ||
      file.originalName.length > 1000 ||
      !file.httpMetadata ||
      typeof file.httpMetadata !== 'object' ||
      Array.isArray(file.httpMetadata) ||
      !file.customMetadata ||
      typeof file.customMetadata !== 'object' ||
      Array.isArray(file.customMetadata) ||
      Object.values(file.customMetadata).some(
        (value) => typeof value !== 'string',
      ) ||
      new TextEncoder().encode(JSON.stringify(file.customMetadata)).byteLength >
        16384 ||
      Object.entries(file.httpMetadata).some(
        ([name, value]) =>
          ![
            'contentType',
            'contentLanguage',
            'contentDisposition',
            'contentEncoding',
            'cacheControl',
            'cacheExpiry',
          ].includes(name) ||
          typeof value !== 'string' ||
          /[\r\n]/.test(value) ||
          (name === 'cacheExpiry' && !Number.isFinite(Date.parse(value))),
      )
    )
      throw new RecoveryError(
        'A recovery file has invalid or duplicate metadata.',
      );
    seenMedia.add(file.key);
    mediaBytes += file.size;
  }
  if (
    !Number.isSafeInteger(mediaBytes) ||
    mediaBytes !== snapshot.mediaBytes ||
    !Number.isInteger(snapshot.parts) ||
    snapshot.parts < 1 ||
    snapshot.parts > 10000 ||
    snapshot.media.some(
      (file) =>
        !Number.isInteger(file.part) ||
        file.part < 1 ||
        file.part > snapshot.parts,
    )
  )
    throw new RecoveryError(
      'The backup file totals or parts are inconsistent.',
    );
  const schemas = await Promise.all(
    names.map(async (name) => {
      const columns = (
        await database
          .prepare(`PRAGMA table_info(${name})`)
          .all<{ name: string }>()
      ).results.map((column) => column.name);
      if (!columns.length)
        throw new RecoveryError(
          'The recovery destination schema is incomplete.',
        );
      return { name, columns };
    }),
  );
  const emptiness = [...names, 'workspace_owners']
    .map((name) => `EXISTS(SELECT 1 FROM ${name})`)
    .join(' OR ');
  const statements = [
    database.prepare(
      `SELECT json(CASE WHEN ${emptiness} THEN 'Recovery destination is not empty' ELSE 'null' END)`,
    ),
  ];
  let records = 0;
  for (const { name, columns } of schemas) {
    const rows = snapshot.tables[name];
    if (!Array.isArray(rows)) throw new RecoveryError('Invalid backup rows.');
    for (const row of rows) {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        !sameKeys(row, columns) ||
        ('team_id' in row && row.team_id !== snapshot.teamId)
      )
        throw new RecoveryError(
          'A backup record has invalid columns or belongs to another team.',
        );
      const values = columns.map((column) => row[column]);
      if (
        values.some(
          (value) =>
            value !== null &&
            typeof value !== 'string' &&
            (typeof value !== 'number' || !Number.isFinite(value)),
        )
      )
        throw new RecoveryError(
          'A backup record contains an unsupported value.',
        );
      for (const column of columns.filter((column) =>
        column.endsWith('_json'),
      )) {
        if (row[column] === null) continue;
        try {
          if (typeof row[column] !== 'string') throw new Error();
          JSON.parse(row[column] as string);
        } catch {
          throw new RecoveryError(
            `A saved ${name} record contains unreadable JSON.`,
          );
        }
      }
      statements.push(
        database
          .prepare(
            `INSERT INTO ${name} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
          )
          .bind(...values),
      );
      records++;
    }
  }
  statements.push(
    database
      .prepare(
        'INSERT INTO workspace_owners (user_id, team_id, created_at) VALUES (?, ?, ?)',
      )
      .bind(ownerId.trim(), snapshot.teamId, new Date().toISOString()),
  );
  // D1 enforces foreign keys during this batch. There is no deferred or disabled
  // constraint path, so a missing parent rolls the whole import back.
  return { statements, snapshot, records, mediaBytes };
}
