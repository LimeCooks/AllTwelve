import { getDatabase, TEAM_ID } from '@/db/client';

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
    if (Array.isArray(parsed)) return { tags: parsed.filter((item): item is string => typeof item === 'string'), note: '', concept: '', quarter: '', clock: '' };
    if (parsed && typeof parsed === 'object') {
      const value = parsed as Record<string, unknown>;
      return {
        tags: Array.isArray(value.tags) ? value.tags.filter((item): item is string => typeof item === 'string') : [],
        note: text(value.note), concept: text(value.concept), quarter: text(value.quarter), clock: text(value.clock),
      };
    }
  } catch {}
  return { tags: [], note: '', concept: '', quarter: '', clock: '' };
}

function presentAsset(row: AssetRow) {
  return {
    id: row.id, gameId: row.game_id, opponent: row.opponent, title: row.title,
    storageKey: row.storage_key, durationSeconds: row.duration_seconds, status: row.status, createdAt: row.created_at,
  };
}

function presentClip(row: ClipRow) {
  return {
    id: row.id, assetId: row.film_asset_id, playId: row.play_id, playName: row.play_name,
    clipNumber: row.clip_number, startSeconds: row.start_seconds, endSeconds: row.end_seconds,
    odk: row.odk ?? '', down: row.down, distance: row.distance, yardLine: row.yard_line ?? '',
    result: row.result ?? '', ...parseDetails(row.tags_json),
  };
}

async function payload(database: D1Database) {
  const assets = await database.prepare(`${assetSelect} WHERE a.team_id = ? ORDER BY a.created_at DESC`).bind(TEAM_ID).all<AssetRow>();
  const activeAsset = assets.results[0] ?? null;
  const clips = activeAsset
    ? await database.prepare(`${clipSelect} WHERE c.film_asset_id = ? ORDER BY c.clip_number`).bind(activeAsset.id).all<ClipRow>()
    : { results: [] as ClipRow[] };
  return { assets: assets.results.map(presentAsset), asset: activeAsset ? presentAsset(activeAsset) : null, clips: clips.results.map(presentClip) };
}

export async function GET() {
  try {
    const database = await getDatabase();
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load film.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action);
    const database = await getDatabase();
    if (action === 'register') {
      const storageKey = text(body.storageKey);
      const title = text(body.title, 'Uploaded game film');
      if (!storageKey) throw new Error('A stored video is required.');
      const existing = await database.prepare('SELECT id FROM film_assets WHERE team_id = ? AND storage_key = ?').bind(TEAM_ID, storageKey).first<{ id: string }>();
      const id = existing?.id ?? crypto.randomUUID();
      if (existing) {
        await database.prepare("UPDATE film_assets SET title = ?, duration_seconds = ?, status = 'ready', game_id = 'game-hamilton-week-5' WHERE id = ? AND team_id = ?")
          .bind(title, Math.max(0, Math.round(number(body.durationSeconds))), id, TEAM_ID).run();
      } else {
        await database.prepare(
          `INSERT INTO film_assets (id, team_id, game_id, title, storage_key, duration_seconds, status, created_at)
           VALUES (?, ?, 'game-hamilton-week-5', ?, ?, ?, 'ready', ?)`,
        ).bind(id, TEAM_ID, title, storageKey, Math.max(0, Math.round(number(body.durationSeconds))), new Date().toISOString()).run();
      }
      return Response.json(await payload(database), { status: existing ? 200 : 201 });
    }
    if (action === 'upsertClip') {
      const assetId = text(body.assetId);
      if (!assetId) throw new Error('Upload film before charting clips.');
      const asset = await database.prepare('SELECT id FROM film_assets WHERE id = ? AND team_id = ?').bind(assetId, TEAM_ID).first<{ id: string }>();
      if (!asset) return Response.json({ error: 'Film record not found.' }, { status: 404 });
      const clipId = text(body.id) || crypto.randomUUID();
      const existing = await database.prepare('SELECT id FROM film_clips WHERE id = ? AND film_asset_id = ?').bind(clipId, assetId).first<{ id: string }>();
      const nextNumber = await database.prepare('SELECT COALESCE(MAX(clip_number), 0) + 1 AS next_number FROM film_clips WHERE film_asset_id = ?').bind(assetId).first<{ next_number: number }>();
      const clipNumber = Math.max(1, Math.round(number(body.clipNumber, nextNumber?.next_number ?? 1)));
      const startSeconds = Math.max(0, number(body.startSeconds));
      const endSeconds = Math.max(startSeconds, number(body.endSeconds, startSeconds));
      const playId = text(body.playId) || null;
      const details = JSON.stringify({
        tags: Array.isArray(body.tags) ? body.tags.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [],
        note: text(body.note), concept: text(body.concept), quarter: text(body.quarter), clock: text(body.clock),
      });
      const values = [playId, clipNumber, startSeconds, endSeconds, text(body.odk) || null, optionalNumber(body.down), optionalNumber(body.distance), text(body.yardLine) || null, text(body.result) || null, details];
      if (existing) {
        await database.prepare(
          `UPDATE film_clips SET play_id = ?, clip_number = ?, start_seconds = ?, end_seconds = ?, odk = ?, down = ?, distance = ?, yard_line = ?, result = ?, tags_json = ?
           WHERE id = ? AND film_asset_id = ?`,
        ).bind(...values, clipId, assetId).run();
      } else {
        await database.prepare(
          `INSERT INTO film_clips (id, film_asset_id, play_id, clip_number, start_seconds, end_seconds, odk, down, distance, yard_line, result, tags_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(clipId, assetId, ...values).run();
      }
      return Response.json(await payload(database), { status: existing ? 200 : 201 });
    }
    throw new Error('Choose a valid film action.');
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to save film data.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const clipId = params.get('clipId')?.trim() ?? '';
    const assetId = params.get('assetId')?.trim() ?? '';
    if (!clipId && !assetId) throw new Error('Choose film or a clip to delete.');
    const database = await getDatabase();
    if (clipId) {
      await database.prepare(
        `DELETE FROM film_clips WHERE id = ? AND film_asset_id IN (SELECT id FROM film_assets WHERE team_id = ?)`,
      ).bind(clipId, TEAM_ID).run();
    } else {
      await database.prepare('DELETE FROM film_assets WHERE id = ? AND team_id = ?').bind(assetId, TEAM_ID).run();
    }
    return Response.json(await payload(database));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete the clip.' }, { status: 400 });
  }
}
