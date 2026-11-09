import { env } from 'cloudflare:workers';
import { getWorkspaceAccess } from '@/db/client';
import { isPrototype } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import { isImageSlot } from '@/lib/media-keys';

async function assertUnregistered(key: string, request: Request) {
  const hint =
    new URL(request.url).searchParams.get('workspace')?.trim() || undefined;
  const { database } = await getWorkspaceAccess('coaching.write', hint);
  const film = await database
    .prepare(
      'SELECT id FROM film_assets WHERE team_id=? AND storage_key=? LIMIT 1',
    )
    .bind(database.teamId, key)
    .first();
  if (film)
    throw new WorkspaceAccessError(
      'This file belongs to saved film. Use Film Room to manage or delete it.',
      409,
    );
}

async function storageKey(key: string, request: Request) {
  const hint =
    new URL(request.url).searchParams.get('workspace')?.trim() || undefined;
  const { database, grant, identity } = await getWorkspaceAccess(
    'coaching.read',
    hint,
  );
  if (
    grant.role !== 'owner' &&
    (['coach-profile', 'player-profile'].includes(key) ||
      (key.startsWith('member-') && key !== `member-${identity.id}-photo`))
  )
    throw new WorkspaceAccessError(
      'This account image is private to its owner.',
      403,
    );
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    grant.role !== 'owner' &&
    (['team-logo', 'opponent-logo', 'coach-profile', 'player-profile'].includes(
      key,
    ) ||
      key.startsWith('member-'))
  )
    throw new WorkspaceAccessError(
      'Only the team owner can change these account or team images.',
      403,
    );
  return isPrototype() ? key : `teams/${database.teamId}/${key}`;
}

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

function mediaBucket() {
  return (env as unknown as { MEDIA: R2Bucket }).MEDIA;
}

function safeKey(request: Request) {
  const key = new URL(request.url).searchParams.get('key')?.trim() ?? '';
  return /^[a-z0-9][a-z0-9._/-]{0,159}$/i.test(key) && !key.includes('..')
    ? key
    : null;
}

async function readMedia(request: Request) {
  const key = safeKey(request);
  if (!key)
    return Response.json(
      { error: 'A valid media key is required.' },
      { status: 400 },
    );
  const storedKey = await storageKey(key, request);
  const metadata = await mediaBucket().head(storedKey);
  if (!metadata)
    return Response.json({ error: 'Media not found.' }, { status: 404 });
  const headers = new Headers();
  metadata.writeHttpMetadata(headers);
  headers.set('etag', metadata.httpEtag);
  headers.set('cache-control', 'private, no-store');
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(metadata.size));
  if (request.method === 'HEAD') return new Response(null, { headers });
  let range: { offset: number; length: number } | undefined;
  const requested = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  // Multipart/unknown range units are ignored. Media players request a single
  // byte range. A stale If-Range validator receives the complete current file.
  const match =
    (!ifRange || ifRange === metadata.httpEtag) &&
    requested?.match(/^bytes=(\d*)-(\d*)$/);
  if (match) {
    const first = match[1] ? Number(match[1]) : null;
    const last = match[2] ? Number(match[2]) : null;
    const start =
      first ?? (last === null ? -1 : Math.max(0, metadata.size - last));
    const end =
      first === null
        ? metadata.size - 1
        : last === null
          ? metadata.size - 1
          : Math.min(last, metadata.size - 1);
    if (
      metadata.size === 0 ||
      (first === null && (last === null || last === 0)) ||
      (first !== null && !Number.isSafeInteger(first)) ||
      (last !== null && !Number.isSafeInteger(last)) ||
      start < 0 ||
      start >= metadata.size ||
      end < start
    ) {
      headers.set('content-range', `bytes */${metadata.size}`);
      headers.set('content-length', '0');
      return new Response(null, { status: 416, headers });
    }
    range = { offset: start, length: end - start + 1 };
    headers.set('content-range', `bytes ${start}-${end}/${metadata.size}`);
    headers.set('content-length', String(range.length));
  }
  const object = await mediaBucket().get(storedKey, {
    onlyIf: { etagMatches: metadata.etag },
    ...(range ? { range } : {}),
  });
  if (!object)
    return Response.json({ error: 'Media not found.' }, { status: 404 });
  if (!('body' in object))
    return Response.json(
      { error: 'This file changed while loading. Please retry.' },
      { status: 409 },
    );
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

async function uploadMedia(request: Request) {
  const key = safeKey(request);
  if (!key)
    return Response.json(
      { error: 'A valid media key is required.' },
      { status: 400 },
    );
  const storedKey = await storageKey(key, request);
  let name: string,
    contentType: string,
    size: number,
    stream: ReadableStream<Uint8Array>;
  if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    const file = (await request.formData()).get('file');
    if (!(file instanceof File))
      return Response.json(
        { error: 'Choose a file to upload.' },
        { status: 400 },
      );
    name = file.name;
    contentType = file.type;
    size = file.size;
    stream = file.stream();
  } else {
    if (!request.body)
      return Response.json(
        { error: 'Choose a file to upload.' },
        { status: 400 },
      );
    try {
      name = decodeURIComponent(
        request.headers.get('x-chalktalk-filename') ?? 'upload',
      );
    } catch {
      return Response.json(
        { error: 'The filename is invalid.' },
        { status: 400 },
      );
    }
    contentType = (request.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim();
    size = Number(
      request.headers.get('x-chalktalk-upload-size') ??
        request.headers.get('content-length'),
    );
    stream = request.body;
  }
  if (!allowedImageTypes.has(contentType) && !contentType.startsWith('video/'))
    return Response.json(
      { error: 'Only image and video files are supported.' },
      { status: 415 },
    );
  if (!Number.isSafeInteger(size) || size <= 0)
    return Response.json(
      { error: 'A non-empty file and its upload size are required.' },
      { status: 400 },
    );
  if (size > MAX_UPLOAD_BYTES)
    return Response.json(
      { error: 'Files must be smaller than 250 MB.' },
      { status: 413 },
    );
  const replaceable = isImageSlot(key);
  if (replaceable && !allowedImageTypes.has(contentType))
    throw new WorkspaceAccessError(
      'Choose an image for this profile or team image slot.',
      415,
    );
  await assertUnregistered(key, request);
  if (!replaceable && (await mediaBucket().head(storedKey)))
    throw new WorkspaceAccessError(
      'An uploaded file already uses this key. Upload the new film as a separate file.',
      409,
    );
  // Raw file requests avoid the framework's 1 MB progressive form-action
  // parser. FixedLengthStream validates size while keeping the body streamed.
  const fixed = new FixedLengthStream(size);
  const piping = stream.pipeTo(fixed.writable);
  // Observe streaming errors immediately, including a failed conditional put.
  void piping.catch(() => {});
  try {
    const stored = await mediaBucket().put(storedKey, fixed.readable, {
      ...(!replaceable ? { onlyIf: { etagDoesNotMatch: '*' } } : {}),
      httpMetadata: {
        contentType,
        contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
      customMetadata: {
        originalName: name,
        uploadedAt: new Date().toISOString(),
      },
    });
    if (!stored) {
      // A conditional failure need not consume the upload. Cancellation of a
      // FixedLengthStream can wait for the sender; never hold the 409 response
      // open while that upstream cancellation settles.
      void fixed.readable.cancel().catch(() => {});
      throw new WorkspaceAccessError(
        'This file was uploaded on another request. Upload new film as a separate file.',
        409,
      );
    }
    await piping;
  } catch (error) {
    void fixed.readable.cancel().catch(() => {});
    if (error instanceof WorkspaceAccessError) throw error;
    throw new WorkspaceAccessError(
      'The upload did not finish. Please retry.',
      400,
    );
  }
  return Response.json({
    key,
    contentType,
    size,
    uploadedAt: new Date().toISOString(),
  });
}

async function deleteMedia(request: Request) {
  const key = safeKey(request);
  if (!key)
    return Response.json(
      { error: 'A valid media key is required.' },
      { status: 400 },
    );
  const storedKey = await storageKey(key, request);
  await assertUnregistered(key, request);
  if (!isImageSlot(key))
    throw new WorkspaceAccessError(
      'Delete uploaded video through Film Room so its clips and reviews stay consistent.',
      409,
    );
  await mediaBucket().delete(storedKey);
  return Response.json({ deleted: true });
}

async function handle(
  request: Request,
  action: (request: Request) => Promise<Response>,
) {
  try {
    return await action(request);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WorkspaceAccessError
            ? error.message
            : 'Unable to access this media file.',
      },
      { status: error instanceof WorkspaceAccessError ? error.status : 500 },
    );
  }
}
export async function GET(request: Request) {
  return handle(request, readMedia);
}
export async function HEAD(request: Request) {
  return handle(request, readMedia);
}
export async function POST(request: Request) {
  return handle(request, uploadMedia);
}
export async function DELETE(request: Request) {
  return handle(request, deleteMedia);
}
