import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const compile = (source) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
const drawing = compile(
  await readFile(new URL('../lib/play-designer.ts', import.meta.url), 'utf8'),
);
const print = compile(
  (
    await readFile(new URL('../lib/print-layout.ts', import.meta.url), 'utf8')
  ).replace("'@/lib/play-designer'", JSON.stringify(drawing)),
);
const {
  practicePrintRecord,
  readPracticePrintSnapshot,
  readPracticePrintPlans,
  practiceTimesOutOfOrder,
  practicePrintDate,
  layoutPracticePrint,
} = await import(
  compile(
    (
      await readFile(
        new URL('../lib/practice-print.ts', import.meta.url),
        'utf8',
      )
    ).replace("'@/lib/print-layout'", JSON.stringify(print)),
  )
);
const record = () => ({
  id: 'practice-a',
  version: 'a'.repeat(64),
  gameId: null,
  title: 'Défense practice',
  practiceDate: '2026-11-08',
  durationMinutes: 25,
  generated: false,
  gameplanSource: {
    id: 'source-a',
    title: 'NKEC preparation',
    version: 'b'.repeat(64),
  },
  blocks: [
    ['16:00', '10 min', 'Contain', 'Keep outside leverage', 'defence'],
    ['TBD', '15 min', 'Kick cover', 'Maintain lanes', 'teams'],
  ],
});
const options = { paper: 'letter', landscape: false, notes: true };
const measure = (text, size) => Array.from(text).length * size * 0.55;

test('the print library distinguishes a blank list from failed or malformed saved practices', async () => {
  assert.deepEqual(
    await readPracticePrintPlans(undefined, async () =>
      Response.json({ plans: [] }),
    ),
    [],
  );
  const plan = record();
  assert.deepEqual(
    await readPracticePrintPlans(undefined, async () =>
      Response.json({ plans: [plan] }),
    ),
    [plan],
  );
  for (const body of [
    {},
    { plans: [plan, plan] },
    { plans: [{ ...plan, durationMinutes: -1 }] },
  ])
    await assert.rejects(() =>
      readPracticePrintPlans(undefined, async () => Response.json(body)),
    );
  await assert.rejects(() =>
    readPracticePrintPlans(undefined, async () =>
      Response.json({ error: 'Unavailable' }, { status: 503 }),
    ),
  );
});

test('print snapshots use the exact saved ID and revision without mutating the displayed record', async () => {
  const plan = record(),
    before = structuredClone(plan);
  const result = await readPracticePrintSnapshot(plan, async (url, init) => {
    assert.equal(url, '/api/practice-plans');
    assert.equal(init.cache, 'no-store');
    return Response.json({
      plans: [{ ...plan, id: 'same-title-other-plan' }, plan],
    });
  });
  assert.deepEqual(result, plan);
  result.blocks[0][2] = 'Changed export copy';
  assert.deepEqual(plan, before);
});
test('failed, malformed, missing, duplicate and stale reads cannot produce an apparently valid script', async () => {
  const plan = record();
  for (const response of [
    Response.json({ error: 'Unavailable' }, { status: 503 }),
    Response.json({}),
    Response.json({ plans: [] }),
    Response.json({ plans: [plan, plan] }),
    Response.json({ plans: [{ ...plan, version: 'c'.repeat(64) }] }),
  ])
    await assert.rejects(() =>
      readPracticePrintSnapshot(plan, async () => response),
    );
});
test('invalid dates, durations, totals, sources and oversized fields reject printing', () => {
  const plan = record();
  for (const invalid of [
    { ...plan, practiceDate: '2026-02-30' },
    { ...plan, durationMinutes: 99 },
    { ...plan, generated: 'yes' },
    { ...plan, gameplanSource: { id: 'x', title: 'Source', version: '' } },
    { ...plan, blocks: [['25:00', '10 min', 'Bad time', '', 'team']] },
    { ...plan, blocks: [['TBD', '0 min', 'Zero duration', '', 'team']] },
    {
      ...plan,
      blocks: [['TBD', '25 min', 'Overlong note', 'A'.repeat(4001), 'team']],
    },
  ])
    assert.throws(() => practicePrintRecord(invalid));
});
test('entered times, unscheduled segments and arbitrary group names are retained without inventing a schedule', () => {
  const plan = record();
  plan.blocks[1][4] = 'Nascar package';
  const layout = layoutPracticePrint(plan, 'JL Judges', options, measure);
  const text = layout.pages
    .flatMap((page) => page.lines.map((line) => line.text))
    .join('\n');
  assert.match(text, /Start: 16:00/);
  assert.match(text, /Start: Not scheduled/);
  assert.match(text, /Nascar package/);
  assert.match(text, /25 segment minutes/);
  assert.match(text, /NKEC preparation/);
  assert.doesNotMatch(text, /Start: 16:10/);
  plan.blocks[1][4] = 'constructor';
  assert.match(
    layoutPracticePrint(plan, 'Team', options, measure)
      .pages.flatMap((page) => page.lines.map((line) => line.text))
      .join('\n'),
    /constructor/,
  );
  assert.equal(practicePrintDate('2026-11-08'), 'November 8, 2026');
});
test('out-of-order entered times are flagged but never reordered', () => {
  const plan = record();
  plan.blocks[0][0] = '16:00';
  plan.blocks[1][0] = '9:00';
  assert.equal(practiceTimesOutOfOrder(plan.blocks), true);
  const text = layoutPracticePrint(plan, 'JL Judges', options, measure)
    .pages.flatMap((page) => page.lines.map((line) => line.text))
    .join('\n');
  assert.match(text, /Review timing/);
  assert.ok(text.indexOf('1. Contain') < text.indexOf('2. Kick cover'));
});
test('long notes paginate completely with continuation context, bounded coordinates and unchanged saved content', () => {
  const plan = record();
  plan.blocks[0][3] =
    Array.from(
      { length: 60 },
      (_, index) =>
        `Teaching point ${index + 1}: Défense, leverage and pursuit.`,
    ).join('\n') + '\nEND OF COACHING NOTES';
  const before = structuredClone(plan),
    layout = layoutPracticePrint(plan, 'JL Judges', options, measure);
  assert.ok(layout.pages.length > 1);
  const text = layout.pages
    .flatMap((page) => page.lines.map((line) => line.text))
    .join('\n');
  for (let index = 1; index <= 60; index++)
    assert.match(text, new RegExp(`Teaching point ${index}:`));
  assert.match(text, /END OF COACHING NOTES/);
  assert.match(text, /Segment 1 - continued/);
  assert.match(text, /2\. Kick cover/);
  for (const page of layout.pages)
    for (const line of page.lines) {
      assert.ok(line.y > 0 && line.y + line.size < layout.height - 40);
      assert.ok(measure(line.text, line.size) <= layout.width - 72);
    }
  assert.deepEqual(plan, before);
});
test('paper/orientation and note omission change the output without changing the saved script', () => {
  const plan = record(),
    before = structuredClone(plan);
  const layout = layoutPracticePrint(
    plan,
    'JL Judges',
    { paper: 'a4', landscape: true, notes: false },
    measure,
  );
  assert.equal(layout.width, 841.89);
  assert.equal(layout.height, 595.28);
  assert.doesNotMatch(
    layout.pages
      .flatMap((page) => page.lines.map((line) => line.text))
      .join('\n'),
    /Keep outside leverage|Maintain lanes/,
  );
  assert.deepEqual(plan, before);
});
test('empty and over-limit exports fail rather than returning a truncated success', () => {
  assert.throws(() =>
    layoutPracticePrint(
      { ...record(), durationMinutes: 0, blocks: [] },
      'Team',
      options,
      measure,
    ),
  );
  const plan = {
    ...record(),
    durationMinutes: 2000,
    blocks: Array.from({ length: 200 }, () => [
      'TBD',
      '10 min',
      'Coverage',
      'Long coaching note. '.repeat(200),
      'defence',
    ]),
  };
  assert.throws(
    () => layoutPracticePrint(plan, 'Team', options, measure),
    /100 printable pages/,
  );
});
