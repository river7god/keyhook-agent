import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { login, SESSION_COOKIE } from '@/domain/auth';
import { DomainError } from '@/domain/errors';
import { ok, toErrorResponse } from '../../_lib/respond';
import { loginThrottle } from '../../_lib/throttle';

export const dynamic = 'force-dynamic';

const body = z.strictObject({ email: z.email().max(200), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  try {
    const input = body.parse(await request.json());
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    loginThrottle.check(`${ip}|${input.email.toLowerCase()}`);

    const result = await login(getDb(), {
      email: input.email,
      password: input.password,
      userAgent: h.get('user-agent'),
      now: new Date(),
    });
    if (!result) {
      loginThrottle.fail(`${ip}|${input.email.toLowerCase()}`);
      throw new DomainError('UNAUTHENTICATED', 'Email or password is incorrect');
    }
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
