import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../lib/dashboard-load.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { loadDashboard } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const valid = {
  '/api/calendar-events': { events: [] },
  '/api/install': { items: [], reviews: [] },
};

test('overview distinguishes a genuinely empty team from failed or incomplete reads and can retry', async () => {
  const fetcher = async (url) => Response.json(valid[url]);
  assert.deepEqual(await loadDashboard(fetcher), {
    events: [],
    install: { items: [], reviews: [] },
  });
  for (const failingUrl of Object.keys(valid)) {
    await assert.rejects(
      loadDashboard(async (url) =>
        url === failingUrl
          ? Response.json({ error: 'Unavailable' }, { status: 503 })
          : fetcher(url),
      ),
    );
    await assert.rejects(
      loadDashboard(async (url) =>
        url === failingUrl ? Response.json({}) : fetcher(url),
      ),
    );
    await assert.rejects(
      loadDashboard(async (url) =>
        url === failingUrl ? new Response('Invalid JSON') : fetcher(url),
      ),
    );
  }
  await assert.rejects(
    loadDashboard(async () => {
      throw new TypeError('Network unavailable');
    }),
  );
  const events = [{ id: 'event-1' }];
  const items = [{ id: 'assignment-1', complete: 50 }];
  const reviews = [{ id: 'review-1', acknowledged: true }];
  assert.deepEqual(
    await loadDashboard(async (url) =>
      Response.json(url.includes('calendar') ? { events } : { items, reviews }),
    ),
    { events, install: { items, reviews } },
  );
});
