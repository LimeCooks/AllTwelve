import type { RecoverySnapshot } from '@/lib/recovery-plan';
type File = RecoverySnapshot['media'][number];
export const RECOVERY_CHUNK_BYTES = 8 * 1024 * 1024;
export class RecoveryChunkError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const hex = (buffer?: ArrayBuffer) =>
  buffer
    ? Array.from(new Uint8Array(buffer), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
    : '';
const count = (file: File) => Math.ceil(file.size / RECOVERY_CHUNK_BYTES);
const size = (file: File, index: number) =>
  Math.min(RECOVERY_CHUNK_BYTES, file.size - index * RECOVERY_CHUNK_BYTES);
const key = (prefix: string, index: number) =>
  prefix + String(index).padStart(6, '0');
function validIndex(file: File, index: number) {
  return Number.isInteger(index) && index >= 0 && index < count(file);
}
export function recoveryHttpMetadata(file: File) {
  const metadata = { ...file.httpMetadata } as R2HTTPMetadata;
  if (metadata.cacheExpiry)
    metadata.cacheExpiry = new Date(metadata.cacheExpiry);
  return metadata;
}
export async function recoveryChunksStatus(
  bucket: R2Bucket,
  prefix: string,
  file: File,
) {
  const page = await bucket.list({ prefix, limit: 1000 });
  if (page.truncated)
    throw new RecoveryChunkError(
      'Recovery chunks exceeded their supported count.',
      409,
    );
  const chunks = page.objects.map((object) => {
    const suffix = object.key.slice(prefix.length),
      index = Number(suffix);
    if (
      !/^\d{6}$/.test(suffix) ||
      !validIndex(file, index) ||
      object.size !== size(file, index) ||
      !object.checksums?.sha256
    )
      throw new RecoveryChunkError(
        'A recovery chunk is inconsistent. Use a new empty recovery destination.',
        409,
      );
    return {
      index,
      size: object.size,
      sha256: hex(object.checksums.sha256),
      etag: object.etag,
    };
  });
  return {
    chunkBytes: RECOVERY_CHUNK_BYTES,
    total: count(file),
    chunks: chunks.sort((a, b) => a.index - b.index),
  };
}
export async function uploadRecoveryChunk(
  bucket: R2Bucket,
  prefix: string,
  file: File,
  index: number,
  sha256: string,
  body: ReadableStream | null,
  claimedSize: string | null,
) {
  if (
    !validIndex(file, index) ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    claimedSize !== String(size(file, index)) ||
    !body
  )
    throw new RecoveryChunkError(
      'Choose a valid chunk of the original recovered file.',
    );
  const target = key(prefix, index),
    existing = await bucket.head(target);
  if (
    existing?.size === size(file, index) &&
    hex(existing.checksums?.sha256) === sha256
  )
    return { index, verified: true };
  try {
    const result = await bucket.put(
      target,
      body.pipeThrough(new FixedLengthStream(size(file, index))),
      {
        sha256,
        onlyIf: existing
          ? { etagMatches: existing.etag }
          : { etagDoesNotMatch: '*' },
      },
    );
    if (!result)
      throw new RecoveryChunkError(
        'This chunk changed during upload. Refresh its progress and retry.',
        409,
      );
  } catch (error) {
    if (error instanceof RecoveryChunkError) throw error;
    throw new RecoveryChunkError(
      'The chunk failed its size/checksum check or storage was interrupted. Retry this chunk.',
    );
  }
  return { index, verified: true };
}
export async function assembleRecoveryFile(
  bucket: R2Bucket,
  prefix: string,
  target: string,
  file: File,
) {
  const progress = await recoveryChunksStatus(bucket, prefix, file);
  if (
    progress.chunks.length !== progress.total ||
    progress.chunks.some((chunk, index) => chunk.index !== index)
  )
    throw new RecoveryChunkError(
      'Some chunks are missing. Choose the same original file to resume.',
      409,
    );
  let index = 0,
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          if (!reader) {
            if (index >= progress.total) {
              controller.close();
              return;
            }
            const object = await bucket.get(key(prefix, index), {
              onlyIf: { etagMatches: progress.chunks[index].etag },
            });
            if (!object || !('body' in object) || !object.body)
              throw new Error('A chunk changed during assembly');
            reader = object.body.getReader();
          }
          const part = await reader.read();
          if (part.done) {
            reader.releaseLock();
            reader = undefined;
            index++;
            continue;
          }
          controller.enqueue(part.value);
          return;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason);
    },
  });
  try {
    const result = await bucket.put(
      target,
      stream.pipeThrough(new FixedLengthStream(file.size)),
      {
        onlyIf: { etagDoesNotMatch: '*' },
        sha256: file.sha256,
        httpMetadata: recoveryHttpMetadata(file),
        customMetadata: file.customMetadata,
      },
    );
    if (!result)
      throw new RecoveryChunkError(
        'The destination file already exists. Refresh recovery status before continuing.',
        409,
      );
  } catch (error) {
    await reader?.cancel().catch(() => {});
    if (error instanceof RecoveryChunkError) throw error;
    throw new RecoveryChunkError(
      'The complete file did not match its prepared checksum or storage was interrupted. Choose the original recovered file again to resume.',
    );
  }
  // Only this owner's known temporary parts are removed after the immutable,
  // complete file has been verified by R2. A cleanup failure is retryable.
  try {
    await bucket.delete(
      progress.chunks.map((chunk) => key(prefix, chunk.index)),
    );
  } catch {
    /* Completed bytes remain valid; retained chunks can be cleaned separately. */
  }
  return { key: file.key, verified: true };
}
