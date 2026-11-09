import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/workspace-search.ts', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source.replace("import { workspaceFetch as fetch } from '@/lib/workspace-fetch';", "const fetch = (...args) => globalThis.fetch(...args);"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { loadSearchRecords, matchingRecords } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

test('search uses saved IDs, jersey zero and multiple terms without sample keyword routing', async () => {
  const payloads = {
    '/api/playbooks': {
      plays: [
        {
          id: 'play-a',
          name: 'Boundary read',
          unit: 'Defence',
          formation: '6-Pack',
          concept: 'Cover 3',
        },
        {
          id: 'play-b',
          name: 'Boundary read',
          unit: 'Offence',
          formation: 'Doubles',
        },
      ],
    },
    '/api/athletes': {
      athletes: [
        {
          id: 'athlete-a',
          name: 'Alex Smith',
          no: 0,
          position: 'FC',
          unit: 'Defence',
          staffNote: 'Private note',
          email: 'private@example.test',
        },
      ],
    },
    '/api/film': { assets: [{ id: 'film-a', title: 'NKEC scout' }] },
  };
  const result = await loadSearchRecords(async (url, options) => {
    assert.equal(options.cache, 'no-store');
    return Response.json(payloads[url]);
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(
    matchingRecords(result.records, ' boundary DEFENCE ').map((r) => r.id),
    ['play-a'],
  );
  assert.deepEqual(
    matchingRecords(result.records, '#0').map((r) => r.id),
    ['athlete-a'],
  );
  assert.deepEqual(
    matchingRecords(result.records, 'boundary read').map((r) => r.id),
    ['play-a', 'play-b'],
  );
  assert.deepEqual(
    matchingRecords(result.records, 'nkec').map((r) => r.id),
    ['film-a'],
  );
  for (const q of [
    'hamilton',
    'red 24',
    'mesh',
    'Private note',
    'private@example.test',
    '  ',
  ])
    assert.deepEqual(matchingRecords(result.records, q), []);
});

test('failed or malformed search sources are incomplete rather than silently empty; retry reads fresh records', async () => {
  const failed = await loadSearchRecords(async (url) => {
    if (url === '/api/playbooks')
      return Response.json({ plays: [{ id: 'p', name: 'Available play' }] });
    if (url === '/api/athletes')
      return Response.json({ error: 'Sign in' }, { status: 401 });
    throw new Error('Network unavailable');
  });
  assert.deepEqual(failed.failures, ['Athletes', 'Film']);
  assert.equal(failed.records[0].id, 'p');
  const malformed = await loadSearchRecords(async () =>
    Response.json({
      plays: [null],
      athletes: 'invalid',
      assets: [{ id: 'f' }],
    }),
  );
  assert.deepEqual(malformed, {
    records: [],
    failures: ['Plays', 'Athletes', 'Film'],
  });
  const empty = await loadSearchRecords(async () =>
    Response.json({ plays: [], athletes: [], assets: [] }),
  );
  assert.deepEqual(empty, { records: [], failures: [] });
});
