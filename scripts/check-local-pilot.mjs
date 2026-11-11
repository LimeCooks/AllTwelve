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
const report = {
  root,
  commit: process.env.GITHUB_SHA ?? null,
  startedAt: new Date().toISOString(),
  checks: [],
};
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
  report.releaseId = release;
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
    const range = await fetch(
      `http://127.0.0.1:${settings[env].port}/api/media?key=team-logo`,
      {
        headers: { cookie: owners[env], range: 'bytes=2-5' },
        signal: AbortSignal.timeout(10000),
      },
    );
    assert.equal(range.status, 206);
    assert.equal(
      range.headers.get('content-range'),
      `bytes 2-5/${bytes[env].length}`,
    );
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      bytes[env].subarray(2, 6),
    );
  }
  report.checks.push(
    'Separate blank onboarding, owner identities, team IDs, roster records, media bytes, partial downloads and foreign-team rejection',
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
  const eventBody = {
    id: randomUUID(),
    title: 'Team practice',
    eventType: 'practice',
    startsAt: '2026-11-10T20:00:00Z',
    endsAt: '2026-11-10T21:30:00Z',
    location: 'Practice field',
    notes: 'Original staff plan',
  };
  const firstEvent = (
    await api('prod', owners.prod, '/api/calendar-events', eventBody, 201)
  ).event;
  assert.deepEqual(
    (await api('prod', owners.prod, '/api/calendar-events', eventBody, 201))
      .event,
    firstEvent,
  );
  const currentEvent = (
    await api(
      'prod',
      staff,
      '/api/calendar-events',
      {
        ...firstEvent,
        title: 'Team practice — revised',
        notes: 'Bring playbooks',
      },
      200,
      'PUT',
    )
  ).event;
  await api(
    'prod',
    owners.prod,
    '/api/calendar-events',
    { ...firstEvent, title: 'Stale event must not replace staff changes' },
    409,
    'PUT',
  );
  await api(
    'prod',
    owners.prod,
    '/api/calendar-events?id=' + firstEvent.id,
    undefined,
    409,
    'DELETE',
    { 'x-chalktalk-calendar-version': firstEvent.version },
  );
  const depth = await api('prod', owners.prod, '/api/depth-charts');
  const removedBody = {
    ...eventBody,
    id: randomUUID(),
    title: 'Disposable removed-event retry check',
  };
  const removedEvent = (
    await api('prod', owners.prod, '/api/calendar-events', removedBody, 201)
  ).event;
  await api(
    'prod',
    owners.prod,
    '/api/calendar-events?id=' + removedEvent.id,
    undefined,
    200,
    'DELETE',
    { 'x-chalktalk-calendar-version': removedEvent.version },
  );
  await api('prod', owners.prod, '/api/calendar-events', removedBody, 409);
  const layouts = {
    ...depth.layouts,
    Defence: [
      {
        id: randomUUID(),
        pos: 'Field safety',
        athleteId: athlete.id,
        x: 50,
        y: 35,
        notes: 'Communicate coverage',
      },
    ],
  };
  await api(
    'prod',
    staff,
    '/api/depth-charts',
    { layouts, version: depth.version },
    200,
    'PUT',
  );
  const gameplan = (
    await api(
      'prod',
      staff,
      '/api/gameplans',
      {
        id: randomUUID(),
        title: 'Opponent preparation',
        opponent: 'Scout team',
        date: '2026-11-10',
        archived: false,
        state: {
          unit: 'Defence',
          included: [],
          objectives: [
            {
              title: 'Communicate coverage',
              detail: 'Confirm the call before every snap',
              target: 'All DBs',
            },
          ],
          callBuckets: [{ name: 'Base calls', plays: [play.createdId] }],
        },
      },
      201,
    )
  ).plan;
  const generated = await api(
    'prod',
    staff,
    '/api/practice-plans',
    {
      id: randomUUID(),
      title: 'Defensive teaching practice',
      practiceDate: '2026-11-10',
      generateFrom: { id: gameplan.id, version: gameplan.version },
    },
    201,
  );
  const practice = generated.plans.find(
    (plan) => plan.id === generated.savedPlanId,
  );
  assert.ok(practice);
  assert.ok(JSON.stringify(practice).includes('Communicate coverage'));
  report.checks.push(
    'Shared calendar rejects stale edits/deletes and retries without duplicates; depth assignments and named gameplan-to-practice generation save real linked records',
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
    assert.equal(
      recovered
        .prepare('SELECT notes FROM calendar_events WHERE id=?')
        .get(currentEvent.id).notes,
      currentEvent.notes,
    );
    assert.deepEqual(
      JSON.parse(
        recovered
          .prepare(
            'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
          )
          .get(teams.prod, 'depth-layouts-v3').value_json,
      ),
      layouts,
    );
    assert.equal(
      JSON.parse(
        recovered
          .prepare(
            'SELECT value_json FROM workspace_state WHERE team_id=? AND state_key=?',
          )
          .get(teams.prod, 'gameplan-record-v1:' + gameplan.id).value_json,
      ).title,
      gameplan.title,
    );
    assert.ok(
      recovered
        .prepare('SELECT plan_json FROM practice_plans WHERE id=?')
        .get(practice.id)
        .plan_json.includes('Communicate coverage'),
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
  assert.deepEqual(
    (
      await api(
        'prod',
        owners.prod,
        '/api/calendar-events?id=' + currentEvent.id,
      )
    ).event,
    currentEvent,
  );
  assert.deepEqual(
    (await api('prod', staff, '/api/depth-charts')).layouts,
    layouts,
  );
  assert.deepEqual(
    (await api('prod', staff, '/api/gameplans?id=' + gameplan.id)).plan,
    gameplan,
  );
  assert.deepEqual(
    (await api('prod', staff, '/api/practice-plans')).plans.find(
      (plan) => plan.id === practice.id,
    ),
    practice,
  );
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
