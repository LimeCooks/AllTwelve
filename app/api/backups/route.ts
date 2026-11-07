import { env } from 'cloudflare:workers';
import { getDatabase } from '@/db/client';
import { isPrototype } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import {
  backupJobKey,
  BackupError,
  createTeamBackup,
  type TeamBackup,
} from '@/lib/team-backup';
import { backupZip } from '@/lib/backup-zip';

const bucket = () => (env as unknown as { MEDIA: R2Bucket }).MEDIA;
const prefix = (teamId: string) => (isPrototype() ? '' : `teams/${teamId}/`);
const failure = (error: unknown) =>
  Response.json(
    {
      error:
        error instanceof WorkspaceAccessError || error instanceof BackupError
          ? error.message
          : 'Unable to prepare your backup.',
    },
    {
      status:
        error instanceof WorkspaceAccessError
          ? error.status
          : error instanceof BackupError
            ? 400
            : 500,
    },
  );

export async function POST() {
  try {
    const database = await getDatabase();
    const snapshot = await createTeamBackup(
      database,
      bucket(),
      prefix(database.teamId),
      isPrototype(),
    );
    await bucket().put(
      backupJobKey(database.teamId),
      JSON.stringify(snapshot),
      { httpMetadata: { contentType: 'application/json' } },
    );
    return Response.json(
      {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        parts: snapshot.parts,
        mediaBytes: snapshot.mediaBytes,
        mediaFiles: snapshot.media.length,
        records: Object.values(snapshot.tables).reduce(
          (n, rows) => n + rows.length,
          0,
        ),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  try {
    const database = await getDatabase(),
      params = new URL(request.url).searchParams;
    const object = await bucket().get(backupJobKey(database.teamId));
    if (!object)
      return Response.json(
        { error: 'Prepare a backup first.' },
        { status: 404 },
      );
    const snapshot = await object.json<TeamBackup>();
    if (
      snapshot.teamId !== database.teamId ||
      snapshot.id !== params.get('id') ||
      Date.now() - Date.parse(snapshot.createdAt) > 24 * 60 * 60 * 1000
    )
      return Response.json(
        {
          error: 'This backup has expired or was replaced. Prepare a new one.',
        },
        { status: 409 },
      );
    const part = Number(params.get('part'));
    if (!Number.isInteger(part) || part < 1 || part > snapshot.parts)
      return Response.json(
        { error: 'Choose a valid backup part.' },
        { status: 400 },
      );
    return new Response(
      backupZip(snapshot, part, bucket(), prefix(database.teamId)),
      {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="chalktalk-${snapshot.createdAt.slice(0, 10)}-part-${part}-of-${snapshot.parts}.zip"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
