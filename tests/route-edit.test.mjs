import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/route-edit.ts', import.meta.url),
  'utf8',
);
const { continuationRoute, beginRouteSegment, moveRouteVertex } = await import(
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
const style = { colour: '#52c5b5', lineStyle: 'dashed', ending: 'arrow' };
const empty = () => ({
  diagramVersion: 2,
  fieldPosition: 55,
  players: [{ id: 'p', label: 'FC', kind: 'skill', x: 250, y: 650 }],
  routes: [],
  zones: [],
  labels: [],
  showOpponent: false,
  opponentFormationId: null,
  opponentPlayers: [],
});
test('route gestures append one movable endpoint and preserve the original scene', () => {
  const initial = empty(),
    begun = beginRouteSegment(initial, 'p', '', { x: 250, y: 620 }, style, 'r');
  assert.equal(initial.routes.length, 0);
  assert.equal(begun.scene.routes.length, 1);
  assert.deepEqual(begun.scene.routes[0].points, [
    { x: 250, y: 650 },
    { x: 250, y: 620 },
  ]);
  const dragged = moveRouteVertex(begun.scene, 'r', begun.index, {
    x: 280,
    y: 610,
  });
  assert.deepEqual(dragged.routes[0].points, [
    { x: 250, y: 650 },
    { x: 280, y: 610 },
  ]);
  assert.equal(dragged.routes[0].endX, 280);
  assert.equal(begun.scene.routes[0].endX, 250);
  const continued = beginRouteSegment(
    dragged,
    'p',
    '',
    { x: 310, y: 610 },
    { ...style, colour: '#ffffff' },
    'unwanted',
  );
  assert.equal(continued.routeId, 'r');
  assert.equal(continued.scene.routes.length, 1);
  assert.equal(continued.scene.routes[0].points.length, 3);
  assert.equal(continued.scene.routes[0].colour, style.colour);
});
test('reselection continues the preferred or latest player route; a new branch requires the explicit flag', () => {
  const first = beginRouteSegment(
    empty(),
    'p',
    '',
    { x: 250, y: 620 },
    style,
    'first',
  );
  const second = beginRouteSegment(
    first.scene,
    'p',
    '',
    { x: 300, y: 650 },
    style,
    'second',
    true,
  );
  assert.equal(second.scene.routes.length, 2);
  assert.equal(second.routeId, 'second');
  assert.equal(continuationRoute(second.scene, 'p').id, 'second');
  assert.equal(continuationRoute(second.scene, 'p', 'first').id, 'first');
  assert.equal(continuationRoute(second.scene, 'foreign'), undefined);
  const continued = beginRouteSegment(
    second.scene,
    'p',
    'first',
    { x: 260, y: 600 },
    style,
    'unused',
  );
  assert.equal(continued.routeId, 'first');
  assert.equal(continued.scene.routes[1].points.length, 2);
  assert.equal(continued.scene.routes[0].points.length, 3);
  assert.equal(
    beginRouteSegment(empty(), 'missing', '', { x: 50, y: 50 }, style, 'r'),
    null,
  );
});
test('coverage follows a dragged or extended endpoint while interior vertices leave the zone at the final end', () => {
  const scene = beginRouteSegment(
    empty(),
    'p',
    '',
    { x: 250, y: 620 },
    style,
    'r',
  ).scene;
  scene.zones = [
    {
      id: 'z',
      routeId: 'r',
      x: 210,
      y: 590,
      width: 80,
      height: 60,
      colour: style.colour,
    },
  ];
  const continued = beginRouteSegment(
    scene,
    'p',
    'r',
    { x: 300, y: 600 },
    style,
    'unused',
  );
  assert.equal(continued.scene.zones[0].x, 260);
  assert.equal(continued.scene.zones[0].y, 570);
  const moved = moveRouteVertex(continued.scene, 'r', continued.index, {
    x: 320,
    y: 580,
  });
  assert.equal(moved.zones[0].x, 280);
  assert.equal(moved.zones[0].y, 550);
  const interior = moveRouteVertex(moved, 'r', 1, { x: 260, y: 610 });
  assert.deepEqual(interior.zones, moved.zones);
  assert.equal(interior.routes[0].endX, 320);
  assert.equal(scene.zones[0].x, 210);
});
