import { validateGameplan, type GameplanState } from '@/lib/gameplan-state';
export const GAMEPLAN_RECORD_PREFIX = 'gameplan-record-v1:';
export const PREVIOUS_GAMEPLAN_ID = 'previous';
export type NamedGameplan = {
  id: string;
  title: string;
  opponent: string;
  date: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  state: GameplanState;
  version: string;
  previous?: boolean;
};
export type GameplanWrite = Pick<
  NamedGameplan,
  'id' | 'title' | 'opponent' | 'date' | 'archived' | 'state'
>;
export const validGameplanId = (value: unknown): value is string =>
  typeof value === 'string' &&
  (value === PREVIOUS_GAMEPLAN_ID ||
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    ));
export function parseNamedGameplan(value: unknown): NamedGameplan {
  const record = value as NamedGameplan | null;
  if (
    !record ||
    !validGameplanId(record.id) ||
    typeof record.title !== 'string' ||
    !record.title.trim() ||
    typeof record.opponent !== 'string' ||
    typeof record.date !== 'string' ||
    typeof record.archived !== 'boolean' ||
    typeof record.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.version) ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !Number.isFinite(Date.parse(record.updatedAt))
  )
    throw new Error(
      'The saved gameplan response was incomplete. Reload before editing.',
    );
  return { ...record, state: validateGameplan(record.state) };
}
export async function readGameplans(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('/api/gameplans', {
    cache: 'no-store',
    signal,
  });
  const data = (await response.json()) as {
    plans?: unknown;
    error?: string;
  } | null;
  if (!response.ok || !Array.isArray(data?.plans))
    throw new Error(
      data?.error || 'Saved gameplans could not be loaded. Retry to continue.',
    );
  const plans = data.plans.map(parseNamedGameplan);
  if (new Set(plans.map((plan) => plan.id)).size !== plans.length)
    throw new Error(
      'The gameplan list contained duplicate records. Reload before editing.',
    );
  return plans;
}
export async function readGameplan(id: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(
    '/api/gameplans?id=' + encodeURIComponent(id),
    { cache: 'no-store' },
  );
  const data = (await response.json()) as { plan?: unknown; error?: string };
  if (!response.ok || !data?.plan)
    throw new Error(
      data?.error || 'The selected gameplan could not be loaded.',
    );
  const plan = parseNamedGameplan(data.plan);
  if (plan.id !== id)
    throw new Error(
      'The selected gameplan response did not match its requested record.',
    );
  return plan;
}
export async function writeGameplan(
  value: GameplanWrite,
  version?: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('/api/gameplans', {
    method: version ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...value, version }),
  });
  const data = (await response.json()) as { plan?: unknown; error?: string };
  if (!response.ok || !data?.plan)
    throw new Error(
      data?.error ||
        'The gameplan save could not be confirmed. Reload before retrying.',
    );
  const plan = parseNamedGameplan(data.plan);
  if (plan.id !== value.id)
    throw new Error(
      'The saved gameplan response did not match the requested record.',
    );
  return plan;
}
