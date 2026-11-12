import { Zip, ZipPassThrough } from 'fflate';
import type { TeamBackup } from '@/lib/team-backup';

export function backupZip(
  snapshot: TeamBackup,
  part: number,
  bucket: R2Bucket,
  prefix: string,
  preserved = false,
) {
  async function* chunks(): AsyncGenerator<Uint8Array> {
    const queue: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      queue.push(chunk);
    });
    const manifest = new ZipPassThrough('alltwelve-backup.json');
    zip.add(manifest);
    manifest.push(
      new TextEncoder().encode(
        JSON.stringify({ ...snapshot, archivePart: part }),
      ),
      true,
    );
    while (queue.length) yield queue.shift()!;
    for (const file of snapshot.media.filter((m) => m.part === part)) {
      const object = await bucket.get(
        `${prefix}${file.key}`,
        preserved ? undefined : { onlyIf: { etagMatches: file.etag } },
      );
      if (
        !object ||
        !('body' in object) ||
        (preserved &&
          (object.size !== file.size ||
            object.customMetadata?.backupSourceEtag !== file.etag))
      )
        throw new Error(
          'A file changed or was removed while downloading. Create a new backup and retry.',
        );
      const entry = new ZipPassThrough(`media/${file.key}`);
      zip.add(entry);
      while (queue.length) yield queue.shift()!;
      const reader = object.body.getReader();
      let bytes = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          entry.push(next.value);
          while (queue.length) yield queue.shift()!;
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      if (bytes !== file.size)
        throw new Error(
          'The file length changed. Create a new backup and retry.',
        );
      entry.push(new Uint8Array(), true);
      while (queue.length) yield queue.shift()!;
    }
    zip.end();
    while (queue.length) yield queue.shift()!;
  }
  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
        await iterator.return(undefined);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
