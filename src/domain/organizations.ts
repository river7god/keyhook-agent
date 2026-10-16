import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { organizations } from '@/db/schema';
import { DomainError } from './errors';

/**
 * Stand-in for auth (decisions.md): pages act as the organization named by DEV_ORGANIZATION_SLUG.
 * Replace with the signed-in user's organization when auth lands.
 */
export async function resolveDevOrganization(db: DbOrTx) {
  const slug = process.env.DEV_ORGANIZATION_SLUG ?? 'harbour-city';
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  if (!org)
    throw new DomainError('NOT_FOUND', `Organization "${slug}" not found — run pnpm db:seed`);
  return org;
}
