import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard: every API route and page must authenticate, and every API route that reads
 * tenant data must run under withOrg (RLS). Public exceptions are listed explicitly.
 */
const APP = path.join(import.meta.dirname);
const PUBLIC = new Set([
  'api/v1/health/route.ts',
  'api/v1/auth/login/route.ts',
  'api/v1/auth/logout/route.ts',
  'api/inngest/route.ts', // authenticated by Inngest request signing (INNGEST_SIGNING_KEY)
  'login/page.tsx',
  'page.tsx',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(APP)
  .map((f) => path.relative(APP, f))
  .filter((f) => f.endsWith('route.ts') || f.endsWith('page.tsx'));

describe('route guards', () => {
  it.each(files.filter((f) => !PUBLIC.has(f)))('%s requires a session and uses withOrg', (file) => {
    const src = readFileSync(path.join(APP, file), 'utf8');
    expect(src).toMatch(file.endsWith('route.ts') ? /requireApiUser\(\)/ : /requirePageUser\(\)/);
    expect(src).toMatch(/withOrg\(/);
  });

  it('knows about every route (no silently public additions)', () => {
    expect(files.length).toBeGreaterThan(PUBLIC.size);
  });
});
