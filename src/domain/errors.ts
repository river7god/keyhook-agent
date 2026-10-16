/**
 * Domain errors carry a stable machine-readable code. The API layer maps codes to HTTP status;
 * agent tools return them to the model as structured tool errors.
 */
export const DOMAIN_ERROR_CODES = [
  'NOT_FOUND',
  'VALIDATION',
  'INVALID_TRANSITION',
  'CONFLICT',
  'APPROVAL_REQUIRED',
  'IDEMPOTENCY_MISMATCH',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
