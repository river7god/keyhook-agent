import { cookies } from 'next/headers';
import { getDb } from '@/db/client';
import { logout, SESSION_COOKIE } from '@/domain/auth';
import { ok, toErrorResponse } from '../../_lib/respond';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const jar = await cookies();
    await logout(getDb(), jar.get(SESSION_COOKIE)?.value);
    jar.delete(SESSION_COOKIE);
    return ok({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
