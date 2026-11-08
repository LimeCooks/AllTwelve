import type { AthleteMetrics } from '@/types/domain';

export async function readRosterAvailability(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<AthleteMetrics> {
  const response = await fetcher('/api/athletes', {
    cache: 'no-store',
    signal,
  });
  let value: { metrics?: unknown; error?: unknown } | null;
  try {
    value = (await response.json()) as typeof value;
  } catch {
    throw new Error(
      'Roster availability could not be read. Retry to check team status.',
    );
  }
  if (!response.ok)
    throw new Error(
      typeof value?.error === 'string'
        ? value.error
        : 'Roster availability is unavailable. Retry to check team status.',
    );
  const metrics = value?.metrics as AthleteMetrics | null | undefined;
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (
    !metrics ||
    !['total', 'active', 'eligible', 'limited', 'out'].every((key) =>
      count(metrics[key as keyof AthleteMetrics]),
    ) ||
    metrics.active + metrics.limited + metrics.out !== metrics.total ||
    metrics.eligible > metrics.total ||
    !Number.isFinite(metrics.installAverage) ||
    metrics.installAverage < 0 ||
    metrics.installAverage > 100
  )
    throw new Error(
      'Roster availability was incomplete. Retry to check team status.',
    );
  return metrics;
}
