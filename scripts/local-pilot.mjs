import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  cp,
  open,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const workspace = fileURLToPath(new URL('../', import.meta.url));
const localRoot = path.join(workspace, '.local-pilot');
const wrangler = path.join(workspace, 'node_modules/wrangler/bin/wrangler.js');
const profiles = {
  owner: { name: 'Owner', email: 'owner@chalktalk.local' },
  staff: { name: 'Staff coach', email: 'staff@chalktalk.local' },
  player: { name: 'Player', email: 'player@chalktalk.local' },
};
const environments = {
  prod: { label: 'Local Prod', port: 3101, workerPort: 15161 },
  nonprod: { label: 'Local Non-Prod', port: 3102, workerPort: 15162 },
};
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, data) =>
  writeFile(file, JSON.stringify(data, null, 2));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );
const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{margin:0;background:#0c1721;color:#e5e9ef;font:16px system-ui;padding:clamp(18px,5vw,64px)}main{max-width:780px;margin:auto}h1{font-size:34px}p{line-height:1.65;color:#b5c8d6}article{padding:22px;border:1px solid #405565;border-radius:12px;margin:18px 0;background:#142531}a,button{display:inline-block;border:1px solid #5a7b91;border-radius:8px;background:#29495d;color:white;padding:12px 18px;font:inherit;cursor:pointer;text-decoration:none}small{display:block;margin:12px 0;overflow-wrap:anywhere}code{color:#a8d9ef}.tag{color:#a8d9ef;font-weight:700}</style></head><body><main>${body}</main></body></html>`;

export function localCookie(environment, profile, secret) {
  const value = `${environment}:${profile}`;
  return `${profile}.${createHmac('sha256', secret).update(value).digest('hex')}`;
}
export function cookieProfile(cookie, environment, secret) {
  if (typeof cookie !== 'string') return null;
  const [profile, signature, extra] = cookie.split('.');
  if (
    !Object.hasOwn(profiles, profile) ||
    !/^[a-f0-9]{64}$/.test(signature ?? '') ||
    extra
  )
    return null;
  const expected = localCookie(environment, profile, secret).split('.')[1];
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ? profile
    : null;
}
export function localIdentity(environment, profile) {
  if (
    !Object.hasOwn(environments, environment) ||
    !Object.hasOwn(profiles, profile)
  )
    throw new Error('Unknown local account.');
  return {
    id: `local-${environment}-${profile}`,
    email: profiles[profile].email,
    name: `${environments[environment].label} · ${profiles[profile].name}`,
  };
}
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory())
      result.push(...(await files(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) result.push(relative);
    else throw new Error('Release snapshots cannot contain symbolic links.');
  }
  return result.sort();
}
export async function captureRelease(root = localRoot) {
  const dist = path.join(workspace, 'dist');
  await readFile(path.join(dist, 'server/index.js'));
  const hash = createHash('sha256');
  for (const [label, directory] of [
    ['dist', dist],
    ['migrations', path.join(workspace, 'drizzle')],
  ]) {
    for (const name of await files(directory)) {
      hash.update(`${label}/${name.replaceAll('\\', '/')}`);
      hash.update(await readFile(path.join(directory, name)));
    }
  }
  const id = hash.digest('hex');
  const release = path.join(root, 'releases', id);
  try {
    await readFile(path.join(release, 'complete.json'));
  } catch {
    await mkdir(release, { recursive: true });
    await cp(dist, path.join(release, 'dist'), { recursive: true });
    await cp(
      path.join(workspace, 'drizzle'),
      path.join(release, 'migrations'),
      { recursive: true },
    );
    await save(path.join(release, 'complete.json'), {
      id,
      capturedAt: new Date().toISOString(),
    });
  }
  return id;
}
export async function prepareEnvironment(
  environment,
  releaseId,
  root = localRoot,
  ports = environments[environment],
) {
  if (
    !Object.hasOwn(environments, environment) ||
    !/^[a-f0-9]{64}$/.test(releaseId)
  )
    throw new Error('Invalid local environment or release.');
  const directory = path.join(root, environment);
  await mkdir(directory, { recursive: true });
  let previous;
  try {
    previous = await json(path.join(directory, 'environment.json'));
  } catch {}
  const release = path.join(root, 'releases', releaseId);
  await readFile(path.join(release, 'complete.json'));
  const settings = {
    environment,
    ...ports,
    databaseId: previous?.databaseId ?? randomUUID(),
    releaseId,
  };
  const config = {
    name: `chalktalk-local-${environment}`,
    main: path.join(release, 'dist/server/index.js'),
    compatibility_date: '2026-05-15',
    compatibility_flags: ['nodejs_compat'],
    no_bundle: true,
    rules: [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }],
    assets: { directory: path.join(release, 'dist/client') },
    vars: { CHALKTALK_MODE: 'pilot' },
    d1_databases: [
      {
        binding: 'DB',
        database_name: `chalktalk-local-${environment}`,
        database_id: settings.databaseId,
        migrations_dir: path.join(release, 'migrations'),
      },
    ],
    r2_buckets: [
      { binding: 'MEDIA', bucket_name: `chalktalk-local-${environment}` },
    ],
  };
  await save(path.join(directory, 'wrangler.json'), config);
  await save(path.join(directory, 'environment.json'), settings);
  return settings;
}
async function command(args, logFile) {
  const log = await open(logFile, 'a');
  try {
    const child = spawn(process.execPath, args, {
      cwd: workspace,
      windowsHide: true,
      stdio: ['ignore', log.fd, log.fd],
      env: { ...process.env, CI: '1', CLOUDFLARE_SEND_METRICS: 'false' },
    });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Local command failed (${code}). See ${logFile}`)),
      );
    });
  } finally {
    await log.close();
  }
}
async function migrate(environment, root = localRoot) {
  await command(
    [
      wrangler,
      'd1',
      'migrations',
      'apply',
      `chalktalk-local-${environment}`,
      '--local',
      '--config',
      path.join(root, environment, 'wrangler.json'),
      '--persist-to',
      path.join(root, environment, 'storage'),
    ],
    path.join(root, environment, 'setup.log'),
  );
}
async function secret(root) {
  const file = path.join(root, 'local-control.key');
  try {
    return await readFile(file, 'utf8');
  } catch {
    const value = randomBytes(32).toString('hex');
    await writeFile(file, value, { flag: 'wx' });
    return value;
  }
}
function hostAllowed(request, port) {
  return [`127.0.0.1:${port}`, `localhost:${port}`].includes(
    request.headers.host,
  );
}
export function accountProxy(environment, settings, key) {
  const cookieName = `chalktalk_local_${environment}`;
  return http.createServer(async (request, response) => {
    try {
      if (!hostAllowed(request, settings.port)) {
        response.writeHead(403);
        response.end('This local server accepts loopback hosts only.');
        return;
      }
      const origin = `http://${request.headers.host}`;
      const url = new URL(request.url, origin);
      if (request.headers.origin && request.headers.origin !== origin) {
        response.writeHead(403);
        response.end('Use this local site to make changes.');
        return;
      }
      const cookies = Object.fromEntries(
        (request.headers.cookie ?? '')
          .split(';')
          .map((part) => part.trim().split('=')),
      );
      const profile = cookieProfile(cookies[cookieName], environment, key);
      const html = (body) => {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(page(settings.label, body));
      };
      if (url.pathname === '/__local' || url.pathname === '/__local/') {
        html(
          `<span class="tag">${escape(settings.label)} · this computer only</span><h1>Choose a local test account</h1><p>These accounts simulate sign-in for local testing. They do not send email or use ChatGPT. Start with Owner, create your blank team, then invite another local account before testing staff/player access.</p>${Object.entries(
            profiles,
          )
            .map(
              ([id, account]) =>
                `<article><h2>${escape(account.name)}</h2><p>${escape(account.email)}</p><form action="/__local/account" method="post"><input type="hidden" name="profile" value="${id}"><button>Use ${escape(account.name)}</button></form></article>`,
            )
            .join(
              '',
            )}<p>Build <code>${settings.releaseId.slice(0, 12)}</code>. Prod and Non-Prod never share team data or uploaded files.</p><a href="http://127.0.0.1:3100/">Local dashboard</a>`,
        );
        return;
      }
      if (url.pathname === '/__local/account' && request.method === 'POST') {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 4096) throw new Error('Account request too large.');
        }
        const selected = new URLSearchParams(body).get('profile');
        if (!Object.hasOwn(profiles, selected)) {
          response.writeHead(400);
          response.end('Choose a local account.');
          return;
        }
        response.writeHead(303, {
          'set-cookie': `${cookieName}=${localCookie(environment, selected, key)}; Path=/; HttpOnly; SameSite=Strict`,
          location: '/',
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }
      if (url.pathname === '/signout-with-chatgpt') {
        response.writeHead(303, {
          'set-cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
          location: '/__local',
        });
        response.end();
        return;
      }
      if (!profile || url.pathname === '/signin-with-chatgpt') {
        response.writeHead(303, {
          location: '/__local',
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }
      const identity = localIdentity(environment, profile);
      const headers = { ...request.headers };
      for (const name of Object.keys(headers))
        if (
          name.startsWith('oai-authenticated-') ||
          ['authorization', 'cookie'].includes(name)
        )
          delete headers[name];
      Object.assign(headers, {
        'oai-authenticated-user-id': identity.id,
        'oai-authenticated-user-email': identity.email,
        'oai-authenticated-user-full-name': encodeURIComponent(identity.name),
        'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
      });
      const upstream = http.request(
        {
          hostname: '127.0.0.1',
          port: settings.workerPort,
          path: request.url,
          method: request.method,
          headers,
        },
        (result) => {
          response.writeHead(result.statusCode, result.headers);
          result.pipe(response);
        },
      );
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end(
          'Local app unavailable. Open the local dashboard for status.',
        );
      });
      request.on('aborted', () => upstream.destroy());
      response.on('close', () => {
        if (!response.writableEnded) upstream.destroy();
      });
      request.pipe(upstream);
    } catch (error) {
      if (!response.headersSent) response.writeHead(500);
      response.end(error.message);
    }
  });
}
async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}
function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  else child.kill('SIGTERM');
}
async function worker(environment, root) {
  const settings = await json(path.join(root, environment, 'environment.json'));
  const probe = http.createServer();
  await listen(probe, settings.workerPort);
  await new Promise((resolve) => probe.close(resolve));
  settings.label = environments[environment].label;
  await migrate(environment, root);
  const log = await open(path.join(root, environment, 'worker.log'), 'a');
  const child = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(settings.workerPort),
      '--persist-to',
      path.join(root, environment, 'storage'),
      '--config',
      path.join(root, environment, 'wrangler.json'),
    ],
    {
      cwd: workspace,
      windowsHide: true,
      stdio: ['ignore', log.fd, log.fd],
      env: { ...process.env, CI: '1', CLOUDFLARE_SEND_METRICS: 'false' },
    },
  );
  let launchError;
  child.once('error', (error) => {
    launchError = error;
  });
  try {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      if (launchError || child.exitCode !== null)
        throw (
          launchError ??
          new Error(`${settings.label} stopped. See its worker.log.`)
        );
      try {
        const ready = await fetch(
          `http://127.0.0.1:${settings.workerPort}/api/session`,
          { signal: AbortSignal.timeout(1000) },
        );
        await ready.text();
        if (ready.status === 401) return { settings, child, log };
      } catch {}
      await wait(250);
    }
    throw new Error(
      `${settings.label} did not become ready. See its worker.log.`,
    );
  } catch (error) {
    kill(child);
    await log.close();
    throw error;
  }
}
export async function launchLocalEnvironment(environment, root, key) {
  const entry = await worker(environment, root);
  entry.proxy = accountProxy(environment, entry.settings, key);
  try {
    await listen(entry.proxy, entry.settings.port);
  } catch (error) {
    kill(entry.child);
    await entry.log.close();
    throw error;
  }
  entry.stop = async () => {
    entry.proxy.closeAllConnections();
    await new Promise((resolve) => entry.proxy.close(resolve));
    kill(entry.child);
    await entry.log.close();
  };
  return entry;
}
export function liveLocalSettings(running) {
  return [...running.values()]
    .filter((entry) => entry.child.exitCode === null && entry.proxy.listening)
    .map((entry) => entry.settings);
}
export function assertPromotionReady(source, runtime) {
  if (!runtime)
    throw new Error(
      'Start the local sites and review Non-Prod before promoting.',
    );
  const candidate = runtime.environments.find(
    (entry) => entry.environment === 'nonprod',
  );
  if (!candidate || candidate.releaseId !== source.releaseId)
    throw new Error(
      'Non-Prod is unavailable or its new build is not running yet. Finish its update and review it before promoting.',
    );
}
async function serve() {
  const key = await secret(localRoot),
    running = new Map();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    for (const entry of running.values()) {
      entry.proxy.closeAllConnections();
      entry.proxy.close();
      kill(entry.child);
      await entry.log.close();
    }
    hub.closeAllConnections();
    hub.close();
    process.exit(0);
  };
  async function boot(environment) {
    const entry = await launchLocalEnvironment(environment, localRoot, key);
    running.set(environment, entry);
  }
  const hub = http.createServer(async (request, response) => {
    if (!hostAllowed(request, 3100)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://127.0.0.1:3100');
    if (url.pathname === '/__local/status') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(
        JSON.stringify({
          product: 'ChalkTalk Local',
          pid: process.pid,
          environments: liveLocalSettings(running),
        }),
      );
      return;
    }
    if (
      request.method === 'POST' &&
      request.headers['x-chalktalk-local-control'] === key
    ) {
      if (url.pathname === '/__local/stop') {
        response.end('Stopping local ChalkTalk.');
        setTimeout(shutdown, 100);
        return;
      }
      if (
        url.pathname === '/__local/reload' &&
        Object.hasOwn(environments, url.searchParams.get('environment'))
      ) {
        const environment = url.searchParams.get('environment'),
          old = running.get(environment);
        try {
          if (old) {
            old.proxy.closeAllConnections();
            await new Promise((resolve) => old.proxy.close(resolve));
            kill(old.child);
            await old.log.close();
            running.delete(environment);
          }
          await boot(environment);
          response.end('Local build restarted.');
        } catch (error) {
          let recovery = '';
          if (old)
            try {
              await prepareEnvironment(environment, old.settings.releaseId);
              await boot(environment);
              recovery = ' Previous local build restored.';
            } catch (failure) {
              recovery = ` Restore failed: ${failure.message}`;
            }
          response.writeHead(500);
          response.end(error.message + recovery);
        }
        return;
      }
    }
    if (request.method !== 'GET') {
      response.writeHead(403);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(
      page(
        'ChalkTalk local instances',
        `<span class="tag">ChalkTalk · local on this machine</span><h1>Your two local sites</h1><p>Separate databases, separate uploaded files, and fixed build snapshots. Nothing here writes to the old hosted pilot or prototype.</p>${Object.entries(
          environments,
        )
          .map(
            ([id, env]) =>
              `<article><h2>${env.label}</h2><p>${id === 'prod' ? 'Your stable place to test the product. Changes are promoted here deliberately.' : 'Try changes here before promoting a build to Local Prod.'}</p><a href="http://127.0.0.1:${env.port}/">Open ${env.label}</a> <a href="http://127.0.0.1:${env.port}/__local">Switch test account</a><small>${liveLocalSettings(running).some((entry) => entry.environment === id) ? `Running build ${running.get(id).settings.releaseId.slice(0, 12)}` : 'Starting or unavailable; check the local logs.'}</small></article>`,
          )
          .join(
            '',
          )}<p>These are local test instances, not internet production. Other devices cannot connect to these loopback addresses. Local sign-in is a testing aid; Cloudflare and managed email sign-in can be connected later.</p>`,
      ),
    );
  });
  try {
    await listen(hub, 3100);
    for (const environment of Object.keys(environments))
      await boot(environment);
    await save(path.join(localRoot, 'runtime.json'), {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    console.log('Local ChalkTalk ready at http://127.0.0.1:3100');
  } catch (error) {
    console.error(error);
    await shutdown();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
async function status() {
  try {
    const response = await fetch('http://127.0.0.1:3100/__local/status', {
      signal: AbortSignal.timeout(1000),
    });
    const value = await response.json();
    if (value.product !== 'ChalkTalk Local') return null;
    const alive = await Promise.all(
      value.environments.map(async (entry) => {
        try {
          const response = await fetch(
            `http://127.0.0.1:${entry.workerPort}/api/session`,
            { signal: AbortSignal.timeout(1500) },
          );
          await response.text();
          return response.status === 401;
        } catch {
          return false;
        }
      }),
    );
    return {
      ...value,
      environments: value.environments.filter((_, index) => alive[index]),
    };
  } catch {
    return null;
  }
}
async function control(action, environment) {
  const key = await readFile(path.join(localRoot, 'local-control.key'), 'utf8');
  const response = await fetch(
    `http://127.0.0.1:3100/__local/${action}${environment ? '?environment=' + environment : ''}`,
    {
      method: 'POST',
      headers: { 'x-chalktalk-local-control': key },
      signal: AbortSignal.timeout(120000),
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(body);
  console.log(body);
}
async function main() {
  const [action = 'status', environment] = process.argv.slice(2);
  await mkdir(localRoot, { recursive: true });
  if (action === 'serve') return serve();
  if (action === 'setup') {
    const release = await captureRelease();
    for (const name of Object.keys(environments)) {
      try {
        await readFile(path.join(localRoot, name, 'environment.json'));
      } catch {
        await prepareEnvironment(name, release);
        await migrate(name);
      }
    }
    await secret(localRoot);
    console.log(
      'Local Prod and Non-Prod prepared. Existing local data was preserved.',
    );
    return;
  }
  if (action === 'start') {
    const existing = await status();
    if (existing?.environments?.length === 2) {
      console.log('Already running: http://127.0.0.1:3100');
      return;
    }
    if (existing)
      throw new Error(
        'Local service is starting or incomplete. Check status/logs before restarting it.',
      );
    const probe = http.createServer();
    await listen(probe, 3100);
    await new Promise((resolve) => probe.close(resolve));
    for (const name of Object.keys(environments))
      await readFile(path.join(localRoot, name, 'environment.json'));
    const log = await open(path.join(localRoot, 'launcher.log'), 'a');
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), 'serve'],
      {
        cwd: workspace,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log.fd, log.fd],
      },
    );
    child.unref();
    let launchError;
    child.once('error', (error) => {
      launchError = error;
    });
    await log.close();
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (launchError || child.exitCode !== null)
        throw (
          launchError ??
          new Error(
            'Local services stopped during startup. Check .local-pilot/launcher.log.',
          )
        );
      const ready = await status();
      if (ready?.environments?.length === 2) {
        console.log('Ready: http://127.0.0.1:3100');
        return;
      }
      await wait(500);
    }
    throw new Error(
      'Local services did not become ready. Check .local-pilot/launcher.log; do not start duplicates.',
    );
  }
  if (action === 'stop') {
    if (await status()) {
      await control('stop');
      const deadline = Date.now() + 15000;
      while (await status()) {
        if (Date.now() > deadline)
          throw new Error(
            'Local shutdown is still running. Check status before starting again.',
          );
        await wait(100);
      }
      console.log('Local ChalkTalk stopped.');
    } else console.log('Local ChalkTalk is not running.');
    return;
  }
  if (action === 'status') {
    console.log(
      JSON.stringify((await status()) ?? { running: false }, null, 2),
    );
    return;
  }
  if (action === 'restart') {
    if (!Object.hasOwn(environments, environment))
      throw new Error('Choose restart prod or restart nonprod.');
    if (!(await status())) throw new Error('Start the local dashboard first.');
    await control('reload', environment);
    return;
  }
  if (action === 'update') {
    if (environment !== 'nonprod')
      throw new Error(
        'Use update nonprod. Stable Prod changes only through promote.',
      );
    await command(
      [path.join(workspace, 'node_modules/typescript/bin/tsc'), '--noEmit'],
      path.join(localRoot, 'build.log'),
    );
    await command(
      [path.join(workspace, 'node_modules/vinext/dist/cli.js'), 'build'],
      path.join(localRoot, 'build.log'),
    );
    await prepareEnvironment('nonprod', await captureRelease());
    if (await status()) await control('reload', 'nonprod');
    console.log('Non-Prod updated; Prod data and build were not changed.');
    return;
  }
  if (action === 'promote') {
    const source = await json(path.join(localRoot, 'nonprod/environment.json'));
    assertPromotionReady(source, await status());
    await prepareEnvironment('prod', source.releaseId);
    if (await status()) await control('reload', 'prod');
    console.log(
      'Non-Prod build promoted. Prod still uses its own data and files.',
    );
    return;
  }
  throw new Error(
    'Use setup, start, stop, status, update nonprod, or promote.',
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
