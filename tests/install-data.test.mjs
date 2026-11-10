import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/install-data.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { parseInstallPayload } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
test('installs distinguish a blank team from malformed, wrong-package or inconsistent reviews', () => {
  const empty = { packages: [], package: null, items: [], reviews: [] };
  assert.deepEqual(parseInstallPayload(empty), empty);
  const pack = {
    id: 'a',
    name: 'Any cadence',
    unit: 'Team',
    dueAt: '',
    publishedAt: null,
    version: 'a'.repeat(64),
  };
  const item = {
    id: 'item',
    playId: 'play',
    title: 'Teaching',
    group: 'Offence',
    reviewCount: 1,
    complete: 0,
  };
  const review = {
    id: 'review',
    itemId: 'item',
    athleteId: 'athlete',
    name: 'Player',
    position: 'X',
    reviewed: false,
    assignment: false,
    note: false,
    acknowledged: false,
  };
  const valid = {
    packages: [pack],
    package: pack,
    items: [item],
    reviews: [review],
  };
  assert.deepEqual(parseInstallPayload(valid, 'a'), valid);
  for (const value of [
    null,
    {},
    { ...valid, package: null },
    { ...valid, packages: [pack, pack] },
    { ...valid, items: [item, item] },
    { ...valid, items: [{ ...item, complete: 101 }] },
    { ...valid, items: [{ ...item, materialSource: 'published', material: null }] },
    { ...valid, items: [{ ...item, materialSource: 'published', material: {id:'different-play',name:'Wrong teaching',notes:'',assignments:[]} }] },
    { ...valid, reviews: [{ ...review, itemId: 'missing' }] },
    { ...valid, reviews: [{ ...review, acknowledged: true }] },
  ])
    assert.throws(() => parseInstallPayload(value));
  assert.throws(() => parseInstallPayload(valid, 'other'));
});
