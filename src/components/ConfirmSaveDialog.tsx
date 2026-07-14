'use client';

import { useState } from 'react';
import type { LintFinding } from '@/lib/types';

/**
 * Hard save gates (§2.5): UPDATE/DELETE with no WHERE requires typing CONFIRM;
 * DDL requires an explicit irreversibility acknowledgment.
 */
export default function ConfirmSaveDialog({ missing, findings, onConfirm, onCancel }: {
  missing: string[];
  findings: LintFinding[];
  onConfirm: (confirmations: string[]) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [ackDdl, setAckDdl] = useState(false);
  const needsConfirm = missing.includes('CONFIRM_NO_WHERE');
  const needsDdl = missing.includes('ACK_DDL');
  const ready = (!needsConfirm || typed === 'CONFIRM') && (!needsDdl || ackDdl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] rounded-md border bg-panel p-5" style={{ borderColor: 'var(--risk-high)' }} role="alertdialog" aria-label="High-risk save confirmation">
        <h2 className="mb-1 text-sm font-semibold" style={{ color: 'var(--risk-high)' }}>⚠ High-risk statement — explicit confirmation required</h2>
        <p className="mb-3 text-xs text-ink-dim">
          This query will be saved into the dictionary as reviewed/ready-to-use. It is <em>never</em> executed by this
          platform, but whoever copies it out will run it against a client database.
        </p>
        <ul className="mono mb-4 max-h-32 space-y-1 overflow-y-auto text-[11px]">
          {findings.filter((f) => f.requires).map((f, i) => (
            <li key={i} style={{ color: 'var(--risk-warn)' }}>line {f.line}: {f.message}</li>
          ))}
        </ul>
        {needsConfirm && (
          <label className="mb-3 block text-xs">
            An UPDATE/DELETE has <strong>no WHERE clause</strong>. Type <span className="mono font-bold">CONFIRM</span> to proceed:
            <input className="input mono mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus placeholder="CONFIRM" />
          </label>
        )}
        {needsDdl && (
          <label className="mb-3 flex items-start gap-2 text-xs">
            <input type="checkbox" checked={ackDdl} onChange={(e) => setAckDdl(e.target.checked)} className="mt-0.5" />
            <span>I understand this contains DDL (DROP / TRUNCATE / ALTER) — a structural, potentially irreversible operation.</span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" disabled={!ready} onClick={() => {
            const c: string[] = [];
            if (needsConfirm) c.push('CONFIRM_NO_WHERE');
            if (needsDdl) c.push('ACK_DDL');
            onConfirm(c);
          }}>
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}
