// One immutable binding per browser document. Switching teams reloads the page,
// so an older tab or queued callback cannot adopt another tab's selection.
let boundTeamId = '';
export function bindWorkspaceScope(teamId: string) {
  if (typeof window === 'undefined')
    throw new Error('Workspace selection belongs to the browser session.');
  if (!teamId || (boundTeamId && boundTeamId !== teamId))
    throw new Error('Reload to open another team workspace.');
  boundTeamId = teamId;
}
export function scopeWorkspaceRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  teamId: string,
  origin: string,
): [RequestInfo | URL, RequestInit | undefined] {
  if (!teamId) return [input, init];
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, origin);
  if (url.origin !== origin || !url.pathname.startsWith('/api/'))
    return [input, init];
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.set('x-alltwelve-team-id', teamId);
  return [input, { ...init, headers }];
}
export const workspaceFetch: typeof globalThis.fetch = (input, init) => {
  const args =
    typeof window === 'undefined'
      ? ([input, init] as const)
      : scopeWorkspaceRequest(input, init, boundTeamId, window.location.origin);
  return globalThis.fetch(...args);
};
export function workspaceMediaUrl(path: string) {
  if (typeof window === 'undefined' || !boundTeamId) return path;
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname !== '/api/media')
    throw new Error('Media must come from this workspace.');
  url.searchParams.set('workspace', boundTeamId);
  return url.pathname + url.search;
}
