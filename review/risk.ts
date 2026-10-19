/**
 * Risk tier of a change, from the paths it touches (docs/ai-delivery.md §3). Deterministic, so
 * CI can label PRs and CODEOWNERS can enforce reviewers without anyone remembering the rules.
 *
 *   A: low    — docs, translations, tests only
 *   B: normal — application and domain code
 *   C: high   — data model and RLS, auth, tool permissions, state machines, prompts, money and
 *               approval policy, CI and the rules that govern agents
 */
export type Tier = 'A' | 'B' | 'C';

interface Rule {
  pattern: RegExp;
  why: string;
}

const HIGH: Rule[] = [
  { pattern: /^src\/db\/(migrations|schema)\//, why: 'data model / migration' },
  { pattern: /^src\/db\/org-scope\.ts$/, why: 'row-level security scope' },
  {
    pattern: /^src\/(proxy\.ts|domain\/auth[^/]*\.ts|app\/api\/v1\/auth\/)/,
    why: 'authentication',
  },
  { pattern: /^src\/tools\//, why: 'agent tools and permissions' },
  {
    pattern:
      /^src\/workflows\/(state-machine|job-states|arrears-state-machine|arrears-states)\.ts$/,
    why: 'state machine',
  },
  { pattern: /^src\/agent\/(arrears\/)?prompts\.ts$/, why: 'prompts' },
  { pattern: /^src\/agent\/untrusted\.ts$/, why: 'untrusted-input boundary' },
  {
    pattern: /^src\/(domain\/(approval-policy|workflow-policy-config)|lib\/money)\.ts$/,
    why: 'money / approval policy',
  },
  { pattern: /^\.github\//, why: 'CI and ownership' },
  { pattern: /^CLAUDE(\.zh-CN)?\.md$/, why: 'rules for coding agents' },
  { pattern: /^review\//, why: 'the review gate itself' },
];

const LOW: RegExp[] = [/^docs\//, /\.md$/, /\.test\.ts$/];

/** Paths whose diff also goes to the security reviewer. */
const SECURITY: RegExp[] = [
  ...HIGH.map((r) => r.pattern),
  /^src\/app\/api\//,
  /^src\/domain\//,
  /^src\/agent\/(context|advance|pm-actions)\.ts$/,
];

const isTest = (p: string) => /\.test\.ts$/.test(p);

export interface Risk {
  tier: Tier;
  reasons: string[];
  securityReview: boolean;
}

export function classify(paths: readonly string[]): Risk {
  const reasons = new Set<string>();
  let tier: Tier = 'A';
  for (const p of paths) {
    // A test next to high-risk code is still only a test.
    const high = isTest(p) ? undefined : HIGH.find((r) => r.pattern.test(p));
    if (high) {
      tier = 'C';
      reasons.add(`${high.why} (${p})`);
    } else if (!LOW.some((re) => re.test(p)) && tier === 'A') {
      tier = 'B';
    }
  }
  return {
    tier,
    reasons: [...reasons],
    securityReview: paths.some((p) => !isTest(p) && SECURITY.some((re) => re.test(p))),
  };
}

/**
 * Docs are bilingual (CLAUDE.md): a change to `X.md` that has an `X.zh-CN.md` sibling must change
 * the sibling too. Returns the English files whose translation was not updated.
 */
export function missingTranslations(
  changed: readonly string[],
  exists: (path: string) => boolean,
): string[] {
  const set = new Set(changed);
  return changed.filter((p) => {
    if (!p.endsWith('.md') || p.endsWith('.zh-CN.md')) return false;
    const zh = p.replace(/\.md$/, '.zh-CN.md');
    return exists(zh) && !set.has(zh);
  });
}
