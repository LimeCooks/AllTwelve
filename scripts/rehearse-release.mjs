import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

// Local-only production-build rehearsal. No deployment or remote-storage command
// exists here; fixture identities are sent exclusively to a loopback Worker.
const root = fileURLToPath(new URL('../', import.meta.url));
const outputs = path.join(root, 'outputs');
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const restartOnly = args.includes('--restart-only');
if (
  !args.includes('--candidate') ||
  args.includes('--rollback') === restartOnly
)
  throw new Error(
    'Usage: node scripts/rehearse-release.mjs --candidate outputs/current.tar.gz (--rollback outputs/previous.tar.gz | --restart-only)',
  );
const archives = [
  option('--candidate'),
  ...(restartOnly ? [] : [option('--rollback')]),
].map((value) => path.resolve(root, value));
for (const archive of archives)
  if (!archive.startsWith(outputs + path.sep) || !archive.endsWith('.tar.gz'))
    throw new Error('Use reviewed deployment archives inside outputs.');
await mkdir(outputs, { recursive: true });
const runDirectory = await mkdtemp(path.join(outputs, 'release-rehearsal-'));
const storage = path.join(runDirectory, 'storage');
const wrangler = path.join(
  root,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const environment = {
  ...process.env,
  CI: '1',
  CLOUDFLARE_SEND_METRICS: 'false',
};
const report = {
  mode: restartOnly
    ? 'candidate restart only - no rollback approval'
    : 'candidate rollback and forward',
  startedAt: new Date().toISOString(),
  directory: runDirectory,
  storage,
  stages: [],
  artifacts: [],
};
console.log(`Isolated rehearsal: ${runDirectory}`);

function command(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    cwd: runDirectory,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.status !== 0)
    throw new Error(
      `${path.basename(executable)} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`,
    );
  return result.stdout;
}

const snapshots = [];
for (const [index, archive] of archives.entries()) {
  const entries = command('tar', ['-tzf', archive])
    .split(/\r?\n/)
    .filter(Boolean);
  if (
    entries.some(
      (entry) =>
        path.isAbsolute(entry) ||
        /^[A-Za-z]:/.test(entry) ||
        entry.split(/[\\/]/).includes('..'),
    )
  )
    throw new Error('Unsafe archive path.');
  const snapshot = path.join(
    runDirectory,
    index === 0 ? 'candidate' : 'rollback',
  );
  await mkdir(snapshot);
  command('tar', ['-xzf', archive, '-C', snapshot]);
  const original = JSON.parse(
    await readFile(path.join(snapshot, 'dist/server/wrangler.json'), 'utf8'),
  );
  const config = path.join(snapshot, 'rehearsal.json');
  await writeFile(
    config,
    JSON.stringify(
      {
        name: 'chalktalk-release-rehearsal',
        main: path.join(snapshot, 'dist/server/index.js'),
        compatibility_date: original.compatibility_date,
        compatibility_flags: original.compatibility_flags,
        no_bundle: true,
        rules: original.rules,
        assets: { directory: path.join(snapshot, 'dist/client') },
        vars: { CHALKTALK_MODE: 'pilot' },
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'chalktalk-rehearsal-local',
            database_id: '00000000-0000-4000-8000-000000000001',
            migrations_dir: path.join(snapshot, 'dist/.openai/drizzle'),
          },
        ],
        r2_buckets: [
          { binding: 'MEDIA', bucket_name: 'chalktalk-rehearsal-local' },
        ],
      },
      null,
      2,
    ),
  );
  snapshots.push(config);
  report.artifacts.push({
    archive,
    sha256: createHash('sha256')
      .update(await readFile(archive))
      .digest('hex'),
  });
}
console.log('Applying schema to fresh local storage only…');
command(process.execPath, [
  wrangler,
  'd1',
  'migrations',
  'apply',
  'DB',
  '--local',
  '--persist-to',
  storage,
  '--config',
  snapshots[0],
]);

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const assigned = server.address().port;
    server.close(() => resolve(assigned));
  });
});
const origin = `http://127.0.0.1:${port}`;
const ownerHeaders = (owner) =>
  owner
    ? {
        'oai-authenticated-user-id': `local-release-owner-${owner}`,
        'oai-authenticated-user-full-name': `Local rehearsal ${owner}`,
      }
    : {};
async function api(
  url,
  owner = 'a',
  body,
  method = body === undefined ? 'GET' : 'POST',
  expected = 200,
) {
  assert.equal(
    new URL(url, origin).origin,
    origin,
    'rehearsal requests must stay on loopback',
  );
  const response = await fetch(new URL(url, origin), {
    method,
    headers: {
      ...ownerHeaders(owner),
      ...(body === undefined
        ? {}
        : { 'content-type': 'application/json', origin }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    expected,
    `${method} ${url}: ${JSON.stringify(result)}`,
  );
  return result;
}

let processHandle;
async function start(config, label) {
  console.log(`Starting ${label} against the same isolated local storage…`);
  let log = '';
  processHandle = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      storage,
      '--config',
      config,
    ],
    {
      cwd: runDirectory,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const child = processHandle;
  child.stdout.on('data', (chunk) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log += chunk;
  });
  child.on('error', (error) => {
    log += error.message;
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`${label} stopped before readiness: ${log}`);
    try {
      const response = await fetch(`${origin}/api/session`, {
        headers: ownerHeaders('a'),
        signal: AbortSignal.timeout(1500),
      });
      if (response.status === 200) {
        const session = await response.json();
        assert.equal(session.mode, 'pilot');
        report.stages.push({ label, readyAt: new Date().toISOString() });
        return;
      }
    } catch {
      /* Poll this same process; do not launch another one. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready: ${log}`);
}
async function stop() {
  if (!processHandle) return;
  const child = processHandle;
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    if (process.platform === 'win32')
      command('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
    let timer;
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Owned rehearsal process did not stop.')),
            10_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  processHandle = null;
}

const media = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU9sAAAAASUVORK5CYII=',
  'base64',
);
let fixture;
async function verifySaved(label) {
  const ownAthlete = (await api('/api/athletes')).athletes.find(
    (athlete) => athlete.id === fixture.athlete,
  );
  assert.equal(ownAthlete.firstName, 'Corrected');
  assert.equal(ownAthlete.staffNote, 'Private rehearsal note');
  const foreignAthlete = await api(
    '/api/athletes',
    'b',
    { id: fixture.athlete, status: 'Out' },
    'PATCH',
    404,
  );
  assert.equal(
    foreignAthlete.athlete,
    undefined,
    'A failed foreign write must not reveal an athlete',
  );
  const a = await api('/api/session');
  assert.equal(a.team.id, fixture.team);
  assert.equal(
    (await api('/api/playbooks')).plays.find((play) => play.id === fixture.play)
      .name,
    'Rehearsal defence',
  );
  assert.equal(
    (await api('/api/playbooks')).plays.find((play) => play.id === fixture.play)
      .notes,
    'Saved diagram revision',
  );
  const savedInstall = await api(`/api/install?packageId=${fixture.install}`);
  assert.equal(savedInstall.items[0].playId, fixture.play);
  assert.equal(savedInstall.package.name, 'Corrected rehearsal install');
  const savedPractice = (await api('/api/practice-plans')).plans.find(
    (plan) => plan.id === fixture.practice,
  );
  assert.equal(savedPractice.title, 'Corrected rehearsal practice');
  assert.deepEqual(savedPractice.blocks, [
    [
      '16:00',
      '13 min',
      'Rehearsal segment',
      'Corrected coaching focus',
      'defence',
    ],
  ]);
  assert.equal(savedPractice.durationMinutes, 13);
  assert.equal(
    (await api('/api/calendar-events')).events[0].title,
    'Corrected rehearsal practice',
  );
  const download = await fetch(`${origin}/api/media?key=team-logo`, {
    headers: ownerHeaders('a'),
  });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), media);
  const notebook = await api('/api/workspace-state?key=sideline-review-v3');
  const conversations = await api(
    '/api/workspace-state?key=private-conversations-v3',
  );
  assert.equal(
    conversations.value.threads[0].name,
    'Private rehearsal conversation',
  );
  assert.equal(
    conversations.value.threads[0].messages[0].text,
    'Durable private rehearsal message',
  );
  assert.equal(notebook.value.notes[0].text, 'Private bench observation');
  const depth = await api('/api/workspace-state?key=depth-layouts-v3');
  assert.equal(depth.value.Offence[0].athleteId, fixture.athlete);
  assert.equal(depth.value.Offence[0].notes, 'Private role note');
  assert.equal(
    (await api('/api/workspace-state?key=depth-layouts-v3', 'b')).value,
    null,
  );
  assert.equal(
    (await api('/api/workspace-state?key=sideline-review-v3', 'b')).value,
    null,
  );
  assert.equal((await api('/api/playbooks', 'b')).plays.length, 0);
  const foreignMedia = await fetch(`${origin}/api/media?key=team-logo`, {
    headers: ownerHeaders('b'),
  });
  assert.equal(foreignMedia.status, 404);
  await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const owner = index % 2 ? 'a' : 'b';
      assert.equal(
        (await api('/api/playbooks', owner)).plays.length,
        owner === 'a' ? 1 : 0,
      );
    }),
  );
  const backup = await api('/api/backups', 'a', undefined, 'POST');
  assert.equal(backup.parts, 1);
  const backupPath = `/api/backups?id=${backup.id}&part=1`;
  const backupResponse = await fetch(`${origin}${backupPath}`, {
    headers: ownerHeaders('a'),
  });
  assert.equal(backupResponse.status, 200);
  const zip = unzipSync(new Uint8Array(await backupResponse.arrayBuffer()));
  assert.deepEqual(Buffer.from(zip['media/team-logo']), media);
  const manifest = JSON.parse(
    new TextDecoder().decode(zip['chalktalk-backup.json']),
  );
  assert.equal(manifest.teamId, fixture.team);
  assert.ok(manifest.tables.plays.some((play) => play.id === fixture.play));
  assert.equal(
    (await fetch(`${origin}${backupPath}`, { headers: ownerHeaders('b') }))
      .status,
    404,
  );
  report.stages.push({
    label: `${label}: saved data and owner isolation verified`,
    verifiedAt: new Date().toISOString(),
  });
  console.log(
    `${label}: saved plays, install, practice, event and uploaded bytes verified.`,
  );
}

try {
  await start(snapshots[0], 'candidate');
  await api('/api/session', null, undefined, 'GET', 401);
  const crossOrigin = await fetch(`${origin}/api/onboarding`, {
    method: 'POST',
    headers: {
      ...ownerHeaders('c'),
      origin: 'https://unrelated.invalid',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Must not be created', season: '2026' }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await api('/api/session', 'c')).team, null);
  for (const owner of ['a', 'b']) {
    assert.equal((await api('/api/session', owner)).team, null);
    await api(
      '/api/onboarding',
      owner,
      { name: `Local rehearsal ${owner}`, season: '2026' },
      'POST',
      201,
    );
    assert.equal((await api('/api/playbooks', owner)).plays.length, 0);
    assert.equal((await api('/api/playbooks', owner)).books.length, 0);
    assert.equal((await api('/api/athletes', owner)).athletes.length, 0);
    assert.equal((await api('/api/install', owner)).packages.length, 0);
    assert.equal((await api('/api/film', owner)).assets.length, 0);
    assert.equal((await api('/api/calendar-events', owner)).events.length, 0);
    assert.equal((await api('/api/practice-plans', owner)).plans.length, 0);
  }
  report.stages.push({
    label:
      'Authenticated blank onboarding, anonymous rejection and cross-origin write rejection verified',
    verifiedAt: new Date().toISOString(),
  });
  const athlete = await api(
    '/api/athletes',
    'a',
    {
      firstName: 'Local',
      lastName: 'Rehearsal',
      position: 'DB',
      unit: 'Defence',
      graduationYear: 12,
      weightLb: 180,
      email: 'local-rehearsal@example.test',
      staffNote: 'Private rehearsal note',
    },
    'POST',
    201,
  );
  const editedAthlete = await api(
    '/api/athletes',
    'a',
    {
      id: athlete.athlete.id,
      firstName: 'Corrected',
      lastName: 'Rehearsal',
      number: 0,
      position: 'FC',
      unit: 'Defence',
      graduationYear: 11,
      weightLb: 185,
      height: '6 ft',
      email: 'local-rehearsal@example.test',
      phone: '555-0100',
      staffNote: 'Must not replace saved note',
      status: 'Out',
    },
    'PUT',
  );
  assert.equal(editedAthlete.athlete.id, athlete.athlete.id);
  assert.equal(editedAthlete.athlete.staffNote, 'Private rehearsal note');
  assert.equal(editedAthlete.athlete.status, 'Active');
  const bookRequest = {
    kind: 'book',
    name: 'Rehearsal',
    side: 'Defence',
    creationId: crypto.randomUUID(),
  };
  const book = await api('/api/playbooks', 'a', bookRequest, 'POST', 201);
  assert.equal(book.books.length, 1);
  const retriedBook = await api(
    '/api/playbooks',
    'a',
    bookRequest,
    'POST',
    200,
  );
  assert.equal(retriedBook.createdId, book.createdId);
  assert.equal(retriedBook.books.length, 1);
  const play = await api(
    '/api/playbooks',
    'a',
    { kind: 'play', playbookId: book.books[0].id, name: 'Rehearsal defence' },
    'POST',
    201,
  );
  const openedPlay = play.plays.find((record) => record.id === play.createdId);
  await api(
    '/api/playbooks',
    'a',
    { ...openedPlay, notes: 'Saved diagram revision' },
    'PUT',
  );
  await api(
    '/api/playbooks',
    'a',
    { ...openedPlay, name: 'Stale overwrite' },
    'PUT',
    409,
  );
  const copySource = (await api('/api/playbooks')).plays.find(
    (record) => record.id === play.createdId,
  );
  const duplicateRequest = {
    kind: 'duplicate',
    id: copySource.id,
    version: copySource.version,
    creationId: crypto.randomUUID(),
  };
  const duplicateResult = await api(
    '/api/playbooks',
    'a',
    duplicateRequest,
    'POST',
    201,
  );
  const duplicatePlay = duplicateResult.plays.find(
    (record) => record.id === duplicateResult.createdId,
  );
  assert.equal(duplicatePlay.notes, 'Saved diagram revision');
  assert.equal(
    (await api('/api/playbooks', 'a', duplicateRequest, 'POST', 200)).createdId,
    duplicatePlay.id,
  );
  const changedCopy = await api(
    '/api/playbooks',
    'a',
    { ...duplicatePlay, name: 'Rehearsal revised copy' },
    'PUT',
  );
  await api(
    '/api/playbooks',
    'a',
    { kind: 'play', id: duplicatePlay.id, version: duplicatePlay.version },
    'DELETE',
    409,
  );
  const currentCopy = changedCopy.plays.find(
    (record) => record.id === duplicatePlay.id,
  );
  await api(
    '/api/playbooks',
    'a',
    { kind: 'play', id: currentCopy.id, version: currentCopy.version },
    'DELETE',
  );
  const install = await api(
    '/api/install',
    'a',
    { kind: 'package', name: 'Any cadence', unit: 'Defence', dueAt: '' },
    'POST',
    201,
  );
  await api('/api/messages', 'a', {
    action: 'create',
    id: 'rehearsal-conversation',
    name: 'Private rehearsal conversation',
  });
  const privateMessage = {
    action: 'message',
    id: 'rehearsal-message',
    threadId: 'rehearsal-conversation',
    text: 'Durable private rehearsal message',
  };
  await api('/api/messages', 'a', privateMessage);
  await api('/api/messages', 'a', privateMessage);
  assert.equal((await api('/api/messages')).threads[0].messages.length, 1);
  const installRevision = {
    kind: 'package',
    packageId: install.package.id,
    name: 'Corrected rehearsal install',
    unit: 'Defence',
    dueAt: '',
    version: install.package.version,
  };
  await api('/api/install', 'a', installRevision, 'PATCH');
  await api('/api/install', 'a', installRevision, 'PATCH', 409);
  await api('/api/install', 'a', {
    packageId: install.package.id,
    playId: play.createdId,
  });
  const practice = await api(
    '/api/practice-plans',
    'a',
    {
      title: 'Rehearsal practice',
      practiceDate: '2026-11-06',
      blocks: [['TBD', '10 min', 'Rehearsal segment', '', 'defence']],
      generated: false,
    },
    'POST',
    201,
  );
  const practiceRevision = {
    ...practice.plans.find((plan) => plan.id === practice.savedPlanId),
    title: 'Corrected rehearsal practice',
    blocks: [
      [
        '16:00',
        '13 min',
        'Rehearsal segment',
        'Corrected coaching focus',
        'defence',
      ],
    ],
  };
  await api('/api/practice-plans', 'a', practiceRevision, 'PUT');
  await api('/api/practice-plans', 'a', practiceRevision, 'PUT', 409);
  const savedEvent = await api(
    '/api/calendar-events',
    'a',
    {
      title: 'Rehearsal practice',
      eventType: 'practice',
      startsAt: '2026-11-06T20:00:00Z',
      endsAt: '2026-11-06T21:00:00Z',
      location: '',
      notes: '',
    },
    'POST',
    201,
  );
  const correctedEvent = {
    id: savedEvent.event.id,
    title: 'Corrected rehearsal practice',
    eventType: 'practice',
    startsAt: '2026-11-06T20:30:00Z',
    endsAt: '2026-11-06T21:45:00Z',
    location: 'Corrected rehearsal field',
    notes: 'Corrected rehearsal note',
  };
  const foreignEvent = await api(
    '/api/calendar-events',
    'b',
    correctedEvent,
    'PUT',
    404,
  );
  assert.equal(foreignEvent.event, undefined);
  const editedEvent = await api(
    '/api/calendar-events',
    'a',
    correctedEvent,
    'PUT',
    200,
  );
  assert.equal(editedEvent.event.id, savedEvent.event.id);
  assert.equal(editedEvent.event.startsAt, '2026-11-06T20:30:00.000Z');
  assert.equal(editedEvent.event.notes, correctedEvent.notes);
  const uploaded = await fetch(`${origin}/api/media?key=team-logo`, {
    method: 'POST',
    headers: {
      ...ownerHeaders('a'),
      origin,
      'content-type': 'image/png',
      'x-chalktalk-upload-size': String(media.length),
      'x-chalktalk-filename': 'rehearsal.png',
    },
    body: media,
  });
  assert.equal(uploaded.status, 200, await uploaded.text());
  const range = await fetch(`${origin}/api/media?key=team-logo`, {
    headers: { ...ownerHeaders('a'), range: 'bytes=1-3' },
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 1-3/${media.length}`);
  assert.deepEqual(
    Buffer.from(await range.arrayBuffer()),
    media.subarray(1, 4),
  );
  const head = await fetch(`${origin}/api/media?key=team-logo`, {
    method: 'HEAD',
    headers: ownerHeaders('a'),
  });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), media.length);
  await api(
    '/api/sideline',
    'a',
    {
      action: 'note',
      id: 'rehearsal-sideline-note',
      text: 'Private bench observation',
    },
    'POST',
    200,
  );
  // Storage lifecycle fixture only; real playback is verified separately with an MP4 in the browser.
  const disposableVideo = Buffer.from('disposable-film-storage-fixture');
  const videoUpload = await fetch(
    `${origin}/api/media?key=film-delete-rehearsal`,
    {
      method: 'POST',
      headers: {
        ...ownerHeaders('a'),
        origin,
        'content-type': 'video/mp4',
        'x-chalktalk-upload-size': String(disposableVideo.length),
        'x-chalktalk-filename': 'rehearsal.mp4',
      },
      body: disposableVideo,
    },
  );
  assert.equal(videoUpload.status, 200);
  const videoRecord = await api(
    '/api/film',
    'a',
    {
      action: 'register',
      storageKey: 'film-delete-rehearsal',
      title: 'Disposable film removal',
    },
    'POST',
    201,
  );
  const chartedVideo = await api(
    '/api/film',
    'a',
    {
      action: 'upsertClip',
      assetId: videoRecord.asset.id,
      startSeconds: 0,
      endSeconds: 1.25,
      note: 'Disposable clip',
    },
    'POST',
    201,
  );
  const staleRemove = await fetch(
    `${origin}/api/film?assetId=${videoRecord.asset.id}`,
    {
      method: 'DELETE',
      headers: {
        ...ownerHeaders('a'),
        origin,
        'x-chalktalk-film-version': videoRecord.asset.version,
      },
    },
  );
  assert.equal(staleRemove.status, 409);
  const removeVideo = await fetch(
    `${origin}/api/film?assetId=${videoRecord.asset.id}`,
    {
      method: 'DELETE',
      headers: {
        ...ownerHeaders('a'),
        origin,
        'x-chalktalk-film-version': chartedVideo.asset.version,
      },
    },
  );
  assert.equal(removeVideo.status, 200, await removeVideo.text());
  const removedBytes = await fetch(
    `${origin}/api/media?key=film-delete-rehearsal`,
    { method: 'HEAD', headers: ownerHeaders('a') },
  );
  assert.equal(removedBytes.status, 404);
  fixture = {
    athlete: athlete.athlete.id,
    team: (await api('/api/session')).team.id,
    play: play.createdId,
    install: install.package.id,
    practice: practice.savedPlanId,
  };
  const depth = await api('/api/depth-charts');
  assert.deepEqual(depth.layouts, {
    Offence: [],
    Defence: [],
    'Special teams': [],
  });
  const layouts = {
    Offence: [
      {
        id: 'rehearsal-depth-role',
        pos: 'Boundary half',
        athleteId: fixture.athlete,
        x: 25,
        y: 40,
        notes: 'Private role note',
      },
    ],
    Defence: [],
    'Special teams': [],
  };
  await api(
    '/api/depth-charts',
    'a',
    { layouts, version: depth.version },
    'PUT',
    200,
  );
  const foreignDepth = await api('/api/depth-charts', 'b');
  await api(
    '/api/depth-charts',
    'b',
    { layouts, version: foreignDepth.version },
    'PUT',
    400,
  );
  await verifySaved('candidate');
  await stop();
  await start(
    snapshots[1] ?? snapshots[0],
    restartOnly ? 'candidate restart' : 'rollback',
  );
  await verifySaved(restartOnly ? 'candidate restart' : 'rollback');
  await stop();
  await start(snapshots[0], 'forward again');
  await verifySaved('forward again');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  try {
    await stop();
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(
      path.join(runDirectory, 'report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(`Report: ${path.join(runDirectory, 'report.json')}`);
  }
}
