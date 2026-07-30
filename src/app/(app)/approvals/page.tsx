'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import DiffView from '@/components/DiffView';
import RiskBadge from '@/components/RiskBadge';
import { useDialogs } from '@/components/Dialogs';
import { useUser } from '@/components/UserContext';
import type { ReviewRequestRow } from '@/lib/types';

/**
 * Reviewer queue (§2.1): pending promotions/updates (peer review — you cannot
 * approve your own) plus stale-flagged public entries.
 */
export default function ApprovalsPage() {
  const user = useUser();
  const { confirm, dialogs } = useDialogs();
  const [reviews, setReviews] = useState<(ReviewRequestRow & { current_public_body?: string | null })[]>([]);
  const [stale, setStale] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [rv, sq] = await Promise.all([
      fetch('/api/reviews?filter=queue').then((r) => (r.ok ? r.json() : { reviews: [] })),
      fetch('/api/queries?scope=public').then((r) => r.json()),
    ]);
    setReviews(rv.reviews ?? []);
    setStale((sq.queries ?? []).filter((q: any) => q.flagged_stale));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openDetail(id: number) {
    setOpenId(id);
    setNotes('');
    const r = await fetch(`/api/reviews/${id}`);
    setDetail(r.ok ? await r.json() : null);
  }

  async function decide(id: number, action: 'approve' | 'reject') {
    const r = await fetch(`/api/reviews/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, notes }),
    });
    const d = await r.json();
    if (!r.ok) { setNotice(d.error ?? 'Failed'); setTimeout(() => setNotice(''), 3000); return; }
    setOpenId(null);
    setDetail(null);
    load();
  }

  async function removeRequest(id: number) {
    const ok = await confirm({
      title: `Delete request #${id}?`,
      message: 'Removes it from the queue entirely — for spam, tests, or duplicate submissions. Prefer Reject when the requester should be able to revise and resubmit.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/reviews/${id}`, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) { setNotice(d.error ?? 'Failed'); setTimeout(() => setNotice(''), 3000); return; }
    setOpenId(null);
    setDetail(null);
    load();
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold">Pending Approvals</h1>
        <span className="text-[11px] text-ink-faint">peer review — requesters can never approve their own submissions</span>
        {notice && <span className="text-[11px]" style={{ color: 'var(--risk-high)' }}>{notice}</span>}
      </header>

      <section className="p-4">
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">Promotion / update requests ({reviews.length})</h2>
        {reviews.map((r) => (
          <div key={r.id} className="mb-2 rounded-sm border border-edge">
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-panel-2" onClick={() => (openId === r.id ? setOpenId(null) : openDetail(r.id))}>
              <span className="mono text-ink-faint">#{r.id}</span>
              <span className="badge border border-edge text-ink-faint">{r.request_type === 'new_promotion' ? 'new → public' : 'update public'}</span>
              <span className="badge border border-edge text-ink-faint">{r.item_type}</span>
              <span className="mono text-[var(--accent-hi)]">{r.proposed?.tag}</span>
              <span className="flex-1 truncate text-ink-dim">{r.proposed?.title}</span>
              {r.proposed?.validation?.risk_level && <RiskBadge level={r.proposed.validation.risk_level} />}
              <span className="text-ink-faint">by {r.requested_by_name}</span>
              {r.parent_request_id && <span className="badge border border-edge" style={{ color: 'var(--risk-warn)' }} title="Resubmission of a rejected request">rev {r.parent_request_id} ↻</span>}
              <span className="text-ink-faint">{new Date(r.created_at).toLocaleDateString()}</span>
            </button>
            {openId === r.id && detail && (
              <div className="border-t border-edge p-3">
                {detail.review.proposed?.description && <p className="mb-2 text-[11px] text-ink-dim">{detail.review.proposed.description}</p>}
                {detail.thread?.length > 0 && (
                  <div className="mb-2 rounded-sm border border-edge bg-panel-2 p-2 text-[11px]">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-ink-faint">Review thread</div>
                    {detail.thread.map((t: any) => (
                      <div key={t.id} className="text-ink-dim">
                        #{t.id} {t.status} {t.reviewed_by_name ? `by ${t.reviewed_by_name}` : ''} {t.review_notes ? `— “${t.review_notes}”` : ''}
                      </div>
                    ))}
                  </div>
                )}
                {r.item_type === 'query' ? (
                  <>
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-ink-faint">
                      {r.request_type === 'update' ? 'current public → proposed' : 'proposed new public entry'}
                    </div>
                    <DiffView oldText={detail.current_public_body ?? ''} newText={detail.review.proposed?.body ?? ''} />
                    {detail.review.proposed?.validation?.findings?.length > 0 && (
                      <div className="mt-2 text-[11px]">
                        <div className="mb-1 text-[10px] uppercase tracking-widest text-ink-faint">Static validation at submission</div>
                        {detail.review.proposed.validation.findings.map((f: any, i: number) => (
                          <div key={i} className="mono text-ink-dim">[{f.severity}] line {f.line}: {f.message}</div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[11px] text-ink-dim">
                    Workflow with {detail.review.proposed?.steps?.length ?? 0} steps:
                    <ol className="mt-1 list-decimal pl-5">
                      {detail.review.proposed?.steps?.map((s: any, i: number) => (
                        <li key={i}><span className="mono text-[var(--accent-hi)]">{s.query?.tag}</span> — {s.query?.title} <RiskBadge level={s.query?.risk_level ?? 'safe'} compact /></li>
                      ))}
                    </ol>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <input className="input" placeholder="Review notes (required to reject)…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <button className="btn btn-primary" onClick={() => decide(r.id, 'approve')}>Approve & publish</button>
                  <button className="btn btn-danger" onClick={() => decide(r.id, 'reject')}>Reject</button>
                  {user.role === 'admin' && (
                    <button className="btn" onClick={() => removeRequest(r.id)} title="Delete without notifying the requester">🗑 Delete</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {reviews.length === 0 && <div className="text-xs text-ink-faint">Queue is clear.</div>}
      </section>

      <section className="p-4 pt-0">
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-ink-faint">Flagged as possibly stale ({stale.length})</h2>
        {stale.map((q) => (
          <div key={q.id} className="mb-1 flex items-center gap-2 rounded-sm border border-edge px-3 py-2 text-xs">
            <span className="badge" style={{ color: 'var(--risk-warn)', border: '1px solid var(--risk-warn)' }}>⚠</span>
            <Link href={`/queries/${q.id}`} className="mono text-[var(--accent-hi)] hover:underline">{q.tag}</Link>
            <span className="flex-1 truncate text-ink-dim">{q.title}</span>
            <span className="truncate text-[11px] text-ink-faint" title={q.stale_note}>{q.stale_note}</span>
          </div>
        ))}
        {stale.length === 0 && <div className="text-xs text-ink-faint">No stale flags raised.</div>}
      </section>
      {dialogs}
    </div>
  );
}
