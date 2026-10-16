import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isDomainError, type DomainErrorCode } from '@/domain/errors';

/**
 * /api/v1 conventions
 * - Success: the resource JSON itself (no envelope).
 * - Error:   { error: { code, message, details? } } with a matching HTTP status.
 * - Request bodies and query strings are validated with Zod before reaching the domain layer.
 * - Every handler resolves an organizationId before calling domain code (auth arrives later).
 */
export interface ApiErrorBody {
  error: { code: DomainErrorCode | 'INTERNAL'; message: string; details?: unknown };
}

const STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  APPROVAL_REQUIRED: 403,
  IDEMPOTENCY_MISMATCH: 422,
};

export function ok<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, init);
}

export function toErrorResponse(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Invalid request', details: z.treeifyError(err) } },
      { status: 400 },
    );
  }
  if (isDomainError(err)) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: STATUS[err.code] },
    );
  }
  console.error(err);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Internal server error' } },
    { status: 500 },
  );
}
