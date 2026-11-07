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
  [
    "'@/lib/depth-layout'",
    JSON.stringify(await moduleUrl('../lib/depth-layout.ts')),
  ],
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
const athletesApi = await import(
  await moduleUrl('../app/api/athletes/route.ts', replacements)
);
const calendarEvents = await import(
  await moduleUrl('../app/api/calendar-events/route.ts', replacements)
);
const sideline = await import(
  await moduleUrl('../app/api/sideline/route.ts', replacements)
);
const depthCharts = await import(
  await moduleUrl('../app/api/depth-charts/route.ts', replacements)
);
const practicePlans = await import(
  await moduleUrl('../app/api/practice-plans/route.ts', replacements)
);
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
globalThis.FixedLengthStream = class extends TransformStream {
  constructor(length) {
    let bytes = 0;
    super({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > length) throw new Error('Too many bytes');
        controller.enqueue(chunk);
      },
      flush() {
        if (bytes !== length) throw new Error('Incomplete upload');
      },
    });
  }
};
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
          body: new Response(
            options?.range
              ? object.bytes.slice(
                  options.range.offset,
                  options.range.offset + options.range.length,
                )
              : object.bytes,
          ).body,
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
  async head(key) {
    const object = objects.get(key);
    return object
      ? {
          key,
          size: object.bytes.byteLength,
          etag: createHash('md5')
            .update(new Uint8Array(object.bytes))
            .digest('hex'),
          httpEtag:
            '"' +
            createHash('md5')
              .update(new Uint8Array(object.bytes))
              .digest('hex') +
            '"',
          writeHttpMetadata(headers) {
            headers.set(
              'content-type',
              object.options.httpMetadata.contentType,
            );
          },
          httpMetadata: object.options?.httpMetadata,
        }
      : null;
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
const films = await import(
  await moduleUrl('../app/api/film/route.ts', [
    [
      "import { env } from 'cloudflare:workers';",
      'const env = { MEDIA: globalThis.privateTestBucket };',
    ],
    ["'@/lib/team-backup'", JSON.stringify(backupUrl)],
    ...replacements,
  ])
);
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
  const bookId = (await created.json()).books[0].id;
  assert.equal(typeof bookId, 'string');
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

test('practice saves return the exact plan, reject invalid updates, and isolate owners', async () => {
  const alice = { id: 'owner-a', name: 'Coach A', email: 'a@example.test' };
  globalThis.privateTestIdentity = alice;
  const body = {
    title: 'Same name',
    practiceDate: '2026-11-06',
    blocks: [['4:00', '10 min', 'Contain', 'Leverage', 'defence']],
    generated: true,
  };
  const first = await practicePlans.POST(request(body));
  assert.equal(first.status, 201);
  const a = await first.json();
  const second = await practicePlans.POST(request(body));
  const b = await second.json();
  assert.notEqual(a.savedPlanId, b.savedPlanId);
  assert.equal(
    b.plans.find((plan) => plan.id === b.savedPlanId).durationMinutes,
    10,
  );
  const update = {
    ...body,
    id: b.savedPlanId,
    blocks: [...body.blocks, ['4:10', '15 min', 'Coverage', '', 'defence']],
  };
  assert.equal((await practicePlans.PUT(request(update))).status, 200);
  for (const invalid of [
    { ...update, practiceDate: '2026-02-30' },
    { ...update, blocks: [['TBD', '-5 min', 'Bad', '', 'team']] },
    { ...update, blocks: null },
    { ...update, title: '' },
  ])
    assert.equal((await practicePlans.PUT(request(invalid))).status, 400);
  const reopened = (await (await practicePlans.GET()).json()).plans.find(
    (plan) => plan.id === b.savedPlanId,
  );
  assert.equal(reopened.durationMinutes, 25);
  assert.deepEqual(reopened.blocks, update.blocks);
  globalThis.privateTestIdentity = {
    id: 'owner-b',
    name: 'Coach B',
    email: 'b@example.test',
  };
  assert.equal((await (await practicePlans.GET()).json()).plans.length, 0);
  assert.equal((await practicePlans.PUT(request(update))).status, 404);
  assert.equal(
    (
      await practicePlans.DELETE(
        new Request(
          `https://pilot.test/api/practice-plans?id=${b.savedPlanId}`,
        ),
      )
    ).status,
    404,
  );
  globalThis.privateTestIdentity = alice;
  for (const id of [a.savedPlanId, b.savedPlanId])
    assert.equal(
      (
        await practicePlans.DELETE(
          new Request(`https://pilot.test/api/practice-plans?id=${id}`),
        )
      ).status,
      200,
    );
  globalThis.privateTestIdentity = null;
  assert.equal((await practicePlans.GET()).status, 401);
  assert.equal((await practicePlans.POST(request(body))).status, 401);
});

test('calendar preserves real instants, rejects invalid input, and isolates saved schedules', async () => {
  const alice = { id: 'owner-a', name: 'Coach A', email: 'a@example.test' };
  const body = {
    title: 'Winter practice',
    eventType: 'practice',
    startsAt: '2026-11-06T16:00:00-04:00',
    endsAt: '2026-11-06T17:30:00-04:00',
    location: 'Field',
    notes: '',
  };
  globalThis.privateTestIdentity = null;
  assert.equal((await calendarEvents.GET()).status, 401);
  assert.equal((await calendarEvents.POST(request(body))).status, 401);
  assert.equal(
    (await calendarEvents.PUT(request({ ...body, id: 'unknown' }))).status,
    401,
  );
  globalThis.privateTestIdentity = alice;
  const created = await calendarEvents.POST(request(body));
  assert.equal(created.status, 201);
  const saved = (await created.json()).event;
  assert.equal(saved.startsAt, '2026-11-06T20:00:00.000Z');
  assert.equal(saved.endsAt, '2026-11-06T21:30:00.000Z');
  const correction = {
    ...body,
    id: saved.id,
    title: 'Corrected travel',
    eventType: 'travel',
    startsAt: '2026-11-06T23:30:00-04:00',
    endsAt: '2026-11-07T02:15:00-04:00',
    location: 'Away field',
    notes: 'Updated arrival details',
  };
  const correctedResponse = await calendarEvents.PUT(request(correction));
  assert.equal(correctedResponse.status, 200);
  const corrected = (await correctedResponse.json()).event;
  assert.equal(corrected.id, saved.id);
  assert.equal(corrected.title, correction.title);
  assert.equal(corrected.startsAt, '2026-11-07T03:30:00.000Z');
  assert.equal(corrected.endsAt, '2026-11-07T06:15:00.000Z');
  assert.equal(corrected.notes, correction.notes);
  assert.equal(corrected.location, correction.location);
  for (const invalid of [
    { ...correction, endsAt: correction.startsAt },
    { ...correction, id: '' },
    { ...correction, eventType: 'fake' },
    { ...correction, startsAt: '2026-02-30T16:00:00Z' },
    { ...correction, title: '' },
    null,
  ]) {
    assert.equal((await calendarEvents.PUT(request(invalid))).status, 400);
    assert.deepEqual((await (await calendarEvents.GET()).json()).events, [
      corrected,
    ]);
  }
  for (const invalid of [
    { ...body, startsAt: '2026-11-06T16:00:00' },
    { ...body, startsAt: '2026-02-30T16:00:00Z' },
    { ...body, endsAt: body.startsAt },
    { ...body, title: '' },
    { ...body, eventType: 'fake' },
    null,
  ])
    assert.equal((await calendarEvents.POST(request(invalid))).status, 400);
  assert.equal((await (await calendarEvents.GET()).json()).events.length, 1);
  globalThis.privateTestIdentity = {
    id: 'owner-b',
    name: 'Coach B',
    email: 'b@example.test',
  };
  assert.equal((await (await calendarEvents.GET()).json()).events.length, 0);
  const foreignUpdate = await calendarEvents.PUT(request(correction));
  assert.equal(foreignUpdate.status, 404);
  assert.equal((await foreignUpdate.json()).event, undefined);
  assert.equal(
    (
      await calendarEvents.DELETE(
        new Request(`https://pilot.test/api/calendar-events?id=${saved.id}`),
      )
    ).status,
    404,
  );
  globalThis.privateTestIdentity = alice;
  assert.deepEqual((await (await calendarEvents.GET()).json()).events, [
    corrected,
  ]);
  assert.equal(
    (
      await calendarEvents.DELETE(
        new Request(`https://pilot.test/api/calendar-events?id=${saved.id}`),
      )
    ).status,
    200,
  );
  assert.equal((await (await calendarEvents.GET()).json()).events.length, 0);
});

test('roster create/update responses cannot reveal another owner’s athlete or accept invalid percentages', async () => {
  const alice = { id: 'owner-a', name: 'Coach A', email: 'a@example.test' };
  const bob = { id: 'owner-b', name: 'Coach B', email: 'b@example.test' };
  const body = {
    firstName: 'Test',
    lastName: 'Athlete',
    number: 12,
    position: 'DB',
    unit: 'Defence',
    graduationYear: 12,
    weightLb: 180,
    email: 'athlete@example.test',
    staffNote: 'Private coaching note',
  };
  globalThis.privateTestIdentity = null;
  assert.equal((await athletesApi.GET()).status, 401);
  assert.equal((await athletesApi.POST(request(body))).status, 401);
  globalThis.privateTestIdentity = alice;
  const response = await athletesApi.POST(request(body));
  assert.equal(response.status, 201);
  const athlete = (await response.json()).athlete;
  assert.equal((await athletesApi.POST(request(body))).status, 409);
  globalThis.privateTestIdentity = bob;
  const forbidden = await athletesApi.PATCH(
    request({ id: athlete.id, status: 'Out' }),
  );
  assert.equal(forbidden.status, 404);
  const forbiddenBody = await forbidden.json();
  assert.equal(forbiddenBody.athlete, undefined);
  assert.ok(!JSON.stringify(forbiddenBody).includes('Private coaching note'));
  const bobResponse = await athletesApi.POST(request(body));
  assert.equal(
    bobResponse.status,
    201,
    'number and email uniqueness must stay within a team',
  );
  const bobAthlete = (await bobResponse.json()).athlete;
  globalThis.privateTestIdentity = alice;
  for (const changes of [
    { attendancePercent: null },
    { installPercent: 'NaN' },
    { attendancePercent: -1 },
    { installPercent: 101 },
    { status: 'Unknown' },
    { staffNote: {} },
  ])
    assert.equal(
      (await athletesApi.PATCH(request({ id: athlete.id, ...changes }))).status,
      400,
    );
  const updated = await athletesApi.PATCH(
    request({
      id: athlete.id,
      status: 'Limited',
      staffNote: 'Saved note',
      attendancePercent: 75,
    }),
  );
  assert.equal(updated.status, 200);
  const reopened = (await (await athletesApi.GET()).json()).athletes.find(
    (item) => item.id === athlete.id,
  );
  assert.equal(reopened.status, 'Limited');
  assert.equal(reopened.attendance, 75);
  assert.equal(reopened.staffNote, 'Saved note');
  globalThis.privateTestIdentity = bob;
  const foreignProfile = await athletesApi.PUT(
    request({ ...body, id: athlete.id, firstName: 'Wrong owner' }),
  );
  assert.equal(foreignProfile.status, 404);
  assert.equal((await foreignProfile.json()).athlete, undefined);
  globalThis.privateTestIdentity = alice;
  const corrected = await athletesApi.PUT(
    request({
      ...body,
      id: athlete.id,
      firstName: 'Corrected',
      number: 0,
      unit: 'Offence',
      graduationYear: 11,
      email: 'CORRECTED@example.test',
      phone: '555-0100',
      status: 'Out',
      attendancePercent: 0,
      installPercent: 99,
      staffNote: 'Stale form note',
    }),
  );
  assert.equal(corrected.status, 200);
  const profile = (await corrected.json()).athlete;
  assert.equal(profile.id, athlete.id);
  assert.equal(profile.firstName, 'Corrected');
  assert.equal(profile.no, 0);
  assert.equal(profile.unit, 'Offence');
  assert.equal(profile.year, '11');
  assert.equal(profile.email, 'corrected@example.test');
  assert.equal(profile.phone, '555-0100');
  assert.equal(profile.staffNote, 'Saved note');
  assert.equal(profile.status, 'Limited');
  assert.equal(profile.attendance, 75);
  assert.equal(profile.install, 0);
  const spareResponse = await athletesApi.POST(
    request({ ...body, number: 13, email: 'spare@example.test' }),
  );
  assert.equal(spareResponse.status, 201);
  const spare = (await spareResponse.json()).athlete;
  assert.equal(
    (await athletesApi.PUT(request({ ...body, id: athlete.id, number: 13 })))
      .status,
    409,
  );
  assert.equal(
    (
      await athletesApi.PUT(
        request({ ...body, id: athlete.id, email: 'spare@example.test' }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await athletesApi.PUT(
        request({ ...body, id: athlete.id, email: 'invalid' }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await (await athletesApi.GET()).json()).athletes.find(
      (item) => item.id === athlete.id,
    ).firstName,
    'Corrected',
  );
  globalThis.privateTestIdentity = null;
  assert.equal(
    (await athletesApi.PUT(request({ ...body, id: athlete.id }))).status,
    401,
  );
  globalThis.privateTestIdentity = alice;
  const clearedNumber = await athletesApi.PUT(
    request({
      ...body,
      id: spare.id,
      number: null,
      email: 'spare@example.test',
    }),
  );
  assert.equal(clearedNumber.status, 200);
  assert.equal((await clearedNumber.json()).athlete.no, null);
  assert.deepEqual(
    (await (await athletesApi.GET()).json()).athletes.map((item) => item.id),
    [athlete.id, spare.id],
    'number zero sorts before unassigned jerseys after reopening',
  );
  // Fixture cleanup is confined to this in-memory test database.
  sqlite
    .prepare('DELETE FROM athletes WHERE id IN (?, ?, ?)')
    .run(athlete.id, bobAthlete.id, spare.id);
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

test('raw file uploads stream above 1 MB, enforce declared sizes, and preserve previous files on failure', async () => {
  globalThis.privateTestIdentity = {
    id: 'owner-a',
    name: 'Coach A',
    email: 'a@example.test',
  };
  const a = await getDatabase(),
    bytes = new Uint8Array(1_100_000).fill(19);
  const upload = (body, declared = body.byteLength, type = 'video/mp4') =>
    new Request('https://pilot.test/api/media?key=raw-upload-test', {
      method: 'POST',
      headers: {
        'content-type': type,
        'x-chalktalk-upload-size': String(declared),
        'x-chalktalk-filename': encodeURIComponent('Practice vidéo.mp4'),
      },
      body,
    });
  assert.equal((await media.POST(upload(bytes))).status, 200);
  assert.equal(
    objects.get(`teams/${a.teamId}/raw-upload-test`).bytes.byteLength,
    bytes.byteLength,
  );
  assert.equal(
    objects.get(`teams/${a.teamId}/raw-upload-test`).options.customMetadata
      .originalName,
    'Practice vidéo.mp4',
  );
  assert.equal((await media.POST(upload(new Uint8Array(10), 5))).status, 400);
  assert.equal((await media.POST(upload(new Uint8Array(10), 20))).status, 400);
  assert.equal(
    objects.get(`teams/${a.teamId}/raw-upload-test`).bytes.byteLength,
    bytes.byteLength,
    'failed overwrites must preserve the previous complete file',
  );
  assert.equal(
    (await media.POST(upload(new Uint8Array(1), 251 * 1024 * 1024))).status,
    413,
  );
  assert.equal(
    (await media.POST(upload(new Uint8Array(1), 1, 'application/javascript')))
      .status,
    415,
  );
  await globalThis.privateTestBucket.delete(
    `teams/${a.teamId}/raw-upload-test`,
  );
});

test('blank teams can register multiple films, select independent clips, and cannot alter another owner’s film', async () => {
  const alice = { id: 'owner-a', name: 'Coach A', email: 'a@example.test' },
    bob = { id: 'owner-b', name: 'Coach B', email: 'b@example.test' };
  globalThis.privateTestIdentity = alice;
  const a = await getDatabase();
  assert.equal(
    sqlite
      .prepare('SELECT count(*) AS n FROM games WHERE team_id = ?')
      .get(a.teamId).n,
    0,
  );
  for (const key of ['film-one', 'film-two'])
    await globalThis.privateTestBucket.put(
      `teams/${a.teamId}/${key}`,
      `video bytes ${key}`,
      { httpMetadata: { contentType: 'video/mp4' } },
    );
  const oneResponse = await films.POST(
    request({
      action: 'register',
      storageKey: 'film-one',
      title: 'First film',
    }),
  );
  assert.equal(oneResponse.status, 201, await oneResponse.clone().text());
  const one = (await oneResponse.json()).asset;
  assert.equal(one.gameId, null);
  const two = (
    await (
      await films.POST(
        request({
          action: 'register',
          storageKey: 'film-two',
          title: 'Second film',
        }),
      )
    ).json()
  ).asset;
  assert.notEqual(one.id, two.id);
  const get = (id) =>
    films.GET(new Request(`https://pilot.test/api/film?assetId=${id}`));
  const chart = (assetId, extra) =>
    films.POST(
      request({
        action: 'upsertClip',
        assetId,
        startSeconds: 0,
        endSeconds: 5,
        ...extra,
      }),
    );
  const first = await chart(one.id, { note: 'First note', concept: 'Cover 3' });
  assert.equal(first.status, 201);
  const firstData = await first.json(),
    firstId = firstData.clips[0].id;
  assert.throws(
    () =>
      sqlite
        .prepare(
          'INSERT INTO film_clips (id, film_asset_id, clip_number, start_seconds, end_seconds) VALUES (?, ?, 1, 0, 1)',
        )
        .run('duplicate-film-clip', one.id),
    /UNIQUE constraint/,
  );
  assert.equal(
    firstData.asset.id,
    one.id,
    'saving in an older film must not switch to the latest upload',
  );
  const second = await chart(one.id, {
    startSeconds: 5,
    endSeconds: 10,
    note: 'Second note',
  });
  const secondData = await second.json(),
    secondId = secondData.clips[1].id;
  assert.equal(secondData.clips.length, 2);
  assert.notEqual(firstId, secondId);
  assert.equal(secondData.clips[0].note, 'First note');
  assert.equal((await (await get(two.id)).json()).clips.length, 0);
  assert.equal((await chart(one.id, { clipNumber: 1 })).status, 400);
  assert.equal((await chart(one.id, { endSeconds: 0 })).status, 400);
  assert.equal((await chart(one.id, { startSeconds: 'bad' })).status, 400);
  assert.equal((await chart(one.id, { startSeconds: -1 })).status, 400);
  assert.equal((await chart(one.id, { clipNumber: 1.5 })).status, 400);
  assert.equal((await chart(one.id, { note: 'x'.repeat(281) })).status, 400);
  const removed = await films.DELETE(
    new Request(`https://pilot.test/api/film?clipId=${firstId}`, {
      method: 'DELETE',
    }),
  );
  assert.equal((await removed.json()).asset.id, one.id);
  const thirdData = await (await chart(one.id, { note: 'Third note' })).json();
  assert.deepEqual(
    thirdData.clips.map((c) => c.clipNumber),
    [2, 3],
  );
  await films.POST(
    request({
      action: 'register',
      storageKey: 'film-one',
      title: 'First film renamed',
    }),
  );
  assert.equal(
    (await (await get(one.id)).json()).clips.length,
    2,
    'registration retry must preserve clips',
  );
  assert.equal(
    (
      await films.POST(
        request({ action: 'register', storageKey: 'missing-video' }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await films.POST(
        request({ action: 'register', storageKey: '../../film-one' }),
      )
    ).status,
    400,
  );
  globalThis.privateTestIdentity = bob;
  const b = await getDatabase();
  await globalThis.privateTestBucket.put(
    `teams/${b.teamId}/film-one`,
    'B video',
    { httpMetadata: { contentType: 'video/mp4' } },
  );
  const bAsset = (
    await (
      await films.POST(
        request({
          action: 'register',
          storageKey: 'film-one',
          title: 'B private film',
        }),
      )
    ).json()
  ).asset;
  assert.notEqual(bAsset.id, one.id);
  assert.equal((await get(one.id)).status, 404);
  assert.equal((await chart(one.id, { id: secondId })).status, 404);
  assert.equal(
    (
      await films.DELETE(
        new Request(`https://pilot.test/api/film?clipId=${secondId}`, {
          method: 'DELETE',
        }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await films.DELETE(
        new Request(`https://pilot.test/api/film?assetId=${one.id}`, {
          method: 'DELETE',
        }),
      )
    ).status,
    404,
  );
  sqlite
    .prepare(
      "INSERT INTO games (id, team_id, opponent, kickoff_at, venue, status, home_away) VALUES ('foreign-film-game', ?, 'B opponent', '', '', 'scheduled', 'home')",
    )
    .run(b.teamId);
  sqlite
    .prepare(
      "INSERT INTO plays (id, team_id, name, unit, family, concept, diagram_json, created_at, updated_at) VALUES ('foreign-film-play', ?, 'B secret play', 'Defence', 'Coverage', '', '{}', '', '')",
    )
    .run(b.teamId);
  globalThis.privateTestIdentity = alice;
  assert.equal(
    (
      await films.POST(
        request({
          action: 'register',
          storageKey: 'film-one',
          gameId: 'foreign-film-game',
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await chart(one.id, { playId: 'foreign-film-play' })).status,
    400,
  );
  assert.equal((await (await get(one.id)).json()).clips.length, 2);
  for (const id of [one.id, two.id])
    assert.equal(
      (
        await films.DELETE(
          new Request(`https://pilot.test/api/film?assetId=${id}`, {
            method: 'DELETE',
          }),
        )
      ).status,
      200,
    );
  for (const key of ['film-one', 'film-two'])
    await globalThis.privateTestBucket.delete(`teams/${a.teamId}/${key}`);
  globalThis.privateTestIdentity = bob;
  await films.DELETE(
    new Request(`https://pilot.test/api/film?assetId=${bAsset.id}`, {
      method: 'DELETE',
    }),
  );
  await globalThis.privateTestBucket.delete(`teams/${b.teamId}/film-one`);
  sqlite.prepare("DELETE FROM games WHERE id = 'foreign-film-game'").run();
  sqlite.prepare("DELETE FROM plays WHERE id = 'foreign-film-play'").run();
  globalThis.privateTestIdentity = null;
  assert.equal((await get(one.id)).status, 401);
  assert.equal(
    (await films.POST(request({ action: 'register', storageKey: 'film-one' })))
      .status,
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

test('sideline notes survive flags, competing devices, retries and owner boundaries without rewriting legacy work', async () => {
  const alice = { id: 'owner-a', name: 'Coach A', email: 'a@example.test' },
    bob = { id: 'owner-b', name: 'Coach B', email: 'b@example.test' };
  globalThis.privateTestIdentity = null;
  assert.equal((await sideline.GET()).status, 401);
  assert.equal(
    (await sideline.POST(request({ action: 'note', id: 'n', text: 'Private' })))
      .status,
    401,
  );
  const createClip = async (owner, key) => {
    globalThis.privateTestIdentity = owner;
    const db = await getDatabase();
    await globalThis.privateTestBucket.put(
      'teams/' + db.teamId + '/' + key,
      'video',
      { httpMetadata: { contentType: 'video/mp4' } },
    );
    const asset = (
      await (
        await films.POST(
          request({ action: 'register', storageKey: key, title: key }),
        )
      ).json()
    ).asset;
    const result = await films.POST(
      request({
        action: 'upsertClip',
        assetId: asset.id,
        startSeconds: 0,
        endSeconds: 5,
      }),
    );
    assert.equal(result.status, 201);
    return { teamId: db.teamId, clip: (await result.json()).clips[0] };
  };
  const a = await createClip(alice, 'sideline-a'),
    b = await createClip(bob, 'sideline-b');
  assert.equal(a.clip.clipNumber, b.clip.clipNumber);
  globalThis.privateTestIdentity = alice;
  const legacy = {
    flagged: [1],
    notes: ['Earlier private note'],
    cameraCount: 0,
  };
  assert.equal(
    (
      await workspaceState.PUT(
        request({
          key: 'sideline-session-v2',
          value: legacy,
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual((await (await sideline.GET()).json()).notes, []);
  assert.deepEqual(
    (await (await sideline.GET()).json()).legacyNotes,
    legacy.notes,
  );
  const note = {
    action: 'note',
    id: 'sideline-note-a',
    clipId: a.clip.id,
    text: 'First bench observation',
  };
  assert.equal((await sideline.POST(request(note))).status, 200);
  const concurrent = await Promise.all([
    sideline.POST(
      request({ action: 'flag', clipId: a.clip.id, flagged: true }),
    ),
    sideline.POST(
      request({
        action: 'note',
        id: 'sideline-note-b',
        clipId: a.clip.id,
        text: 'Second device observation',
      }),
    ),
  ]);
  assert.deepEqual(
    concurrent.map((r) => r.status),
    [200, 200],
  );
  assert.equal((await sideline.POST(request(note))).status, 200);
  assert.equal(
    (await sideline.POST(request({ ...note, text: 'Different content' })))
      .status,
    409,
  );
  let saved = await (await sideline.GET()).json();
  assert.equal(saved.notes.length, 2);
  assert.deepEqual(saved.flaggedClipIds, [a.clip.id]);
  assert.equal(
    (
      await sideline.POST(
        request({ action: 'flag', clipId: a.clip.id, flagged: true }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await sideline.POST(
        request({ action: 'flag', clipId: a.clip.id, flagged: false }),
      )
    ).status,
    200,
  );
  saved = await (await sideline.GET()).json();
  assert.equal(saved.notes.length, 2);
  assert.deepEqual(saved.flaggedClipIds, []);
  for (const body of [
    null,
    { action: 'fake' },
    { action: 'note', id: 'bad', text: '' },
    { ...note, text: 'x'.repeat(1001) },
    { action: 'flag', clipId: a.clip.id, flagged: 'true' },
    { action: 'note', id: 'bad', text: 'Invalid', clipId: {} },
  ])
    assert.equal((await sideline.POST(request(body))).status, 400);
  assert.equal(
    (
      await sideline.POST(
        request({ ...note, id: 'foreign', clipId: b.clip.id }),
      )
    ).status,
    404,
  );
  const raw = sqlite
    .prepare(
      'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
    )
    .get(a.teamId, 'sideline-review-v3').value_json;
  sqlite
    .prepare(
      'UPDATE workspace_state SET value_json=? WHERE team_id=? AND state_key=?',
    )
    .run('{broken', a.teamId, 'sideline-review-v3');
  assert.equal((await sideline.GET()).status, 500);
  assert.equal((await sideline.POST(request(note))).status, 500);
  assert.equal(
    sqlite
      .prepare(
        'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
      )
      .get(a.teamId, 'sideline-review-v3').value_json,
    '{broken',
  );
  sqlite
    .prepare(
      'UPDATE workspace_state SET value_json=? WHERE team_id=? AND state_key=?',
    )
    .run(raw, a.teamId, 'sideline-review-v3');
  assert.deepEqual(
    JSON.parse(
      sqlite
        .prepare(
          'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
        )
        .get(a.teamId, 'sideline-session-v2').value_json,
    ),
    legacy,
  );
  globalThis.privateTestIdentity = bob;
  assert.deepEqual((await (await sideline.GET()).json()).notes, []);
  assert.deepEqual((await (await sideline.GET()).json()).legacyNotes, []);
  assert.equal(
    (
      await sideline.POST(
        request({ action: 'flag', clipId: a.clip.id, flagged: true }),
      )
    ).status,
    404,
  );
  assert.equal(
    (await sideline.POST(request({ ...note, clipId: b.clip.id }))).status,
    200,
  );
  assert.equal((await (await sideline.GET()).json()).notes.length, 1);
  globalThis.privateTestIdentity = alice;
  assert.equal((await (await sideline.GET()).json()).notes.length, 2);
});

test('media serves seekable byte ranges and metadata with owner isolation, validators and unsatisfiable-range handling', async () => {
  const alice = { id: 'owner-a', name: 'Coach A', email: 'a@example.test' },
    bob = { id: 'owner-b', name: 'Coach B', email: 'b@example.test' };
  const key = 'range-test',
    url = 'https://pilot.test/api/media?key=' + key;
  globalThis.privateTestIdentity = null;
  assert.equal(
    (await media.HEAD(new Request(url, { method: 'HEAD' }))).status,
    401,
  );
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
  globalThis.privateTestIdentity = alice;
  const a = await getDatabase();
  await globalThis.privateTestBucket.put(
    'teams/' + a.teamId + '/' + key,
    bytes,
    { httpMetadata: { contentType: 'video/mp4' } },
  );
  const get = (range, ifRange) =>
    media.GET(
      new Request(url, {
        headers: {
          ...(range ? { range } : {}),
          ...(ifRange ? { 'if-range': ifRange } : {}),
        },
      }),
    );
  const head = await media.HEAD(
    new Request(url, { method: 'HEAD', headers: { range: 'bytes=2-5' } }),
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '16');
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal(await head.text(), '');
  const whole = await get();
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-length'), '16');
  assert.equal(whole.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await whole.arrayBuffer()), bytes);
  for (const [range, first, last] of [
    ['bytes=2-5', 2, 5],
    ['bytes=12-', 12, 15],
    ['bytes=-3', 13, 15],
    ['bytes=14-99', 14, 15],
  ]) {
    const response = await get(range);
    assert.equal(response.status, 206);
    assert.equal(
      response.headers.get('content-range'),
      'bytes ' + first + '-' + last + '/16',
    );
    assert.equal(
      Number(response.headers.get('content-length')),
      last - first + 1,
    );
    assert.deepEqual(
      new Uint8Array(await response.arrayBuffer()),
      bytes.slice(first, last + 1),
    );
  }
  for (const range of [
    'bytes=16-',
    'bytes=9-3',
    'bytes=-0',
    'bytes=9007199254740992-',
  ]) {
    const response = await get(range);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */16');
    assert.equal(await response.text(), '');
  }
  assert.equal((await get('bytes=2-5', head.headers.get('etag'))).status, 206);
  assert.equal((await get('bytes=2-5', '"outdated"')).status, 200);
  assert.equal((await get('bytes=0-1,3-4')).status, 200);
  globalThis.privateTestIdentity = bob;
  assert.equal((await get('bytes=2-5')).status, 404);
  assert.equal(
    (await media.HEAD(new Request(url, { method: 'HEAD' }))).status,
    404,
  );
  const b = await getDatabase();
  await globalThis.privateTestBucket.put(
    'teams/' + b.teamId + '/' + key,
    Uint8Array.from([99, 98, 97]),
    { httpMetadata: { contentType: 'video/mp4' } },
  );
  assert.deepEqual(
    new Uint8Array(await (await get('bytes=1-2')).arrayBuffer()),
    Uint8Array.from([98, 97]),
  );
  await globalThis.privateTestBucket.delete('teams/' + a.teamId + '/' + key);
  await globalThis.privateTestBucket.delete('teams/' + b.teamId + '/' + key);
});

test('depth charts start blank, preserve custom roles and notes, reject stale or foreign assignments and retain legacy data', async () => {
  const blank = { Offence: [], Defence: [], 'Special teams': [] };
  globalThis.privateTestIdentity = null;
  assert.equal((await depthCharts.GET()).status, 401);
  assert.equal(
    (await depthCharts.PUT(request({ layouts: blank, version: '' }))).status,
    401,
  );
  globalThis.privateTestIdentity = {
    id: 'depth-first-owner',
    name: 'First depth owner',
    email: 'depth-first@example.test',
  };
  assert.equal(
    (
      await onboarding.POST(
        request({ name: 'Blank depth team', season: '2026' }),
      )
    ).status,
    201,
  );
  const fresh = await depthCharts.GET();
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get('cache-control'), 'private, no-store');
  const first = await fresh.json();
  assert.deepEqual(first.layouts, blank);
  assert.deepEqual(first.athletes, []);
  assert.equal(
    (
      await workspaceState.PUT(
        request({ key: 'depth-layouts-v2', value: null }),
      )
    ).status,
    200,
  );
  assert.deepEqual((await (await depthCharts.GET()).json()).layouts, blank);
  const alice = { id: 'owner-a', name: 'Coach A', email: 'a@example.test' },
    bob = { id: 'owner-b', name: 'Coach B', email: 'b@example.test' };
  const makeAthlete = async (owner, suffix) => {
    globalThis.privateTestIdentity = owner;
    const response = await athletesApi.POST(
      request({
        firstName: 'Depth',
        lastName: suffix,
        number: null,
        position: 'DB',
        unit: 'Defence',
        graduationYear: 12,
        weightLb: 180,
        email: 'depth-' + suffix + '@example.test',
      }),
    );
    assert.equal(response.status, 201);
    return (await response.json()).athlete.id;
  };
  const aId = await makeAthlete(alice, 'A'),
    bId = await makeAthlete(bob, 'B');
  globalThis.privateTestIdentity = alice;
  const a = await getDatabase();
  const legacy = {
    Offence: [
      {
        id: 'custom-boundary',
        pos: 'Boundary half',
        athleteId: aId,
        x: 23,
        y: 42,
      },
    ],
  };
  assert.equal(
    (
      await workspaceState.PUT(
        request({ key: 'depth-layouts-v2', value: legacy }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await workspaceState.PUT(
        request({
          key: 'depth-note-offence-custom-boundary',
          value: 'Earlier coaching note',
        }),
      )
    ).status,
    200,
  );
  const loaded = await (await depthCharts.GET()).json();
  assert.deepEqual(loaded.layouts.Defence, []);
  assert.deepEqual(loaded.layouts['Special teams'], []);
  assert.equal(loaded.layouts.Offence[0].notes, 'Earlier coaching note');
  assert.equal(loaded.layouts.Offence[0].athleteId, aId);
  const rawLegacy = sqlite
    .prepare(
      'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
    )
    .get(a.teamId, 'depth-layouts-v2').value_json;
  const valid = {
    ...loaded.layouts,
    Offence: [
      { ...loaded.layouts.Offence[0], notes: 'Corrected role notes', x: 61.5 },
    ],
  };
  for (const layouts of [
    null,
    { ...valid, Offence: [{ ...valid.Offence[0], pos: '' }] },
    { ...valid, Offence: [{ ...valid.Offence[0], x: -1 }] },
    { ...valid, Offence: [valid.Offence[0], valid.Offence[0]] },
    { ...valid, Offence: [{ ...valid.Offence[0], notes: {} }] },
    { ...valid, Offence: [{ ...valid.Offence[0], athleteId: bId }] },
  ]) {
    assert.equal(
      (await depthCharts.PUT(request({ layouts, version: loaded.version })))
        .status,
      400,
    );
    assert.deepEqual(
      (await (await depthCharts.GET()).json()).layouts,
      loaded.layouts,
    );
  }
  const save = await depthCharts.PUT(
    request({ layouts: valid, version: loaded.version }),
  );
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(saved.layouts.Offence[0].notes, 'Corrected role notes');
  assert.equal(saved.layouts.Offence[0].x, 61.5);
  assert.notEqual(saved.version, loaded.version);
  assert.equal(
    (
      await depthCharts.PUT(
        request({ layouts: loaded.layouts, version: loaded.version }),
      )
    ).status,
    409,
  );
  const competing = await Promise.all(
    ['First device', 'Second device'].map((pos) =>
      depthCharts.PUT(
        request({
          layouts: { ...valid, Offence: [{ ...valid.Offence[0], pos }] },
          version: saved.version,
        }),
      ),
    ),
  );
  assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
  const winner = await (await depthCharts.GET()).json();
  assert.ok(
    ['First device', 'Second device'].includes(winner.layouts.Offence[0].pos),
  );
  assert.equal(winner.layouts.Offence[0].notes, 'Corrected role notes');
  const raw = sqlite
    .prepare(
      'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
    )
    .get(a.teamId, 'depth-layouts-v3').value_json;
  sqlite
    .prepare(
      'UPDATE workspace_state SET value_json=? WHERE team_id=? AND state_key=?',
    )
    .run('{broken', a.teamId, 'depth-layouts-v3');
  assert.equal((await depthCharts.GET()).status, 500);
  assert.equal(
    (
      await depthCharts.PUT(
        request({ layouts: valid, version: winner.version }),
      )
    ).status,
    500,
  );
  assert.equal(
    sqlite
      .prepare(
        'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
      )
      .get(a.teamId, 'depth-layouts-v3').value_json,
    '{broken',
  );
  sqlite
    .prepare(
      'UPDATE workspace_state SET value_json=? WHERE team_id=? AND state_key=?',
    )
    .run(raw, a.teamId, 'depth-layouts-v3');
  assert.equal(
    sqlite
      .prepare(
        'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
      )
      .get(a.teamId, 'depth-layouts-v2').value_json,
    rawLegacy,
  );
  assert.equal(
    JSON.parse(
      sqlite
        .prepare(
          'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
        )
        .get(a.teamId, 'depth-note-offence-custom-boundary').value_json,
    ),
    'Earlier coaching note',
  );
  globalThis.privateTestIdentity = bob;
  const other = await (await depthCharts.GET()).json();
  assert.deepEqual(other.layouts, blank);
  assert.ok(!other.athletes.some((athlete) => athlete.id === aId));
  assert.equal(
    (await depthCharts.PUT(request({ layouts: valid, version: other.version })))
      .status,
    400,
  );
  globalThis.privateTestIdentity = alice;
  sqlite
    .prepare('DELETE FROM athletes WHERE id=? AND team_id=?')
    .run(aId, a.teamId);
  const missing = await (await depthCharts.GET()).json();
  assert.equal(missing.layouts.Offence[0].athleteId, aId);
  assert.ok(!missing.athletes.some((athlete) => athlete.id === aId));
  assert.equal(
    (
      await depthCharts.PUT(
        request({ layouts: missing.layouts, version: missing.version }),
      )
    ).status,
    400,
  );
  missing.layouts.Offence[0].athleteId = '';
  assert.equal(
    (
      await depthCharts.PUT(
        request({ layouts: missing.layouts, version: missing.version }),
      )
    ).status,
    200,
  );
});
