import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import {
  destination,
  fixture,
  rowCounts,
} from './helpers/recovery-fixture.mjs';
const moduleUrl = async (file, replacements = []) => {
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
const backup = await moduleUrl('../lib/team-backup.ts'),
  identity = await moduleUrl('../lib/workspace-identity.ts');
const plan = await moduleUrl('../lib/recovery-plan.ts', [
  ["'@/lib/team-backup'", JSON.stringify(backup)],
]);
const chunks = await moduleUrl('../lib/recovery-chunks.ts');
const { handleRecovery } = await import(
  await moduleUrl('../lib/recovery-service.ts', [
    ["'@/lib/team-backup'", JSON.stringify(backup)],
    ["'@/lib/recovery-plan'", JSON.stringify(plan)],
    ["'@/lib/recovery-chunks'", JSON.stringify(chunks)],
    ["'@/lib/workspace-identity'", JSON.stringify(identity)],
  ])
);
globalThis.FixedLengthStream = class {
  constructor(expected) {
    let size = 0;
    const stream = new TransformStream({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > expected) throw Error('Too long');
        controller.enqueue(chunk);
      },
      flush() {
        if (size !== expected) throw Error('Too short');
      },
    });
    this.readable = stream.readable;
    this.writable = stream.writable;
  }
};
function bucket() {
  const objects = new Map();
  const head = (key) => {
    const file = objects.get(key);
    if (!file) return null;
    return {
      key,
      size: file.bytes.length,
      etag: createHash('md5').update(file.bytes).digest('hex'),
      checksums: file.sha256
        ? { sha256: Uint8Array.from(Buffer.from(file.sha256, 'hex')).buffer }
        : {},
      httpMetadata: file.options.httpMetadata ?? {},
      customMetadata: file.options.customMetadata ?? {},
    };
  };
  const bucket = {
    async head(key) {
      return head(key);
    },
    async get(key, options) {
      const object = head(key);
      if (
        object &&
        options?.onlyIf?.etagMatches &&
        options.onlyIf.etagMatches !== object.etag
      )
        return object;
      return object
        ? {
            body: new Response(objects.get(key).bytes).body,
            ...object,
            json: async () =>
              JSON.parse(objects.get(key).bytes.toString('utf8')),
          }
        : null;
    },
    async put(key, body, options = {}) {
      if (
        options.onlyIf?.etagMatches &&
        options.onlyIf.etagMatches !== head(key)?.etag
      )
        return null;
      if (options.onlyIf?.etagDoesNotMatch === '*' && objects.has(key))
        return null;
      const bytes = Buffer.from(await new Response(body).arrayBuffer());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (options.sha256 && options.sha256 !== sha256)
        throw Error('Checksum mismatch');
      objects.set(key, {
        bytes,
        sha256: options.sha256 ? sha256 : undefined,
        options,
      });
      return head(key);
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys])
        objects.delete(key);
    },
    async list(options) {
      return {
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(options.prefix))
          .sort()
          .map(head),
        truncated: false,
      };
    },
  };
  return { bucket, objects };
}
function setup() {
  const { sql, database } = destination(),
    store = bucket(),
    snapshot = fixture(),
    bytes = Buffer.from('Original recovery media bytes');
  snapshot.media = [
    {
      key: 'film-one',
      size: bytes.length,
      etag: createHash('md5').update(bytes).digest('hex'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      part: 1,
      contentType: 'video/mp4',
      originalName: 'Practice.mp4',
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: { originalName: 'Practice.mp4' },
    },
  ];
  snapshot.mediaBytes = bytes.length;
  const env = { DB: database, MEDIA: store.bucket };
  const call = async (
    path,
    method = 'GET',
    body,
    extra = {},
    owner = 'recovery-owner',
  ) => {
    const headers = { origin: 'https://recovery.test', ...extra };
    if (owner) headers['oai-authenticated-user-id'] = owner;
    if (body !== undefined && !(body instanceof Uint8Array)) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(body);
    }
    return handleRecovery(
      new Request('https://recovery.test' + path, { method, headers, body }),
      env,
    );
  };
  return { sql, database, store, snapshot, bytes, env, call };
}
test('recovery authenticates, isolates preparations, rejects cross-origin writes and never exposes foreign data', async () => {
  const x = setup();
  try {
    assert.equal(
      (await x.call('/recovery/status', 'GET', undefined, {}, null)).status,
      401,
    );
    assert.equal(
      (
        await x.call('/recovery/prepare', 'POST', x.snapshot, {
          origin: 'https://foreign.test',
        })
      ).status,
      403,
    );
    assert.equal(
      (await x.call('/recovery/prepare', 'POST', x.snapshot)).status,
      200,
    );
    assert.deepEqual(
      await (
        await x.call('/recovery/status', 'GET', undefined, {}, 'other-owner')
      ).json(),
      { state: 'empty' },
    );
    assert.equal(
      (
        await x.call(
          '/recovery/commit',
          'POST',
          undefined,
          { 'x-recovery-digest': 'secret' },
          'other-owner',
        )
      ).status,
      404,
    );
    assert.ok(Object.values(rowCounts(x.sql)).every((count) => count === 0));
  } finally {
    x.sql.close();
  }
});
test('recovery retries preserve verified immutable media and commit once to the new signed-in owner', async () => {
  const x = setup();
  try {
    let prepared = await (
      await x.call('/recovery/prepare', 'POST', x.snapshot)
    ).json();
    assert.equal(prepared.state, 'preparing');
    const headers = {
      'x-recovery-digest': prepared.digest,
      'x-recovery-size': String(x.bytes.length),
    };
    assert.equal(
      (await x.call('/recovery/commit', 'POST', undefined, headers)).status,
      409,
    );
    const bad = Buffer.from(x.bytes);
    bad[0] ^= 1;
    assert.equal(
      (await x.call('/recovery/file?key=film-one', 'PUT', bad, headers)).status,
      400,
    );
    assert.equal(
      await x.store.bucket.head('teams/recovery-team/film-one'),
      null,
    );
    assert.equal(
      (
        await x.call(
          '/recovery/file?key=film-one',
          'PUT',
          x.bytes.subarray(1),
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (await x.call('/recovery/file?key=film-one', 'PUT', x.bytes, headers))
        .status,
      200,
    );
    assert.equal(
      (await x.call('/recovery/file?key=film-one', 'PUT', bad, headers)).status,
      200,
    );
    assert.deepEqual(
      x.store.objects.get('teams/recovery-team/film-one').bytes,
      x.bytes,
    );
    prepared = await (
      await x.call('/recovery/prepare', 'POST', x.snapshot)
    ).json();
    assert.equal(prepared.files[0].verified, true);
    const changed = structuredClone(x.snapshot);
    changed.tables.teams[0].name = 'Different preparation';
    assert.equal(
      (await x.call('/recovery/prepare', 'POST', changed)).status,
      409,
    );
    const committed = await x.call(
      '/recovery/commit',
      'POST',
      undefined,
      headers,
    );
    assert.equal(committed.status, 200);
    assert.equal((await committed.json()).state, 'complete');
    const before = rowCounts(x.sql);
    assert.equal(
      (
        await (
          await x.call('/recovery/commit', 'POST', undefined, headers)
        ).json()
      ).state,
      'complete',
    );
    assert.deepEqual(rowCounts(x.sql), before);
    assert.equal(
      x.sql.prepare('SELECT user_id FROM workspace_owners').get().user_id,
      'recovery-owner',
    );
    assert.equal(
      (await x.call('/recovery/prepare', 'POST', x.snapshot)).status,
      409,
    );
    assert.equal(
      (await x.call('/recovery/file?key=film-one', 'PUT', x.bytes, headers))
        .status,
      409,
    );
    assert.equal(
      (await x.call('/recovery/status', 'GET', undefined, {}, 'other-owner'))
        .status,
      409,
    );
  } finally {
    x.sql.close();
  }
});
test('a lost commit response recovers from exact rows and files without a second import', async () => {
  const x = setup();
  try {
    const prepared = await (
        await x.call('/recovery/prepare', 'POST', x.snapshot)
      ).json(),
      headers = {
        'x-recovery-digest': prepared.digest,
        'x-recovery-size': String(x.bytes.length),
      };
    await x.call('/recovery/file?key=film-one', 'PUT', x.bytes, headers);
    const batch = x.database.batch;
    let injected = false;
    x.database.batch = async function (statements) {
      const result = await batch.call(this, statements);
      if (
        !injected &&
        statements.length > 1 &&
        x.sql.prepare('SELECT COUNT(*) n FROM workspace_owners').get().n
      ) {
        injected = true;
        throw Error('Lost commit confirmation');
      }
      return result;
    };
    assert.equal(
      (await x.call('/recovery/commit', 'POST', undefined, headers)).status,
      409,
    );
    x.database.batch = batch;
    assert.equal(injected, true);
    assert.equal(
      (await (await x.call('/recovery/status')).json()).state,
      'complete',
    );
    const before = rowCounts(x.sql);
    assert.equal(
      (await x.call('/recovery/commit', 'POST', undefined, headers)).status,
      200,
    );
    assert.deepEqual(rowCounts(x.sql), before);
  } finally {
    x.sql.close();
  }
});
test('late destination population blocks the entire import and unknown existing files are never replaced', async () => {
  const x = setup();
  try {
    const prepared = await (
        await x.call('/recovery/prepare', 'POST', x.snapshot)
      ).json(),
      headers = {
        'x-recovery-digest': prepared.digest,
        'x-recovery-size': String(x.bytes.length),
      };
    await x.store.bucket.put('teams/recovery-team/film-one', 'Other bytes', {
      httpMetadata: { contentType: 'video/mp4' },
    });
    assert.equal(
      (await x.call('/recovery/file?key=film-one', 'PUT', x.bytes, headers))
        .status,
      409,
    );
    x.store.objects.delete('teams/recovery-team/film-one');
    await x.call('/recovery/file?key=film-one', 'PUT', x.bytes, headers);
    const batch = x.database.batch;
    x.database.batch = async function (statements) {
      if (
        statements.length > 1 &&
        !(await this.prepare('SELECT COUNT(*) n FROM teams').first()).n
      )
        x.sql
          .prepare(
            'INSERT INTO teams(id,name,short_name,season,created_at) VALUES(?,?,?,?,?)',
          )
          .run('late', 'Keep me', 'Keep', '2026', 'now');
      return batch.call(this, statements);
    };
    assert.equal(
      (await x.call('/recovery/commit', 'POST', undefined, headers)).status,
      409,
    );
    assert.deepEqual(
      x.sql
        .prepare('SELECT id,name FROM teams')
        .all()
        .map((row) => ({ ...row })),
      [{ id: 'late', name: 'Keep me' }],
    );
    assert.equal(x.sql.prepare('SELECT COUNT(*) n FROM athletes').get().n, 0);
    assert.equal(
      x.sql.prepare('SELECT COUNT(*) n FROM workspace_owners').get().n,
      0,
    );
  } finally {
    x.sql.close();
  }
});

test('large recovery files resume bounded chunks and cannot publish until the complete SHA-256 matches', async () => {
  const x = setup(),
    chunkBytes = 8 * 1024 * 1024;
  x.bytes = Buffer.alloc(chunkBytes + 97, 42);
  Object.assign(x.snapshot.media[0], {
    size: x.bytes.length,
    etag: createHash('md5').update(x.bytes).digest('hex'),
    sha256: createHash('sha256').update(x.bytes).digest('hex'),
  });
  x.snapshot.mediaBytes = x.bytes.length;
  try {
    const prepared = await (
        await x.call('/recovery/prepare', 'POST', x.snapshot)
      ).json(),
      headers = { 'x-recovery-digest': prepared.digest };
    const upload = async (
      index,
      bytes,
      sha = createHash('sha256').update(bytes).digest('hex'),
    ) =>
      x.call('/recovery/chunk?key=film-one&index=' + index, 'PUT', bytes, {
        ...headers,
        'x-recovery-size': String(bytes.length),
        'x-recovery-sha256': sha,
      });
    assert.equal(
      (
        await x.call('/recovery/file?key=film-one', 'PUT', x.bytes, {
          ...headers,
          'x-recovery-size': String(x.bytes.length),
        })
      ).status,
      400,
    );
    assert.equal(
      (await upload(0, x.bytes.subarray(0, chunkBytes))).status,
      200,
    );
    let progress = await (
      await x.call('/recovery/chunks?key=film-one', 'GET', undefined, headers)
    ).json();
    assert.equal(progress.total, 2);
    assert.deepEqual(
      progress.chunks.map((part) => part.index),
      [0],
    );
    assert.equal(
      (await x.call('/recovery/file?key=film-one', 'POST', undefined, headers))
        .status,
      409,
    );
    const wrong = Buffer.alloc(97, 41);
    assert.equal((await upload(1, wrong, 'a'.repeat(64))).status, 400);
    assert.equal((await upload(1, wrong)).status, 200);
    assert.equal(
      (await x.call('/recovery/file?key=film-one', 'POST', undefined, headers))
        .status,
      400,
    );
    assert.equal(
      await x.store.bucket.head('teams/recovery-team/film-one'),
      null,
    );
    assert.equal((await upload(1, x.bytes.subarray(chunkBytes))).status, 200);
    progress = await (
      await x.call('/recovery/chunks?key=film-one', 'GET', undefined, headers)
    ).json();
    assert.equal(progress.chunks.length, 2);
    assert.equal(
      (await x.call('/recovery/file?key=film-one', 'POST', undefined, headers))
        .status,
      200,
    );
    assert.deepEqual(
      x.store.objects.get('teams/recovery-team/film-one').bytes,
      x.bytes,
    );
    assert.equal(
      (await (await x.call('/recovery/status')).json()).files[0].verified,
      true,
    );
    assert.equal(
      (
        await (
          await x.call(
            '/recovery/chunks?key=film-one',
            'GET',
            undefined,
            headers,
          )
        ).json()
      ).chunks.length,
      0,
    );
    assert.ok(Object.values(rowCounts(x.sql)).every((count) => count === 0));
    assert.equal(
      (await x.call('/recovery/commit', 'POST', undefined, headers)).status,
      200,
    );
  } finally {
    x.sql.close();
  }
});
