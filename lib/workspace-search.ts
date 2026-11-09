import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
export type SearchResult = {
  id: string;
  name: string;
  detail: string;
  kind: 'play' | 'athlete' | 'film';
};

export function matchingRecords(records: SearchResult[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return records
    .filter((record) =>
      terms.every((term) =>
        `${record.name} ${record.detail}`.toLocaleLowerCase().includes(term),
      ),
    )
    .sort(
      (a, b) =>
        Number(
          b.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
        ) -
          Number(
            a.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
          ) ||
        a.name.localeCompare(b.name) ||
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id),
    );
}

type Row = Record<string, unknown>;
const value = (row: Row, key: string) =>
  typeof row[key] === 'string' ? (row[key] as string) : '';
const sources = [
  {
    url: '/api/playbooks',
    key: 'plays',
    label: 'Plays',
    kind: 'play',
    map: (r: Row) => ({
      name: value(r, 'name'),
      detail: [value(r, 'unit'), value(r, 'formation'), value(r, 'concept')]
        .filter(Boolean)
        .join(' · '),
    }),
  },
  {
    url: '/api/athletes',
    key: 'athletes',
    label: 'Athletes',
    kind: 'athlete',
    map: (r: Row) => ({
      name: value(r, 'name'),
      detail: [
        typeof r.no === 'number' ? `#${r.no}` : '',
        value(r, 'position'),
        value(r, 'unit'),
      ]
        .filter(Boolean)
        .join(' · '),
    }),
  },
  {
    url: '/api/film',
    key: 'assets',
    label: 'Film',
    kind: 'film',
    map: (r: Row) => ({ name: value(r, 'title'), detail: 'Saved film' }),
  },
] as const;

export async function loadSearchRecords(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const response = await fetcher(source.url, { cache: 'no-store', signal });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok || !data || !Array.isArray(data[source.key]))
        throw new Error(source.label);
      return (data[source.key] as Row[]).map((row): SearchResult => {
        if (!row || typeof row.id !== 'string') throw new Error(source.label);
        const mapped = source.map(row);
        if (!mapped.name) throw new Error(source.label);
        return { id: row.id, kind: source.kind, ...mapped };
      });
    }),
  );
  return {
    records: results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    ),
    failures: results.flatMap((result, index) =>
      result.status === 'rejected' ? [sources[index].label] : [],
    ),
  };
}
