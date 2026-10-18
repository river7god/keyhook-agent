import { cookies, headers } from 'next/headers';
import { getDb } from '@/db/client';
import { guestLogin, guestLoginEnabled, SESSION_COOKIE } from '@/domain/auth';
import { DomainError } from '@/domain/errors';
import { ok, toErrorResponse } from '../../_lib/respond';
import { guestThrottle } from '../../_lib/throttle';

export const dynamic = 'force-dynamic';

/** One-click reviewer access to the demo organization (off unless DEMO_GUEST_LOGIN=true). */
export async function POST() {
  try {
    if (!guestLoginEnabled()) throw new DomainError('NOT_FOUND', 'Guest access is not enabled');
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    guestThrottle.check(ip);
    guestThrottle.fail(ip);
    const result = await guestLogin(getDb(), { userAgent: h.get('user-agent'), now: new Date() });
    (await cookies()).set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: result.expiresAt,
    });
    return ok({ name: result.user.name, organization: result.user.organizationName });
  } catch (err) {
    return toErrorResponse(err);
  }
}
