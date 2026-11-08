import { backupTables } from '@/lib/team-backup';
import {
  planRecovery,
  RecoveryError,
  type RecoverySnapshot,
} from '@/lib/recovery-plan';
import { identityFromHeaders } from '@/lib/workspace-identity';
import {
  RECOVERY_CHUNK_BYTES,
  RecoveryChunkError,
  recoveryChunksStatus,
  uploadRecoveryChunk,
  assembleRecoveryFile,
  recoveryHttpMetadata,
} from '@/lib/recovery-chunks';

type Bindings = { DB: D1Database; MEDIA: R2Bucket };
type Job = { owner: string; digest: string; snapshot: RecoverySnapshot };
class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
const digest = async (text: string) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const names = [...backupTables.map(([name]) => name), 'workspace_owners'];
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  );
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
async function occupied(database: D1Database) {
  const result = await database
    .prepare(
      `SELECT ${names.map((name) => `EXISTS(SELECT 1 FROM ${name})`).join(' OR ')} AS occupied`,
    )
    .first<{ occupied: number }>();
  if (!result || ![0, 1].includes(result.occupied))
    throw new Error('Destination check failed');
  return result.occupied === 1;
}
async function requireEmpty(database: D1Database) {
  if (await occupied(database))
    throw new RequestError(
      'This destination already contains team data. Recovery cannot overwrite or merge it.',
      409,
    );
}
async function boundedJson(request: Request) {
  if (!request.body)
    throw new RequestError('Choose a prepared recovery manifest.');
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > 18 * 1024 * 1024) {
        await reader.cancel();
        throw new RequestError('The recovery manifest is too large.', 413);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
async function jobFor(bucket: R2Bucket, key: string, owner: string) {
  const object = await bucket.get(key);
  if (!object) return null;
  const job = await object.json<Job>();
  if (
    job.owner !== owner ||
    job.digest !== (await digest(canonical(job.snapshot)))
  )
    throw new Error('Recovery preparation could not be verified');
  return job;
}
function objectMatches(
  object: R2Object,
  file: RecoverySnapshot['media'][number],
) {
  return (
    object.size === file.size &&
    object.checksums.sha256 &&
    hex(object.checksums.sha256) === file.sha256 &&
    canonical(object.httpMetadata ?? {}) === canonical(file.httpMetadata) &&
    canonical(object.customMetadata ?? {}) === canonical(file.customMetadata)
  );
}
async function mediaStatus(bucket: R2Bucket, snapshot: RecoverySnapshot) {
  const prefix = `teams/${snapshot.teamId}/`,
    stored = new Map<string, R2Object>();
  let cursor: string | undefined;
  for (let pages = 0; ; pages++) {
    if (pages > 20) throw new Error('Recovery file listing did not finish');
    const page = await bucket.list({
      prefix,
      limit: 1000,
      cursor,
      include: ['httpMetadata', 'customMetadata'],
    } as R2ListOptions & { include: string[] });
    for (const object of page.objects) {
      const key = object.key.slice(prefix.length);
      if (stored.has(key)) throw new Error('Duplicate recovery file');
      stored.set(key, object);
    }
    if (!page.truncated) break;
    if (!page.cursor || page.cursor === cursor)
      throw new Error('Recovery file listing did not advance');
    cursor = page.cursor;
  }
  const expected = new Set(snapshot.media.map((file) => file.key));
  if ([...stored.keys()].some((key) => !expected.has(key)))
    throw new RequestError(
      'This destination contains files outside the prepared backup. Use a separate empty destination.',
      409,
    );
  return snapshot.media.map((file) => ({
    key: file.key,
    size: file.size,
    originalName: file.originalName,
    verified: Boolean(
      stored.get(file.key) && objectMatches(stored.get(file.key)!, file),
    ),
  }));
}
async function completed(database: D1Database, job: Job) {
  const results = await database.batch(
    names.map((name) =>
      database.prepare(
        `SELECT * FROM ${name} ORDER BY ${name === 'workspace_owners' ? 'user_id' : 'id'}`,
      ),
    ),
  );
  const owners = results.at(-1)!.results as {
    user_id: string;
    team_id: string;
  }[];
  if (
    owners.length !== 1 ||
    owners[0].user_id !== job.owner ||
    owners[0].team_id !== job.snapshot.teamId
  )
    return false;
  const rows = (values: unknown[]) =>
    JSON.stringify(values.map((value) => canonical(value)).sort());
  return backupTables.every(
    ([name], index) =>
      rows(results[index].results) === rows(job.snapshot.tables[name]),
  );
}
async function summary(bindings: Bindings, job: Job) {
  const files = await mediaStatus(bindings.MEDIA, job.snapshot),
    hasData = await occupied(bindings.DB);
  const complete =
    hasData &&
    files.every((file) => file.verified) &&
    (await completed(bindings.DB, job));
  if (hasData && !complete)
    throw new RequestError(
      'This destination contains data that does not exactly match this recovery. Nothing was overwritten.',
      409,
    );
  return {
    state: complete ? 'complete' : 'preparing',
    id: job.snapshot.id,
    digest: job.digest,
    teamName: job.snapshot.tables.teams[0].name,
    records: Object.values(job.snapshot.tables).reduce(
      (total, rows) => total + rows.length,
      0,
    ),
    files,
    mediaBytes: job.snapshot.mediaBytes,
  };
}

// Only the separately built recovery site routes requests here. The pilot has
// no import route or flag enabling this service.
export async function handleRecovery(request: Request, bindings: Bindings) {
  try {
    const user = identityFromHeaders(request.headers);
    if (!user)
      throw new RequestError('Sign in to recover your private workspace.', 401);
    const url = new URL(request.url);
    if (!['GET', 'POST', 'PUT'].includes(request.method))
      throw new RequestError('Method not allowed.', 405);
    if (
      request.method !== 'GET' &&
      (request.headers.get('origin') !== url.origin ||
        request.headers.get('sec-fetch-site') === 'cross-site')
    )
      throw new RequestError(
        'Recovery writes must come from this workspace.',
        403,
      );
    const key = `_recovery/${await digest(user.id)}/current.json`;
    if (url.pathname === '/recovery/status' && request.method === 'GET') {
      const job = await jobFor(bindings.MEDIA, key, user.id);
      if (job) return json(await summary(bindings, job));
      await requireEmpty(bindings.DB);
      return json({ state: 'empty' });
    }
    if (url.pathname === '/recovery/prepare' && request.method === 'POST') {
      await requireEmpty(bindings.DB);
      const value = await boundedJson(request),
        plan = await planRecovery(bindings.DB, value, user.id);
      const job: Job = {
        owner: user.id,
        digest: await digest(canonical(plan.snapshot)),
        snapshot: plan.snapshot,
      };
      const existing = await jobFor(bindings.MEDIA, key, user.id);
      if (existing && existing.digest !== job.digest)
        throw new RequestError(
          'A different backup is already prepared here. Use a new empty recovery destination.',
          409,
        );
      if (!existing) {
        const stored = await bindings.MEDIA.put(key, JSON.stringify(job), {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'application/json' },
        });
        if (!stored) {
          const winner = await jobFor(bindings.MEDIA, key, user.id);
          if (winner?.digest !== job.digest)
            throw new RequestError(
              'Another backup preparation won. Refresh recovery status.',
              409,
            );
        }
      }
      return json(await summary(bindings, job));
    }
    const job = await jobFor(bindings.MEDIA, key, user.id);
    if (!job)
      throw new RequestError(
        'Prepare the verified recovery manifest first.',
        404,
      );
    if (request.headers.get('x-recovery-digest') !== job.digest)
      throw new RequestError(
        'Recovery preparation changed. Refresh before continuing.',
        409,
      );
    if (
      url.pathname === '/recovery/chunks' ||
      url.pathname === '/recovery/chunk' ||
      (url.pathname === '/recovery/file' && request.method === 'POST')
    ) {
      await requireEmpty(bindings.DB);
      const file = job.snapshot.media.find(
        (file) => file.key === url.searchParams.get('key'),
      );
      if (!file)
        throw new RequestError('Choose a file from the prepared recovery.');
      const prefix = `_recovery/${await digest(user.id)}/chunks/${job.snapshot.id}/${file.key}/`;
      if (url.pathname === '/recovery/chunks' && request.method === 'GET')
        return json(await recoveryChunksStatus(bindings.MEDIA, prefix, file));
      if (url.pathname === '/recovery/chunk' && request.method === 'PUT') {
        const rawIndex = url.searchParams.get('index');
        if (rawIndex === null || !/^\d+$/.test(rawIndex))
          throw new RequestError('Choose a valid recovery chunk.');
        return json(
          await uploadRecoveryChunk(
            bindings.MEDIA,
            prefix,
            file,
            Number(rawIndex),
            request.headers.get('x-recovery-sha256') ?? '',
            request.body,
            request.headers.get('x-recovery-size'),
          ),
        );
      }
      if (url.pathname === '/recovery/file' && request.method === 'POST') {
        const existing = await bindings.MEDIA.head(
          `teams/${job.snapshot.teamId}/${file.key}`,
        );
        if (existing) {
          if (!objectMatches(existing, file))
            throw new RequestError(
              'An existing destination file does not match. It was not replaced.',
              409,
            );
          return json({ key: file.key, verified: true });
        }
        return json(
          await assembleRecoveryFile(
            bindings.MEDIA,
            prefix,
            `teams/${job.snapshot.teamId}/${file.key}`,
            file,
          ),
        );
      }
      throw new RequestError('Recovery chunk action not found.', 404);
    }
    if (url.pathname === '/recovery/file' && request.method === 'PUT') {
      await requireEmpty(bindings.DB);
      const file = job.snapshot.media.find(
        (file) => file.key === url.searchParams.get('key'),
      );
      if (
        !file ||
        request.headers.get('x-recovery-size') !== String(file.size) ||
        (!request.body && file.size !== 0)
      )
        throw new RequestError(
          'Choose the matching file and byte size from the prepared recovery.',
        );
      if (file.size > RECOVERY_CHUNK_BYTES)
        throw new RequestError('Use resumable chunks for this recovery file.');
      const target = `teams/${job.snapshot.teamId}/${file.key}`,
        existing = await bindings.MEDIA.head(target);
      if (existing) {
        if (!objectMatches(existing, file))
          throw new RequestError(
            'An existing destination file does not match. It was not replaced.',
            409,
          );
        return json({ key: file.key, verified: true });
      }
      const httpMetadata = recoveryHttpMetadata(file);
      const body = request.body
        ? request.body.pipeThrough(new FixedLengthStream(file.size))
        : null;
      try {
        const stored = await bindings.MEDIA.put(target, body, {
          onlyIf: { etagDoesNotMatch: '*' },
          sha256: file.sha256,
          httpMetadata,
          customMetadata: file.customMetadata,
        });
        if (!stored) {
          const winner = await bindings.MEDIA.head(target);
          if (!winner || !objectMatches(winner, file))
            throw new RequestError(
              'The destination file changed. It was not replaced.',
              409,
            );
        }
      } catch (error) {
        if (error instanceof RequestError) throw error;
        throw new RequestError(
          'The file upload failed its length/checksum check or storage was interrupted. Retry the same file.',
        );
      }
      return json({ key: file.key, verified: true });
    }
    if (url.pathname === '/recovery/commit' && request.method === 'POST') {
      const status = await summary(bindings, job);
      if (status.state === 'complete') return json(status);
      if (status.files.some((file) => !file.verified))
        throw new RequestError(
          'Upload and verify every backup file before restoring records.',
          409,
        );
      const plan = await planRecovery(bindings.DB, job.snapshot, user.id);
      try {
        await bindings.DB.batch(plan.statements);
      } catch {
        throw new RequestError(
          'Recovery did not confirm an empty destination and complete relationships. Refresh status before retrying; no partial database import is allowed.',
          409,
        );
      }
      return json(await summary(bindings, job));
    }
    throw new RequestError('Recovery action not found.', 404);
  } catch (error) {
    return json(
      {
        error:
          error instanceof RequestError ||
          error instanceof RecoveryError ||
          error instanceof RecoveryChunkError
            ? error.message
            : error instanceof SyntaxError
              ? 'The recovery manifest is not valid JSON.'
              : 'Recovery could not be verified. Refresh status before continuing.',
      },
      error instanceof RequestError || error instanceof RecoveryChunkError
        ? error.status
        : error instanceof RecoveryError || error instanceof SyntaxError
          ? 400
          : 500,
    );
  }
}
