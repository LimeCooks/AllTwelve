export const GAMEPLAN_KEY = 'gameplan-active-v3';
export type GameplanState = {
  filmSelection?: string;
  unit: string;
  included: string[];
  objectives: { title: string; detail: string; target: string }[];
  callBuckets: { name: string; plays: string[] }[];
};

export function emptyGameplan(): GameplanState {
  return { unit: 'Offence', included: [], objectives: [], callBuckets: [] };
}

export function validateGameplan(value: unknown): GameplanState {
  const state = value as GameplanState | null;
  const strings = (items: unknown): items is string[] =>
    Array.isArray(items) && items.every((item) => typeof item === 'string');
  if (
    !state ||
    (state.filmSelection !== undefined &&
      (typeof state.filmSelection !== 'string' ||
        state.filmSelection.length > 200)) ||
    !['Offence', 'Defence', 'Special teams'].includes(state.unit) ||
    !strings(state.included) ||
    !Array.isArray(state.objectives) ||
    !state.objectives.every(
      (item) =>
        item &&
        typeof item.title === 'string' &&
        typeof item.detail === 'string' &&
        typeof item.target === 'string',
    ) ||
    !Array.isArray(state.callBuckets) ||
    !state.callBuckets.every(
      (item) => item && typeof item.name === 'string' && strings(item.plays),
    )
  )
    throw new Error(
      'This saved gameplan could not be read. Your saved data has not been changed.',
    );
  return state;
}

export async function loadGameplan(
  fetcher: typeof fetch = fetch,
): Promise<GameplanState> {
  const read = async (key: string) => {
    const response = await fetcher(`/api/workspace-state?key=${key}`, {
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error('Unable to load the saved gameplan. Please retry.');
    const body = (await response.json()) as { value: unknown };
    if (!body || !Object.hasOwn(body, 'value'))
      throw new Error('The saved gameplan response was incomplete.');
    return body.value;
  };
  const current = await read(GAMEPLAN_KEY);
  if (current !== null) return validateGameplan(current);
  // Preserve the original prototype plan. New saves use a cadence-neutral key.
  const legacy = await read('gameplan-week-5-v2');
  return legacy === null ? emptyGameplan() : validateGameplan(legacy);
}

export function resolveGameplanPlay<T extends { id: string; name: string }>(
  reference: string,
  plays: T[],
): T | undefined {
  const byId = plays.find((play) => play.id === reference);
  if (byId) return byId;
  const legacyMatches = plays.filter((play) => play.name === reference);
  return legacyMatches.length === 1 ? legacyMatches[0] : undefined;
}

export function linkGameplanPlays(
  state: GameplanState,
  plays: { id: string; name: string }[],
): GameplanState {
  return {
    ...state,
    callBuckets: state.callBuckets.map((bucket) => ({
      ...bucket,
      plays: bucket.plays.map(
        (reference) => resolveGameplanPlay(reference, plays)?.id ?? reference,
      ),
    })),
  };
}
