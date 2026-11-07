import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const moduleFrom = async (file) => {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  );
};
const { normalizeDrawing, removeSceneItem, replaceScenePlayers } =
  await moduleFrom('../lib/play-designer.ts');
const { validatePlayDiagram } = await moduleFrom('../lib/validate-play.ts');
const player = (id, x) => ({ id, x, y: 650, label: id, kind: 'skill' });
const route = (id, playerId, x) => ({
  id,
  playerId,
  startX: x,
  startY: 650,
  endX: x,
  endY: 550,
  points: [
    { x, y: 650 },
    { x, y: 550 },
  ],
  colour: '#ffffff',
  lineStyle: 'solid',
});
const original = () =>
  normalizeDrawing({
    diagramVersion: 2,
    fieldPosition: 55,
    players: [player('own', 200)],
    opponentPlayers: [player('opp', 400)],
    routes: [route('r-own', 'own', 200), route('r-opp', 'opp', 400)],
    zones: [
      {
        id: 'coverage',
        routeId: 'r-opp',
        x: 370,
        y: 520,
        width: 60,
        height: 60,
        colour: '#ffffff',
      },
    ],
    labels: [],
    showOpponent: true,
  });

test('deleting opponents or routes removes dangling links while retaining coverage geometry and other routes', () => {
  const scene = original();
  const before = structuredClone(scene);
  const removed = removeSceneItem(scene, 'opponent', 'opp');
  assert.deepEqual(scene, before, 'undo snapshot must remain unchanged');
  assert.equal(removed.opponentPlayers.length, 0);
  assert.deepEqual(
    removed.routes.map((item) => item.id),
    ['r-own'],
  );
  assert.equal(removed.zones[0].routeId, undefined);
  assert.equal(removed.zones[0].x, scene.zones[0].x);
  assert.equal(removed.zones[0].y, scene.zones[0].y);
  validatePlayDiagram(removed);
  const routeRemoved = removeSceneItem(scene, 'route', 'r-opp');
  assert.equal(routeRemoved.zones.length, 1);
  assert.equal(routeRemoved.zones[0].routeId, undefined);
});

test('formation changes clear only the replaced side’s routes and repair old orphan references', () => {
  const scene = original();
  const own = replaceScenePlayers(scene, [player('new-own', 250)]);
  assert.deepEqual(
    own.routes.map((item) => item.id),
    ['r-opp'],
  );
  assert.equal(own.zones[0].routeId, 'r-opp');
  const opponent = replaceScenePlayers(scene, [player('new-opp', 450)], true);
  assert.deepEqual(
    opponent.routes.map((item) => item.id),
    ['r-own'],
  );
  assert.equal(opponent.zones[0].routeId, undefined);
  const orphan = normalizeDrawing({
    ...scene,
    opponentPlayers: [],
    routes: [route('old-route', 'missing-player', 100)],
    zones: [{ ...scene.zones[0], routeId: 'missing-route' }],
  });
  assert.equal(orphan.routes[0].playerId, undefined);
  assert.equal(orphan.zones[0].routeId, undefined);
  validatePlayDiagram(orphan);
});

test('modern writes reject missing anchors and route references instead of persisting broken links', () => {
  const scene = original();
  assert.throws(
    () =>
      validatePlayDiagram({
        ...scene,
        routes: [{ ...scene.routes[0], playerId: 'missing' }],
      }),
    /player/,
  );
  assert.throws(
    () =>
      validatePlayDiagram({
        ...scene,
        zones: [{ ...scene.zones[0], routeId: 'missing' }],
      }),
    /route/,
  );
  assert.throws(
    () =>
      validatePlayDiagram({ ...scene, opponentPlayers: [player('own', 300)] }),
    /distinct IDs/,
  );
});
