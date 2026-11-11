import { NextRequest, NextResponse } from 'next/server';
import { identityFromHeaders } from '@/lib/workspace-identity';

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === 'development') return NextResponse.next();
  if (!identityFromHeaders(request.headers))
    return NextResponse.json(
      { error: 'Sign in to access your workspace.' },
      { status: 401 },
    );
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin)
      return NextResponse.json(
        { error: 'This request must come from your workspace.' },
        { status: 403 },
      );
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
