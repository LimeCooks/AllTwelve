import { getDatabase, type TeamDatabase } from '@/db/client';
import { env } from 'cloudflare:workers';
import { isPrototype } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import { safeMediaKey } from '@/lib/team-backup';

class FilmInputError extends Error {}
function timeValue(value: unknown, fallback = 0) {
  if (value === undefined || value === '' || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new FilmInputError('Enter valid, non-negative clip times.');
  return parsed;
}

type AssetRow = {
  id: string;
  game_id: string | null;
  opponent: string | null;
  title: string;
  storage_key: string | null;
  duration_seconds: number;
  status: string;
  created_at: string;
};

type ClipRow = {
  id: string;
  film_asset_id: string;
  play_id: string | null;
  play_name: string | null;
  clip_number: number;
  start_seconds: number;
  end_seconds: number;
  odk: string | null;
  down: number | null;
  distance: number | null;
  yard_line: string | null;
  result: string | null;
  tags_json: string;
};

type ClipDetails = {
  tags: string[];
  note: string;
  concept: string;
  quarter: string;
  clock: string;
};

const assetSelect = `SELECT a.id, a.game_id, g.opponent, a.title, a.storage_key, a.duration_seconds, a.status, a.created_at
  FROM film_assets a LEFT JOIN games g ON g.id = a.game_id`;
const clipSelect = `SELECT c.id, c.film_asset_id, c.play_id, p.name AS play_name, c.clip_number,
  c.start_seconds, c.end_seconds, c.odk, c.down, c.distance, c.yard_line, c.result, c.tags_json
  FROM film_clips c LEFT JOIN plays p ON p.id = c.play_id`;

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: unknown) {
  if (value === '' || value == null) return null;
  const parsed = number(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDetails(raw: string): ClipDetails {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed))
      return {
        tags: parsed.filter((item): item is string => typeof item === 'string'),
        note: '',
        concept: '',
        quarter: '',
        clock: '',
      };
    if (parsed && typeof parsed === 'object') {
      const value = parsed as Record<string, unknown>;
      return {
        tags: Array.isArray(value.tags)
          ? value.tags.filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
        note: text(value.note),
        concept: text(value.concept),
        quarter: text(value.quarter),
        clock: text(value.clock),
      };
    }
  } catch {}
  return { tags: [], note: '', concept: '', quarter: '', clock: '' };
}

function presentAsset(row: AssetRow) {
  return {
    id: row.id,
    gameId: row.game_id,
    opponent: row.opponent,
    title: row.title,
    storageKey: row.storage_key,
    durationSeconds: row.duration_seconds,
    status: row.status,
    createdAt: row.created_at,
  };
}

function presentClip(row: ClipRow) {
  return {
    id: row.id,
    assetId: row.film_asset_id,
    playId: row.play_id,
    playName: row.play_name,
    clipNumber: row.clip_number,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    odk: row.odk ?? '',
    down: row.down,
    distance: row.distance,
    yardLine: row.yard_line ?? '',
    result: row.result ?? '',
    ...parseDetails(row.tags_json),
  };
}

async function payload(database: TeamDatabase, assetId = '') {
  const assets = await database
    .prepare(
      `${assetSelect} WHERE a.team_id = ? ORDER BY a.created_at DESC, a.rowid DESC`,
    )
    .bind(database.teamId)
    .all<AssetRow>();
  const activeAsset = assetId
    ? (assets.results.find((asset) => asset.id === assetId) ?? null)
    : (assets.results[0] ?? null);
  if (assetId && !activeAsset)
    throw new WorkspaceAccessError('Film record not found.', 404);
  const clips = activeAsset
    ? await database
        .prepare(
          `${clipSelect} WHERE c.film_asset_id = ? ORDER BY c.clip_number`,
        )
        .bind(activeAsset.id)
        .all<ClipRow>()
    : { results: [] as ClipRow[] };
  return {
    assets: assets.results.map(presentAsset),
    asset: activeAsset ? presentAsset(activeAsset) : null,
    clips: clips.results.map(presentClip),
  };
}

export async function GET(request: Request) {
  try {
    const database = await getDatabase();
    return Response.json(
      await payload(
        database,
        new URL(request.url).searchParams.get('assetId') ?? '',
      ),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WorkspaceAccessError
            ? error.message
            : 'Unable to load film. Try again.',
      },
      { status: error instanceof WorkspaceAccessError ? error.status : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action);
    const database = await getDatabase();
    if (action === 'register') {
      const storageKey = text(body.storageKey);
      const title = text(body.title, 'Uploaded game film');
      if (!safeMediaKey(storageKey))
        throw new FilmInputError('A valid stored video is required.');
      const key = isPrototype()
        ? storageKey
        : `teams/${database.teamId}/${storageKey}`;
      const object = await (env as unknown as { MEDIA: R2Bucket }).MEDIA.head(
        key,
      );
      if (
        !object ||
        !object.httpMetadata?.contentType?.startsWith('video/') ||
        object.size === 0
      )
        throw new FilmInputError(
          'Upload a video before adding it to the film library.',
        );
      const gameId = text(body.gameId) || null;
      if (
        gameId &&
        !(await database
          .prepare('SELECT id FROM games WHERE id = ? AND team_id = ?')
          .bind(gameId, database.teamId)
          .first())
      )
        throw new WorkspaceAccessError(
          'Choose a game belonging to your team.',
          400,
        );
      const existing = await database
        .prepare(
          'SELECT id, game_id, duration_seconds FROM film_assets WHERE team_id = ? AND storage_key = ?',
        )
        .bind(database.teamId, storageKey)
        .first<{
          id: string;
          game_id: string | null;
          duration_seconds: number;
        }>();
      const id = existing?.id ?? crypto.randomUUID();
      if (existing) {
        await database
          .prepare(
            "UPDATE film_assets SET title = ?, duration_seconds = ?, game_id = ?, status = 'ready' WHERE id = ? AND team_id = ?",
          )
          .bind(
            title,
            body.durationSeconds === undefined
              ? existing.duration_seconds
              : Math.round(timeValue(body.durationSeconds)),
            body.gameId === undefined ? existing.game_id : gameId,
            id,
            database.teamId,
          )
          .run();
      } else {
        await database
          .prepare(
            `INSERT INTO film_assets (id, team_id, game_id, title, storage_key, duration_seconds, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`,
          )
          .bind(
            id,
            database.teamId,
            gameId,
            title,
            storageKey,
            Math.max(0, Math.round(number(body.durationSeconds))),
            new Date().toISOString(),
          )
          .run();
      }
      return Response.json(await payload(database, id), {
        status: existing ? 200 : 201,
      });
    }
    if (action === 'metadata') {
      const assetId = text(body.assetId),
        duration = Number(body.durationSeconds);
      if (!Number.isFinite(duration) || duration <= 0)
        throw new FilmInputError('A valid film duration is required.');
      if (
        !(await database
          .prepare('SELECT id FROM film_assets WHERE id = ? AND team_id = ?')
          .bind(assetId, database.teamId)
          .first())
      )
        throw new WorkspaceAccessError('Film record not found.', 404);
      await database
        .prepare(
          'UPDATE film_assets SET duration_seconds = ? WHERE id = ? AND team_id = ?',
        )
        .bind(Math.round(duration), assetId, database.teamId)
        .run();
      return Response.json(await payload(database, assetId));
    }
    if (action === 'upsertClip') {
      const assetId = text(body.assetId);
      if (!assetId)
        throw new FilmInputError('Upload film before charting clips.');
      const asset = await database
        .prepare('SELECT id FROM film_assets WHERE id = ? AND team_id = ?')
        .bind(assetId, database.teamId)
        .first<{ id: string }>();
      if (!asset)
        return Response.json(
          { error: 'Film record not found.' },
          { status: 404 },
        );
      const clipId = text(body.id) || crypto.randomUUID();
      const existing = await database
        .prepare(
          'SELECT id, clip_number FROM film_clips WHERE id = ? AND film_asset_id = ?',
        )
        .bind(clipId, assetId)
        .first<{ id: string; clip_number: number }>();
      if (text(body.id) && !existing)
        throw new WorkspaceAccessError(
          'Clip record not found in this film.',
          404,
        );
      const nextNumber = await database
        .prepare(
          'SELECT COALESCE(MAX(clip_number), 0) + 1 AS next_number FROM film_clips WHERE film_asset_id = ?',
        )
        .bind(assetId)
        .first<{ next_number: number }>();
      const clipNumber = number(
        body.clipNumber,
        existing?.clip_number ?? nextNumber?.next_number ?? 1,
      );
      if (!Number.isInteger(clipNumber) || clipNumber < 1)
        throw new FilmInputError('Choose a positive whole clip number.');
      const startSeconds = timeValue(body.startSeconds);
      const endSeconds = timeValue(body.endSeconds, startSeconds);
      const playId = text(body.playId) || null;
      if (
        playId &&
        !(await database
          .prepare('SELECT id FROM plays WHERE id = ? AND team_id = ?')
          .bind(playId, database.teamId)
          .first())
      )
        throw new WorkspaceAccessError(
          'Choose a play belonging to your team.',
          400,
        );
      if (endSeconds <= startSeconds)
        throw new FilmInputError('The clip end must be after its start.');
      if (
        !Number.isInteger(clipNumber) ||
        (await database
          .prepare(
            'SELECT id FROM film_clips WHERE film_asset_id = ? AND clip_number = ? AND id != ?',
          )
          .bind(assetId, clipNumber, clipId)
          .first())
      )
        throw new FilmInputError('That clip number is already in use.');
      if (text(body.note).length > 280)
        throw new FilmInputError('Keep teaching notes to 280 characters.');
      const details = JSON.stringify({
        tags: Array.isArray(body.tags)
          ? body.tags
              .filter(
                (item): item is string =>
                  typeof item === 'string' && Boolean(item.trim()),
              )
              .map((item) => item.trim())
          : [],
        note: text(body.note),
        concept: text(body.concept),
        quarter: text(body.quarter),
        clock: text(body.clock),
      });
      const values = [
        playId,
        clipNumber,
        startSeconds,
        endSeconds,
        text(body.odk) || null,
        optionalNumber(body.down),
        optionalNumber(body.distance),
        text(body.yardLine) || null,
        text(body.result) || null,
        details,
      ];
      if (existing) {
        await database
          .prepare(
            `UPDATE film_clips SET play_id = ?, clip_number = ?, start_seconds = ?, end_seconds = ?, odk = ?, down = ?, distance = ?, yard_line = ?, result = ?, tags_json = ?
           WHERE id = ? AND film_asset_id = ?`,
          )
          .bind(...values, clipId, assetId)
          .run();
      } else {
        await database
          .prepare(
            `INSERT INTO film_clips (id, film_asset_id, play_id, clip_number, start_seconds, end_seconds, odk, down, distance, yard_line, result, tags_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(clipId, assetId, ...values)
          .run();
      }
      return Response.json(await payload(database, assetId), {
        status: existing ? 200 : 201,
      });
    }
    throw new FilmInputError('Choose a valid film action.');
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof FilmInputError ||
          error instanceof WorkspaceAccessError
            ? error.message
            : 'Unable to save film data.',
      },
      {
        status:
          error instanceof WorkspaceAccessError
            ? error.status
            : error instanceof FilmInputError
              ? 400
              : 500,
      },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const clipId = params.get('clipId')?.trim() ?? '';
    const assetId = params.get('assetId')?.trim() ?? '';
    if (!clipId && !assetId)
      throw new FilmInputError('Choose film or a clip to delete.');
    const database = await getDatabase();
    if (clipId) {
      const clip = await database
        .prepare(
          'SELECT c.film_asset_id FROM film_clips c JOIN film_assets a ON a.id = c.film_asset_id WHERE c.id = ? AND a.team_id = ?',
        )
        .bind(clipId, database.teamId)
        .first<{ film_asset_id: string }>();
      if (!clip) throw new WorkspaceAccessError('Clip record not found.', 404);
      await database
        .prepare('DELETE FROM film_clips WHERE id = ? AND film_asset_id = ?')
        .bind(clipId, clip.film_asset_id)
        .run();
      return Response.json(await payload(database, clip.film_asset_id));
    } else {
      const owned = await database
        .prepare('SELECT id FROM film_assets WHERE id = ? AND team_id = ?')
        .bind(assetId, database.teamId)
        .first();
      if (!owned) throw new WorkspaceAccessError('Film record not found.', 404);
      await database
        .prepare('DELETE FROM film_assets WHERE id = ? AND team_id = ?')
        .bind(assetId, database.teamId)
        .run();
    }
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof FilmInputError ||
          error instanceof WorkspaceAccessError
            ? error.message
            : 'Unable to delete the clip.',
      },
      {
        status:
          error instanceof WorkspaceAccessError
            ? error.status
            : error instanceof FilmInputError
              ? 400
              : 500,
      },
    );
  }
}
