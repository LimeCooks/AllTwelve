import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/field-camera.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { fieldViewport } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('zoom enlarges field coordinates without changing their yard scale and fit restores the original view', () => {
  const fit = fieldViewport(650, 60);
  assert.deepEqual(fit, {
    x: 0,
    y: 350,
    width: 720,
    height: 600,
    pan: { x: 0, y: 0 },
  });
  const zoomed = fieldViewport(650, 60, 3);
  assert.equal(zoomed.width, fit.width / 3);
  assert.equal(zoomed.height, fit.height / 3);
  assert.equal(zoomed.x + zoomed.width / 2, 360);
  assert.equal(zoomed.y + zoomed.height / 2, 650);
  const panned = fieldViewport(650, 60, 3, { x: -50, y: 80 });
  assert.equal(panned.x, zoomed.x - 50);
  assert.equal(panned.y, zoomed.y + 80);
  assert.deepEqual(fieldViewport(650, 60, 1, { x: 0, y: 0 }), fit);
});

test('camera stays within the field at goal lines, full field, maximum zoom and extreme pans', () => {
  for (const spot of [1, 55, 109])
    for (const depth of [30, 60, 140, 150])
      for (const zoom of [0, 1, 2, 6, 100])
        for (const delta of [-10000, 0, 10000]) {
          const view = fieldViewport(100 + spot * 10, depth, zoom, {
            x: delta,
            y: delta,
          });
          assert.ok(view.width > 0 && view.height > 0);
          assert.ok(view.x >= 0 && view.x + view.width <= 720 + 1e-8);
          assert.ok(view.y >= -100 && view.y + view.height <= 1400 + 1e-8);
          if (delta === 0) {
            const ballY = 100 + spot * 10;
            assert.ok(
              ballY >= view.y && ballY <= view.y + view.height,
              'zoom must keep a goal-line play visible',
            );
          }
          assert.deepEqual(
            fieldViewport(100 + spot * 10, depth, zoom, view.pan),
            view,
            'bounded pan must not accumulate hidden offsets',
          );
        }
});
test('full Canadian amateur field includes both twenty-yard end zones', () => {
  assert.deepEqual(fieldViewport(650, 150), {
    x: 0,
    y: -100,
    width: 720,
    height: 1500,
    pan: { x: 0, y: 0 },
  });
});
