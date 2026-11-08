import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const compile = (source) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
const drawing = compile(
  await readFile(new URL('../lib/play-designer.ts', import.meta.url), 'utf8'),
);
const source = (
  await readFile(new URL('../lib/print-layout.ts', import.meta.url), 'utf8')
).replace("'@/lib/play-designer'", JSON.stringify(drawing));
const { printViewBox, wrapPrintText, inkColour } = await import(
  compile(source)
);
test('print bounds retain routes, rotated coverage and long labels while excluding hidden opponents', () => {
  const play = {
    diagramVersion: 2,
    fieldPosition: 55,
    players: [{ id: 'p', x: 100, y: 650, label: 'X', kind: 'skill' }],
    opponentPlayers: [
      { id: 'op', x: 600, y: 1200, label: 'CB', kind: 'skill' },
    ],
    routes: [
      {
        id: 'r',
        playerId: 'p',
        startX: 100,
        startY: 650,
        endX: 160,
        endY: 300,
        points: [
          { x: 100, y: 650 },
          { x: 160, y: 300 },
        ],
      },
      {
        id: 'hidden',
        playerId: 'op',
        startX: 600,
        startY: 1200,
        endX: 600,
        endY: -1000,
      },
    ],
    zones: [
      {
        id: 'z',
        x: 500,
        y: 500,
        width: 200,
        height: 40,
        rotation: 90,
        colour: '#abcdef',
      },
    ],
    labels: [
      {
        id: 'l',
        x: 700,
        y: 400,
        text: 'A long sideline teaching label',
        colour: '#abcdef',
      },
    ],
    showOpponent: false,
  };
  const before = structuredClone(play),
    box = printViewBox(play);
  assert.ok(box.y <= 280 && box.y + box.height >= 780);
  assert.ok(box.x + box.width > 800);
  assert.ok(box.y > -500);
  assert.deepEqual(play, before);
  const opponent = printViewBox({ ...play, showOpponent: true });
  assert.ok(opponent.y <= -1020 && opponent.y + opponent.height >= 1216);
});
test('print text wraps unbroken strings and Unicode without dropping words or paragraphs', () => {
  const value =
    'Défense 日本語 coverage\n\n' + 'ABCDE'.repeat(10) + '\nEND OF NOTES';
  const lines = wrapPrintText(value, 18, (text) => Array.from(text).length);
  assert.ok(lines.every((line) => Array.from(line).length <= 18));
  assert.ok(lines.includes(''));
  assert.equal(lines.join('').replaceAll(' ', ''), value.replace(/\s/g, ''));
  assert.equal(lines.at(-1), 'END OF NOTES');
});
test('paper colours retain hue while making white and pale player lines visible', () => {
  assert.equal(inkColour('#e5e9ef'), '#243447');
  assert.equal(inkColour('#ffffff'), '#243447');
  assert.match(inkColour('#52c5b5'), /^#[0-9a-f]{6}$/);
  assert.notEqual(inkColour('#52c5b5'), '#52c5b5');
  assert.equal(inkColour('transparent'), 'transparent');
});
