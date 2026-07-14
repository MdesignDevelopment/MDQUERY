'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Styled replacements for window.confirm / window.prompt so the app never
 * shows a browser-native dialog.
 *
 * Usage:
 *   const { confirm, promptText, dialogs } = useDialogs();
 *   ...render {dialogs} once in the component...
 *   if (await confirm({ title: 'Delete?', danger: true })) { ... }
 *   const note = await promptText({ title: 'Reason', minLength: 3 });
 */

export interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOpts {
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  type?: 'text' | 'password';
  multiline?: boolean;
  minLength?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void };

export function useDialogs() {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', opts, resolve })),
    [],
  );
  const promptText = useCallback(
    (opts: PromptOpts) => new Promise<string | null>((resolve) => setPending({ kind: 'prompt', opts, resolve })),
    [],
  );

  const settle = (value: boolean | string | null) => {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.resolve(!!value);
    else pending.resolve(typeof value === 'string' ? value : null);
    setPending(null);
  };

  const dialogs = pending ? <DialogShell pending={pending} onSettle={settle} /> : null;
  return { confirm, promptText, dialogs };
}

function DialogShell({ pending, onSettle }: { pending: Pending; onSettle: (v: boolean | string | null) => void }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const opts = pending.opts;
  const danger = !!opts.danger;
  const isPrompt = pending.kind === 'prompt';
  const minLength = isPrompt ? ((opts as PromptOpts).minLength ?? 1) : 0;
  const ready = !isPrompt || value.trim().length >= minLength;

  useEffect(() => {
    (isPrompt ? inputRef.current : confirmRef.current)?.focus();
  }, [isPrompt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSettle(isPrompt ? null : false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!ready) return;
    onSettle(isPrompt ? value.trim() : true);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => onSettle(isPrompt ? null : false)}>
      <form
        className="w-[420px] rounded-md border bg-panel p-4"
        style={{ borderColor: danger ? 'var(--risk-high)' : 'var(--edge)' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role={danger ? 'alertdialog' : 'dialog'}
        aria-label={opts.title}
      >
        <h2 className="mb-1 text-sm font-semibold" style={danger ? { color: 'var(--risk-high)' } : undefined}>
          {opts.title}
        </h2>
        {opts.message && <p className="mb-3 whitespace-pre-wrap text-xs text-ink-dim">{opts.message}</p>}

        {isPrompt && (
          <label className="mb-3 block text-xs">
            {(opts as PromptOpts).label && <span className="mb-1 block text-ink-dim">{(opts as PromptOpts).label}</span>}
            {(opts as PromptOpts).multiline ? (
              <textarea
                ref={(el) => { inputRef.current = el; }}
                className="input h-20 resize-none"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={(opts as PromptOpts).placeholder}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              />
            ) : (
              <input
                ref={(el) => { inputRef.current = el; }}
                className="input"
                type={(opts as PromptOpts).type ?? 'text'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={(opts as PromptOpts).placeholder}
                autoComplete={(opts as PromptOpts).type === 'password' ? 'new-password' : 'off'}
              />
            )}
            {minLength > 1 && value.trim().length > 0 && value.trim().length < minLength && (
              <span className="mt-1 block text-[11px]" style={{ color: 'var(--risk-warn)' }}>
                At least {minLength} characters.
              </span>
            )}
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn" type="button" onClick={() => onSettle(isPrompt ? null : false)}>
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button ref={confirmRef} className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} type="submit" disabled={!ready}>
            {opts.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
