import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import {
  identityFromHeaders,
  WorkspaceAccessError,
} from '@/lib/workspace-identity';

export const isPrototype = () =>
  process.env.NODE_ENV === 'development' &&
  (env as unknown as { CHALKTALK_MODE?: string }).CHALKTALK_MODE !== 'pilot';

export async function requestIdentity() {
  if (isPrototype()) return { id: 'local-prototype', email: '', name: 'Coach' };
  const identity = identityFromHeaders(await headers());
  if (!identity)
    throw new WorkspaceAccessError('Sign in to access your workspace.', 401);
  return identity;
}
