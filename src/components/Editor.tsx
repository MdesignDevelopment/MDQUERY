'use client';

import { useEffect, useRef, useState } from 'react';
import MonacoEditor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import '@/lib/monacoSetup'; // self-hosted Monaco assets — must load before the editor initializes
import type { LintFinding } from '@/lib/types';

type MdqTheme = 'mdq-dark' | 'mdq-light';

function currentTheme(): MdqTheme {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light'
    ? 'mdq-light'
    : 'mdq-dark';
}

/**
 * Monaco editor pane (§6): the dominant panel of the workspace. Uses Monaco's
 * SQL language; a custom Oracle PL/SQL tokenizer is the production upgrade.
 * Validation findings render as inline squiggles/markers.
 */
export default function Editor({ value, onChange, findings, readOnly, onSave }: {
  value: string;
  onChange: (v: string) => void;
  findings: LintFinding[];
  readOnly?: boolean;
  onSave?: () => void;
}) {
  const monacoRef = useRef<any>(null);
  const editorRef = useRef<any>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const [theme, setTheme] = useState<MdqTheme>('mdq-dark');

  // Follow the app's dark/light toggle (data-theme on <html>) live
  useEffect(() => {
    setTheme(currentTheme());
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const handleBeforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme('mdq-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.lineHighlightBackground': '#2d2d30',
        'editorLineNumber.foreground': '#6a6a6a',
        'editorGutter.background': '#1e1e1e',
      },
    });
    monaco.editor.defineTheme('mdq-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: { 'editor.background': '#ffffff' },
    });
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.());
    applyMarkers();
  };

  function applyMarkers() {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    const sevMap: Record<string, number> = { error: 8, warning: 4, info: 2 }; // MarkerSeverity
    monaco.editor.setModelMarkers(
      model,
      'mdq-lint',
      (findings ?? []).map((f) => ({
        severity: sevMap[f.severity] ?? 2,
        message: `${f.code}: ${f.message}`,
        startLineNumber: f.line,
        startColumn: f.col,
        endLineNumber: f.line,
        endColumn: Math.min(f.col + 40, model.getLineMaxColumn(Math.min(f.line, model.getLineCount()))),
      })),
    );
  }

  useEffect(applyMarkers, [findings]);

  useEffect(() => {
    const onReveal = (e: Event) => {
      const line = (e as CustomEvent).detail?.line;
      const editor = editorRef.current;
      if (editor && line) {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      }
    };
    window.addEventListener('mdq-reveal-line', onReveal);
    return () => window.removeEventListener('mdq-reveal-line', onReveal);
  }, []);

  return (
    <MonacoEditor
      language="sql"
      theme={theme}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      loading={<div className="flex h-full w-full items-center justify-center bg-bg text-xs text-ink-faint">Loading editor…</div>}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "ui-monospace, 'Cascadia Code', Consolas, Menlo, monospace",
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderLineHighlight: 'gutter',
        padding: { top: 8 },
        tabSize: 2,
      }}
    />
  );
}

/** Jump the editor cursor to a finding's line (used by the validation panel). */
export function revealLine(editorHost: HTMLElement | null, line: number) {
  // Monaco instance access is kept inside Editor; the panel dispatches a custom event instead.
  window.dispatchEvent(new CustomEvent('mdq-reveal-line', { detail: { line } }));
}
