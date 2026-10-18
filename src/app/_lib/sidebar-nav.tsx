'use client';

import {
  Bot,
  CircleCheck,
  Flag,
  HandCoins,
  House,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Bot;
  badge?: keyof NavCounts;
}

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operate',
    items: [
      { href: '/dashboard', label: 'Work orders', icon: LayoutDashboard, badge: 'needsPm' },
      { href: '/dashboard/approvals', label: 'Approvals', icon: CircleCheck, badge: 'approvals' },
      { href: '/dashboard/arrears', label: 'Arrears', icon: HandCoins, badge: 'arrears' },
      { href: '/dashboard/portfolio', label: 'Portfolio', icon: House, badge: 'findings' },
    ],
  },
  {
    label: 'Agents',
    items: [
      { href: '/dashboard/agents', label: 'Agent catalog', icon: Bot },
      { href: '/simulator', label: 'Message simulator', icon: MessageSquareText },
    ],
  },
  {
    label: 'Trust',
    items: [
      { href: '/dashboard/audit', label: 'Audit log', icon: ScrollText },
      { href: '/dashboard/feedback', label: 'Corrections', icon: Flag },
    ],
  },
];

export type NavCounts = { needsPm: number; approvals: number; findings: number; arrears: number };

function isActive(path: string, href: string) {
  if (href === '/dashboard') return path === '/dashboard' || path.startsWith('/dashboard/jobs');
  return path === href || path.startsWith(`${href}/`);
}

export function SidebarNav({ counts, compact = false }: { counts: NavCounts; compact?: boolean }) {
  const path = usePathname();
  return (
    <>
      {SECTIONS.map((s) => (
        <div key={s.label} style={compact ? { display: 'contents' } : undefined}>
          {!compact && <div className="section-label">{s.label}</div>}
          {s.items.map((item) => {
            const Icon = item.icon;
            const n = item.badge ? counts[item.badge] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-item"
                aria-current={isActive(path, item.href) ? 'page' : undefined}
              >
                <Icon size={18} />
                {item.label}
                {n > 0 && (
                  <span className={`pill ${item.badge === 'needsPm' ? 'danger' : 'warn'}`}>
                    {n}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
