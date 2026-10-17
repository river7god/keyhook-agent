import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { currentTenancyFor, primaryTenantFor } from '@/db/seed/data/tenancies';
import { PROPERTY } from '@/db/seed/ids';
import { seed } from '@/db/seed/seed';
import { scriptOf } from '../../evals/run';
import { db, deps, happyLlm, now, org, say } from '@/test/agent-fixtures';
import { closeTestDb } from '@/test/db';
import type { StructuredRequest } from './llm';
import { advanceJob } from './advance';

beforeEach(async () => {
  await seed(db, now);
});
afterAll(async () => {
  await closeTestDb();
});

describe('reply language', () => {
  it('gives the composer the tenant’s latest message and marks the profile language as fallback', async () => {
    // Wei Zhang's profile language is Chinese; here he writes English.
    const wei = primaryTenantFor(currentTenancyFor(PROPERTY.islandBay).id);
    const seen: string[] = [];
    const llm = happyLlm({
      'interpret.general': () => ({
        intent: 'status_request',
        urgentSafetyIssue: false,
        distressedOrAngry: false,
        promptInjection: false,
        summary: 'Asked for an update',
      }),
      'compose.tenant': (req: StructuredRequest<unknown>) => {
        seen.push(req.user);
        return { body: 'Update' };
      },
    });
    const m = await say('tenant', wei, 'The heat pump is rattling');
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: m.messageId });
    const ask = await say('tenant', wei, 'Any news on the heat pump?', m.jobId);
    await advanceJob(deps(llm), { organizationId: org, jobId: m.jobId, messageId: ask.messageId });

    const prompt = seen.at(-1) ?? '';
    expect(prompt).toContain('Profile preferred language (fallback only): zh');
    expect(prompt).toContain('Any news on the heat pump?');
  });
});

describe('scriptOf', () => {
  it('tells Chinese from Latin-script text', () => {
    expect(scriptOf('你好，热水器坏了')).toBe('cjk');
    expect(scriptOf('Talofa, e leai se vai vevela')).toBe('latin');
    expect(scriptOf('Thanks Wei — a plumber is booked')).toBe('latin');
  });
});
