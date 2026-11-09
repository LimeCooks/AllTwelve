import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  localCookie,
  cookieProfile,
  localIdentity,
  prepareEnvironment,
  accountProxy,
  liveLocalSettings,
  assertPromotionReady,
} from '../scripts/local-pilot.mjs';

test('promotion refuses an unstarted candidate and status does not call an exited worker healthy', () => {
  const source = { environment: 'nonprod', releaseId: 'new' };
  const running = new Map([
    [
      'prod',
      {
        child: { exitCode: null },
        proxy: { listening: true },
        settings: { environment: 'prod', releaseId: 'stable' },
      },
    ],
    [
      'nonprod',
      { child: { exitCode: 1 }, proxy: { listening: true }, settings: source },
    ],
  ]);
  assert.deepEqual(liveLocalSettings(running), [
    { environment: 'prod', releaseId: 'stable' },
  ]);
  assert.throws(
    () =>
      assertPromotionReady(source, {
        environments: liveLocalSettings(running),
      }),
    /unavailable/,
  );
  assert.throws(() => assertPromotionReady(source, null), /Start/);
  assert.throws(
    () =>
      assertPromotionReady(source, {
        environments: [{ environment: 'nonprod', releaseId: 'old' }],
      }),
    /not running/,
  );
  running.get('nonprod').child.exitCode = null;
  assert.doesNotThrow(() =>
    assertPromotionReady(source, { environments: liveLocalSettings(running) }),
  );
});

test('local account signatures cannot be forged or reused across environments', () => {
  const key = randomBytes(32).toString('hex');
  const value = localCookie('prod', 'owner', key);
  assert.equal(cookieProfile(value, 'prod', key), 'owner');
  assert.equal(cookieProfile(value, 'nonprod', key), null);
  assert.equal(
    cookieProfile(value.replace('owner.', 'staff.'), 'prod', key),
    null,
  );
  assert.equal(cookieProfile(value, 'prod', 'another-key'), null);
  assert.equal(
    cookieProfile('constructor.' + '0'.repeat(64), 'prod', key),
    null,
  );
  assert.notEqual(
    localIdentity('prod', 'owner').id,
    localIdentity('nonprod', 'owner').id,
  );
});

test('local environment updates preserve independent database identities, storage and stable builds', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chalktalk-local-settings-'));
  for (const id of ['a'.repeat(64), 'b'.repeat(64)]) {
    await mkdir(path.join(root, 'releases', id), { recursive: true });
    await writeFile(path.join(root, 'releases', id, 'complete.json'), '{}');
  }
  const prod = await prepareEnvironment('prod', 'a'.repeat(64), root);
  const nonprod = await prepareEnvironment('nonprod', 'a'.repeat(64), root);
  assert.notEqual(prod.databaseId, nonprod.databaseId);
  assert.notEqual(prod.port, nonprod.port);
  assert.notEqual(prod.workerPort, nonprod.workerPort);
  const before = await readFile(
    path.join(root, 'prod', 'wrangler.json'),
    'utf8',
  );
  await mkdir(path.join(root, 'prod', 'storage'), { recursive: true });
  await writeFile(path.join(root, 'prod', 'storage', 'kept'), 'prod data');
  const updated = await prepareEnvironment('nonprod', 'b'.repeat(64), root);
  assert.equal(updated.databaseId, nonprod.databaseId);
  assert.equal(
    await readFile(path.join(root, 'prod', 'wrangler.json'), 'utf8'),
    before,
  );
  assert.equal(
    await readFile(path.join(root, 'prod', 'storage', 'kept'), 'utf8'),
    'prod data',
  );
  const config = JSON.parse(
    await readFile(path.join(root, 'nonprod', 'wrangler.json'), 'utf8'),
  );
  assert.equal(config.vars.CHALKTALK_MODE, 'pilot');
  assert.ok(config.main.includes('b'.repeat(64)));
  assert.equal(config.d1_databases[0].database_id, nonprod.databaseId);
  assert.ok(
    config.r2_buckets.every((bucket) => bucket.bucket_name.endsWith('nonprod')),
  );
});

test('loopback account proxy requires its cookie, strips forged identities and rejects foreign origins', async () => {
  let received;
  const upstream = http.createServer((req, res) => {
    received = req.headers;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        id: req.headers['oai-authenticated-user-id'],
        email: req.headers['oai-authenticated-user-email'],
        range: req.headers.range,
      }),
    );
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const settings = {
    port: 0,
    workerPort: upstream.address().port,
    label: 'Local Prod',
    releaseId: 'a'.repeat(64),
  };
  const key = randomBytes(32).toString('hex');
  const proxy = accountProxy('prod', settings, key);
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  settings.port = proxy.address().port;
  const origin = `http://127.0.0.1:${settings.port}`;
  try {
    let r = await fetch(origin + '/api/session', {
      headers: { 'oai-authenticated-user-id': 'forged' },
      redirect: 'manual',
    });
    assert.equal(r.status, 303);
    await r.text();
    assert.equal(received, undefined);
    r = await fetch(origin + '/__local/account', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'profile=staff',
      redirect: 'manual',
    });
    assert.equal(r.status, 303);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    await r.text();
    r = await fetch(origin + '/api/media?key=example', {
      headers: {
        cookie,
        'oai-authenticated-user-id': 'forged-owner',
        range: 'bytes=2-5',
      },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      id: 'local-prod-staff',
      email: 'staff@chalktalk.local',
      range: 'bytes=2-5',
    });
    assert.equal(received.cookie, undefined);
    r = await fetch(origin + '/api/write', {
      method: 'POST',
      headers: { cookie, origin: 'https://other.example' },
      body: 'no',
    });
    assert.equal(r.status, 403);
    await r.text();
    r = await fetch(origin + '/api/session', {
      headers: {
        cookie: `chalktalk_local_prod=${localCookie('nonprod', 'owner', key)}`,
      },
      redirect: 'manual',
    });
    assert.equal(r.status, 303);
    await r.text();
    r = await fetch(origin + '/signout-with-chatgpt', {
      headers: { cookie },
      redirect: 'manual',
    });
    assert.equal(r.status, 303);
    assert.ok(r.headers.get('set-cookie').includes('Max-Age=0'));
    await r.text();
  } finally {
    proxy.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => proxy.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  }
});
