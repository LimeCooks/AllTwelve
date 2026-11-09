import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/gameplan-state.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source.replace("import { workspaceFetch as fetch } from '@/lib/workspace-fetch';", "const fetch = (...args) => globalThis.fetch(...args);"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const {
  loadGameplan,
  emptyGameplan,
  linkGameplanPlays,
  resolveGameplanPlay,
  GAMEPLAN_KEY,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('gameplan starts blank, preserves legacy records, and never falls back after a failed or corrupt read', async () => {
  const seen = [];
  assert.deepEqual(
    await loadGameplan(async (url) => {
      seen.push(url);
      return Response.json({ value: null });
    }),
    emptyGameplan(),
  );
  assert.equal(seen.length, 2);
  const legacy = {
    ...emptyGameplan(),
    unit: 'Defence',
    objectives: [{ title: 'Contain', detail: 'Keep leverage', target: '' }],
  };
  assert.deepEqual(
    await loadGameplan(async (url) =>
      Response.json({ value: url.endsWith(GAMEPLAN_KEY) ? null : legacy }),
    ),
    legacy,
  );
  let calls = 0;
  assert.deepEqual(
    await loadGameplan(async () => {
      calls++;
      return Response.json({ value: legacy });
    }),
    legacy,
  );
  assert.equal(calls, 1);
  for (const response of [
    Response.json({ error: 'Unavailable' }, { status: 503 }),
    Response.json({}),
    Response.json({ value: { ...legacy, callBuckets: null } }),
  ]) {
    calls = 0;
    await assert.rejects(
      loadGameplan(async () => {
        calls++;
        return response;
      }),
    );
    assert.equal(calls, 1, 'failure must not open a writable empty fallback');
  }
});

test('stable play references survive renames and duplicate names without choosing the wrong play', () => {
  const plays = [
    { id: 'a', name: 'Cover 3' },
    { id: 'b', name: 'Cover 3' },
    { id: 'c', name: 'Blitz' },
  ];
  assert.equal(resolveGameplanPlay('Cover 3', plays), undefined);
  assert.equal(resolveGameplanPlay('a', plays).id, 'a');
  assert.equal(resolveGameplanPlay('Deleted', plays), undefined);
  const linked = linkGameplanPlays(
    {
      ...emptyGameplan(),
      callBuckets: [
        { name: 'Third down', plays: ['c', 'Blitz', 'Cover 3', 'Deleted'] },
      ],
    },
    plays,
  );
  assert.deepEqual(linked.callBuckets[0].plays, [
    'c',
    'c',
    'Cover 3',
    'Deleted',
  ]);
  assert.equal(
    resolveGameplanPlay(linked.callBuckets[0].plays[0], [
      { id: 'c', name: 'New name' },
    ]).name,
    'New name',
  );
});
