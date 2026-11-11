import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
export type FilmAssetRecord = {
  version?: string;
  id: string;
  gameId: string | null;
  opponent: string | null;
  title: string;
  storageKey: string | null;
  durationSeconds: number;
  status: string;
  createdAt: string;
};
export type FilmClipRecord = {
  version: string;
  id: string;
  assetId: string;
  playId: string | null;
  playName: string | null;
  clipNumber: number;
  startSeconds: number;
  endSeconds: number;
  odk: string;
  down: number | null;
  distance: number | null;
  yardLine: string;
  result: string;
  tags: string[];
  note: string;
  concept: string;
  quarter: string;
  clock: string;
};
export type FilmPayload = {
  savedClipId?: string;
  assets: FilmAssetRecord[];
  asset: FilmAssetRecord | null;
  clips: FilmClipRecord[];
  error?: string;
};

export function parseFilmPayload(
  value: unknown,
  requestedId = '',
): FilmPayload {
  const data = value as FilmPayload | null;
  const text = (value: unknown) => typeof value === 'string';
  const nullable = (value: unknown) => value === null || text(value);
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value);
  const asset = (value: FilmAssetRecord) =>
    value &&
    text(value.id) &&
    Boolean(value.id) &&
    text(value.title) &&
    nullable(value.gameId) &&
    nullable(value.opponent) &&
    nullable(value.storageKey) &&
    number(value.durationSeconds) &&
    value.durationSeconds >= 0 &&
    text(value.status) &&
    text(value.createdAt);
  const unique = (rows: { id: string }[]) =>
    new Set(rows.map((row) => row.id)).size === rows.length;
  if (
    !data ||
    !Array.isArray(data.assets) ||
    !data.assets.every(asset) ||
    !unique(data.assets) ||
    !Array.isArray(data.clips) ||
    (data.asset !== null &&
      (!asset(data.asset) ||
        !data.assets.some(
          (row) =>
            row.id === data.asset!.id &&
            row.title === data.asset!.title &&
            row.storageKey === data.asset!.storageKey,
        ) ||
        !data.asset.version ||
        !/^[a-f0-9]{64}$/.test(data.asset.version))) ||
    (!data.asset && (data.assets.length || data.clips.length)) ||
    (requestedId && data.asset?.id !== requestedId)
  )
    throw new Error(
      'The film library response was incomplete. Retry before changing any records.',
    );
  if (
    !data.clips.every(
      (clip) =>
        clip &&
        text(clip.id) &&
        Boolean(clip.id) &&
        typeof clip.version === 'string' &&
        /^[a-f0-9]{64}$/.test(clip.version) &&
        clip.assetId === data.asset?.id &&
        nullable(clip.playId) &&
        nullable(clip.playName) &&
        Number.isInteger(clip.clipNumber) &&
        clip.clipNumber > 0 &&
        number(clip.startSeconds) &&
        clip.startSeconds >= 0 &&
        number(clip.endSeconds) &&
        clip.endSeconds > clip.startSeconds &&
        text(clip.odk) &&
        (clip.down === null || number(clip.down)) &&
        (clip.distance === null || number(clip.distance)) &&
        [
          clip.yardLine,
          clip.result,
          clip.note,
          clip.concept,
          clip.quarter,
          clip.clock,
        ].every(text) &&
        Array.isArray(clip.tags) &&
        clip.tags.every(text),
    ) ||
    !unique(data.clips) ||
    new Set(data.clips.map((clip) => clip.clipNumber)).size !==
      data.clips.length
  )
    throw new Error(
      'Saved clip details could not be read. Retry before changing any records.',
    );
  if (
    data.savedClipId !== undefined &&
    (typeof data.savedClipId !== 'string' ||
      !data.clips.some((clip) => clip.id === data.savedClipId))
  )
    throw new Error(
      'The saved clip could not be confirmed. Your draft should remain open.',
    );
  return data;
}
export async function readFilmData(
  assetId = '',
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<FilmPayload> {
  const response = await fetcher(
    `/api/film${assetId ? '?assetId=' + encodeURIComponent(assetId) : ''}`,
    { cache: 'no-store', signal },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value &&
        typeof value === 'object' &&
        'error' in value &&
        typeof value.error === 'string'
        ? value.error
        : 'Saved film could not be loaded.',
    );
  return parseFilmPayload(value, assetId);
}
