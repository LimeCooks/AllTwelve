import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/backup-status.ts', import.meta.url),
  'utf8',
);
const { parsePreparedBackup, readBackupStatus } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    ).toString('base64')
);
const backup = {
  id: 'prepared-job',
  createdAt: '2026-11-08T12:00:00.000Z',
  expiresAt: '2026-11-09T12:00:00.000Z',
  parts: 2,
  mediaFiles: 4,
  mediaBytes: 700000000,
  records: 12,
};
test('backup details reject malformed dates, unsafe counts and incomplete success responses', () => {
  assert.deepEqual(parsePreparedBackup(backup), backup);
  for (const value of [
    null,
    {},
    { ...backup, parts: 10002 },
    { ...backup, parts: 0 },
    { ...backup, mediaFiles: 10001 },
    { ...backup, mediaBytes: Infinity },
    { ...backup, records: -1 },
    { ...backup, createdAt: 'bad' },
    { ...backup, expiresAt: 'bad' },
    { ...backup, expiresAt: backup.createdAt },
  ])
    assert.throws(() => parsePreparedBackup(value));
});
test('backup status distinguishes no snapshot, expiry and failed reads, while using private fresh requests', async () => {
  const abort = new AbortController();
  let calls = 0;
  for (const reason of ['none', 'expired']) {
    const result = await readBackupStatus(
      abort.signal,
      async (url, options) => {
        assert.equal(url, '/api/backups?status=1');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.signal, abort.signal);
        calls++;
        return Response.json({ backup: null, reason });
      },
    );
    assert.equal(result.reason, reason);
    assert.equal(result.backup, null);
  }
  assert.equal(calls, 2);
  assert.deepEqual(
    (
      await readBackupStatus(undefined, async () =>
        Response.json({ backup, reason: 'ready' }),
      )
    ).backup,
    backup,
  );
  await assert.rejects(
    readBackupStatus(undefined, async () => Response.json({ backup: null })),
    /verified/,
  );
  await assert.rejects(
    readBackupStatus(undefined, async () =>
      Response.json({ error: 'Sign in' }, { status: 401 }),
    ),
    /Sign in/,
  );
  await assert.rejects(
    readBackupStatus(undefined, async () => {
      throw new DOMException('Aborted', 'AbortError');
    }),
    { name: 'AbortError' },
  );
});
