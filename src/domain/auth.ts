import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { organizations, propertyManagers, sessions } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/password';

/**
 * PM authentication. Runs on the owner connection (not withOrg): at login and session lookup the
 * organization is not known yet. Everything after authentication runs under withOrg.
 */
export const SESSION_TTL_MS = 12 * 3_600_000;
export { SESSION_COOKIE } from './auth-cookie';

export interface SessionUser {
  sessionId: string;
  organizationId: string;
  organizationName: string;
  propertyManagerId: string;
  name: string;
  email: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Verified against when the email is unknown, so response time doesn't reveal which emails exist.
let dummyHash: Promise<string> | undefined;

export async function login(
  db: Db,
  args: { email: string; password: string; userAgent: string | null; now: Date },
): Promise<{ token: string; expiresAt: Date; user: SessionUser } | null> {
  const [pm] = await db
    .select({
      id: propertyManagers.id,
      organizationId: propertyManagers.organizationId,
      organizationName: organizations.name,
      name: propertyManagers.fullName,
      email: propertyManagers.email,
      passwordHash: propertyManagers.passwordHash,
      active: propertyManagers.active,
    })
    .from(propertyManagers)
    .innerJoin(organizations, eq(organizations.id, propertyManagers.organizationId))
    .where(eq(sql`lower(${propertyManagers.email})`, args.email.trim().toLowerCase()))
    .limit(1);

  if (!pm?.passwordHash || !pm.active) {
    dummyHash ??= hashPassword('dummy-password-for-timing');
    await verifyPassword(args.password, await dummyHash);
    return null;
  }
  if (!(await verifyPassword(args.password, pm.passwordHash))) return null;

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(args.now.getTime() + SESSION_TTL_MS);
  const [row] = await db
    .insert(sessions)
    .values({
      organizationId: pm.organizationId,
      propertyManagerId: pm.id,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: args.userAgent?.slice(0, 300) ?? null,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('session insert failed');
  return {
    token,
    expiresAt,
    user: {
      sessionId: row.id,
      organizationId: pm.organizationId,
      organizationName: pm.organizationName,
      propertyManagerId: pm.id,
      name: pm.name,
      email: pm.email,
    },
  };
}

/** Resolve a cookie token to an active PM session (null if missing, expired or PM deactivated). */
export async function getSessionUser(
  db: Db,
  token: string | undefined,
  now: Date,
): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      organizationId: sessions.organizationId,
      organizationName: organizations.name,
      propertyManagerId: propertyManagers.id,
      name: propertyManagers.fullName,
      email: propertyManagers.email,
      active: propertyManagers.active,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(
      propertyManagers,
      and(
        eq(propertyManagers.organizationId, sessions.organizationId),
        eq(propertyManagers.id, sessions.propertyManagerId),
      ),
    )
    .innerJoin(organizations, eq(organizations.id, sessions.organizationId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)));
  if (!row?.active) return null;
  // Touch at most once a minute.
  if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    propertyManagerId: row.propertyManagerId,
    name: row.name,
    email: row.email,
  };
}

export async function logout(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function purgeExpiredSessions(db: Db, now: Date): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}
