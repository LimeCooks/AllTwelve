import { env } from 'cloudflare:workers';

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);

function mediaBucket() {
  return (env as unknown as { MEDIA: R2Bucket }).MEDIA;
}

function safeKey(request: Request) {
  const key = new URL(request.url).searchParams.get('key')?.trim() ?? '';
  return /^[a-z0-9][a-z0-9._/-]{0,159}$/i.test(key) && !key.includes('..') ? key : null;
}

export async function GET(request: Request) {
  const key = safeKey(request);
  if (!key) return Response.json({ error: 'A valid media key is required.' }, { status: 400 });
  const object = await mediaBucket().get(key);
  if (!object) return Response.json({ error: 'Media not found.' }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, max-age=60');
  return new Response(object.body, { headers });
}

export async function POST(request: Request) {
  const key = safeKey(request);
  if (!key) return Response.json({ error: 'A valid media key is required.' }, { status: 400 });
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'Choose a file to upload.' }, { status: 400 });
  const isImage = allowedImageTypes.has(file.type);
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) return Response.json({ error: 'Only image and video files are supported.' }, { status: 415 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: 'Files must be smaller than 250 MB.' }, { status: 413 });
  await mediaBucket().put(key, file.stream(), {
    httpMetadata: { contentType: file.type, contentDisposition: `inline; filename="${file.name.replaceAll('"', '')}"` },
    customMetadata: { originalName: file.name, uploadedAt: new Date().toISOString() },
  });
  return Response.json({ key, contentType: file.type, size: file.size, uploadedAt: new Date().toISOString() });
}

export async function DELETE(request: Request) {
  const key = safeKey(request);
  if (!key) return Response.json({ error: 'A valid media key is required.' }, { status: 400 });
  await mediaBucket().delete(key);
  return Response.json({ deleted: true });
}
