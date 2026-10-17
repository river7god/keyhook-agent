import { z } from 'zod';
import { requireApiUser } from '@/app/_lib/session';
import { getDb } from '@/db/client';
import { withOrg } from '@/db/org-scope';
import { DomainError } from '@/domain/errors';
import { getMediaBytes } from '@/domain/media-store';
import { toErrorResponse } from '../../_lib/respond';

export const dynamic = 'force-dynamic';

const SAFE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** A stored photo, for the signed-in PM's organization only (RLS). */
export async function GET(_request: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  try {
    const user = await requireApiUser();
    const id = z.uuid().parse((await params).mediaId);
    const row = await withOrg(getDb(), user.organizationId, (tx) =>
      getMediaBytes(tx, user.organizationId, id),
    );
    if (!row || !SAFE_TYPES.has(row.mime)) throw new DomainError('NOT_FOUND', 'Photo not found');
    return new Response(new Uint8Array(row.bytes), {
      headers: {
        'content-type': row.mime,
        'content-disposition': 'inline',
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
