'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { readBackupHistory, type PreparedBackup } from '@/lib/backup-status';

export function BackupHistory() {
  const [backups, setBackups] = useState<PreparedBackup[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    sequence = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );
  const load = async (reset = false) => {
    if (lock.current) return;
    lock.current = true;
    const ticket = ++sequence.current,
      request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    try {
      const result = await readBackupHistory(
        reset ? undefined : (cursor ?? undefined),
        request.signal,
      );
      if (ticket !== sequence.current) return;
      if (!reset && result.cursor && result.cursor === cursor)
        throw new Error('Backup history did not advance. Refresh to continue.');
      setBackups((previous) =>
        [
          ...new Map(
            [...(reset ? [] : previous), ...result.backups].map((backup) => [
              backup.id,
              backup,
            ]),
          ).values(),
        ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      );
      setCursor(result.cursor);
      setLoaded(true);
    } catch (failure) {
      if (ticket === sequence.current && !request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Saved backups could not be loaded.',
        );
    } finally {
      if (ticket === sequence.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <details
      className="backup-history"
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded && !lock.current)
          void load(true);
      }}
    >
      <summary>Saved backup history</summary>
      <p>
        These completed recovery copies remain available when you prepare
        another backup. Download every part of the snapshot you choose. Recovery
        uses a separate empty workspace.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void load(true)}>
        Refresh saved backups
      </Button>
      {busy ? <p role="status">Loading saved backups…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {loaded && !backups.length && !error ? (
        <p>
          No saved backups yet. Prepare a complete backup to add the first one.
        </p>
      ) : null}
      <ul>
        {backups.map((backup) => (
          <li key={backup.id}>
            <strong>{new Date(backup.createdAt).toLocaleString()}</strong>
            <p>
              {backup.records} records · {backup.mediaFiles} uploaded{' '}
              {backup.mediaFiles === 1 ? 'file' : 'files'} · {backup.parts}{' '}
              {backup.parts === 1 ? 'part' : 'parts'}
            </p>
            <div className="team-backup-downloads">
              {Array.from({ length: backup.parts }, (_, index) => (
                <a
                  key={index}
                  href={`/api/backups?archiveId=${encodeURIComponent(backup.id)}&part=${index + 1}`}
                  download={`alltwelve-${backup.createdAt.slice(0, 10)}-${backup.id.slice(0, 8)}-part-${index + 1}.zip`}
                >
                  {backup.parts === 1
                    ? 'Download recovery copy (.zip)'
                    : `Download part ${index + 1} of ${backup.parts}`}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {cursor ? (
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          Load more saved backups
        </Button>
      ) : null}
      <p>
        Backups are currently manual. Automatic schedules and storage cleanup
        are not enabled.
      </p>
    </details>
  );
}
