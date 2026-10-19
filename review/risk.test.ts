import { describe, expect, it } from 'vitest';
import { classify, missingTranslations } from './risk';

describe('classify', () => {
  it('docs and tests only → A', () => {
    expect(classify(['docs/roadmap.md', 'README.zh-CN.md', 'src/agent/m9.db.test.ts']).tier).toBe(
      'A',
    );
  });

  it('application code → B', () => {
    const r = classify(['docs/x.md', 'src/app/dashboard/jobs/[jobId]/agent-trace.tsx']);
    expect(r).toMatchObject({ tier: 'B', reasons: [], securityReview: false });
  });

  it.each([
    ['src/db/migrations/0014_x.sql', 'data model'],
    ['src/db/schema/jobs.ts', 'data model'],
    ['src/tools/action-tools.ts', 'tools'],
    ['src/workflows/state-machine.ts', 'state machine'],
    ['src/agent/prompts.ts', 'prompts'],
    ['src/agent/arrears/prompts.ts', 'prompts'],
    ['src/domain/auth.ts', 'authentication'],
    ['src/proxy.ts', 'authentication'],
    ['src/lib/money.ts', 'money'],
    ['.github/workflows/ci.yml', 'CI'],
    ['CLAUDE.md', 'rules'],
    ['review/risk.ts', 'review gate'],
  ])('%s → C (%s)', (path, why) => {
    const r = classify([path]);
    expect(r.tier).toBe('C');
    expect(r.reasons.join()).toContain(why);
    expect(r.securityReview).toBe(true);
  });

  it('a test beside high-risk code stays low', () => {
    expect(classify(['src/tools/execute.db.test.ts']).tier).toBe('A');
  });

  it('domain and API changes get a security review without being C', () => {
    expect(classify(['src/domain/jobs.ts'])).toMatchObject({ tier: 'B', securityReview: true });
    expect(classify(['src/app/api/v1/jobs/route.ts'])).toMatchObject({
      tier: 'B',
      securityReview: true,
    });
  });
});

describe('missingTranslations', () => {
  const existing = new Set(['docs/a.zh-CN.md', 'README.zh-CN.md']);
  const exists = (p: string) => existing.has(p);

  it('flags English docs whose translation did not change', () => {
    expect(missingTranslations(['docs/a.md', 'README.md', 'README.zh-CN.md'], exists)).toEqual([
      'docs/a.md',
    ]);
  });

  it('ignores docs without a translation and non-markdown files', () => {
    expect(missingTranslations(['docs/spec-notes.md', 'src/x.ts'], exists)).toEqual([]);
  });
});

describe('review comment', () => {
  it('bounds the diff per file and in total', async () => {
    const { boundedDiff } = await import('./pr-review');
    const file = (name: string, size: number) =>
      `diff --git a/${name} b/${name}\n${'x'.repeat(size)}\n`;
    const r = boundedDiff(file('a.ts', 100) + file('big.ts', 50_000) + file('c.ts', 100));
    expect(r.text).toContain('more characters of this file not shown');
    expect(r.text).toContain('c.ts');
    expect(r.omitted).toEqual([]);
    const many = Array.from({ length: 10 }, (_, n) => file(`f${String(n)}.ts`, 19_000)).join('');
    expect(boundedDiff(many).omitted.length).toBeGreaterThan(0);
  });

  it('renders findings by severity with the marker for the sticky comment', async () => {
    const { MARKER, renderComment } = await import('./pr-review');
    const md = renderComment({
      risk: {
        tier: 'C',
        reasons: ['agent tools and permissions (src/tools/x.ts)'],
        securityReview: true,
      },
      reviewer: {
        summary: 'Adds a tool.',
        findings: [
          {
            severity: 'low',
            category: 'tests',
            file: 'src/tools/x.ts',
            line: null,
            title: 'No test',
            failureScenario: 's',
            suggestion: 'add one',
          },
          {
            severity: 'high',
            category: 'idempotency',
            file: 'src/tools/x.ts',
            line: 12,
            title: 'Missing key | dup',
            failureScenario: 'retry sends twice',
            suggestion: 'add key',
          },
        ],
      },
      security: { summary: 'Fine.', findings: [] },
      model: 'claude-opus-5-5',
      omitted: [],
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      costMicros: 8000,
    });
    expect(md.startsWith(MARKER)).toBe(true);
    expect(md).toContain('risk tier C · 1 high finding(s)');
    expect(md.indexOf('Missing key \\| dup')).toBeLessThan(md.indexOf('No test'));
    expect(md).toContain('US$0.008');
  });
});
