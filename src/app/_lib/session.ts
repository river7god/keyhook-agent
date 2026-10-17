import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { getSessionUser, SESSION_COOKIE, type SessionUser } from '@/domain/auth';
import { DomainError } from '@/domain/errors';

/** Authoritative session check (database lookup). The proxy only does an optimistic cookie check. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(getDb(), token, new Date());
}

/** For pages: redirect to /login when not signed in. */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const path = (await headers()).get('x-pathname') ?? '/dashboard';
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return user;
}

/** For API routes: 401 when not signed in. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new DomainError('UNAUTHENTICATED', 'Sign in required');
  return user;
}
