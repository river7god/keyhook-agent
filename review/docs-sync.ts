/**
 * pnpm docs:sync [--range <git range>]
 *
 * Deterministic check (not an agent): every changed `X.md` that has an `X.zh-CN.md` translation
 * must change the translation in the same PR (CLAUDE.md: docs are bilingual).
 */
import { existsSync } from 'node:fs';
import { changedFiles } from './pr-review';
import { missingTranslations } from './risk';

const args = process.argv.slice(2);
const i = args.indexOf('--range');
const range = (i >= 0 ? args[i + 1] : undefined) ?? 'origin/main...HEAD';
const changed = changedFiles(range).filter((p) => existsSync(p));
const missing = missingTranslations(changed, existsSync);
if (missing.length) {
  for (const p of missing) {
    console.error(
      `::error file=${p}::${p} changed but ${p.replace(/\.md$/, '.zh-CN.md')} did not (docs are bilingual; English is canonical)`,
    );
  }
  process.exit(1);
}
console.log(
  `docs:sync: ${String(changed.filter((p) => p.endsWith('.md')).length)} doc(s) checked, translations in step.`,
);
