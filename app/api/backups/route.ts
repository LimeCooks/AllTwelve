import { env } from 'cloudflare:workers';
import { getDatabase } from '@/db/client';
import { isPrototype } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import {
  backupJobKey,
  backupArchiveKey,
  backupOverview as summary,
  listBackupHistory,
  backupCopyPrefix,
  advanceBackupCopy,
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
      headers: { 'cache-control': 'private, no-store' },
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
    snapshot.copiedFiles = 0;
    await bucket().put(
      backupJobKey(database.teamId),
      JSON.stringify(snapshot),
      { httpMetadata: { contentType: 'application/json' } },
    );
    const copied = await advanceBackupCopy(
      bucket(),
      database.teamId,
      prefix(database.teamId),
      snapshot.id,
    );
    return Response.json(summary(copied), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const database = await getDatabase(),
      body = (await request.json()) as { id?: unknown };
    if (typeof body?.id !== 'string')
      throw new BackupError('Choose a prepared backup to continue.');
    return Response.json(
      summary(
        await advanceBackupCopy(
          bucket(),
          database.teamId,
          prefix(database.teamId),
          body.id,
        ),
      ),
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  try {
    const database = await getDatabase(),
      params = new URL(request.url).searchParams;
    if (params.get('history') === '1')
      return Response.json(
        await listBackupHistory(
          bucket(),
          database.teamId,
          params.get('cursor') ?? undefined,
        ),
        { headers: { 'cache-control': 'private, no-store' } },
      );
    const archiveId = params.get('archiveId');
    if (
      archiveId !== null &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        archiveId,
      )
    )
      throw new BackupError('Choose a valid saved backup.');
    const statusOnly = !archiveId && params.get('status') === '1';
    const object = await bucket().get(
      archiveId
        ? backupArchiveKey(database.teamId, archiveId)
        : backupJobKey(database.teamId),
    );
    if (!object && statusOnly)
      return Response.json(
        { backup: null, reason: 'none' },
        { headers: { 'cache-control': 'private, no-store' } },
      );
    if (!object)
      return Response.json(
        {
          error: archiveId
            ? 'This saved backup was not found. Refresh backup history.'
            : 'Prepare a backup first.',
        },
        { status: 404 },
      );
    const snapshot = await object.json<TeamBackup>();
    const createdAt = Date.parse(snapshot.createdAt);
    if (snapshot.teamId !== database.teamId)
      throw new BackupError('This backup could not be verified for your team.');
    if (
      archiveId &&
      (snapshot.id !== archiveId ||
        snapshot.copiedFiles !== snapshot.media.length ||
        !Number.isFinite(createdAt))
    )
      throw new BackupError('This saved backup is incomplete or unreadable.');
    const expired =
      !Number.isFinite(createdAt) ||
      createdAt > Date.now() + 5 * 60 * 1000 ||
      Date.now() - createdAt >= 24 * 60 * 60 * 1000;
    if (statusOnly)
      return Response.json(
        {
          backup: expired ? null : summary(snapshot),
          reason: expired ? 'expired' : 'ready',
        },
        { headers: { 'cache-control': 'private, no-store' } },
      );
    if (!archiveId && (snapshot.id !== params.get('id') || expired))
      return Response.json(
        {
          error: 'This backup has expired or was replaced. Prepare a new one.',
        },
        { status: 409 },
      );
    const part = Number(params.get('part'));
    if (
      snapshot.copiedFiles !== undefined &&
      snapshot.copiedFiles < snapshot.media.length
    )
      return Response.json(
        {
          error:
            'This backup is still preserving uploaded files. Continue preparation before downloading.',
        },
        { status: 409 },
      );
    if (!Number.isInteger(part) || part < 1 || part > snapshot.parts)
      return Response.json(
        { error: 'Choose a valid backup part.' },
        { status: 400 },
      );
    return new Response(
      backupZip(
        snapshot,
        part,
        bucket(),
        snapshot.copiedFiles !== undefined
          ? backupCopyPrefix(database.teamId, snapshot.id)
          : prefix(database.teamId),
        snapshot.copiedFiles !== undefined,
      ),
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
