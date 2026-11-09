import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/film-report.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source.replace("import { workspaceFetch as fetch } from '@/lib/workspace-fetch';", "const fetch = (...args) => globalThis.fetch(...args);"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const {
  recordedYardage,
  buildFilmReport,
  loadReportDataset,
  filmReportCsv,
  safeCsvCell,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const clip = (id, result, extra = {}) => ({
  id,
  assetId: 'a',
  odk: 'Offence',
  down: 1,
  distance: 10,
  result,
  playId: null,
  playName: null,
  concept: '',
  clipNumber: 1,
  note: '',
  tags: [],
  ...extra,
});

test('yardage never guesses from down, clock, touchdown or narrative text', () => {
  for (const text of [
    '3rd down',
    'Q1 12:00',
    'Rush,TD',
    '12 yard pass incomplete',
    '',
    '201 yards',
  ])
    assert.equal(recordedYardage(text), null);
  for (const [text, value] of [
    ['+8', 8],
    ['-2', -2],
    ['loss of 3 yards', -3],
    ['12 yds', 12],
    ['0', 0],
  ])
    assert.equal(recordedYardage(text), value);
});
test('reports expose missing yardage, unit scope and honest ties', () => {
  const data = [
    clip('1', '+8', { concept: 'A' }),
    clip('2', '-2', { concept: 'B' }),
    clip('3', 'Q1 12:00'),
    clip('4', 'TD', { odk: 'Defence' }),
    clip('5', '', { odk: '' }),
  ];
  const report = buildFilmReport(data, 'Offence');
  assert.equal(report.clips.length, 3);
  assert.equal(report.yardageCount, 2);
  assert.equal(report.positive, 1);
  assert.equal(report.rows[0].averageYards, 3);
  assert.equal(report.rows[0].topCall, 'A / B (tie)');
  assert.equal(report.unassigned, 1);
  assert.equal(
    buildFilmReport([clip('x', 'TD')], 'Offence').rows[0].averageYards,
    null,
  );
  assert.equal(
    buildFilmReport([clip('x', 'TD')], 'Offence').rows[0].topCall,
    'Not charted',
  );
});
test('selected and aggregate datasets fetch exact sources; partial failures reject', async () => {
  const assets = [
    { id: 'a', title: 'Older' },
    { id: 'b', title: 'Latest' },
  ];
  const seen = [];
  const fetcher = async (url) => {
    seen.push(url);
    const id =
      new URL(url, 'https://test.invalid').searchParams.get('assetId') || 'b';
    return Response.json({
      assets,
      asset: assets.find((a) => a.id === id),
      clips: [clip(id, '+8', { assetId: id })],
    });
  };
  assert.equal((await loadReportDataset('a', fetcher)).label, 'Older');
  assert.deepEqual(seen, ['/api/film?assetId=a']);
  seen.length = 0;
  const all = await loadReportDataset('all', fetcher);
  assert.deepEqual(
    all.clips.map((c) => c.id),
    ['b', 'a'],
  );
  assert.equal(all.selection, 'all');
  await assert.rejects(
    loadReportDataset('all', async (url) =>
      url.includes('assetId=a')
        ? Response.json({ error: 'Unavailable' }, { status: 503 })
        : fetcher(url),
    ),
    /Unavailable/,
  );
  await assert.rejects(
    loadReportDataset('a', async () =>
      Response.json({ assets, asset: assets[1], clips: [] }),
    ),
    /incomplete/,
  );
});
test('CSV matches selected unit and protects spreadsheet text formulas', () => {
  const csv = filmReportCsv(
    {
      label: '=film',
      clips: [
        clip('a', '+8', { concept: '@call' }),
        clip('b', '+40', { odk: 'Defence' }),
      ],
    },
    'Offence',
  );
  assert.match(csv, /'\=film/);
  assert.match(csv, /'@call/);
  assert.doesNotMatch(csv, /Defence/);
  assert.equal(safeCsvCell(-2), '"-2"');
  assert.equal(safeCsvCell(' -2+3'), '"\' -2+3"');
});
