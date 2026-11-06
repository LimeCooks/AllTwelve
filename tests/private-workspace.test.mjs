import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
const objects = new Map();
globalThis.privateTestBucket = {
  async put(key, body, options) {
    objects.set(key, {
      bytes: await new Response(body).arrayBuffer(),
      options,
    });
  },
  async get(key) {
    const object = objects.get(key);
    return object
      ? {
          body: object.bytes,
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
};
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
