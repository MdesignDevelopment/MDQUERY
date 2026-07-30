'use client';

import { useCallback, useEffect, useState } from 'react';
import DiffView from '@/components/DiffView';
import { useDialogs } from '@/components/Dialogs';
import type { ReviewRequestRow } from '@/lib/types';

/**
 * My promotion/update requests (§2.1): status tracking; rejected requests show
 * the reviewer's notes and can be edited + resubmitted in the same thread.
 */
export default function MyRequestsPage() {
  const [reviews, setReviews] = useState<ReviewRequestRow[]>([]);
  const [editing, setEditing] = useState<ReviewRequestRow | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [notice, setNotice] = useState('');
  const { confirm, dialogs } = useDialogs();

  const load = useCallback(async () => {
    const r = await fetch('/api/reviews?filter=mine');
    const d = await r.json();
    setReviews(d.reviews ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resubmit() {
    if (!editing) return;
    const r = await fetch(`/api/reviews/${editing.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposed: { body: draftBody } }),
    });
    const d = await r.json();
    if (!r.ok) { setNotice(d.error ?? 'Failed'); setTimeout(() => setNotice(''), 3000); return; }
    setEditing(null);
    load();
  }

  async function withdraw(r: ReviewRequestRow) {
    const ok = await confirm({
      title: r.status === 'pending' ? `Withdraw request #${r.id}?` : `Delete request #${r.id}?`,
      message: r.status === 'pending'
        ? 'This cancels the pending promotion/update — it will no longer show in anyone’s review queue.'
        : 'This removes the rejected request from your history. You can always promote it again fresh later.',
      confirmLabel: r.status === 'pending' ? 'Withdraw' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/reviews/${r.id}`, { method: 'DELETE' });
    const d = await res.json();
    if (!res.ok) { setNotice(d.error ?? 'Failed'); setTimeout(() => setNotice(''), 3000); return; }
    load();
  }

  const STATUS_COLOR: Record<string, string> = {
    pending: 'var(--risk-warn)',
    approved: 'var(--risk-safe)',
    rejected: 'var(--risk-high)',
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold">My Requests</h1>
        <span className="text-[11px] text-ink-faint">promotions & proposed public edits</span>
        {notice && <span className="text-[11px]" style={{ color: 'var(--risk-high)' }}>{notice}</span>}
      </header>
      <div className="p-4">
        {reviews.map((r) => (
          <div key={r.id} className="mb-2 rounded-sm border border-edge px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="mono text-ink-faint">#{r.id}</span>
              <span className="badge" style={{ color: STATUS_COLOR[r.status], border: `1px solid ${STATUS_COLOR[r.status]}` }}>{r.status}</span>
              <span className="badge border border-edge text-ink-faint">{r.request_type === 'new_promotion' ? 'new → public' : 'update public'}</span>
              <span className="mono text-[var(--accent-hi)]">{r.proposed?.tag}</span>
              <span className="flex-1 truncate text-ink-dim">{r.proposed?.title}</span>
              {r.parent_request_id && <span className="badge border border-edge text-ink-faint">resubmission of #{r.parent_request_id}</span>}
              <span className="text-ink-faint">{new Date(r.created_at).toLocaleDateString()}</span>
              {(r.status === 'pending' || r.status === 'rejected') && (
                <button className="btn px-1.5" onClick={() => withdraw(r)} title={r.status === 'pending' ? 'Withdraw request' : 'Delete request'} aria-label={r.status === 'pending' ? 'Withdraw request' : 'Delete request'}>
                  🗑
                </button>
              )}
            </div>
            {r.status === 'rejected' && (
              <div className="mt-2 rounded-sm border p-2" style={{ borderColor: 'var(--risk-high)', background: 'rgba(241,76,76,.06)' }}>
                <div className="text-[11px]"><b>Rejected by {r.reviewed_by_name}:</b> {r.review_notes}</div>
                {editing?.id === r.id ? (
                  <div className="mt-2">
                    <textarea className="input mono h-40" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} aria-label="Revised query body" />
                    <div className="mt-1 text-[10px] uppercase tracking-widest text-ink-faint">diff vs rejected proposal</div>
                    <DiffView oldText={r.proposed?.body ?? ''} newText={draftBody} />
                    <div className="mt-2 flex gap-2">
                      <button className="btn btn-primary" onClick={resubmit}>Resubmit (stays in thread #{r.id})</button>
                      <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  r.item_type === 'query' && (
                    <button className="btn mt-2" onClick={() => { setEditing(r); setDraftBody(r.proposed?.body ?? ''); }}>
                      Edit & resubmit
                    </button>
                  )
                )}
              </div>
            )}
            {r.status === 'approved' && (
              <div className="mt-1 text-[11px] text-ink-faint">Approved by {r.reviewed_by_name}{r.review_notes ? ` — “${r.review_notes}”` : ''}. Now live in the Public Dictionary.</div>
            )}
          </div>
        ))}
        {reviews.length === 0 && <div className="text-xs text-ink-faint">No requests yet — open one of your private queries and hit ⇪ Promote.</div>}
      </div>
      {dialogs}
    </div>
  );
}
