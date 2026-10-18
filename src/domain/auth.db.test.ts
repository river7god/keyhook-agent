import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { propertyManagers, sessions } from '@/db/schema';
import { ORG, PM } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { closeTestDb, testDb } from '@/test/db';
import {
  GUEST_EMAIL,
  GUEST_SESSION_TTL_MS,
  getSessionUser,
  guestLogin,
  login,
  logout,
  SESSION_TTL_MS,
} from './auth';

const db = testDb();
const now = new Date('2026-10-19T00:00:00Z');
const creds = {
  email: 'aroha@harbourcity.example.test',
  password: 'keyhook-demo',
  userAgent: 'vitest',
  now,
};

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

describe('auth', () => {
  it('logs in a seeded PM and resolves the session to their organization', async () => {
    const r = await login(db, { ...creds, email: 'ArOhA@HarbourCity.example.test ' });
    expect(r?.user).toMatchObject({ propertyManagerId: PM.aroha, organizationId: ORG.harbourCity });
    const user = await getSessionUser(db, r?.token, now);
    expect(user?.email).toBe('aroha@harbourcity.example.test');
  });

  it('stores only a hash of the session token', async () => {
    const r = await login(db, creds);
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(r?.token);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a wrong password and an unknown email the same way', async () => {
    await expect(login(db, { ...creds, password: 'nope' })).resolves.toBeNull();
    await expect(login(db, { ...creds, email: 'nobody@example.test' })).resolves.toBeNull();
  });

  it('expires sessions and ends them on logout', async () => {
    const r = await login(db, creds);
    expect(
      await getSessionUser(db, r?.token, new Date(now.getTime() + SESSION_TTL_MS + 1)),
    ).toBeNull();
    await logout(db, r?.token);
    expect(await getSessionUser(db, r?.token, now)).toBeNull();
  });

  it('drops the session of a deactivated PM', async () => {
    const r = await login(db, creds);
    await db
      .update(propertyManagers)
      .set({ active: false })
      .where(eq(propertyManagers.id, PM.aroha));
    expect(await getSessionUser(db, r?.token, now)).toBeNull();
    await expect(login(db, creds)).resolves.toBeNull();
  });
});

describe('guest demo login', () => {
  it('creates one shared guest PM in the demo organization and a short session', async () => {
    const a = await guestLogin(db, { userAgent: 'vitest', now });
    const b = await guestLogin(db, { userAgent: 'vitest', now });
    expect(a.user).toMatchObject({ organizationId: ORG.harbourCity, name: 'Guest reviewer' });
    expect(b.user.propertyManagerId).toBe(a.user.propertyManagerId);
    expect(a.expiresAt.getTime() - now.getTime()).toBe(GUEST_SESSION_TTL_MS);
    expect(await getSessionUser(db, a.token, now)).toMatchObject({ email: GUEST_EMAIL });
    const guests = await db
      .select()
      .from(propertyManagers)
      .where(eq(propertyManagers.email, GUEST_EMAIL));
    expect(guests).toHaveLength(1);
    expect(guests[0]?.passwordHash).toBeNull();
  });

  it('cannot be entered with a password', async () => {
    await guestLogin(db, { userAgent: 'vitest', now });
    expect(await login(db, { ...creds, email: GUEST_EMAIL, password: '' })).toBeNull();
  });

  it('is refused for a deactivated guest', async () => {
    const a = await guestLogin(db, { userAgent: 'vitest', now });
    await db
      .update(propertyManagers)
      .set({ active: false })
      .where(eq(propertyManagers.id, a.user.propertyManagerId));
    await expect(guestLogin(db, { userAgent: 'vitest', now })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
