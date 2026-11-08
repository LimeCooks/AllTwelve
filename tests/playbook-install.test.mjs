import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const url = async (file, replacements = []) => {
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  return (
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
};
const parser = await url('../lib/install-data.ts');
const { loadInstallDestinations, addSavedPlayToInstall } = await import(
  await url('../lib/playbook-install.ts', [
    ["'@/lib/install-data'", JSON.stringify(parser)],
  ])
);
const pack = (id, unit = 'Defence', publishedAt = null) => ({
  id,
  name: id,
  unit,
  dueAt: '',
  publishedAt,
  version: 'a'.repeat(64),
});
const payload = (packages, selected = packages[0] ?? null, items = []) => ({
  packages,
  package: selected,
  items,
  reviews: [],
});
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test('draft destinations use exact unit or Team, retain arbitrary cadence, and reject failed or malformed reads', async () => {
  const packs = [
    pack('daily'),
    pack('monthly', 'Team'),
    pack('offence', 'Offence'),
    pack('published', 'Defence', '2026-11-07T12:00:00Z'),
  ];
  packs[1].dueAt = '2026-12-01';
  const signal = new AbortController().signal;
  const choices = await loadInstallDestinations(
    'Defence',
    signal,
    async (path, options) => {
      assert.equal(path, '/api/install');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.signal, signal);
      return response(payload(packs));
    },
  );
  assert.deepEqual(
    choices.map((p) => p.id),
    ['daily', 'monthly'],
  );
  assert.equal(choices[1].dueAt, '2026-12-01');
  assert.deepEqual(
    await loadInstallDestinations('Defence', undefined, async () =>
      response(payload([])),
    ),
    [],
  );
  await assert.rejects(
    () =>
      loadInstallDestinations('Defence', undefined, async () =>
        response({ error: 'Unavailable' }, 503),
      ),
    /Unavailable/,
  );
  await assert.rejects(
    () =>
      loadInstallDestinations('Defence', undefined, async () =>
        response({ packages: [] }),
      ),
    /incomplete/,
  );
  await assert.rejects(
    () =>
      loadInstallDestinations('Defence', undefined, async () => {
        throw Error('Offline');
      }),
    /Offline/,
  );
});

test('adding a play confirms the requested install and exact saved play before reporting success', async () => {
  const target = pack('target'),
    item = {
      id: 'item',
      playId: 'play',
      title: 'Cover 3',
      group: 'Defence',
      reviewCount: 0,
      complete: 0,
    };
  const saved = await addSavedPlayToInstall(
    'target',
    'play',
    'Defence',
    async (path, options) => {
      assert.equal(path, '/api/install');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), {
        packageId: 'target',
        playId: 'play',
      });
      return response(payload([target], target, [item]));
    },
  );
  assert.equal(saved.id, 'target');
  await assert.rejects(
    () =>
      addSavedPlayToInstall('target', 'play', 'Defence', async () =>
        response(payload([target])),
      ),
    /could not be confirmed/,
  );
  const wrong = pack('other');
  await assert.rejects(
    () =>
      addSavedPlayToInstall('target', 'play', 'Defence', async () =>
        response(payload([wrong], wrong, [item])),
      ),
    /incomplete/,
  );
  await assert.rejects(
    () =>
      addSavedPlayToInstall('target', 'play', 'Defence', async () =>
        response(
          payload([target], target, [{ ...item, playId: 'other-play' }]),
        ),
      ),
    /could not be confirmed/,
  );
  const wrongUnit = pack('target', 'Offence');
  await assert.rejects(
    () =>
      addSavedPlayToInstall('target', 'play', 'Defence', async () =>
        response(payload([wrongUnit], wrongUnit, [item])),
      ),
    /could not be confirmed/,
  );
  await assert.rejects(
    () =>
      addSavedPlayToInstall('target', 'play', 'Defence', async () =>
        response({ error: 'Published elsewhere' }, 409),
      ),
    /Published elsewhere/,
  );
  await assert.rejects(
    () =>
      addSavedPlayToInstall('target', 'play', 'Defence', async () =>
        response({}),
      ),
    /incomplete/,
  );
});
