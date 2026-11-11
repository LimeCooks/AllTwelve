import { handleRecovery } from './recovery-service.js';
import { identityFromHeaders } from './workspace-identity.js';
import page from './page.js';
import client from './client.js';

export default {
  async fetch(request, bindings) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/recovery/'))
      return handleRecovery(request, bindings);
    if (!identityFromHeaders(request.headers))
      return new Response(
        'Sign in through this private Site to open recovery.',
        { status: 401 },
      );
    if (request.method !== 'GET')
      return new Response('Method not allowed', { status: 405 });
    const headers = {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
    };
    if (url.pathname === '/')
      return new Response(page, {
        headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
      });
    if (url.pathname === '/recovery-client.js')
      return new Response(client, {
        headers: {
          ...headers,
          'content-type': 'text/javascript; charset=utf-8',
        },
      });
    return new Response('Not found', { status: 404 });
  },
};
