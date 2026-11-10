import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { restoreBackup } from './restore-backup.mjs';
import {
  workspace,
  captureRelease,
  prepareEnvironment,
  launchLocalEnvironment,
} from './local-pilot.mjs';

// Disposable stores only. Never opens either user-facing .local-pilot store.
await mkdir(path.join(workspace, 'outputs'), { recursive: true });
const root = await mkdtemp(
  path.join(workspace, 'outputs', 'local-pilot-check-'),
);
const key = randomBytes(32).toString('hex');
const running = new Map();
const settings = {};
const report = { root, startedAt: new Date().toISOString(), checks: [] };
async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function login(env, profile) {
  const origin = `http://127.0.0.1:${settings[env].port}`;
  const response = await fetch(origin + '/__local/account', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'profile=' + profile,
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 303);
  await response.text();
  return response.headers.get('set-cookie').split(';')[0];
}
async function api(
  env,
  cookie,
  url,
  body,
  expected = 200,
  method = body === undefined ? 'GET' : 'POST',
  extra = {},
) {
  const origin = `http://127.0.0.1:${settings[env].port}`;
  const response = await fetch(origin + url, {
    method,
    headers: {
      cookie,
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function file(env, cookie, bytes) {
  const origin = `http://127.0.0.1:${settings[env].port}`;
  const response = await fetch(origin + '/api/media?key=team-logo', {
    method: 'POST',
    headers: {
      cookie,
      origin,
      'content-type': 'image/png',
      'x-chalktalk-upload-size': String(bytes.length),
    },
    body: bytes,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  await response.text();
}
async function readFile(env, cookie) {
  const response = await fetch(
    `http://127.0.0.1:${settings[env].port}/api/media?key=team-logo`,
    { headers: { cookie }, signal: AbortSignal.timeout(10000) },
  );
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}
try {
  const release = await captureRelease(root);
  for (const env of ['prod', 'nonprod']) {
    settings[env] = await prepareEnvironment(env, release, root, {
      label: 'Disposable ' + env,
      port: await freePort(),
      workerPort: await freePort(),
    });
    running.set(env, await launchLocalEnvironment(env, root, key));
  }
  const owners = {
    prod: await login('prod', 'owner'),
    nonprod: await login('nonprod', 'owner'),
  };
  const teams = {};
  for (const env of ['prod', 'nonprod']) {
    const fresh = await api(env, owners[env], '/api/session');
    assert.equal(fresh.team, null);
    assert.equal(fresh.canCreateTeam, true);
    await api(
      env,
      owners[env],
      '/api/onboarding',
      { name: 'Disposable ' + env, season: '2026' },
      201,
    );
    teams[env] = (await api(env, owners[env], '/api/session')).team.id;
    assert.equal(
      (await api(env, owners[env], '/api/playbooks')).plays.length,
      0,
    );
    assert.equal(
      (await api(env, owners[env], '/api/athletes')).athletes.length,
      0,
    );
  }
  assert.notEqual(teams.prod, teams.nonprod);
  const athlete = (
    await api(
      'prod',
      owners.prod,
      '/api/athletes',
      {
        firstName: 'Local',
        lastName: 'Receiver',
        position: 'FS',
        unit: 'Defence',
        graduationYear: 12,
        weightLb: 180,
        email: 'qa-player@example.test',
        staffNote: 'Private staff note',
      },
      201,
    )
  ).athlete;
  assert.equal(
    (await api('nonprod', owners.nonprod, '/api/athletes')).athletes.length,
    0,
  );
  await api('nonprod', owners.nonprod, '/api/athletes', undefined, 403, 'GET', {
    'x-chalktalk-team-id': teams.prod,
  });
  const bytes = {
    prod: Buffer.from('prod-private-image'),
    nonprod: Buffer.from('nonprod-private-image'),
  };
  for (const env of ['prod', 'nonprod']) {
    await file(env, owners[env], bytes[env]);
    assert.deepEqual(await readFile(env, owners[env]), bytes[env]);
  }
  report.checks.push(
    'Separate blank onboarding, owner identities, team IDs, roster records, media bytes and foreign-team rejection',
  );
  await api(
    'prod',
    owners.prod,
    '/api/team-access',
    { id: randomUUID(), email: 'staff@chalktalk.local', role: 'staff' },
    201,
  );
  const staff = await login('prod', 'staff');
  const invitation = (await api('prod', staff, '/api/team-invitations'))
    .invitations[0];
  await api('prod', staff, '/api/team-invitations', {
    id: invitation.id,
    version: invitation.version,
  });
  assert.equal((await api('prod', staff, '/api/session')).team.id, teams.prod);
  assert.equal((await api('prod', staff, '/api/athletes')).athletes.length, 1);
  await api('prod', staff, '/api/backups', undefined, 403);
  const nonprodStaff = await login('nonprod', 'staff');
  assert.equal(
    (await api('nonprod', nonprodStaff, '/api/team-invitations')).invitations
      .length,
    0,
  );
  const book = await api(
    'prod',
    owners.prod,
    '/api/playbooks',
    { kind: 'book', name: 'Defence', side: 'Defence' },
    201,
  );
  const play = await api(
    'prod',
    owners.prod,
    '/api/playbooks',
    { kind: 'play', name: 'Published teaching', playbookId: book.createdId },
    201,
  );
  const pack = (
    await api(
      'prod',
      owners.prod,
      '/api/install',
      { kind: 'package', name: 'Any cadence', unit: 'Defence', dueAt: '' },
      201,
    )
  ).package;
  await api('prod', owners.prod, '/api/install', {
    packageId: pack.id,
    playId: play.createdId,
  });
  await api(
    'prod',
    owners.prod,
    '/api/install',
    { kind: 'publish', packageId: pack.id },
    200,
    'PATCH',
  );
  await api(
    'prod',
    owners.prod,
    '/api/team-access',
    {
      id: randomUUID(),
      email: 'player@chalktalk.local',
      role: 'player',
      athleteId: athlete.id,
    },
    201,
  );
  const player = await login('prod', 'player');
  const playerInvite = (await api('prod', player, '/api/team-invitations'))
    .invitations[0];
  await api('prod', player, '/api/team-invitations', {
    id: playerInvite.id,
    version: playerInvite.version,
  });
  let learning = await api('prod', player, '/api/player-learning');
  assert.equal(learning.items.length, 1);
  assert.equal(learning.items[0].play.id, play.createdId);
  assert.equal(learning.items[0].materialSource, 'published');
  const issuedMaterial = learning.items[0].play;
  assert.deepEqual(
    (await api('prod', owners.prod, '/api/install?packageId=' + pack.id))
      .items[0].material,
    issuedMaterial,
  );
  assert.ok(!JSON.stringify(learning).includes('Private staff note'));
  for (const kind of ['reviewed', 'assignment', 'note']) {
    const row = learning.items[0];
    learning = await api(
      'prod',
      player,
      '/api/player-learning',
      { id: row.id, version: row.version, kind },
      200,
      'PATCH',
    );
  }
  assert.equal(
    (await api('prod', owners.prod, '/api/install?packageId=' + pack.id))
      .reviews[0].acknowledged,
    true,
  );
  report.checks.push(
    'Local staff invite/join and privacy; linked player published diagram and coach-visible acknowledgements',
  );
  const channel = (
    await api('prod', owners.prod, '/api/team-messages', {
      action: 'create',
      id: randomUUID(),
      kind: 'channel',
      name: 'Practice updates',
    })
  ).selected;
  const messageId = randomUUID();
  const send = {
    action: 'send',
    id: messageId,
    conversationId: channel.id,
    text: 'Bring your playbook.',
  };
  await api('prod', staff, '/api/team-messages', send);
  await api('prod', staff, '/api/team-messages', send);
  const received = await api(
    'prod',
    player,
    '/api/team-messages?conversationId=' + channel.id,
  );
  assert.equal(received.messages.length, 1);
  assert.equal(received.messages[0].text, send.text);
  assert.equal(
    received.messages[0].authorId,
    (await api('prod', staff, '/api/session')).user.id,
  );
  const direct = (
    await api('prod', staff, '/api/team-messages', {
      action: 'create',
      id: randomUUID(),
      kind: 'direct',
      recipientId: (await api('prod', player, '/api/session')).user.id,
    })
  ).selected;
  await api('prod', player, '/api/team-messages', {
    action: 'send',
    id: randomUUID(),
    conversationId: direct.id,
    text: 'I reviewed my assignment.',
  });
  assert.equal(
    (await api('prod', staff, '/api/team-messages?conversationId=' + direct.id))
      .messages.length,
    1,
  );
  await api(
    'prod',
    owners.prod,
    '/api/team-messages?conversationId=' + direct.id,
    undefined,
    404,
  );
  assert.equal(
    (await api('nonprod', owners.nonprod, '/api/team-messages')).conversations
      .length,
    0,
  );
  report.checks.push(
    'Team channels deliver across roles, retries do not duplicate, direct conversations exclude other accounts and the other environment',
  );
  const backup = await api(
    'prod',
    owners.prod,
    '/api/backups',
    undefined,
    200,
    'POST',
  );
  assert.equal(backup.state, 'ready');
  const archives = [];
  for (let part = 1; part <= backup.parts; part++) {
    const response = await fetch(
      `http://127.0.0.1:${settings.prod.port}/api/backups?archiveId=${backup.id}&part=${part}`,
      { headers: { cookie: owners.prod }, signal: AbortSignal.timeout(10000) },
    );
    assert.equal(response.status, 200);
    const archive = path.join(root, `backup-${part}.zip`);
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    archives.push(archive);
  }
  await restoreBackup({
    archives,
    output: path.join(root, 'offline-recovery'),
    ownerId: 'local-recovery-owner',
  });
  const recovered = new DatabaseSync(
    path.join(root, 'offline-recovery', 'workspace.sqlite'),
    { readOnly: true },
  );
  try {
    const retained = JSON.parse(
      recovered
        .prepare(
          'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
        )
        .get(teams.prod, 'install-published-v1:' + pack.id).value_json,
    );
    assert.equal(retained.items[0].playId, issuedMaterial.id);
    assert.deepEqual(
      JSON.parse(retained.items[0].diagramJson).players,
      issuedMaterial.players,
    );
    assert.deepEqual(retained.items[0].assignments, issuedMaterial.assignments);
    assert.equal(retained.items[0].notes, issuedMaterial.notes);
    assert.ok(
      recovered
        .prepare(
          'SELECT 1 FROM workspace_state WHERE team_id=? AND state_key=?',
        )
        .get(teams.prod, 'team-message-v1:' + channel.id + ':' + messageId),
    );
  } finally {
    recovered.close();
  }
  report.checks.push(
    'Published teaching and connected messages are present in downloaded manual backup ZIPs and restore into an independent offline database',
  );
  for (const entry of running.values()) await entry.stop();
  running.clear();
  for (const env of ['prod', 'nonprod'])
    running.set(env, await launchLocalEnvironment(env, root, key));
  for (const env of ['prod', 'nonprod']) {
    assert.equal(
      (await api(env, owners[env], '/api/session')).team.id,
      teams[env],
    );
    assert.deepEqual(await readFile(env, owners[env]), bytes[env]);
  }
  learning = await api('prod', player, '/api/player-learning');
  assert.deepEqual(learning.items[0].play, issuedMaterial);
  assert.equal(
    (
      await api(
        'prod',
        player,
        '/api/team-messages?conversationId=' + channel.id,
      )
    ).messages[0].id,
    messageId,
  );
  assert.equal(
    (await api('prod', staff, '/api/team-messages?conversationId=' + direct.id))
      .messages[0].text,
    'I reviewed my assignment.',
  );
  assert.ok(
    learning.items[0].reviewed &&
      learning.items[0].assignment &&
      learning.items[0].note,
  );
  assert.equal(
    (await api('nonprod', owners.nonprod, '/api/playbooks')).plays.length,
    0,
  );
  report.checks.push(
    'Both independent databases, files and player completion survive full local restarts',
  );
  report.status = 'passed';
  console.log('Passed dual local instance integration checks.');
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  throw error;
} finally {
  for (const entry of running.values()) await entry.stop();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(root, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log('Report: ' + path.join(root, 'report.json'));
}
