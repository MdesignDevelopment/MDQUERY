'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Documentation tab (rich text + inline screenshots): the author writes free
 * text and drops/pastes/inserts images anywhere within it — e.g. the support
 * email that a query resolves, illustrated inline.
 *
 * Built on a plain contentEditable + document.execCommand rather than a rich
 * -text dependency (none exists in this project) — pragmatic for an
 * internal tool's formatting needs (bold/italic/lists/headings/links/images).
 * The HTML this produces is untrusted until the server sanitizes it on save
 * (src/lib/sanitize.ts) — that's the real security boundary, not this editor.
 * Inserted images resolve through /api/blob/documentation/..., a same-origin
 * proxy in front of the private Blob store — never a public blob URL.
 */
export default function DocumentationEditor({
  value,
  onChange,
  editable,
  onUploadImage,
  dirty,
  saving,
  onSave,
}: {
  value: string;
  onChange: (html: string) => void;
  editable: boolean;
  onUploadImage: (file: File) => Promise<string>;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // null (not `value`) so the first sync effect always runs — the div is
  // genuinely empty on mount regardless of what `value` already holds.
  const lastEmitted = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync from outside (initial load, switching queries, version restore) —
  // but never while the change originated from our own onInput, or every
  // keystroke would reset the caret to the start of the div.
  useEffect(() => {
    if (ref.current && value !== lastEmitted.current) {
      ref.current.innerHTML = value;
      lastEmitted.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (!editable) return;
    function onSelectionChange() {
      if (!ref.current || !document.activeElement || !ref.current.contains(document.activeElement)) return;
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
      });
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [editable]);

  function emit() {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
    lastEmitted.current = html;
    onChange(html);
  }

  function exec(cmd: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  }

  async function uploadAndInsert(file: File, atPoint?: { x: number; y: number }) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      setError(`"${file.name}" isn't a supported image type (PNG/JPEG/GIF/WEBP).`);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError(`"${file.name}" is over the 8 MB limit.`);
      return;
    }
    ref.current?.focus();
    if (atPoint && (document as any).caretRangeFromPoint) {
      const range: Range | null = (document as any).caretRangeFromPoint(atPoint.x, atPoint.y);
      if (range) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    setUploading(true);
    setError('');
    try {
      const url = await onUploadImage(file);
      document.execCommand('insertImage', false, url);
      emit();
    } catch (e) {
      setError((e as Error).message || 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  }

  if (!editable) {
    return value.trim() ? (
      <div className="doc-content flex-1 overflow-auto p-4 text-[13px] leading-6" dangerouslySetInnerHTML={{ __html: value }} />
    ) : (
      <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">
        No documentation yet for this query.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-edge bg-panel px-2 py-1.5">
        <button type="button" className={`btn px-2 py-0.5 ${active.bold ? 'border-[var(--accent)]' : ''}`} title="Bold (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}><b>B</b></button>
        <button type="button" className={`btn px-2 py-0.5 ${active.italic ? 'border-[var(--accent)]' : ''}`} title="Italic (Ctrl+I)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}><i>I</i></button>
        <button type="button" className={`btn px-2 py-0.5 ${active.underline ? 'border-[var(--accent)]' : ''}`} title="Underline (Ctrl+U)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}><u>U</u></button>
        <span className="mx-1 h-4 w-px bg-edge" />
        <button type="button" className="btn px-2 py-0.5" title="Heading" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<h2>')}>H2</button>
        <button type="button" className="btn px-2 py-0.5" title="Subheading" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<h3>')}>H3</button>
        <button type="button" className="btn px-2 py-0.5" title="Paragraph" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<p>')}>¶</button>
        <span className="mx-1 h-4 w-px bg-edge" />
        <button type="button" className={`btn px-2 py-0.5 ${active.insertUnorderedList ? 'border-[var(--accent)]' : ''}`} title="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>• List</button>
        <button type="button" className={`btn px-2 py-0.5 ${active.insertOrderedList ? 'border-[var(--accent)]' : ''}`} title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')}>1. List</button>
        <button type="button" className="btn px-2 py-0.5" title="Quote (e.g. quoting the original email)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<blockquote>')}>❝</button>
        <span className="mx-1 h-4 w-px bg-edge" />
        <button
          type="button"
          className="btn px-2 py-0.5"
          title="Insert image"
          disabled={uploading}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          🖼 {uploading ? 'Uploading…' : 'Image'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadAndInsert(f);
            e.target.value = '';
          }}
        />
        {error && <span className="ml-2 text-[11px]" style={{ color: 'var(--risk-high)' }}>{error}</span>}
        <span className="flex-1" />
        <button type="button" className="btn btn-primary px-2 py-0.5" disabled={!dirty || saving} onMouseDown={(e) => e.preventDefault()} onClick={onSave} title="Save documentation">
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        className="doc-content min-h-0 flex-1 overflow-auto p-4 text-[13px] leading-6 outline-none"
        data-placeholder="Describe the type of email/ticket this query resolves — paste or drag screenshots in anywhere…"
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          const items = Array.from(e.clipboardData?.items ?? []);
          const imageItem = items.find((it) => it.type.startsWith('image/'));
          if (imageItem) {
            e.preventDefault();
            const file = imageItem.getAsFile();
            if (file) uploadAndInsert(file);
          }
          // otherwise let the browser paste plain/rich text normally
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (files.length === 0) return;
          e.preventDefault();
          for (const f of files) uploadAndInsert(f, { x: e.clientX, y: e.clientY });
        }}
      />
    </div>
  );
}
