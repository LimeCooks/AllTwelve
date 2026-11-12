import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/workspace-fetch.ts', import.meta.url),
  'utf8',
);
const compile = (text) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
const api = await import(compile(source));
test('scoping preserves upload requests and replaces a conflicting team hint with the document binding', () => {
  const request = new Request('https://pilot.test/api/media?key=film-test', {
    method: 'POST',
    headers: {
      'content-type': 'video/mp4',
      'x-alltwelve-team-id': 'other-team',
    },
    body: 'film bytes',
  });
  const [input, init] = api.scopeWorkspaceRequest(
    request,
    undefined,
    'team-a',
    'https://pilot.test',
  );
  assert.equal(input, request);
  assert.equal(request.method, 'POST');
  assert.equal(init.headers.get('content-type'), 'video/mp4');
  assert.equal(init.headers.get('x-alltwelve-team-id'), 'team-a');
  const options = {
    method: 'PUT',
    body: '{"title":"Saved"}',
    headers: { 'content-type': 'application/json' },
  };
  const [url, scoped] = api.scopeWorkspaceRequest(
    '/api/gameplans',
    options,
    'team-b',
    'https://pilot.test',
  );
  assert.equal(url, '/api/gameplans');
  assert.equal(scoped.body, options.body);
  assert.equal(scoped.method, 'PUT');
  assert.equal(scoped.headers.get('x-alltwelve-team-id'), 'team-b');
  assert.deepEqual(options.headers, { 'content-type': 'application/json' });
});
test('workspace hints are not attached to external origins or ordinary page requests', () => {
  for (const url of [
    'https://other.test/api/film',
    '/signin-with-chatgpt',
    '/api-unrelated',
  ]) {
    const options = { headers: { accept: 'application/json' } };
    assert.deepEqual(
      api.scopeWorkspaceRequest(url, options, 'team-a', 'https://pilot.test'),
      [url, options],
    );
  }
});
test('independent browser documents retain independent bindings, including native media URLs', async () => {
  const previousWindow = globalThis.window,
    previousFetch = globalThis.fetch;
  globalThis.window = { location: { origin: 'https://pilot.test' } };
  try {
    const a = await import(compile(source + '\n// document-a'));
    const b = await import(compile(source + '\n// document-b'));
    a.bindWorkspaceScope('team-a');
    b.bindWorkspaceScope('team-b');
    const seen = [];
    globalThis.fetch = async (input, init) => {
      seen.push(init.headers.get('x-alltwelve-team-id'));
      return Response.json({});
    };
    await a.workspaceFetch('/api/athletes');
    await b.workspaceFetch('/api/athletes');
    await a.workspaceFetch('/api/athletes');
    assert.deepEqual(seen, ['team-a', 'team-b', 'team-a']);
    assert.equal(
      new URL(
        a.workspaceMediaUrl('/api/media?key=team-logo'),
        'https://pilot.test',
      ).searchParams.get('workspace'),
      'team-a',
    );
    assert.equal(
      new URL(
        b.workspaceMediaUrl('/api/media?key=team-logo'),
        'https://pilot.test',
      ).searchParams.get('workspace'),
      'team-b',
    );
    assert.throws(() => a.bindWorkspaceScope('team-b'), /Reload/);
    assert.throws(
      () => a.workspaceMediaUrl('https://other.test/api/media?key=film'),
      /this workspace/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
