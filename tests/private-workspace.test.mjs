import assert from 'node:assert/strict';
import {
  readFile,
  readdir,
  mkdtemp,
  writeFile,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { restoreBackup } from '../scripts/restore-backup.mjs';
import { unzipSync } from 'fflate';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
// Use exactly the checked-in SQL chain, without request-time prototype setup.
for (const name of (await readdir(new URL('../drizzle/', import.meta.url)))
  .filter((n) => n.endsWith('.sql'))
  .sort()) {
  sqlite.exec(
    await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'),
  );
}
const database = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      async first() {
        return statement.get(...values) ?? null;
      },
      async all() {
        return { results: statement.all(...values) };
      },
      async run() {
        if (/^\s*SELECT\b/i.test(sql))
          return { results: statement.all(...values) };
        return statement.run(...values);
      },
    };
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const result = [];
      for (const s of statements) result.push(await s.run());
      sqlite.exec('COMMIT');
      return result;
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  },
};
globalThis.privateTestDatabase = database;
globalThis.privateTestIdentity = null;
const moduleUrl = async (path, replacements = []) => {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
  return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
};
const identityUrl = await moduleUrl('../lib/workspace-identity.ts');
const requestUrl = `data:text/javascript;base64,${Buffer.from(`import { WorkspaceAccessError } from ${JSON.stringify(identityUrl)}; export const isPrototype = () => false; export const requestIdentity = async () => { if (!globalThis.privateTestIdentity) throw new WorkspaceAccessError('Sign in',401); return globalThis.privateTestIdentity; };`).toString('base64')}`;
const dbUrl = await moduleUrl('../db/client.ts', [
  [
    "import { env } from 'cloudflare:workers';",
    'const env = { DB: globalThis.privateTestDatabase };',
  ],
  ["'@/lib/request-identity'", JSON.stringify(requestUrl)],
  ["'@/lib/workspace-identity'", JSON.stringify(identityUrl)],
]);
const replacements = [
  ["'@/db/client'", JSON.stringify(dbUrl)],
  ["'@/lib/request-identity'", JSON.stringify(requestUrl)],
  ["'@/lib/workspace-identity'", JSON.stringify(identityUrl)],
  [
    "'@/lib/validate-play'",
    JSON.stringify(await moduleUrl('../lib/validate-play.ts')),
  ],
  [
    "'@/lib/play-designer'",
    JSON.stringify(await moduleUrl('../lib/play-designer.ts')),
  ],
];
const session = await import(
  await moduleUrl('../app/api/session/route.ts', replacements)
);
const onboarding = await import(
  await moduleUrl('../app/api/onboarding/route.ts', replacements)
);
const playbooks = await import(
  await moduleUrl('../app/api/playbooks/route.ts', replacements)
);
const { getDatabase } = await import(dbUrl);
const { identityFromHeaders } = await import(identityUrl);
const workspaceState = await import(
  await moduleUrl('../app/api/workspace-state/route.ts', [
    [
      "import { NextRequest, NextResponse } from 'next/server';",
      'const NextResponse = { json: (body, init) => Response.json(body, init) };',
    ],
    ...replacements,
  ])
);
const objects = new Map();
globalThis.privateTestBucket = {
  async put(key, body, options) {
    objects.set(key, {
      bytes: await new Response(body).arrayBuffer(),
      options,
    });
  },
  async get(key, options) {
    const object = objects.get(key);
    if (
      object &&
      options?.onlyIf?.etagMatches &&
      options.onlyIf.etagMatches !==
        createHash('md5').update(new Uint8Array(object.bytes)).digest('hex')
    )
      return {};
    return object
      ? {
          body: new Response(object.bytes).body,
          async json() {
            return JSON.parse(new TextDecoder().decode(object.bytes));
          },
          httpEtag: 'test-etag',
          writeHttpMetadata(headers) {
            headers.set(
              'content-type',
              object.options.httpMetadata.contentType,
            );
          },
        }
      : null;
  },
  async delete(key) {
    objects.delete(key);
  },
  async list({ prefix = '', cursor = '' } = {}) {
    const matches = [...objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b));
    const index = Number(cursor || 0),
      selected = matches.slice(index, index + 1);
    return {
      objects: selected.map(([key, object]) => ({
        key,
        size: object.bytes.byteLength,
        etag: createHash('md5')
          .update(new Uint8Array(object.bytes))
          .digest('hex'),
        httpMetadata: object.options?.httpMetadata,
        customMetadata: object.options?.customMetadata,
      })),
      truncated: index + 1 < matches.length,
      cursor: String(index + 1),
    };
  },
};
const backupUrl = await moduleUrl('../lib/team-backup.ts');
const zipUrl = await moduleUrl('../lib/backup-zip.ts', [
  ["'fflate'", JSON.stringify(import.meta.resolve('fflate'))],
]);
const backups = await import(
  await moduleUrl('../app/api/backups/route.ts', [
    [
      "import { env } from 'cloudflare:workers';",
      'const env = { MEDIA: globalThis.privateTestBucket };',
    ],
    ["'@/lib/team-backup'", JSON.stringify(backupUrl)],
    ["'@/lib/backup-zip'", JSON.stringify(zipUrl)],
    ...replacements,
  ])
);
const { backupTables, createTeamBackup, backupJobKey } = await import(
  backupUrl
);
const { backupZip } = await import(zipUrl);
const media = await import(
  await moduleUrl('../app/api/media/route.ts', [
    [
      "import { env } from 'cloudflare:workers';",
      'const env = { MEDIA: globalThis.privateTestBucket };',
    ],
    ...replacements,
  ])
);
const request = (body) =>
  new Request('https://pilot.test/api/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('fresh hosted migration chain is empty, identity required, owners receive isolated blank teams', async () => {
  for (const table of [
    'teams',
    'athletes',
    'games',
    'plays',
    'playbooks',
    'formations',
    'install_packages',
    'film_assets',
    'calendar_events',
    'messages',
  ])
    assert.equal(
      sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
      0,
      table,
    );
  assert.equal((await session.GET()).status, 401);
  assert.equal(
    (await onboarding.POST(request({ name: 'No identity', season: '2026' })))
      .status,
    401,
  );
  await assert.rejects(getDatabase, (err) => err.status === 401);
  assert.equal(identityFromHeaders(new Headers()), null);
  assert.equal(
    identityFromHeaders(
      new Headers({
        'oai-authenticated-user-id': 'a',
        'oai-authenticated-user-full-name': 'Liam%20M',
        'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
      }),
    ).name,
    'Liam M',
  );
  globalThis.privateTestIdentity = {
    id: 'owner-a',
    name: 'Coach A',
    email: 'a@example.test',
  };
  assert.equal((await (await session.GET()).json()).team, null);
  await assert.rejects(getDatabase, (err) => err.status === 409);
  assert.equal(
    (await onboarding.POST(request({ name: '', season: 'bad' }))).status,
    400,
  );
  assert.equal(
    (await onboarding.POST(request({ name: 'Team A', season: '2026' }))).status,
    201,
  );
  const a = await getDatabase();
  assert.equal(
    (await onboarding.POST(request({ name: 'Duplicate', season: '2026' })))
      .status,
    409,
  );
  assert.equal((await (await playbooks.GET()).json()).books.length, 0);
  const created = await playbooks.POST(
    request({ kind: 'book', name: 'A defence', side: 'Defence' }),
  );
  assert.equal(created.status, 201);
  const bookId = (await created.json()).createdId;
  globalThis.privateTestIdentity = {
    id: 'owner-b',
    name: 'Coach B',
    email: 'b@example.test',
  };
  assert.equal(
    (await onboarding.POST(request({ name: 'Team B', season: '2026' }))).status,
    201,
  );
  const b = await getDatabase();
  assert.notEqual(a.teamId, b.teamId);
  assert.equal(
    a.teamId,
    sqlite
      .prepare('SELECT team_id FROM workspace_owners WHERE user_id = ?')
      .get('owner-a').team_id,
    'request A context must not change after request B',
  );
  assert.equal((await (await playbooks.GET()).json()).books.length, 0);
  const changed = await playbooks.PUT(
    request({ kind: 'book', id: bookId, name: 'Stolen name', side: 'Defence' }),
  );
  assert.ok(changed.status >= 400);
  globalThis.privateTestIdentity = {
    id: 'owner-a',
    name: 'Coach A',
    email: 'a@example.test',
  };
  assert.equal(
    (await (await playbooks.GET()).json()).books[0].name,
    'A defence',
  );
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM teams').get().n, 2);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM athletes').get().n, 0);
});

test('profile updates remain team-scoped and update the next signed-in session', async () => {
  globalThis.privateTestIdentity = {
    id: 'owner-a',
    name: 'Coach A',
    email: 'a@example.test',
  };
  const saved = await workspaceState.PUT(
    request({
      key: 'team-settings',
      value: { teamName: 'Renamed Team A', season: '2027' },
    }),
  );
  assert.equal(saved.status, 200);
  assert.equal(
    (await (await session.GET()).json()).team.name,
    'Renamed Team A',
  );
  const invalid = await workspaceState.PUT(
    request({ key: 'team-settings', value: { teamName: '', season: 'oops' } }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(
    (await (await session.GET()).json()).team.name,
    'Renamed Team A',
  );
  globalThis.privateTestIdentity = {
    id: 'owner-b',
    name: 'Coach B',
    email: 'b@example.test',
  };
  const getRequest = new Request(
    'https://pilot.test/api/workspace-state?key=team-settings',
  );
  Object.assign(getRequest, { nextUrl: new URL(getRequest.url) });
  assert.equal(
    (await (await workspaceState.GET(getRequest)).json()).value.teamName,
    'Team B',
  );
  assert.equal((await (await session.GET()).json()).team.name, 'Team B');
  globalThis.privateTestIdentity = null;
  assert.equal((await workspaceState.GET(getRequest)).status, 401);
  assert.equal(
    (
      await workspaceState.PUT(
        request({
          key: 'team-settings',
          value: { teamName: 'No access', season: '2027' },
        }),
      )
    ).status,
    401,
  );
});

test('same media key is isolated per team and anonymous media access is rejected', async () => {
  const url = 'https://pilot.test/api/media?key=team-logo';
  const alice = { id: 'owner-a', name: 'Coach A', email: 'a@example.test' },
    bob = { id: 'owner-b', name: 'Coach B', email: 'b@example.test' };
  const upload = (text) => {
    const form = new FormData();
    form.set('file', new File([text], 'logo.png', { type: 'image/png' }));
    return new Request(url, { method: 'POST', body: form });
  };
  globalThis.privateTestIdentity = alice;
  assert.equal((await media.POST(upload('A logo'))).status, 200);
  globalThis.privateTestIdentity = bob;
  assert.equal((await media.GET(new Request(url))).status, 404);
  assert.equal((await media.POST(upload('B logo'))).status, 200);
  assert.equal(await (await media.GET(new Request(url))).text(), 'B logo');
  await media.DELETE(new Request(url, { method: 'DELETE' }));
  globalThis.privateTestIdentity = alice;
  assert.equal(await (await media.GET(new Request(url))).text(), 'A logo');
  globalThis.privateTestIdentity = null;
  assert.equal((await media.GET(new Request(url))).status, 401);
  assert.equal((await media.POST(upload('intrusion'))).status, 401);
  assert.equal(
    (await media.DELETE(new Request(url, { method: 'DELETE' }))).status,
    401,
  );
});

test('complete backup restores all team tables and file bytes offline without touching another owner', async () => {
  globalThis.privateTestIdentity = {
    id: 'owner-a',
    name: 'Coach A',
    email: 'a@example.test',
  };
  const scoped = await getDatabase(),
    ids = new Map([['teams', scoped.teamId]]);
  for (const [table, sql] of backupTables) {
    if (table === 'teams') continue;
    const existing = sqlite.prepare(sql).get(scoped.teamId);
    if (existing) {
      ids.set(table, existing.id);
      continue;
    }
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    const references = new Map(
      sqlite
        .prepare(`PRAGMA foreign_key_list(${table})`)
        .all()
        .map((fk) => [fk.from, ids.get(fk.table)]),
    );
    const row = Object.fromEntries(
      columns.map((col) => [
        col.name,
        col.name === 'id'
          ? `backup-fixture-${table}`
          : col.name === 'team_id'
            ? scoped.teamId
            : references.has(col.name)
              ? references.get(col.name)
              : col.name === 'storage_key'
                ? 'film-backup'
                : col.name.endsWith('_json')
                  ? JSON.stringify({
                      fixture: table,
                      note: 'Recovery must preserve this JSON exactly.',
                    })
                  : /INT|REAL/.test(col.type)
                    ? 1
                    : `fixture-${col.name}`,
      ]),
    );
    sqlite
      .prepare(
        `INSERT INTO ${table} (${columns.map((c) => c.name).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      )
      .run(...columns.map((c) => row[c.name]));
    ids.set(table, row.id);
  }
  await globalThis.privateTestBucket.put(
    `teams/${scoped.teamId}/film-backup`,
    'real film bytes for recovery',
    {
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: { originalName: 'Practice.mp4' },
    },
  );
  await globalThis.privateTestBucket.put(
    'teams/some-other-team/private-film',
    'NEVER EXPORT',
    { httpMetadata: { contentType: 'video/mp4' } },
  );
  const prepared = await backups.POST();
  assert.equal(prepared.status, 200, await prepared.clone().text());
  const job = await prepared.json();
  assert.equal(job.mediaFiles, 2);
  const response = await backups.GET(
    new Request(`https://pilot.test/api/backups?id=${job.id}&part=1`),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  const bytes = new Uint8Array(await response.arrayBuffer()),
    files = unzipSync(bytes);
  const snapshot = JSON.parse(
    new TextDecoder().decode(files['chalktalk-backup.json']),
  );
  assert.equal(snapshot.tables.teams.length, 1);
  assert.equal(snapshot.tables.teams[0].id, scoped.teamId);
  assert.equal('workspace_owners' in snapshot.tables, false);
  for (const [table] of backupTables)
    assert.ok(
      snapshot.tables[table].length > 0,
      `${table} must be covered by recovery`,
    );
  assert.equal(
    new TextDecoder().decode(files['media/film-backup']),
    'real film bytes for recovery',
  );
  assert.equal(files['media/private-film'], undefined);
  const directory = await mkdtemp(
    path.join(tmpdir(), 'chalktalk-backup-test-'),
  );
  const archive = path.join(directory, 'backup.zip');
  await writeFile(archive, bytes);
  const output = path.join(directory, 'recovered');
  await restoreBackup({
    archives: [archive],
    output,
    ownerId: 'recovery-owner',
  });
  const recovered = new DatabaseSync(path.join(output, 'workspace.sqlite'));
  for (const [table] of backupTables) {
    const rows = recovered
      .prepare(`SELECT * FROM ${table} ORDER BY id`)
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(
      rows,
      [...snapshot.tables[table]].sort((a, b) => a.id.localeCompare(b.id)),
      table,
    );
  }
  assert.equal(
    recovered.prepare('SELECT user_id FROM workspace_owners').get().user_id,
    'recovery-owner',
  );
  assert.equal(recovered.prepare('PRAGMA foreign_key_check').all().length, 0);
  recovered.close();
  assert.equal(
    await readFile(path.join(output, 'media', 'film-backup'), 'utf8'),
    'real film bytes for recovery',
  );
  await assert.rejects(access(path.join(output, 'RESTORE_INCOMPLETE.txt')));
  await assert.rejects(
    restoreBackup({ archives: [archive], output, ownerId: 'overwrite' }),
    /already exists/,
  );
  const multi = {
    ...snapshot,
    parts: 2,
    media: snapshot.media.map((m, i) => ({ ...m, part: i + 1 })),
  };
  const partNames = [];
  for (const part of [1, 2]) {
    const filename = path.join(directory, `part-${part}.zip`);
    await writeFile(
      filename,
      new Uint8Array(
        await new Response(
          backupZip(
            multi,
            part,
            globalThis.privateTestBucket,
            `teams/${scoped.teamId}/`,
          ),
        ).arrayBuffer(),
      ),
    );
    partNames.push(filename);
  }
  await assert.rejects(
    restoreBackup({
      archives: [partNames[0]],
      output: path.join(directory, 'missing-part'),
      ownerId: 'recovery-owner',
    }),
    /Not all backup parts/,
  );
  await assert.rejects(
    restoreBackup({
      archives: [partNames[0], partNames[0]],
      output: path.join(directory, 'duplicate-part'),
      ownerId: 'recovery-owner',
    }),
    /same backup part/,
  );
  const multiOutput = path.join(directory, 'multipart-recovery');
  assert.equal(
    (
      await restoreBackup({
        archives: partNames.reverse(),
        output: multiOutput,
        ownerId: 'recovery-owner',
      })
    ).mediaFiles,
    2,
  );
  const recoveredMetadata = JSON.parse(
    await readFile(path.join(multiOutput, 'recovery.json'), 'utf8'),
  );
  assert.equal(
    recoveredMetadata.media.find((m) => m.key === 'film-backup').customMetadata
      .originalName,
    'Practice.mp4',
  );
  const corrupted = bytes.slice(),
    location = Buffer.from(corrupted).indexOf(
      Buffer.from('real film bytes for recovery'),
    );
  assert.ok(location > 0);
  corrupted[location] ^= 1;
  const damaged = path.join(directory, 'damaged.zip');
  await writeFile(damaged, corrupted);
  await assert.rejects(
    restoreBackup({
      archives: [damaged],
      output: path.join(directory, 'damaged-output'),
      ownerId: 'recovery-owner',
    }),
    /integrity check/,
  );
  const largePlan = await createTeamBackup(
    scoped,
    {
      ...globalThis.privateTestBucket,
      async list(options) {
        const page = await globalThis.privateTestBucket.list(options);
        return {
          ...page,
          objects: page.objects.map((o) => ({ ...o, size: 300 * 1024 * 1024 })),
        };
      },
    },
    `teams/${scoped.teamId}/`,
  );
  assert.equal(
    largePlan.parts,
    2,
    'large libraries are split without allocating the film in memory',
  );
  assert.equal(
    (
      await backups.GET(
        new Request(`https://pilot.test/api/backups?id=${job.id}&part=99`),
      )
    ).status,
    400,
  );
  await globalThis.privateTestBucket.put(
    `teams/${scoped.teamId}/film-backup`,
    'changed after snapshot',
    { httpMetadata: { contentType: 'video/mp4' } },
  );
  const changed = await backups.GET(
    new Request(`https://pilot.test/api/backups?id=${job.id}&part=1`),
  );
  await assert.rejects(changed.arrayBuffer(), /changed|removed/);
  const next = await backups.POST();
  assert.equal(next.status, 200);
  assert.equal(
    (
      await backups.GET(
        new Request(`https://pilot.test/api/backups?id=${job.id}&part=1`),
      )
    ).status,
    409,
  );
  const nextJob = await next.json();
  const storedJob = await (
    await globalThis.privateTestBucket.get(backupJobKey(scoped.teamId))
  ).json();
  storedJob.createdAt = '2000-01-01T00:00:00.000Z';
  await globalThis.privateTestBucket.put(
    backupJobKey(scoped.teamId),
    JSON.stringify(storedJob),
    { httpMetadata: { contentType: 'application/json' } },
  );
  assert.equal(
    (
      await backups.GET(
        new Request(`https://pilot.test/api/backups?id=${nextJob.id}&part=1`),
      )
    ).status,
    409,
  );
  await globalThis.privateTestBucket.delete(
    `teams/${scoped.teamId}/film-backup`,
  );
  assert.equal(
    (await backups.POST()).status,
    400,
    'missing film must not silently produce an incomplete backup',
  );
  globalThis.privateTestIdentity = {
    id: 'owner-b',
    name: 'Coach B',
    email: 'b@example.test',
  };
  assert.equal(
    (
      await backups.GET(
        new Request(`https://pilot.test/api/backups?id=${job.id}&part=1`),
      )
    ).status,
    404,
  );
  globalThis.privateTestIdentity = null;
  assert.equal((await backups.POST()).status, 401);
  assert.equal(
    (await backups.GET(new Request('https://pilot.test/api/backups?part=1')))
      .status,
    401,
  );
});
