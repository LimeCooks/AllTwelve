import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
export type PreparedBackup = {
  state?: 'copying' | 'ready';
  preserved?: boolean;
  copiedFiles?: number;
  id: string;
  createdAt: string;
  expiresAt: string;
  parts: number;
  mediaFiles: number;
  mediaBytes: number;
  records: number;
};
export function parsePreparedBackup(value: unknown): PreparedBackup {
  const data = value as PreparedBackup | null;
  const integer = (number: unknown) =>
    typeof number === 'number' && Number.isSafeInteger(number) && number >= 0;
  if (
    !data ||
    typeof data.id !== 'string' ||
    !data.id ||
    data.id.length > 100 ||
    typeof data.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    typeof data.expiresAt !== 'string' ||
    Date.parse(data.expiresAt) !== Date.parse(data.createdAt) + 86400000 ||
    !integer(data.parts) ||
    data.parts < 1 ||
    data.parts > 10001 ||
    !integer(data.mediaFiles) ||
    data.mediaFiles > 10000 ||
    !integer(data.mediaBytes) ||
    !integer(data.records) ||
    (data.state !== undefined && !['copying', 'ready'].includes(data.state)) ||
    (data.preserved !== undefined && typeof data.preserved !== 'boolean') ||
    (data.preserved === true &&
      (!data.state ||
        !integer(data.copiedFiles) ||
        data.copiedFiles! > data.mediaFiles ||
        (data.state === 'ready' && data.copiedFiles !== data.mediaFiles) ||
        (data.state === 'copying' && data.copiedFiles === data.mediaFiles)))
  )
    throw new Error(
      'The prepared backup details were incomplete. Refresh backup status before downloading.',
    );
  return data;
}
export async function readBackupStatus(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('/api/backups?status=1', {
    cache: 'no-store',
    signal,
  });
  const value = (await response.json()) as {
    error?: unknown;
    backup?: unknown;
    reason?: unknown;
  } | null;
  if (!response.ok)
    throw new Error(
      typeof value?.error === 'string'
        ? value.error
        : 'Backup status could not be loaded.',
    );
  if (
    value?.backup === null &&
    (value.reason === 'none' || value.reason === 'expired')
  )
    return { backup: null, reason: value.reason as 'none' | 'expired' };
  if (value?.reason !== 'ready')
    throw new Error('Backup status could not be verified. Retry to continue.');
  return {
    backup: parsePreparedBackup(value.backup),
    reason: 'ready' as const,
  };
}

export async function readBackupHistory(
  cursor?: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    '/api/backups?history=1' +
      (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    { cache: 'no-store', signal },
  );
  const value = (await response.json()) as {
    error?: unknown;
    backups?: unknown;
    cursor?: unknown;
  } | null;
  if (!response.ok)
    throw new Error(
      typeof value?.error === 'string'
        ? value.error
        : 'Saved backups could not be loaded.',
    );
  if (
    !Array.isArray(value?.backups) ||
    value.backups.length > 20 ||
    (value.cursor !== null && typeof value.cursor !== 'string')
  )
    throw new Error(
      'Backup history was incomplete. Refresh before downloading.',
    );
  const backups = value.backups.map(parsePreparedBackup);
  if (
    backups.some(
      (backup) => backup.state !== 'ready' || backup.preserved !== true,
    ) ||
    new Set(backups.map((backup) => backup.id)).size !== backups.length
  )
    throw new Error('Saved backup details could not be verified.');
  return { backups, cursor: value.cursor as string | null };
}
