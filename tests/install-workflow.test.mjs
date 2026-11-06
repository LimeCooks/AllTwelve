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
      bind(...next) { values = next; return this; },
      async first() { return statement.get(...values) ?? null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { return statement.run(...values); },
    };
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
globalThis.chalkTestDatabase = database;
const moduleUrl = async (path, replacements = []) => {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return `data:text/javascript;base64,${Buffer.from(result.outputText).toString('base64')}`;
};
const dbUrl = await moduleUrl('../db/client.ts', [["import { env } from 'cloudflare:workers';", 'const env = { DB: globalThis.chalkTestDatabase };']]);
const validatorUrl = await moduleUrl('../lib/validate-play.ts');
const replacements = [["'@/db/client'", JSON.stringify(dbUrl)], ["'@/lib/validate-play'", JSON.stringify(validatorUrl)]];
const installs = await import(await moduleUrl('../lib/install-api.ts', replacements));
const playbooks = await import(await moduleUrl('../app/api/playbooks/route.ts', replacements));
const { getDatabase, TEAM_ID } = await import(dbUrl);
await getDatabase();

async function call(api, method, body, query = '') {
  const response = await api[method](new Request(`http://test/api${query}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }));
  return { status: response.status, data: await response.json() };
}
const ok = (result) => { assert.ok(result.status < 300, JSON.stringify(result.data)); return result.data; };

test('complete package lifecycle, arbitrary cadence, isolation, publication and safe review boundaries', async () => {
  const bookData = ok(await call(playbooks, 'POST', { kind: 'book', name: 'Test system', side: 'Offence' }));
  const book = bookData.books.find((item) => item.name === 'Test system');
  const created = ok(await call(playbooks, 'POST', { kind: 'play', playbookId: book.id, name: 'Boundary read', concept: 'Read' }));
  let play = created.plays.find((item) => item.id === created.createdId);
  assert.equal(play.family, 'Unassigned');
  const player = { id: 'x', label: 'X', kind: 'skill', x: 100, y: 300, colour: '#30d5c8' };
  const route = { id: 'r', playerId: 'x', startX: 100, startY: 300, endX: 150, endY: 200, colour: '#30d5c8', lineStyle: 'solid', points: [{ x: 100, y: 300 }, { x: 100, y: 240 }, { x: 150, y: 200 }] };
  const saved = ok(await call(playbooks, 'PUT', { ...play, players: [player], routes: [route], assignments: [{ id: 'a', position: 'X', title: 'Read leverage', detail: 'Break outside' }], fieldPosition: 55 }));
  play = saved.plays.find((item) => item.id === play.id);
  assert.deepEqual(play.routes[0].points, route.points);
  assert.equal(play.players[0].colour, player.colour);
  const a = ok(await call(installs, 'POST', { kind: 'package', name: 'Camp day 2', unit: 'Offence' })).package;
  const b = ok(await call(installs, 'POST', { kind: 'package', name: 'Monthly concepts', unit: 'Team', dueAt: '2026-12-01' })).package;
  assert.equal(a.dueAt, ''); assert.equal(b.dueAt, '2026-12-01');
  assert.equal((await call(installs, 'POST', { playId: play.id })).status, 400);
  assert.equal((await call(installs, 'POST', { kind: 'package', name: 'Bad date', dueAt: '2026-02-30' })).status, 400);
  let data = ok(await call(installs, 'POST', { packageId: a.id, playId: play.id }));
  assert.equal(data.items.length, 1);
  data = ok(await call(installs, 'POST', { packageId: a.id, playIds: [play.id, play.id] }));
  assert.equal(data.items.length, 1, 'Adding the same play is idempotent');
  assert.equal(ok(await call(installs, 'GET', null, `?packageId=${b.id}`)).items.length, 0, 'Other packages stay untouched');
  assert.equal((await call(installs, 'POST', { packageId: a.id, playIds: [play.id, 'missing'] })).status, 400);
  assert.equal((await call(installs, 'PATCH', { kind: 'publish', packageId: a.id })).status, 400, 'Cannot publish with no recipients');
  assert.equal((await call(playbooks, 'DELETE', { kind: 'play', id: play.id })).status, 409, 'Installed play cannot silently disappear');
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO athletes (id, team_id, number, first_name, last_name, position, unit, graduation_year, height, weight_lb, status, eligibility, attendance_percent, install_percent, email, phone, staff_note, created_at, updated_at) VALUES ('athlete-test', ?, 1, 'Test', 'Player', 'X', 'Offence', 12, '', 0, 'Active', 'Cleared', 0, 0, 'test@example.invalid', '', '', ?, ?)`).bind(TEAM_ID, now, now).run();
  data = ok(await call(installs, 'PATCH', { kind: 'publish', packageId: a.id }));
  assert.ok(data.package.publishedAt); assert.equal(data.reviews.length, 1); assert.equal(data.reviews[0].acknowledged, false);
  assert.equal(ok(await call(installs, 'PATCH', { kind: 'publish', packageId: a.id })).reviews.length, 1);
  assert.equal((await call(installs, 'PATCH', { packageId: a.id, itemId: data.items[0].id, athleteId: 'athlete-test', step: 'all' })).status, 403, 'Coach preview cannot impersonate athlete completion');
  assert.equal((await call(installs, 'DELETE', { kind: 'package', packageId: a.id })).status, 400);
  assert.equal((await call(installs, 'DELETE', { kind: 'item', packageId: a.id, itemId: data.items[0].id })).status, 400);
  assert.equal((await call(playbooks, 'PUT', play)).status, 409, 'Published teaching content cannot change under reviews');
  const copied = ok(await call(playbooks, 'POST', { kind: 'duplicate', id: play.id }));
  const copy = copied.plays.find((item) => item.id === copied.createdId);
  assert.equal(copy.locked, false); assert.deepEqual(copy.routes, play.routes); assert.equal(copy.assignments.length, 1);
  assert.notEqual(copy.assignments[0].id, play.assignments[0].id);
  ok(await call(playbooks, 'PUT', { ...copy, name: 'Revised boundary read' }));
  const after = ok(await call(installs, 'GET', null, `?packageId=${a.id}`));
  assert.equal(after.items[0].title, 'Boundary read'); assert.equal(after.reviews[0].acknowledged, false);
  const draft = ok(await call(installs, 'POST', { packageId: b.id, playId: copy.id }));
  ok(await call(installs, 'DELETE', { kind: 'item', packageId: b.id, itemId: draft.items[0].id }));
  ok(await call(installs, 'DELETE', { kind: 'package', packageId: b.id }));
  assert.equal((await call(installs, 'GET', null, `?packageId=${b.id}`)).status, 400);
  const library = ok(await call(playbooks, 'GET'));
  assert.ok(library.plays.some((item) => item.id === copy.id), 'Removing draft content retains original play');
});

test('invalid diagram input and duplicate positions cannot destroy a previously saved play', async () => {
  const library = ok(await call(playbooks, 'GET'));
  const play = library.plays.find((item) => !item.locked);
  assert.equal((await call(playbooks, 'PUT', { ...play, routes: [{ id: 'broken', startX: 'invalid' }] })).status, 400);
  assert.equal((await call(playbooks, 'PUT', { ...play, name: 'Should roll back', assignments: [{ id: 'one', position: 'X', title: 'One' }, { id: 'two', position: 'X', title: 'Two' }] })).status, 400);
  const restored = ok(await call(playbooks, 'GET')).plays.find((item) => item.id === play.id);
  assert.equal(restored.name, play.name); assert.deepEqual(restored.assignments, play.assignments);
});
