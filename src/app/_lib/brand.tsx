import { KeyRound } from 'lucide-react';
import Link from 'next/link';

/** Product wordmark. Deliberately its own mark — no third-party logos. */
export function Brand({ href = '/', tagline = false }: { href?: string; tagline?: boolean }) {
  return (
    <Link href={href} className="brand" aria-label="Keyhook-agent home">
      <span className="mark">
        <KeyRound size={18} strokeWidth={2.2} />
      </span>
      <span>
        Keyhook-agent
        {tagline && <small>AI agents for property teams</small>}
      </span>
    </Link>
  );
}
