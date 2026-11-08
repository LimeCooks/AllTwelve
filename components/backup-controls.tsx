'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  parsePreparedBackup,
  readBackupStatus,
  type PreparedBackup,
} from '@/lib/backup-status';

export function BackupControls() {
  const [backup, setBackup] = useState<PreparedBackup | null>(null);
  const [busy, setBusy] = useState(true);
  const [known, setKnown] = useState(false);
  const [expiredNotice, setExpiredNotice] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const operation = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = async () => {
    if (operation.current) return;
    operation.current = true;
    const ticket = ++sequence.current,
      request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    try {
      const result = await readBackupStatus(request.signal);
      if (ticket !== sequence.current) return;
      setBackup(result.backup);
      setExpiredNotice(result.reason === 'expired');
      setKnown(true);
    } catch (failure) {
      if (ticket === sequence.current && !request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Backup status could not be loaded.',
        );
    } finally {
      if (ticket === sequence.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
      controller.current?.abort();
      operation.current = false;
    };
  }, []);
  useEffect(() => {
    setClock(Date.now());
    if (!backup) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.max(0, Date.parse(backup.expiresAt) - Date.now()) + 20,
    );
    return () => window.clearTimeout(timer);
  }, [backup]);
  const prepare = async () => {
    if (operation.current || !known) return;
    operation.current = true;
    const ticket = ++sequence.current,
      request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    setBackup(null);
    setExpiredNotice(false);
    try {
      const response = await fetch('/api/backups', {
        method: 'POST',
        signal: request.signal,
      });
      const data = (await response.json()) as { error?: unknown } | null;
      if (!response.ok)
        throw new Error(
          typeof data?.error === 'string'
            ? data.error
            : 'Unable to prepare your backup.',
        );
      const prepared = parsePreparedBackup(data);
      if (ticket === sequence.current) setBackup(prepared);
    } catch (failure) {
      if (ticket === sequence.current && !request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Unable to prepare your backup.',
        );
    } finally {
      if (ticket === sequence.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  };
  const expired =
    expiredNotice || Boolean(backup && Date.parse(backup.expiresAt) <= clock);
  return (
    <section
      className="team-backup-controls"
      aria-label="Complete team backup"
      aria-busy={busy}
    >
      <h3>Complete team backup</h3>
      <p>
        Download your team records, plays, formations, roster, and uploaded
        images and film. Keep every ZIP part together as a recovery copy on your
        device.
      </p>
      <Button onClick={() => void prepare()} disabled={busy || !known}>
        {busy
          ? 'Checking or preparing backup…'
          : backup || expired
            ? 'Prepare a new backup'
            : 'Prepare backup'}
      </Button>
      <Button variant="outline" onClick={() => void load()} disabled={busy}>
        Refresh backup status
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {expired ? (
        <p role="status">
          The prepared backup has expired. Prepare a new one to download a
          current recovery copy.
        </p>
      ) : null}
      {!busy && known && !backup && !expired && !error ? (
        <p>
          No prepared backup. Backups are manual; preparing one does not mean it
          has been downloaded.
        </p>
      ) : null}
      {backup && !expired ? (
        <div aria-live="polite">
          <p>
            Prepared {new Date(backup.createdAt).toLocaleString()} ·{' '}
            {backup.records} records · {backup.mediaFiles} uploaded{' '}
            {backup.mediaFiles === 1 ? 'file' : 'files'}
            {backup.mediaBytes
              ? ` · ${(backup.mediaBytes / 1024 / 1024).toFixed(1)} MB`
              : ''}
          </p>
          <p>
            Download links expire {new Date(backup.expiresAt).toLocaleString()}.
            You can return here on another device using the same account.
          </p>
          {backup.parts > 1 ? (
            <p>
              Download all {backup.parts} parts. Each includes team records and
              a share of the files.
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
            Check that every download finishes. Preparing another backup
            replaces these links. If files changed, prepare again. Recovery uses
            a separate empty workspace; there is no in-place restore here.
          </p>
        </div>
      ) : null}
    </section>
  );
}
