export type WorkspaceIdentity = { id: string; email: string; name: string };

// These headers are trusted only behind the Sites ingress. Never expose the
// Worker through an alternate public origin that bypasses that ingress.
export function identityFromHeaders(
  headers: Pick<Headers, 'get'>,
): WorkspaceIdentity | null {
  const id = headers.get('oai-authenticated-user-id')?.trim();
  if (!id) return null;
  const email = headers.get('oai-authenticated-user-email')?.trim() ?? '';
  let name = headers.get('oai-authenticated-user-full-name')?.trim() ?? '';
  if (
    headers.get('oai-authenticated-user-full-name-encoding') ===
    'percent-encoded-utf-8'
  ) {
    try {
      name = decodeURIComponent(name);
    } catch {
      name = '';
    }
  }
  return { id, email, name: name || email || 'Coach' };
}

export class WorkspaceAccessError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type TeamDatabase = D1Database & { readonly teamId: string };

export function scopedDatabase(
  database: D1Database,
  teamId: string,
): TeamDatabase {
  // A fresh wrapper per request prevents cross-user state on a shared binding.
  return new Proxy(database, {
    get(target, key) {
      if (key === 'teamId') return teamId;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as TeamDatabase;
}
