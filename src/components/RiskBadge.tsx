import type { RiskLevel } from '@/lib/types';

const CFG: Record<RiskLevel, { label: string; color: string; title: string }> = {
  safe: { label: 'safe', color: 'var(--risk-safe)', title: 'Read-only (SELECT only)' },
  scoped_write: { label: 'scoped write', color: 'var(--risk-warn)', title: 'INSERT/UPDATE/DELETE with a WHERE clause' },
  high_risk: { label: 'high risk', color: 'var(--risk-high)', title: 'UPDATE/DELETE without WHERE, or DDL' },
};

export default function RiskBadge({ level, compact }: { level: RiskLevel; compact?: boolean }) {
  const c = CFG[level] ?? CFG.safe;
  return (
    <span
      className="badge"
      style={{ color: c.color, border: `1px solid ${c.color}55`, background: `${c.color}14` }}
      title={c.title}
    >
      ● {compact ? '' : c.label}
    </span>
  );
}
