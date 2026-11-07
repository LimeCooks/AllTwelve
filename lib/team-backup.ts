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
