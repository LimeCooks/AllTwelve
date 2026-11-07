'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

type PreparedBackup = {
  id: string;
  createdAt: string;
  parts: number;
  mediaFiles: number;
  mediaBytes: number;
};

export function BackupControls() {
  const [backup, setBackup] = useState<PreparedBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prepare = async () => {
    setBusy(true);
    setError('');
    setBackup(null);
    try {
      const response = await fetch('/api/backups', { method: 'POST' });
      const data = (await response.json()) as PreparedBackup & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || 'Unable to prepare your backup.');
      setBackup(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to prepare your backup.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="team-backup-controls" aria-label="Complete team backup">
      <h3>Complete team backup</h3>
      <p>
        Download your team records, plays, formations, roster, and uploaded
        images and film. This keeps a recovery copy on your device.
      </p>
      <Button onClick={() => void prepare()} disabled={busy}>
        {busy
          ? 'Preparing backup…'
          : backup
            ? 'Prepare a new backup'
            : 'Prepare backup'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {backup ? (
        <div aria-live="polite">
          <p>
            Ready to download · {backup.mediaFiles} uploaded{' '}
            {backup.mediaFiles === 1 ? 'file' : 'files'}
            {backup.mediaBytes
              ? ` · ${(backup.mediaBytes / 1024 / 1024).toFixed(1)} MB`
              : ''}
          </p>
          {backup.parts > 1 ? (
            <p>
              Download all {backup.parts} parts and keep them together. Each
              part includes the team records and a share of the files.
            </p>
          ) : null}
          <div className="team-backup-downloads">
            {Array.from({ length: backup.parts }, (_, i) => (
              <a
                key={i}
                href={`/api/backups?id=${encodeURIComponent(backup.id)}&part=${i + 1}`}
                download={`chalktalk-${backup.createdAt.slice(0, 10)}-part-${i + 1}-of-${backup.parts}.zip`}
              >
                {backup.parts === 1
                  ? 'Download backup (.zip)'
                  : `Download part ${i + 1} of ${backup.parts}`}
              </a>
            ))}
          </div>
          <p>
            Check that each download finishes before leaving. Links last 24
            hours or until you prepare a new backup. If a file changes during
            download, prepare a new backup and retry. Recovery uses a separate
            empty workspace.
          </p>
        </div>
      ) : null}
    </section>
  );
}
