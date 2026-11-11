import type { TeamDatabase } from '@/lib/workspace-identity';

export class BackupError extends Error {}

// Order is also the foreign-key-safe restore order. Ownership grants are never
// exported: recovery must attach the team to an explicitly chosen account.
export const backupTables = [
  ['teams', 'SELECT * FROM teams WHERE id = ?'],
  ['athletes', 'SELECT * FROM athletes WHERE team_id = ?'],
  ['games', 'SELECT * FROM games WHERE team_id = ?'],
  ['formations', 'SELECT * FROM formations WHERE team_id = ?'],
  ['playbooks', 'SELECT * FROM playbooks WHERE team_id = ?'],
  ['plays', 'SELECT * FROM plays WHERE team_id = ?'],
  [
    'play_assignments',
    'SELECT a.* FROM play_assignments a JOIN plays p ON p.id = a.play_id WHERE p.team_id = ?',
  ],
  ['depth_charts', 'SELECT * FROM depth_charts WHERE team_id = ?'],
  [
    'depth_assignments',
    'SELECT a.* FROM depth_assignments a JOIN depth_charts d ON d.id = a.depth_chart_id WHERE d.team_id = ?',
  ],
  ['install_packages', 'SELECT * FROM install_packages WHERE team_id = ?'],
  [
    'install_items',
    'SELECT i.* FROM install_items i JOIN install_packages p ON p.id = i.package_id WHERE p.team_id = ?',
  ],
  [
    'athlete_reviews',
    'SELECT r.* FROM athlete_reviews r JOIN install_items i ON i.id = r.install_item_id JOIN install_packages p ON p.id = i.package_id WHERE p.team_id = ?',
  ],
  ['calendar_events', 'SELECT * FROM calendar_events WHERE team_id = ?'],
  ['practice_plans', 'SELECT * FROM practice_plans WHERE team_id = ?'],
  ['conversations', 'SELECT * FROM conversations WHERE team_id = ?'],
  [
    'messages',
    'SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.team_id = ?',
  ],
  ['film_assets', 'SELECT * FROM film_assets WHERE team_id = ?'],
  [
    'film_clips',
    'SELECT c.* FROM film_clips c JOIN film_assets a ON a.id = c.film_asset_id WHERE a.team_id = ?',
  ],
  ['workspace_state', 'SELECT * FROM workspace_state WHERE team_id = ?'],
] as const;

export type BackupMedia = {
  key: string;
  size: number;
  etag: string;
  part: number;
  contentType: string;
  originalName: string;
  httpMetadata: Record<string, unknown>;
  customMetadata: Record<string, string>;
};
export type TeamBackup = {
  copiedFiles?: number;
  format: 'chalktalk-team-backup';
  version: 1;
  id: string;
  createdAt: string;
  teamId: string;
  tables: Record<string, Record<string, unknown>[]>;
  media: BackupMedia[];
  parts: number;
  mediaBytes: number;
};
export const PART_BYTES = 512 * 1024 * 1024;
export const backupJobKey = (teamId: string) =>
  `_backups/${teamId}/current.json`;
export const backupCopyPrefix = (teamId: string, id: string) =>
  `_backups/${teamId}/copies/${id}/`;
export const backupArchiveKey = (teamId: string, id: string) =>
  `_backups/${teamId}/manifests/${id}.json`;

export async function advanceBackupCopy(
  bucket: R2Bucket,
  teamId: string,
  sourcePrefix: string,
  id: string,
) {
  const object = await bucket.get(backupJobKey(teamId));
  if (!object) throw new BackupError('Prepare a backup first.');
  const snapshot = await object.json<TeamBackup>();
  if (snapshot.teamId !== teamId || snapshot.id !== id)
    throw new BackupError(
      'This preparation was replaced. Refresh backup status.',
    );
  if (
    !Number.isFinite(Date.parse(snapshot.createdAt)) ||
    Date.now() - Date.parse(snapshot.createdAt) >= 86400000
  )
    throw new BackupError('This preparation expired. Prepare a new backup.');
  if (snapshot.copiedFiles === undefined)
    throw new BackupError(
      'Prepare a new backup to preserve its uploaded files.',
    );
  if (
    !Number.isInteger(snapshot.copiedFiles) ||
    snapshot.copiedFiles < 0 ||
    snapshot.copiedFiles > snapshot.media.length
  )
    throw new BackupError(
      'Backup progress could not be verified. Prepare a new backup.',
    );
  const archive = async () => {
    await bucket.put(backupArchiveKey(teamId, id), JSON.stringify(snapshot), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { overview: JSON.stringify(backupOverview(snapshot)) },
    });
  };
  if (snapshot.copiedFiles === snapshot.media.length) {
    await archive();
    return snapshot;
  }
  const end = Math.min(snapshot.media.length, snapshot.copiedFiles + 5);
  for (let index = snapshot.copiedFiles; index < end; index++) {
    const file = snapshot.media[index],
      target = backupCopyPrefix(teamId, id) + file.key;
    const existing = await bucket.head(target);
    if (
      existing?.size === file.size &&
      existing.customMetadata?.backupSourceEtag === file.etag
    )
      continue;
    const source = await bucket.get(sourcePrefix + file.key, {
      onlyIf: { etagMatches: file.etag },
    });
    if (!source || !('body' in source) || !source.body)
      throw new BackupError(
        'An upload changed before it was preserved. Prepare a new backup; incomplete copies are not downloadable.',
      );
    const fixed = new FixedLengthStream(file.size);
    await bucket.put(target, source.body.pipeThrough(fixed), {
      httpMetadata: { contentType: file.contentType },
      customMetadata: { backupSourceEtag: file.etag },
    });
  }
  snapshot.copiedFiles = end;
  if (end === snapshot.media.length) await archive();
  const saved = await bucket.put(
    backupJobKey(teamId),
    JSON.stringify(snapshot),
    {
      onlyIf: { etagMatches: object.etag },
      httpMetadata: { contentType: 'application/json' },
    },
  );
  if (!saved)
    throw new BackupError(
      'Backup preparation changed in another tab. Refresh backup status to continue.',
    );
  return snapshot;
}
export const safeMediaKey = (key: string) =>
  /^[a-z0-9][a-z0-9._/-]{0,159}$/i.test(key) &&
  key.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

export async function createTeamBackup(
  database: TeamDatabase,
  bucket: R2Bucket,
  prefix: string,
  legacyPrototype = false,
): Promise<TeamBackup> {
  // The older prototype stores its conversations inside workspace_state and
  // never created these two relational tables. Preserve that JSON as-is.
  const legacyNames = legacyPrototype
    ? new Set(
        (
          await database
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('conversations','messages')",
            )
            .all<{ name: string }>()
        ).results.map((r) => r.name),
      )
    : null;
  // D1 batch executes these reads in one transaction, rather than collecting
  // unrelated point-in-time reads while records can be changing.
  const results = await database.batch<Record<string, unknown>>(
    backupTables.map(([name, sql]) =>
      database
        .prepare(
          legacyNames &&
            (name === 'conversations' || name === 'messages') &&
            !legacyNames.has(name)
            ? 'SELECT NULL AS unused WHERE ? IS NULL'
            : sql,
        )
        .bind(database.teamId),
    ),
  );
  const tables = Object.fromEntries(
    backupTables.map(([name], i) => [name, results[i].results ?? []]),
  );
  if (tables.teams.length !== 1)
    throw new BackupError('Your team could not be found.');
  const media: BackupMedia[] = [];
  let cursor: string | undefined,
    part = 1,
    partBytes = 0,
    mediaBytes = 0;
  do {
    const options: R2ListOptions & { include: string[] } = {
      prefix,
      cursor,
      limit: 500,
      include: ['httpMetadata', 'customMetadata'],
    };
    const page = await bucket.list(options);
    for (const object of page.objects) {
      if (object.key.startsWith('_backups/')) continue;
      const key = object.key.slice(prefix.length);
      if (!safeMediaKey(key))
        throw new BackupError(
          'An uploaded file has an unsupported name. Contact support before exporting.',
        );
      if (object.size > PART_BYTES)
        throw new BackupError(
          'An uploaded file exceeds the supported backup part size.',
        );
      if (partBytes && partBytes + object.size > PART_BYTES) {
        part++;
        partBytes = 0;
      }
      partBytes += object.size;
      mediaBytes += object.size;
      media.push({
        key,
        size: object.size,
        etag: object.etag,
        part,
        contentType:
          object.httpMetadata?.contentType ?? 'application/octet-stream',
        originalName: object.customMetadata?.originalName ?? key,
        httpMetadata: JSON.parse(
          JSON.stringify(object.httpMetadata ?? {}),
        ) as Record<string, unknown>,
        customMetadata: object.customMetadata ?? {},
      });
      if (media.length > 10000)
        throw new BackupError(
          'This workspace needs an assisted backup because it contains more than 10,000 uploaded files.',
        );
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const available = new Set(media.map((m) => m.key));
  if (
    tables.film_assets.some(
      (asset) =>
        typeof asset.storage_key === 'string' &&
        asset.storage_key &&
        !available.has(asset.storage_key),
    )
  )
    throw new BackupError(
      'A saved film file is missing. A complete backup cannot be created until it is recovered or the stale film record is removed.',
    );
  const snapshot: TeamBackup = {
    format: 'chalktalk-team-backup',
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    teamId: database.teamId,
    tables,
    media,
    parts: part,
    mediaBytes,
  };
  if (
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
    16 * 1024 * 1024
  )
    throw new BackupError(
      'This workspace needs an assisted backup because its records exceed 16 MB.',
    );
  return snapshot;
}

export const backupOverview = (snapshot: TeamBackup) => ({
  retainedHistory: true,
  copiedFiles: snapshot.copiedFiles,
  preserved: snapshot.copiedFiles !== undefined,
  state:
    snapshot.copiedFiles !== undefined &&
    snapshot.copiedFiles < snapshot.media.length
      ? 'copying'
      : 'ready',
  id: snapshot.id,
  createdAt: snapshot.createdAt,
  expiresAt: new Date(
    Date.parse(snapshot.createdAt) + 24 * 60 * 60 * 1000,
  ).toISOString(),
  parts: snapshot.parts,
  mediaBytes: snapshot.mediaBytes,
  mediaFiles: snapshot.media.length,
  records: Object.values(snapshot.tables).reduce(
    (n, rows) => n + rows.length,
    0,
  ),
});

export async function listBackupHistory(
  bucket: R2Bucket,
  teamId: string,
  cursor?: string,
) {
  if (cursor && cursor.length > 4096)
    throw new BackupError(
      'The backup history page could not be read. Refresh history.',
    );
  const prefix = `_backups/${teamId}/manifests/`;
  const page = await bucket.list({
    prefix,
    cursor,
    limit: 20,
    include: ['customMetadata'],
  } as R2ListOptions);
  const backups: ReturnType<typeof backupOverview>[] = [];
  for (const object of page.objects) {
    const id = object.key.slice(prefix.length).replace(/\.json$/, '');
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id,
      )
    )
      throw new BackupError('A saved backup record could not be verified.');
    let overview: ReturnType<typeof backupOverview>;
    if (object.customMetadata?.overview)
      overview = JSON.parse(object.customMetadata.overview);
    else {
      const saved = await bucket.get(object.key);
      if (!saved)
        throw new BackupError('Backup history changed. Refresh to continue.');
      const snapshot = await saved.json<TeamBackup>();
      if (
        snapshot.teamId !== teamId ||
        snapshot.id !== id ||
        snapshot.copiedFiles !== snapshot.media.length
      )
        throw new BackupError('A saved backup record could not be verified.');
      overview = backupOverview(snapshot);
    }
    if (overview.id !== id || overview.state !== 'ready' || !overview.preserved)
      throw new BackupError('A saved backup record could not be verified.');
    backups.push(overview);
  }
  return {
    backups: backups.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    ),
    cursor: page.truncated ? page.cursor : null,
  };
}
