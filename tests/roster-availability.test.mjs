import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/roster-availability.ts', import.meta.url),
  'utf8',
);
const { readRosterAvailability } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(source.replace("import { workspaceFetch as fetch } from '@/lib/workspace-fetch';", "const fetch = (...args) => globalThis.fetch(...args);"), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    ).toString('base64')
);
const metrics = {
  total: 6,
  active: 3,
  eligible: 5,
  limited: 2,
  out: 1,
  installAverage: 63,
};
const reply =
  (value, status = 200) =>
  async () =>
    Response.json(value, { status });
test('availability uses a fresh cancellable roster read and distinguishes a real empty roster', async () => {
  const request = new AbortController();
  let calls = 0;
  const actual = await readRosterAvailability(
    request.signal,
    async (url, options) => {
      calls++;
      assert.equal(url, '/api/athletes');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.signal, request.signal);
      return Response.json({ metrics });
    },
  );
  assert.deepEqual(actual, metrics);
  assert.equal(calls, 1);
  const empty = {
    total: 0,
    active: 0,
    eligible: 0,
    limited: 0,
    out: 0,
    installAverage: 0,
  };
  assert.deepEqual(
    await readRosterAvailability(undefined, reply({ metrics: empty })),
    empty,
  );
});
test('failed and malformed availability cannot masquerade as zero counts or valid stale data', async () => {
  await assert.rejects(
    readRosterAvailability(
      undefined,
      reply({ metrics, error: 'Sign in again' }, 401),
    ),
    /Sign in again/,
  );
  await assert.rejects(
    readRosterAvailability(undefined, reply({ metrics }, 503)),
    /unavailable/,
  );
  await assert.rejects(
    readRosterAvailability(
      undefined,
      async () =>
        new Response('<html>Temporary failure</html>', { status: 502 }),
    ),
    /could not be read/,
  );
  await assert.rejects(
    readRosterAvailability(undefined, async () => {
      throw new Error('Network offline');
    }),
    /Network offline/,
  );
  for (const value of [
    null,
    {},
    { metrics: null },
    { metrics: { active: 0, limited: 0, out: 0 } },
    { metrics: { ...metrics, active: -1 } },
    { metrics: { ...metrics, total: 7 } },
    { metrics: { ...metrics, out: '1' } },
    { metrics: { ...metrics, eligible: 7 } },
    { metrics: { ...metrics, installAverage: 101 } },
    { metrics: { ...metrics, limited: 1.5 } },
    { metrics: { ...metrics, total: Number.MAX_SAFE_INTEGER + 1 } },
  ]) {
    await assert.rejects(
      readRosterAvailability(undefined, reply(value)),
      /incomplete/,
    );
  }
  let failed = true;
  const retry = async () =>
    failed
      ? Response.json({ error: 'Temporarily unavailable' }, { status: 503 })
      : Response.json({ metrics });
  await assert.rejects(
    readRosterAvailability(undefined, retry),
    /Temporarily unavailable/,
  );
  failed = false;
  assert.deepEqual(await readRosterAvailability(undefined, retry), metrics);
});
