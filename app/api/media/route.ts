import { env } from 'cloudflare:workers';
import { getDatabase } from '@/db/client';
import { isPrototype } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';

async function storageKey(key: string) {
  const database = await getDatabase();
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
  const object = await mediaBucket().get(await storageKey(key));
  if (!object)
    return Response.json({ error: 'Media not found.' }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, max-age=60');
  return new Response(object.body, { headers });
}

async function uploadMedia(request: Request) {
  const key = safeKey(request);
  if (!key)
    return Response.json(
      { error: 'A valid media key is required.' },
      { status: 400 },
    );
  const storedKey = await storageKey(key);
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
  // Raw file requests avoid the framework's 1 MB progressive form-action
  // parser. FixedLengthStream validates size while keeping the body streamed.
  const fixed = new FixedLengthStream(size);
  const piping = stream.pipeTo(fixed.writable);
  try {
    await Promise.all([
      piping,
      mediaBucket().put(storedKey, fixed.readable, {
        httpMetadata: {
          contentType,
          contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
        customMetadata: {
          originalName: name,
          uploadedAt: new Date().toISOString(),
        },
      }),
    ]);
  } catch {
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
  await mediaBucket().delete(await storageKey(key));
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
export async function POST(request: Request) {
  return handle(request, uploadMedia);
}
export async function DELETE(request: Request) {
  return handle(request, deleteMedia);
}
