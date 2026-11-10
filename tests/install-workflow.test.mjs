import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual handlers and SQL against an isolated SQLite database.
// No network, user records, or local Wrangler state is touched.
const sqlite = new DatabaseSync(':memory:');
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
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
globalThis.chalkTestDatabase = database;
const moduleUrl = async (path, replacements = []) => {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
  const result = ts.transpileModule(
    source.replace(
      "import { workspaceFetch as fetch } from '@/lib/workspace-fetch';",
      'const fetch = (...args) => globalThis.fetch(...args);',
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  );
  return `data:text/javascript;base64,${Buffer.from(result.outputText).toString('base64')}`;
};
const identityUrl = await moduleUrl('../lib/workspace-identity.ts');
const permissionsUrl = await moduleUrl('../lib/team-permissions.ts', [
  ["'@/lib/workspace-identity'", JSON.stringify(identityUrl)],
]);
const dbUrl = await moduleUrl('../db/client.ts', [
  [
    "import { requestWorkspaceId } from '@/lib/request-identity';",
    "const requestWorkspaceId = async () => '';",
  ],
  ["'@/lib/team-permissions'", JSON.stringify(permissionsUrl)],
  [
    "import { isPrototype, requestIdentity } from '@/lib/request-identity';",
    "const isPrototype = () => true; const requestIdentity = async () => ({id: 'local-test'});",
  ],
  ["'@/lib/workspace-identity'", JSON.stringify(identityUrl)],
  [
    "import { env } from 'cloudflare:workers';",
    'const env = { DB: globalThis.chalkTestDatabase };',
  ],
]);
const validatorUrl = await moduleUrl('../lib/validate-play.ts');
const designerUrl = await moduleUrl('../lib/play-designer.ts');
const replacements = [
  [
    "'@/lib/playbook-revision'",
    JSON.stringify(await moduleUrl('../lib/playbook-revision.ts')),
  ],
  [
    "'@/lib/playbook-creation'",
    JSON.stringify(await moduleUrl('../lib/playbook-creation.ts')),
  ],
  ["'@/lib/workspace-identity'", JSON.stringify(identityUrl)],
  ["'@/db/client'", JSON.stringify(dbUrl)],
  ["'@/lib/validate-play'", JSON.stringify(validatorUrl)],
  ["'@/lib/play-designer'", JSON.stringify(designerUrl)],
];
replacements.push(["'@/lib/install-material'", JSON.stringify(await moduleUrl('../lib/install-material.ts', replacements))]);
const installs = await import(
  await moduleUrl('../lib/install-api.ts', replacements)
);
const playbooks = await import(
  await moduleUrl('../app/api/playbooks/route.ts', replacements)
);
const { getDatabase, TEAM_ID } = await import(dbUrl);
const designer = await import(designerUrl);
await getDatabase();

async function call(api, method, body, query = '') {
  const response = await api[method](
    new Request(`http://test/api${query}`, {
      method,
      ...(body
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    }),
  );
  return { status: response.status, data: await response.json() };
}
const ok = (result) => {
  assert.ok(result.status < 300, JSON.stringify(result.data));
  return result.data;
};

test('complete package lifecycle, arbitrary cadence, isolation, publication and safe review boundaries', async () => {
  const bookData = ok(
    await call(playbooks, 'POST', {
      kind: 'book',
      name: 'Test system',
      side: 'Offence',
    }),
  );
  const book = bookData.books.find((item) => item.name === 'Test system');
  const created = ok(
    await call(playbooks, 'POST', {
      kind: 'play',
      playbookId: book.id,
      name: 'Boundary read',
      concept: 'Read',
    }),
  );
  let play = created.plays.find((item) => item.id === created.createdId);
  assert.equal(play.family, 'Unassigned');
  const player = {
    id: 'x',
    label: 'X',
    kind: 'skill',
    x: 100,
    y: 300,
    colour: '#30d5c8',
  };
  const route = {
    id: 'r',
    playerId: 'x',
    startX: 100,
    startY: 300,
    endX: 150,
    endY: 200,
    colour: '#30d5c8',
    lineStyle: 'solid',
    points: [
      { x: 100, y: 300 },
      { x: 100, y: 240 },
      { x: 150, y: 200 },
    ],
  };
  const saved = ok(
    await call(playbooks, 'PUT', {
      ...play,
      players: [player],
      routes: [route],
      assignments: [
        {
          id: 'a',
          position: 'X',
          title: 'Read leverage',
          detail: 'Break outside',
        },
      ],
      fieldPosition: 55,
    }),
  );
  play = saved.plays.find((item) => item.id === play.id);
  assert.deepEqual(play.routes[0].points, route.points);
  assert.equal(play.players[0].colour, player.colour);
  const a = ok(
    await call(installs, 'POST', {
      kind: 'package',
      name: 'Camp day 2',
      unit: 'Offence',
    }),
  ).package;
  const b = ok(
    await call(installs, 'POST', {
      kind: 'package',
      name: 'Monthly concepts',
      unit: 'Team',
      dueAt: '2026-12-01',
    }),
  ).package;
  assert.equal(a.dueAt, '');
  assert.equal(b.dueAt, '2026-12-01');
  const edits = await Promise.all(
    ['Monthly revised A', 'Monthly revised B'].map((name) =>
      call(installs, 'PATCH', {
        kind: 'package',
        packageId: b.id,
        name,
        unit: 'Team',
        dueAt: b.dueAt,
        version: b.version,
      }),
    ),
  );
  assert.deepEqual(edits.map((result) => result.status).sort(), [200, 409]);
  const currentB = ok(
    await call(installs, 'GET', null, `?packageId=${b.id}`),
  ).package;
  assert.ok(['Monthly revised A', 'Monthly revised B'].includes(currentB.name));
  assert.equal(currentB.dueAt, b.dueAt);
  assert.equal((await call(installs, 'POST', { playId: play.id })).status, 400);
  assert.equal(
    (
      await call(installs, 'POST', {
        kind: 'package',
        name: 'Bad date',
        dueAt: '2026-02-30',
      })
    ).status,
    400,
  );
  let data = ok(
    await call(installs, 'POST', { packageId: a.id, playId: play.id }),
  );
  assert.equal(data.items.length, 1);
  data = ok(
    await call(installs, 'POST', {
      packageId: a.id,
      playIds: [play.id, play.id],
    }),
  );
  assert.equal(data.items.length, 1, 'Adding the same play is idempotent');
  assert.equal(
    ok(await call(installs, 'GET', null, `?packageId=${b.id}`)).items.length,
    0,
    'Other packages stay untouched',
  );
  assert.equal(
    (
      await call(installs, 'POST', {
        packageId: a.id,
        playIds: [play.id, 'missing'],
      })
    ).status,
    400,
  );
  assert.equal(
    (await call(installs, 'PATCH', { kind: 'publish', packageId: a.id }))
      .status,
    400,
    'Cannot publish with no recipients',
  );
  assert.equal(
    (
      await call(playbooks, 'DELETE', {
        kind: 'play',
        id: play.id,
        version: play.version,
      })
    ).status,
    409,
    'Installed play cannot silently disappear',
  );
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO athletes (id, team_id, number, first_name, last_name, position, unit, graduation_year, height, weight_lb, status, eligibility, attendance_percent, install_percent, email, phone, staff_note, created_at, updated_at) VALUES ('athlete-test', ?, 1, 'Test', 'Player', 'X', 'Offence', 12, '', 0, 'Active', 'Cleared', 0, 0, 'test@example.invalid', '', '', ?, ?)`,
    )
    .bind(TEAM_ID, now, now)
    .run();
  // Add an unavailable play after the preflight read but before the write batch.
  // The transaction must revalidate the current contents, not publish the old list.
  const originalBatch = database.batch;
  database.batch = async function (statements) {
    database.batch = originalBatch;
    sqlite
      .prepare(
        "INSERT INTO install_items (id,package_id,play_id,title,item_type,position_group,sort_order) VALUES ('late-item',?,NULL,'Unavailable','Play','Offence',99)",
      )
      .run(a.id);
    return originalBatch.call(this, statements);
  };
  assert.equal(
    (await call(installs, 'PATCH', { kind: 'publish', packageId: a.id }))
      .status,
    409,
  );
  const unpublished = ok(
    await call(installs, 'GET', null, `?packageId=${a.id}`),
  );
  assert.equal(unpublished.package.publishedAt, null);
  assert.equal(unpublished.reviews.length, 0);
  sqlite.prepare("DELETE FROM install_items WHERE id='late-item'").run();
  data = ok(
    await call(installs, 'PATCH', { kind: 'publish', packageId: a.id }),
  );
  assert.ok(data.package.publishedAt);
  assert.equal(data.reviews.length, 1);
  assert.equal(data.reviews[0].acknowledged, false);
  assert.equal(
    ok(await call(installs, 'PATCH', { kind: 'publish', packageId: a.id }))
      .reviews.length,
    1,
  );
  assert.equal(
    (
      await call(installs, 'PATCH', {
        packageId: a.id,
        itemId: data.items[0].id,
        athleteId: 'athlete-test',
        step: 'all',
      })
    ).status,
    403,
    'Coach preview cannot impersonate athlete completion',
  );
  assert.equal(
    (await call(installs, 'DELETE', { kind: 'package', packageId: a.id }))
      .status,
    400,
  );
  assert.equal(
    (
      await call(installs, 'DELETE', {
        kind: 'item',
        packageId: a.id,
        itemId: data.items[0].id,
      })
    ).status,
    400,
  );
  assert.equal(
    (await call(playbooks, 'PUT', play)).status,
    409,
    'Published teaching content cannot change under reviews',
  );
  const copied = ok(
    await call(playbooks, 'POST', {
      kind: 'duplicate',
      id: play.id,
      version: play.version,
    }),
  );
  const copy = copied.plays.find((item) => item.id === copied.createdId);
  assert.equal(copy.locked, false);
  assert.deepEqual(copy.routes, play.routes);
  assert.equal(copy.assignments.length, 1);
  assert.notEqual(copy.assignments[0].id, play.assignments[0].id);
  ok(await call(playbooks, 'PUT', { ...copy, name: 'Revised boundary read' }));
  const after = ok(await call(installs, 'GET', null, `?packageId=${a.id}`));
  assert.equal(after.items[0].title, 'Boundary read');
  assert.equal(after.reviews[0].acknowledged, false);
  const draft = ok(
    await call(installs, 'POST', { packageId: b.id, playId: copy.id }),
  );
  ok(
    await call(installs, 'DELETE', {
      kind: 'item',
      packageId: b.id,
      itemId: draft.items[0].id,
    }),
  );
  ok(await call(installs, 'DELETE', { kind: 'package', packageId: b.id }));
  assert.equal(
    (await call(installs, 'GET', null, `?packageId=${b.id}`)).status,
    400,
  );
  const library = ok(await call(playbooks, 'GET'));
  assert.ok(
    library.plays.some((item) => item.id === copy.id),
    'Removing draft content retains original play',
  );
});

test('invalid diagram input and duplicate positions cannot destroy a previously saved play', async () => {
  const library = ok(await call(playbooks, 'GET'));
  const play = library.plays.find((item) => !item.locked);
  assert.equal(
    (
      await call(playbooks, 'PUT', {
        ...play,
        routes: [{ id: 'broken', startX: 'invalid' }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(playbooks, 'PUT', {
        ...play,
        name: 'Should roll back',
        assignments: [
          { id: 'one', position: 'X', title: 'One' },
          { id: 'two', position: 'X', title: 'Two' },
        ],
      })
    ).status,
    400,
  );
  const restored = ok(await call(playbooks, 'GET')).plays.find(
    (item) => item.id === play.id,
  );
  assert.equal(restored.name, play.name);
  assert.deepEqual(restored.assignments, play.assignments);
});

test('defensive/scout formations, custom packages, opponent snapshots and modern drawings persist end to end', async () => {
  const createFormation = async (
    name,
    scope,
    packageName,
    opponent = '',
    unit = 'Defence',
  ) => {
    const result = ok(
      await call(playbooks, 'POST', {
        kind: 'formation',
        name,
        scope,
        packageName,
        opponent,
        unit,
      }),
    );
    return result.formations.find((f) => f.id === result.createdId);
  };
  const jumbo = await createFormation('4-3', 'team', 'Jumbo');
  const nascar = await createFormation('4-3', 'team', 'Nascar');
  const scout = await createFormation('3-3-6', 'scout', '', 'NKEC', 'Offence');
  const otherScout = await createFormation(
    '3-3-6',
    'scout',
    '',
    'Other opponent',
    'Offence',
  );
  assert.notEqual(jumbo.id, nascar.id);
  assert.equal(jumbo.name, '4-3');
  assert.equal(jumbo.packageName, 'Jumbo');
  assert.equal(scout.opponent, 'NKEC');
  assert.notEqual(scout.id, otherScout.id);
  assert.equal(jumbo.diagramVersion, 2);
  assert.ok(jumbo.players.some((p) => p.label === 'FS'));
  assert.ok(!jumbo.players.some((p) => p.label === 'Q'));
  const books = ok(
    await call(playbooks, 'POST', {
      kind: 'book',
      name: 'QA defence',
      side: 'Defence',
    }),
  );
  const book = books.books.find((b) => b.name === 'QA defence');
  const newData = ok(
    await call(playbooks, 'POST', {
      kind: 'play',
      playbookId: book.id,
      name: 'Coverage test',
      family: 'Coverage',
      concept: 'Coverage',
      formationId: nascar.id,
    }),
  );
  const play = newData.plays.find((p) => p.id === newData.createdId);
  assert.equal(play.unit, 'Defence');
  assert.equal(play.formation, '4-3');
  assert.deepEqual(play.players, nascar.players);
  assert.equal(
    (
      await call(playbooks, 'POST', {
        kind: 'play',
        playbookId: book.id,
        name: 'Wrong side',
        formationId: scout.id,
      })
    ).status,
    400,
  );
  const scene = designer.normalizeDrawing(play);
  assert.equal(
    new Set(designer.startingPlayers('Defence').map((p) => p.colour)).size,
    3,
  );
  const p = scene.players.find((item) => item.label === 'S');
  p.colour = '#ef665c';
  scene.routes = [
    {
      id: 'two-yard-route',
      playerId: p.id,
      startX: p.x,
      startY: p.y,
      endX: p.x + 20,
      endY: p.y - 20,
      points: [
        { x: p.x, y: p.y },
        { x: p.x, y: p.y - 20 },
        { x: p.x + 20, y: p.y - 20 },
      ],
      colour: p.colour,
      lineStyle: 'dashed',
      ending: 'bar',
    },
  ];
  scene.zones = [
    {
      id: 'oval',
      x: 150,
      y: p.y - 100,
      width: 100,
      height: 60,
      shape: 'ellipse',
      colour: '#52c5b5',
      opacity: 0.4,
      rotation: 25,
    },
    {
      id: 'rectangle',
      x: 300,
      y: p.y - 120,
      width: 60,
      height: 80,
      shape: 'rectangle',
      colour: '#5c9fda',
      opacity: 0.25,
      rotation: 0,
    },
  ];
  scene.labels = [
    { id: 'label', x: 250, y: p.y - 70, text: 'Deep half', colour: '#e5e9ef' },
  ];
  scene.showOpponent = true;
  scene.opponentFormationId = scout.id;
  scene.opponentPlayers = designer.formationPlayers(
    scout,
    scene.fieldPosition,
    true,
  );
  const shifted = designer.shiftScene(scene, 75);
  const attached = designer.normalizeDrawing({
    ...scene,
    zones: [{ ...scene.zones[0], routeId: scene.routes[0].id }],
  });
  assert.equal(
    attached.zones[0].x + attached.zones[0].width / 2,
    scene.routes[0].endX,
  );
  assert.equal(
    attached.zones[0].y + attached.zones[0].height / 2,
    scene.routes[0].endY,
  );
  const extended = structuredClone(attached);
  extended.routes[0].points.push({
    x: scene.routes[0].endX + 20,
    y: scene.routes[0].endY - 30,
  });
  const extendedDrawing = designer.normalizeDrawing(extended);
  assert.equal(extendedDrawing.zones[0].x, attached.zones[0].x + 20);
  assert.equal(extendedDrawing.zones[0].y, attached.zones[0].y - 30);
  const delta = 200;
  assert.equal(shifted.players[0].y - scene.players[0].y, delta);
  assert.equal(
    shifted.routes[0].points[2].y - scene.routes[0].points[2].y,
    delta,
  );
  assert.equal(
    shifted.opponentPlayers[0].y - scene.opponentPlayers[0].y,
    delta,
  );
  assert.equal(shifted.zones[0].y - scene.zones[0].y, delta);
  assert.equal(shifted.labels[0].y - scene.labels[0].y, delta);
  ok(await call(playbooks, 'PUT', { ...play, ...shifted }));
  const reloaded = ok(await call(playbooks, 'GET')).plays.find(
    (item) => item.id === play.id,
  );
  assert.equal(reloaded.diagramVersion, 2);
  assert.equal(reloaded.fieldPosition, 75);
  assert.deepEqual(reloaded.routes, shifted.routes);
  assert.deepEqual(reloaded.zones, shifted.zones);
  assert.deepEqual(reloaded.opponentPlayers, shifted.opponentPlayers);
  assert.equal(reloaded.opponentFormationId, scout.id);
  const duplicate = ok(
    await call(playbooks, 'POST', {
      kind: 'duplicate',
      id: play.id,
      version: reloaded.version,
    }),
  );
  const copy = duplicate.plays.find((p) => p.id === duplicate.createdId);
  assert.deepEqual(copy.routes, reloaded.routes);
  assert.deepEqual(copy.zones, reloaded.zones);
  assert.deepEqual(copy.opponentPlayers, reloaded.opponentPlayers);
  assert.equal(designer.snapY(p.y - 17), p.y - 20);
  assert.equal(designer.YARD, 10);
  assert.match(
    designer.routePath({ ...scene.routes[0], lineStyle: 'curve' }),
    /Q/,
  );
  const before = JSON.stringify(reloaded);
  assert.equal(
    (
      await call(playbooks, 'PUT', {
        ...reloaded,
        zones: [{ ...reloaded.zones[0], opacity: 2 }],
      })
    ).status,
    400,
  );
  assert.equal(
    JSON.stringify(
      ok(await call(playbooks, 'GET')).plays.find((p) => p.id === play.id),
    ),
    before,
  );
});
test('deleting an opponent persists coherent routes and detached coverage, while invalid links preserve the saved play', async () => {
  const designer = await import(designerUrl);
  const books = ok(
    await call(playbooks, 'POST', {
      kind: 'book',
      name: 'Link integrity',
      side: 'Defence',
    }),
  );
  const book = books.books.find((item) => item.name === 'Link integrity');
  const created = ok(
    await call(playbooks, 'POST', {
      kind: 'play',
      playbookId: book.id,
      name: 'Linked defence',
    }),
  );
  let play = created.plays.find((item) => item.id === created.createdId);
  const scene = designer.normalizeDrawing(play);
  const own = scene.players[0];
  scene.opponentPlayers = [
    { id: 'opponent-q', label: 'Q', kind: 'qb', x: 360, y: 680 },
  ];
  scene.showOpponent = true;
  scene.routes = [own, scene.opponentPlayers[0]].map((player, index) => ({
    id: `link-${index}`,
    playerId: player.id,
    startX: player.x,
    startY: player.y,
    endX: player.x,
    endY: player.y - 40,
    points: [
      { x: player.x, y: player.y },
      { x: player.x, y: player.y - 40 },
    ],
    colour: '#ffffff',
    lineStyle: 'solid',
  }));
  scene.zones = [
    {
      id: 'coverage',
      routeId: 'link-1',
      x: 340,
      y: 620,
      width: 40,
      height: 40,
      colour: '#ffffff',
    },
  ];
  play = ok(await call(playbooks, 'PUT', { ...play, ...scene })).plays.find(
    (p) => p.id === play.id,
  );
  const removed = designer.removeSceneItem(scene, 'opponent', 'opponent-q');
  ok(await call(playbooks, 'PUT', { ...play, ...removed }));
  const reopened = ok(await call(playbooks, 'GET')).plays.find(
    (item) => item.id === play.id,
  );
  assert.equal(reopened.opponentPlayers.length, 0);
  assert.deepEqual(
    reopened.routes.map((route) => route.id),
    ['link-0'],
  );
  assert.equal(reopened.zones[0].routeId, undefined);
  assert.equal(reopened.zones[0].x, 340);
  const invalid = await call(playbooks, 'PUT', {
    ...reopened,
    name: 'Must not replace',
    zones: [{ ...reopened.zones[0], routeId: 'missing' }],
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    ok(await call(playbooks, 'GET')).plays.find((item) => item.id === play.id)
      .name,
    'Linked defence',
  );
});

test('creation retries return exact IDs without duplicate books, plays, formations or assignments', async () => {
  const creationId = crypto.randomUUID();
  const body = {
    kind: 'book',
    name: 'Retry defence',
    side: 'Defence',
    creationId,
  };
  const first = ok(await call(playbooks, 'POST', body));
  const retry = ok(
    await call(playbooks, 'POST', {
      creationId,
      side: 'Defence',
      name: 'Retry defence',
      kind: 'book',
    }),
  );
  assert.equal(retry.createdId, first.createdId);
  assert.equal(retry.books.filter((b) => b.name === body.name).length, 1);
  assert.equal(
    (await call(playbooks, 'POST', { ...body, name: 'Changed' })).status,
    409,
  );
  assert.equal(
    (await call(playbooks, 'POST', { ...body, creationId: 'bad' })).status,
    400,
  );
  const invalidId = crypto.randomUUID();
  assert.equal(
    (
      await call(playbooks, 'POST', {
        kind: 'book',
        side: 'Defence',
        creationId: invalidId,
      })
    ).status,
    400,
  );
  assert.equal(
    sqlite
      .prepare('SELECT count(*) n FROM workspace_state WHERE state_key = ?')
      .get('pb-create-' + invalidId).n,
    0,
  );
  const playBody = {
    kind: 'play',
    name: 'Retry coverage',
    playbookId: first.createdId,
    creationId: crypto.randomUUID(),
  };
  const play = ok(await call(playbooks, 'POST', playBody));
  assert.equal(
    ok(await call(playbooks, 'POST', playBody)).createdId,
    play.createdId,
  );
  sqlite
    .prepare(
      'INSERT INTO play_assignments (id,play_id,position,title,detail,sort_order) VALUES (?,?,?,?,?,?)',
    )
    .run(crypto.randomUUID(), play.createdId, 'FS', 'Read', 'Deep middle', 0);
  const copyBody = {
    kind: 'duplicate',
    id: play.createdId,
    version: ok(await call(playbooks, 'GET')).plays.find(
      (p) => p.id === play.createdId,
    ).version,
    creationId: crypto.randomUUID(),
  };
  const copy = ok(await call(playbooks, 'POST', copyBody));
  assert.equal(
    ok(await call(playbooks, 'POST', copyBody)).createdId,
    copy.createdId,
  );
  assert.equal(
    sqlite
      .prepare('SELECT count(*) n FROM play_assignments WHERE play_id = ?')
      .get(copy.createdId).n,
    1,
  );
  const formationBody = {
    kind: 'formation',
    name: 'Retry 6-Pack',
    unit: 'Defence',
    scope: 'team',
    creationId: crypto.randomUUID(),
  };
  const formation = ok(await call(playbooks, 'POST', formationBody));
  assert.equal(
    ok(await call(playbooks, 'POST', formationBody)).createdId,
    formation.createdId,
  );
  ok(
    await call(playbooks, 'DELETE', {
      kind: 'formation',
      id: formation.createdId,
      version: formation.formations.find((f) => f.id === formation.createdId)
        .version,
    }),
  );
  assert.equal((await call(playbooks, 'POST', formationBody)).status, 409);
});

test('the browser library validator accepts real saved payloads', async () => {
  const { parsePlaybookLibrary } = await import(
    await moduleUrl('../lib/playbook-library.ts', replacements)
  );
  const data = ok(await call(playbooks, 'GET'));
  assert.equal(parsePlaybookLibrary(data).plays.length, data.plays.length);
});

test('stale designer, formation and book saves cannot overwrite newer content or assignments', async () => {
  const first = ok(
    await call(playbooks, 'POST', {
      kind: 'book',
      name: 'Concurrency',
      side: 'Defence',
    }),
  );
  const book = first.books.find((b) => b.id === first.createdId);
  assert.match(book.version, /^[a-f0-9]{64}$/);
  const bookUpdate = { kind: 'book', ...book, name: 'Newer name' };
  ok(await call(playbooks, 'PUT', bookUpdate));
  assert.equal(
    (await call(playbooks, 'PUT', { ...bookUpdate, name: 'Stale name' }))
      .status,
    409,
  );
  assert.equal(
    (await call(playbooks, 'PUT', { ...bookUpdate, version: null })).status,
    400,
  );
  assert.equal(
    ok(await call(playbooks, 'GET')).books.find((b) => b.id === book.id).name,
    'Newer name',
  );
  const made = ok(
    await call(playbooks, 'POST', {
      kind: 'play',
      playbookId: book.id,
      name: 'Old drawing',
    }),
  );
  const old = made.plays.find((p) => p.id === made.createdId);
  const updated = ok(
    await call(playbooks, 'PUT', {
      ...old,
      name: 'New drawing',
      notes: 'Latest note',
      assignments: [
        { id: 'a', position: 'FS', title: 'Deep', detail: 'Middle' },
      ],
    }),
  ).plays.find((p) => p.id === old.id);
  assert.notEqual(updated.version, old.version);
  assert.equal(
    (
      await call(playbooks, 'PUT', {
        ...old,
        name: 'Stale drawing',
        assignments: [],
      })
    ).status,
    409,
  );
  const reopened = ok(await call(playbooks, 'GET')).plays.find(
    (p) => p.id === old.id,
  );
  assert.equal(reopened.name, 'New drawing');
  assert.equal(reopened.notes, 'Latest note');
  assert.equal(reopened.assignments[0].title, 'Deep');
  // Change an assignment after preflight but before the actual transaction.
  const originalBatch = database.batch;
  let injected = false;
  database.batch = async function (statements) {
    if (!injected) {
      injected = true;
      sqlite
        .prepare('UPDATE play_assignments SET detail = ? WHERE play_id = ?')
        .run('Changed during save', old.id);
    }
    return originalBatch.call(this, statements);
  };
  try {
    assert.equal(
      (
        await call(playbooks, 'PUT', {
          ...updated,
          name: 'Must roll back',
          assignments: [],
        })
      ).status,
      409,
    );
  } finally {
    database.batch = originalBatch;
  }
  const raced = ok(await call(playbooks, 'GET')).plays.find(
    (p) => p.id === old.id,
  );
  assert.equal(raced.name, 'New drawing');
  assert.equal(raced.assignments[0].detail, 'Changed during save');
  const draftInstall = ok(
    await call(installs, 'POST', {
      kind: 'package',
      name: 'Publication race',
      unit: 'Defence',
      dueAt: '',
    }),
  ).package;
  ok(
    await call(installs, 'POST', {
      packageId: draftInstall.id,
      playId: raced.id,
    }),
  );
  injected = false;
  database.batch = async function (statements) {
    if (!injected) {
      injected = true;
      sqlite
        .prepare('UPDATE install_packages SET published_at = ? WHERE id = ?')
        .run(new Date().toISOString(), draftInstall.id);
    }
    return originalBatch.call(this, statements);
  };
  try {
    assert.equal(
      (
        await call(playbooks, 'PUT', {
          ...raced,
          name: 'Must not change after publication',
        })
      ).status,
      409,
    );
  } finally {
    database.batch = originalBatch;
  }
  assert.equal(
    ok(await call(playbooks, 'GET')).plays.find((p) => p.id === raced.id).name,
    raced.name,
  );
  const formationCreated = ok(
    await call(playbooks, 'POST', {
      kind: 'formation',
      name: 'Concurrent 6-Pack',
      unit: 'Defence',
      scope: 'team',
    }),
  );
  const formation = formationCreated.formations.find(
    (f) => f.id === formationCreated.createdId,
  );
  ok(
    await call(playbooks, 'PUT', {
      ...formation,
      kind: 'formation',
      name: 'Latest 6-Pack',
    }),
  );
  assert.equal(
    (
      await call(playbooks, 'PUT', {
        ...formation,
        kind: 'formation',
        name: 'Stale 6-Pack',
      })
    ).status,
    409,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT count(*) n FROM workspace_state WHERE state_key LIKE 'pb-save-%'",
      )
      .get().n,
    0,
  );
});

test('Playbook install client confirms real handler responses and safe repeated additions', async () => {
  const parserUrl = await moduleUrl('../lib/install-data.ts');
  const client = await import(
    await moduleUrl('../lib/playbook-install.ts', [
      ["'@/lib/install-data'", JSON.stringify(parserUrl)],
    ])
  );
  const fetcher = async (_path, options = {}) =>
    installs[options.method ?? 'GET'](
      new Request('http://test/api/install', options),
    );
  const library = ok(
    await call(playbooks, 'POST', {
      kind: 'book',
      name: 'Client handoff',
      side: 'Defence',
    }),
  );
  const made = ok(
    await call(playbooks, 'POST', {
      kind: 'play',
      name: 'Client saved play',
      playbookId: library.createdId,
    }),
  );
  const pack = ok(
    await call(installs, 'POST', {
      kind: 'package',
      name: 'No fixed cadence',
      unit: 'Team',
      dueAt: '',
    }),
  ).package;
  const choices = await client.loadInstallDestinations(
    'Defence',
    undefined,
    fetcher,
  );
  assert.ok(choices.some((choice) => choice.id === pack.id));
  assert.ok(
    choices.every(
      (choice) =>
        !choice.publishedAt && ['Team', 'Defence'].includes(choice.unit),
    ),
  );
  assert.equal(
    (
      await client.addSavedPlayToInstall(
        pack.id,
        made.createdId,
        'Defence',
        fetcher,
      )
    ).id,
    pack.id,
  );
  await client.addSavedPlayToInstall(
    pack.id,
    made.createdId,
    'Defence',
    fetcher,
  );
  assert.equal(
    ok(await call(installs, 'GET', null, '?packageId=' + pack.id)).items.length,
    1,
  );
});

test('copy is one coherent source version and failed or retried copies cannot leave partial records', async () => {
  const madeBook = ok(
    await call(playbooks, 'POST', {
      kind: 'book',
      name: 'Copy transaction',
      side: 'Defence',
    }),
  );
  const made = ok(
    await call(playbooks, 'POST', {
      kind: 'play',
      name: 'Copy source',
      playbookId: madeBook.createdId,
    }),
  );
  let source = made.plays.find((p) => p.id === made.createdId);
  source = ok(
    await call(playbooks, 'PUT', {
      ...source,
      assignments: [
        {
          id: 'source-a',
          position: 'FS',
          title: 'Old read',
          detail: 'Old detail',
        },
      ],
    }),
  ).plays.find((p) => p.id === source.id);
  const creationId = crypto.randomUUID(),
    body = {
      kind: 'duplicate',
      id: source.id,
      version: source.version,
      creationId,
    };
  const count = sqlite.prepare('SELECT count(*) n FROM plays').get().n;
  const originalBatch = database.batch;
  let injected = false;
  database.batch = async function (statements) {
    if (!injected) {
      injected = true;
      const diagram = JSON.parse(
        sqlite
          .prepare('SELECT diagram_json FROM plays WHERE id = ?')
          .get(source.id).diagram_json,
      );
      diagram.labels = [
        {
          id: 'latest-label',
          x: 200,
          y: 600,
          text: 'Latest diagram',
          colour: '#ffffff',
        },
      ];
      sqlite
        .prepare(
          'UPDATE plays SET name = ?, notes = ?, diagram_json = ? WHERE id = ?',
        )
        .run(
          'Latest copy source',
          'Latest note',
          JSON.stringify(diagram),
          source.id,
        );
      sqlite
        .prepare(
          'UPDATE play_assignments SET title = ?, detail = ? WHERE play_id = ?',
        )
        .run('Latest read', 'Latest detail', source.id);
    }
    return originalBatch.call(this, statements);
  };
  try {
    assert.equal((await call(playbooks, 'POST', body)).status, 409);
  } finally {
    database.batch = originalBatch;
  }
  assert.equal(sqlite.prepare('SELECT count(*) n FROM plays').get().n, count);
  assert.equal(
    sqlite
      .prepare('SELECT count(*) n FROM workspace_state WHERE state_key = ?')
      .get('pb-create-' + creationId).n,
    0,
  );
  assert.equal((await call(playbooks, 'POST', body)).status, 409);
  const latest = ok(await call(playbooks, 'GET')).plays.find(
    (p) => p.id === source.id,
  );
  const freshBody = { ...body, version: latest.version };
  const copied = ok(await call(playbooks, 'POST', freshBody));
  const copy = copied.plays.find((p) => p.id === copied.createdId);
  assert.equal(copy.name, 'Latest copy source — copy');
  assert.equal(copy.notes, 'Latest note');
  assert.equal(copy.labels[0].text, 'Latest diagram');
  assert.equal(copy.assignments[0].title, 'Latest read');
  assert.equal(copy.assignments[0].detail, 'Latest detail');
  assert.notEqual(copy.assignments[0].id, latest.assignments[0].id);
  assert.equal(
    (
      await call(playbooks, 'DELETE', {
        kind: 'play',
        id: source.id,
        version: source.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (await call(playbooks, 'DELETE', { kind: 'play', id: source.id })).status,
    400,
  );
  ok(
    await call(playbooks, 'DELETE', {
      kind: 'play',
      id: source.id,
      version: latest.version,
    }),
  );
  assert.equal(
    ok(await call(playbooks, 'POST', freshBody)).createdId,
    copy.id,
    'An already confirmed copy retries safely even if its source was removed',
  );
  assert.equal(
    (await call(playbooks, 'POST', { kind: 'duplicate', id: copy.id })).status,
    400,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT count(*) n FROM workspace_state WHERE state_key LIKE 'pb-save-%'",
      )
      .get().n,
    0,
  );
});

test('delete checks content and new child/install links inside the transaction rather than cascading over newer work', async () => {
  const madeBook = ok(
    await call(playbooks, 'POST', {
      kind: 'book',
      name: 'Delete transaction',
      side: 'Defence',
    }),
  );
  let book = madeBook.books.find((b) => b.id === madeBook.createdId);
  const renamed = ok(
    await call(playbooks, 'PUT', {
      ...book,
      kind: 'book',
      name: 'New book name',
    }),
  );
  assert.equal(
    (
      await call(playbooks, 'DELETE', {
        kind: 'book',
        id: book.id,
        version: book.version,
      })
    ).status,
    409,
  );
  book = renamed.books.find((b) => b.id === book.id);
  const template = ok(
    await call(playbooks, 'POST', {
      kind: 'play',
      name: 'Template for race',
      playbookId: book.id,
    }),
  );
  const templatePlay = template.plays.find((p) => p.id === template.createdId);
  const emptyMade = ok(
    await call(playbooks, 'POST', {
      kind: 'book',
      name: 'Empty before race',
      side: 'Defence',
    }),
  );
  const emptyBook = emptyMade.books.find((b) => b.id === emptyMade.createdId);
  const originalBatch = database.batch;
  let injected = false;
  database.batch = async function (statements) {
    if (!injected) {
      injected = true;
      sqlite
        .prepare(
          'INSERT INTO plays (id,team_id,playbook_id,formation_id,name,unit,category,family,concept,diagram_json,notes,created_at,updated_at) SELECT ?,team_id,?,formation_id,?,unit,category,family,concept,diagram_json,notes,created_at,updated_at FROM plays WHERE id = ?',
        )
        .run(
          crypto.randomUUID(),
          emptyBook.id,
          'Created during deletion',
          templatePlay.id,
        );
    }
    return originalBatch.call(this, statements);
  };
  try {
    assert.equal(
      (
        await call(playbooks, 'DELETE', {
          kind: 'book',
          id: emptyBook.id,
          version: emptyBook.version,
        })
      ).status,
      409,
    );
  } finally {
    database.batch = originalBatch;
  }
  assert.ok(
    sqlite.prepare('SELECT id FROM playbooks WHERE id = ?').get(emptyBook.id),
  );
  assert.equal(
    sqlite
      .prepare('SELECT count(*) n FROM plays WHERE playbook_id = ?')
      .get(emptyBook.id).n,
    1,
  );
  const install = ok(
    await call(installs, 'POST', {
      kind: 'package',
      name: 'Link during delete',
      unit: 'Defence',
      dueAt: '',
    }),
  ).package;
  injected = false;
  database.batch = async function (statements) {
    if (!injected) {
      injected = true;
      sqlite
        .prepare(
          "INSERT INTO install_items (id,package_id,play_id,title,item_type,position_group,sort_order) VALUES (?,?,?,?,'Play','Defence',0)",
        )
        .run(
          crypto.randomUUID(),
          install.id,
          templatePlay.id,
          templatePlay.name,
        );
    }
    return originalBatch.call(this, statements);
  };
  try {
    assert.equal(
      (
        await call(playbooks, 'DELETE', {
          kind: 'play',
          id: templatePlay.id,
          version: templatePlay.version,
        })
      ).status,
      409,
    );
  } finally {
    database.batch = originalBatch;
  }
  assert.ok(
    sqlite.prepare('SELECT id FROM plays WHERE id = ?').get(templatePlay.id),
  );
  assert.equal(
    ok(await call(installs, 'GET', null, '?packageId=' + install.id)).items
      .length,
    1,
  );
  const formationMade = ok(
    await call(playbooks, 'POST', {
      kind: 'formation',
      name: 'Delete stale formation',
      unit: 'Defence',
      scope: 'team',
    }),
  );
  const formation = formationMade.formations.find(
    (f) => f.id === formationMade.createdId,
  );
  const changed = ok(
    await call(playbooks, 'PUT', {
      ...formation,
      kind: 'formation',
      name: 'Latest formation name',
    }),
  ).formations.find((f) => f.id === formation.id);
  assert.equal(
    (
      await call(playbooks, 'DELETE', {
        kind: 'formation',
        id: formation.id,
        version: formation.version,
      })
    ).status,
    409,
  );
  ok(
    await call(playbooks, 'DELETE', {
      kind: 'formation',
      id: formation.id,
      version: changed.version,
    }),
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT count(*) n FROM workspace_state WHERE state_key LIKE 'pb-save-%'",
      )
      .get().n,
    0,
  );
});

test('publication preserves one atomic teaching copy and rejects unreadable material without partial publication', async () => {
  const {teamId}=await getDatabase();
  const now=new Date().toISOString();
  sqlite.prepare("INSERT INTO athletes(id,team_id,number,first_name,last_name,position,unit,graduation_year,height,weight_lb,status,eligibility,attendance_percent,install_percent,email,phone,staff_note,created_at,updated_at) VALUES(?,?,99,'Snapshot','Player','X','Offence',12,'',0,'Active','Cleared',0,0,'snapshot@example.invalid','','',?,?)").run('snapshot-athlete',teamId,now,now);
  const book=ok(await call(playbooks,'POST',{kind:'book',name:'Issued versions',side:'Offence'}));
  const made=ok(await call(playbooks,'POST',{kind:'play',playbookId:book.createdId,name:'Issued route'}));
  const source=sqlite.prepare('SELECT diagram_json FROM plays WHERE id=?').get(made.createdId).diagram_json;
  const pack=ok(await call(installs,'POST',{kind:'package',name:'Camp afternoon',unit:'Offence'})).package;
  ok(await call(installs,'POST',{packageId:pack.id,playId:made.createdId}));
  sqlite.prepare('UPDATE plays SET diagram_json=? WHERE id=?').run('{"players":"invalid"}',made.createdId);
  assert.equal((await call(installs,'PATCH',{kind:'publish',packageId:pack.id})).status,400);
  assert.equal(sqlite.prepare('SELECT published_at FROM install_packages WHERE id=?').get(pack.id).published_at,null);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM athlete_reviews r JOIN install_items i ON i.id=r.install_item_id WHERE i.package_id=?').get(pack.id).n,0);
  assert.equal(sqlite.prepare('SELECT id FROM workspace_state WHERE team_id=? AND state_key=?').get(teamId,'install-published-v1:'+pack.id),undefined);
  sqlite.prepare('UPDATE plays SET diagram_json=? WHERE id=?').run(source,made.createdId);
  const originalBatch=database.batch;
  let injected=false;
  database.batch=async function(statements){
    if(!injected){injected=true;sqlite.prepare('UPDATE plays SET notes=? WHERE id=?').run('Latest committed instruction',made.createdId);}
    return originalBatch.call(this,statements);
  };
  let published;
  try{published=ok(await call(installs,'PATCH',{kind:'publish',packageId:pack.id}));}finally{database.batch=originalBatch;}
  assert.equal(injected,true);
  assert.equal(published.items[0].materialSource,'published');
  assert.equal(published.items[0].material.notes,'Latest committed instruction');
  const frozen=published.items[0].material;
  sqlite.prepare('UPDATE plays SET notes=? WHERE id=?').run('Different future source',made.createdId);
  const reopened=ok(await call(installs,'GET',null,'?packageId='+pack.id));
  assert.deepEqual(reopened.items[0].material,frozen);
  assert.deepEqual(ok(await call(installs,'PATCH',{kind:'publish',packageId:pack.id})).items[0].material,frozen,'publication retry cannot replace the issued version');
});
