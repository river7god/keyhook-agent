import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/domain/auth-cookie';

/**
 * Optimistic check only: pages without a session cookie go to /login. The authoritative check
 * (database session lookup) happens in every page and API route via requirePageUser/requireApiUser.
 * Also forwards the path so server components can build the ?next= redirect.
 */
export default function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (!req.cookies.has(SESSION_COOKIE)) {
    const url = new URL('/login', req.nextUrl);
    url.searchParams.set('next', path + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  const headers = new Headers(req.headers);
  headers.set('x-pathname', path + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only; API routes return 401 themselves, and /login, /, assets stay public.
  matcher: ['/dashboard/:path*', '/simulator/:path*'],
};
