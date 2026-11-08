import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/film-data.ts', import.meta.url),
  'utf8',
);
const url =
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
  ).toString('base64');
const { parseFilmPayload, readFilmData } = await import(url);
const asset = {
  id: 'film',
  title: 'Film',
  gameId: null,
  opponent: null,
  storageKey: 'film-test',
  durationSeconds: 5,
  status: 'ready',
  createdAt: 'today',
  version: 'a'.repeat(64),
};
const clip = {
  id: 'clip',
  assetId: 'film',
  playId: null,
  playName: null,
  clipNumber: 1,
  startSeconds: 0,
  endSeconds: 3,
  odk: 'Defence',
  down: null,
  distance: null,
  yardLine: '',
  result: '',
  tags: [],
  note: 'Teaching',
  concept: '',
  quarter: '',
  clock: '',
};
const payload = () => ({ assets: [asset], asset, clips: [clip] });

test('film responses distinguish a blank library from incomplete or mixed film data', () => {
  assert.deepEqual(parseFilmPayload({ assets: [], asset: null, clips: [] }), {
    assets: [],
    asset: null,
    clips: [],
  });
  assert.equal(parseFilmPayload(payload(), 'film').clips[0].note, 'Teaching');
  assert.throws(() => parseFilmPayload({ assets: [], clips: [] }));
  assert.throws(() => parseFilmPayload({ ...payload(), asset: null }));
  assert.throws(() => parseFilmPayload(payload(), 'another-film'));
  assert.throws(() =>
    parseFilmPayload({ ...payload(), assets: [asset, asset] }),
  );
  assert.throws(() =>
    parseFilmPayload({ ...payload(), asset: { ...asset, version: undefined } }),
  );
  assert.throws(() =>
    parseFilmPayload({ ...payload(), clips: [{ ...clip, assetId: 'other' }] }),
  );
  assert.throws(() =>
    parseFilmPayload({ ...payload(), clips: [clip, { ...clip, id: 'other' }] }),
  );
  assert.throws(() =>
    parseFilmPayload({ ...payload(), clips: [{ ...clip, endSeconds: 0 }] }),
  );
  assert.throws(() =>
    parseFilmPayload({
      ...payload(),
      asset: { ...asset, durationSeconds: NaN },
    }),
  );
});

test('saved clip IDs are confirmed exactly rather than guessing the final clip in a response', () => {
  const other = { ...clip, id: 'other', clipNumber: 20 };
  assert.equal(
    parseFilmPayload({
      ...payload(),
      clips: [clip, other],
      savedClipId: 'clip',
    }).savedClipId,
    'clip',
  );
  assert.throws(() =>
    parseFilmPayload({ ...payload(), savedClipId: 'missing' }),
  );
});

test('film reads use the requested encoded ID, preserve cancellation and reject HTTP failures', async () => {
  const controller = new AbortController();
  const result = await readFilmData(
    'film /?',
    controller.signal,
    async (path, options) => {
      assert.equal(path, '/api/film?assetId=film%20%2F%3F');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.signal, controller.signal);
      const selected = { ...asset, id: 'film /?' };
      return new Response(
        JSON.stringify({ assets: [selected], asset: selected, clips: [] }),
      );
    },
  );
  assert.equal(result.asset.id, 'film /?');
  await assert.rejects(
    () =>
      readFilmData(
        '',
        undefined,
        async () =>
          new Response(JSON.stringify({ error: 'Offline service' }), {
            status: 503,
          }),
      ),
    /Offline service/,
  );
  await assert.rejects(
    () =>
      readFilmData(
        '',
        undefined,
        async () => new Response(JSON.stringify({ assets: [] })),
      ),
    /incomplete/,
  );
  controller.abort();
  await assert.rejects(
    () =>
      readFilmData('', controller.signal, async (_path, options) => {
        options.signal.throwIfAborted();
      }),
    (error) => error.name === 'AbortError',
  );
});
