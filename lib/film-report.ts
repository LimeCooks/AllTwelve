export type ReportAsset = { id: string; title: string };
export type ReportClip = {
  id: string;
  assetId: string;
  odk: string;
  down: number | null;
  distance: number | null;
  result: string;
  playId: string | null;
  playName: string | null;
  concept: string;
  clipNumber: number;
  note: string;
  tags: string[];
};
export type ReportDataset = {
  assets: ReportAsset[];
  asset: ReportAsset | null;
  clips: ReportClip[];
  selection: string;
  label: string;
  filmCount: number;
};

export async function loadReportDataset(
  selection = '',
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ReportDataset> {
  const read = async (id = '') => {
    const response = await fetcher(
      `/api/film${id ? `?assetId=${encodeURIComponent(id)}` : ''}`,
      { cache: 'no-store', signal },
    );
    const data = (await response.json()) as {
      assets: ReportAsset[];
      asset: ReportAsset | null;
      clips: ReportClip[];
      error?: string;
    };
    if (!response.ok)
      throw new Error(data.error || 'Unable to load the film dataset.');
    if (
      !data ||
      !Array.isArray(data.assets) ||
      !data.assets.every(
        (asset) =>
          asset &&
          typeof asset.id === 'string' &&
          typeof asset.title === 'string',
      ) ||
      new Set(data.assets.map((asset) => asset.id)).size !==
        data.assets.length ||
      (!data.asset && data.assets.length > 0) ||
      data.asset === undefined ||
      (data.asset &&
        (typeof data.asset.id !== 'string' ||
          typeof data.asset.title !== 'string')) ||
      !Array.isArray(data.clips) ||
      (id && data.asset?.id !== id) ||
      (data.asset && !data.assets.some((asset) => asset.id === data.asset!.id))
    )
      throw new Error('The film dataset was incomplete. Please retry.');
    if (
      !data.clips.every(
        (clip) =>
          clip &&
          typeof clip.id === 'string' &&
          typeof clip.assetId === 'string' &&
          clip.assetId === data.asset?.id &&
          typeof clip.odk === 'string' &&
          typeof clip.result === 'string' &&
          (clip.down === null ||
            (Number.isInteger(clip.down) && clip.down > 0)) &&
          (clip.distance === null ||
            (typeof clip.distance === 'number' &&
              Number.isFinite(clip.distance) &&
              clip.distance >= 0)) &&
          (clip.playId === null || typeof clip.playId === 'string') &&
          (clip.playName === null || typeof clip.playName === 'string') &&
          typeof clip.concept === 'string' &&
          Number.isInteger(clip.clipNumber) &&
          clip.clipNumber > 0 &&
          typeof clip.note === 'string' &&
          Array.isArray(clip.tags) &&
          clip.tags.every((tag) => typeof tag === 'string'),
      )
    )
      throw new Error('Saved clips could not be read reliably. Please retry.');
    if (new Set(data.clips.map((clip) => clip.id)).size !== data.clips.length)
      throw new Error(
        'The film dataset contained duplicate clips. Please retry.',
      );
    return data;
  };
  const first = await read(selection === 'all' ? '' : selection);
  if (selection !== 'all')
    return {
      ...first,
      selection: first.asset?.id ?? '',
      label: first.asset?.title ?? 'No saved film',
      filmCount: first.asset ? 1 : 0,
    };
  const others = await Promise.all(
    first.assets
      .filter((asset) => asset.id !== first.asset?.id)
      .map((asset) => read(asset.id)),
  );
  const clips = [first, ...others].flatMap((data) => data.clips);
  if (new Set(clips.map((clip) => clip.id)).size !== clips.length)
    throw new Error(
      'The film dataset contained duplicate clips. Please retry.',
    );
  return {
    assets: first.assets,
    asset: null,
    clips,
    selection: 'all',
    label: `All saved films (${first.assets.length})`,
    filmCount: first.assets.length,
  };
}

export function recordedYardage(result: string): number | null {
  const match = result
    .trim()
    .match(
      /^(?:(gain|loss)(?:\s+of)?\s+)?([+-]?\d+(?:\.\d{1,2})?)\s*(?:yards?|yds?)?$/i,
    );
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value) || Math.abs(value) > 200) return null;
  if (match[1]?.toLowerCase() === 'loss') return -Math.abs(value);
  return value;
}

export function buildFilmReport(clips: ReportClip[], unit: string) {
  const selected = clips.filter((clip) => clip.odk === unit);
  const yardage = selected
    .map((clip) => recordedYardage(clip.result))
    .filter((yards): yards is number => yards !== null);
  const groups = new Map<string, ReportClip[]>();
  for (const clip of selected) {
    const key =
      clip.down === null
        ? 'Down not charted'
        : `${clip.down}${clip.distance === null ? ' · distance not charted' : ` & ${clip.distance}`}`;
    groups.set(key, [...(groups.get(key) ?? []), clip]);
  }
  const rows = [...groups.entries()].map(([situation, records]) => {
    const calls = new Map<string, number>();
    for (const clip of records) {
      const call = clip.playName?.trim() || clip.concept.trim();
      if (call) calls.set(call, (calls.get(call) ?? 0) + 1);
    }
    const maximum = Math.max(0, ...calls.values());
    const winners = [...calls.entries()]
      .filter(([, count]) => count === maximum)
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b));
    const yards = records
      .map((clip) => recordedYardage(clip.result))
      .filter((value): value is number => value !== null);
    return {
      situation,
      topCall: winners.length
        ? winners.join(' / ') + (winners.length > 1 ? ' (tie)' : '')
        : 'Not charted',
      count: records.length,
      share: Math.round((records.length / selected.length) * 100),
      yardageCount: yards.length,
      averageYards: yards.length
        ? yards.reduce((a, b) => a + b, 0) / yards.length
        : null,
    };
  });
  return {
    clips: selected,
    rows,
    complete: selected.filter(
      (clip) =>
        clip.down !== null &&
        clip.distance !== null &&
        Boolean(clip.result.trim()),
    ).length,
    yardageCount: yardage.length,
    positive: yardage.filter((yards) => yards > 0).length,
    explosive: yardage.filter((yards) => yards >= 20).length,
    unassigned: clips.filter(
      (clip) => !['Offence', 'Defence', 'Special teams'].includes(clip.odk),
    ).length,
  };
}

export function safeCsvCell(value: unknown) {
  let text =
    value === null || value === undefined
      ? ''
      : ['string', 'number', 'boolean', 'bigint'].includes(typeof value)
        ? String(value)
        : (JSON.stringify(value) ?? '');
  if (typeof value === 'string' && /^[=+@-]/.test(text.trimStart()))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function filmReportCsv(dataset: ReportDataset, unit: string) {
  const rows = buildFilmReport(dataset.clips, unit).rows;
  return (
    '\uFEFF' +
    [
      [
        'Dataset',
        'Unit',
        'Situation',
        'Top call / concept',
        'Clips',
        'Share of unit clips (%)',
        'Clips with yardage',
        'Average recorded yards',
      ],
      ...rows.map((row) => [
        dataset.label,
        unit,
        row.situation,
        row.topCall,
        row.count,
        row.share,
        row.yardageCount,
        row.averageYards,
      ]),
    ]
      .map((row) => row.map(safeCsvCell).join(','))
      .join('\r\n')
  );
}
