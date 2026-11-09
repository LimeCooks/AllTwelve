import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
import { parseInstallPayload } from '@/lib/install-data';
function responseError(value: unknown, fallback: string) {
  if (
    value &&
    typeof value === 'object' &&
    'error' in value &&
    typeof value.error === 'string'
  )
    return value.error;
  return fallback;
}
export async function loadInstallDestinations(
  unit: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('/api/install', { cache: 'no-store', signal });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      responseError(value, 'Unable to load draft installs. Please retry.'),
    );
  return parseInstallPayload(value).packages.filter(
    (pack) => !pack.publishedAt && (pack.unit === 'Team' || pack.unit === unit),
  );
}
export async function addSavedPlayToInstall(
  packageId: string,
  playId: string,
  unit: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('/api/install', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ packageId, playId }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      responseError(
        value,
        'Unable to add the saved play. Your play is unchanged.',
      ),
    );
  const saved = parseInstallPayload(value, packageId);
  if (
    !saved.package ||
    (saved.package.unit !== 'Team' && saved.package.unit !== unit) ||
    !saved.items.some((item) => item.playId === playId)
  )
    throw new Error(
      'The play could not be confirmed in that install. Open Manage installs to check before retrying.',
    );
  return saved.package;
}
