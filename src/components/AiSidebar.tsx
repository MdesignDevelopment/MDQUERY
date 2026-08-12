'use client';

import { useRef, useState } from 'react';
import DiffView from './DiffView';
import { useDialogs } from './Dialogs';

type AiSource = 'provider' | 'fallback' | 'fallback-error';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  proposedSql?: string | null;
  applied?: boolean;
  slow?: boolean;
  source?: AiSource;
  model?: string;
}

/** Small badge so it's never a guess which engine answered this turn. */
function SourceBadge({ source, model }: { source?: AiSource; model?: string }) {
  if (!source) return null;
  const label =
    source === 'provider' ? `Claude · ${model}` : source === 'fallback-error' ? 'Offline · provider error' : 'Offline · static analyzer';
  const color = source === 'provider' ? 'text-accent' : source === 'fallback-error' ? 'text-red-400' : 'text-ink-faint';
  return <div className={`mb-1 text-[9px] uppercase tracking-wide ${color}`}>{label}</div>;
}

/**
 * AI Query Copilot sidebar (§2.3, §5): docked chat-style panel. Every edit is
 * a proposed diff with Accept / Reject — never an auto-commit. Accepting only
 * updates the editor buffer; saving still runs the full validation pipeline.
 */
export default function AiSidebar({ body, onApply, editable }: {
  body: string;
  onApply: (newBody: string) => void;
  editable: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { confirm, dialogs } = useDialogs();
  const bodyRef = useRef(body);
  bodyRef.current = body;

  function extractSql(text: string): string | null {
    const m = /```sql\s*\n([\s\S]*?)```/.exec(text);
    return m ? m[1].trimEnd() : null;
  }

  async function ask(mode: 'edit' | 'explain' | 'review', instruction: string) {
    if (busy) return;
    const snapshot = bodyRef.current;
    setBusy(true);
    setTurns((t) => [...t, { role: 'user', text: instruction || `(${mode})` }, { role: 'assistant', text: '' }]);
    const slowTimer = setTimeout(() => {
      setTurns((t) => {
        const copy = [...t];
        const last = copy[copy.length - 1];
        if (last?.role === 'assistant' && !last.text) copy[copy.length - 1] = { ...last, slow: true };
        return copy;
      });
    }, 15_000);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, body: snapshot, instruction }),
      });
      const source = (res.headers.get('x-ai-source') as AiSource | null) ?? undefined;
      const model = res.headers.get('x-ai-model') ?? undefined;
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setTurns((t) => {
            const copy = [...t];
            copy[copy.length - 1] = { role: 'assistant', text: acc, source, model };
            return copy;
          });
        }
      }
      const sql = mode === 'edit' ? extractSql(acc) : null;
      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = { role: 'assistant', text: acc, proposedSql: sql, source, model };
        return copy;
      });
    } catch (e) {
      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = { role: 'assistant', text: `Request failed: ${(e as Error).message}` };
        return copy;
      });
    } finally {
      clearTimeout(slowTimer);
      setBusy(false);
    }
  }

  async function accept(i: number) {
    const turn = turns[i];
    if (!turn.proposedSql) return;
    // Guardrail (§5): escalation check before applying
    const oldUp = bodyRef.current.toUpperCase();
    const newUp = turn.proposedSql.toUpperCase();
    const nowUnscoped = /\b(UPDATE|DELETE)\b/.test(newUp) && !/\bWHERE\b/.test(newUp);
    const selectToDml = !/\b(UPDATE|DELETE|INSERT|MERGE)\b/.test(oldUp) && /\b(UPDATE|DELETE|INSERT|MERGE)\b/.test(newUp);
    if (nowUnscoped || selectToDml) {
      const reasons = [
        nowUnscoped ? '• the result is an UPDATE/DELETE with no WHERE clause (affects every row)' : '',
        selectToDml ? '• a read-only query becomes a data-modifying statement' : '',
      ].filter(Boolean).join('\n');
      const ok = await confirm({
        title: '⚠ This AI change escalates risk',
        message: `${reasons}\n\nApplying only updates the editor buffer — saving will still require the full high-risk confirmation.`,
        confirmLabel: 'Apply to editor anyway',
        danger: true,
      });
      if (!ok) return;
    }
    onApply(turn.proposedSql);
    setTurns((t) => t.map((x, j) => (j === i ? { ...x, applied: true } : x)));
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-edge bg-panel">
      {dialogs}
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-xs font-semibold">Query Copilot</span>
        <span className="text-[9px] uppercase tracking-wide text-ink-faint">text-only · no schema access</span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 && (
          <div className="text-[11px] leading-relaxed text-ink-faint">
            Describe a change (&quot;add a filter for status = ACTIVE&quot;, &quot;convert to a CTE&quot;), or use Explain / Review.
            <br /><br />
            The copilot reasons from the query text only — it can never check a client&apos;s live schema, and every edit is a
            reviewable diff.
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i}>
            {t.role === 'user' ? (
              <div className="rounded-sm bg-panel-2 px-2 py-1.5 text-[11px]">{t.text}</div>
            ) : (
              <div className="text-[11px] leading-relaxed text-ink-dim">
                <SourceBadge source={t.source} model={t.model} />
                {t.slow && !t.text && <div className="mb-1 animate-pulse text-ink-faint">still thinking…</div>}
                <Rendered text={t.text} hideSqlBlock={!!t.proposedSql} />
                {t.proposedSql != null && (
                  <div className="mt-2">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-ink-faint">Proposed change</div>
                    <DiffView oldText={bodyRef.current} newText={t.proposedSql} />
                    <div className="mt-1.5 flex gap-1.5">
                      <button className="btn btn-primary" disabled={t.applied || !editable} onClick={() => accept(i)}>
                        {t.applied ? '✓ Applied to editor' : 'Accept → editor'}
                      </button>
                      <button className="btn" disabled={t.applied} onClick={() => setTurns((x) => x.map((y, j) => (j === i ? { ...y, proposedSql: null } : y)))}>
                        Reject
                      </button>
                    </div>
                    {t.applied && <div className="mt-1 text-[10px] text-ink-faint">Not saved yet — Save runs the full validation pipeline.</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="mono animate-pulse text-[11px] text-ink-faint">▍</div>}
      </div>

      <div className="border-t border-edge p-2">
        <div className="mb-1.5 flex gap-1">
          <button className="btn flex-1 justify-center" disabled={busy} onClick={() => ask('explain', 'Explain this query')}>Explain</button>
          <button className="btn flex-1 justify-center" disabled={busy} onClick={() => ask('review', 'Review for best practices')}>Review</button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim()) return;
            ask('edit', input.trim());
            setInput('');
          }}
        >
          <textarea
            className="input mono h-16 resize-none"
            placeholder={editable ? 'Describe an edit… (Enter to send)' : 'Read-only query — clone it to edit with the copilot'}
            value={input}
            disabled={!editable || busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
              }
            }}
            aria-label="Copilot instruction"
          />
        </form>
      </div>
    </aside>
  );
}

/** Minimal markdown-ish rendering: bold, inline code, fenced blocks. */
function Rendered({ text, hideSqlBlock }: { text: string; hideSqlBlock?: boolean }) {
  const withoutSql = hideSqlBlock ? text.replace(/```sql\s*\n[\s\S]*?```/, '') : text;
  const parts = withoutSql.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-1 whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        p.startsWith('```') ? (
          <pre key={i} className="mono overflow-x-auto rounded-sm border border-edge bg-bg p-2 text-[10.5px]">
            {p.replace(/```\w*\n?/, '').replace(/```$/, '')}
          </pre>
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: escapeHtml(p).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code class="mono">$1</code>') }} />
        ),
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
