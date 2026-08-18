'use client';

import { useMemo, useRef, useState } from 'react';
import type { QueryParamDef } from '@/lib/types';
import { resolveBinds } from '@/lib/params';

/**
 * Form Mode (§2.2): bind variables rendered as labeled inputs so values can
 * be filled without touching raw SQL. Same underlying query — switching modes
 * never mutates the body.
 */
/** The unified variable-type choices exposed in the editor's type selector. */
const VARIABLE_TYPES = [
  { value: 'text', label: 'Text', data_type: 'text', is_list: false },
  { value: 'number', label: 'Number', data_type: 'number', is_list: false },
  { value: 'date', label: 'Date', data_type: 'date', is_list: false },
  { value: 'enum', label: 'Enum (fixed choices)', data_type: 'enum', is_list: false },
  { value: 'list_text', label: 'List of text', data_type: 'text', is_list: true },
  { value: 'list_number', label: 'List of numbers', data_type: 'number', is_list: true },
  { value: 'geometry', label: 'Geometry (shapefile)', data_type: 'geometry', is_list: false },
] as const;

function variableTypeKey(p: Pick<QueryParamDef, 'data_type' | 'is_list'>): string {
  if (p.is_list) return p.data_type === 'number' ? 'list_number' : 'list_text';
  return p.data_type;
}

type ParsedFeature = { index: number; label: string; wkt: string };

/**
 * Automates the manual QGIS workflow (import shapefile -> run
 * geom_to_wkt($geometry) -> paste into the value cell): upload a .zip
 * shapefile bundle (or a bare .shp) and it's parsed server-side into WKT.
 * The value stays a plain editable textarea so manual paste still works.
 */
function GeometryField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [features, setFeatures] = useState<ParsedFeature[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setStatus('loading');
    setError('');
    setFeatures(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/geometry/parse', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse shapefile.');
      const parsed: ParsedFeature[] = data.features;
      if (parsed.length === 1) {
        onChange(parsed[0].wkt);
      } else {
        setFeatures(parsed);
      }
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Failed to parse shapefile.');
    }
  }

  return (
    <div className="space-y-1">
      <textarea
        className="input mono h-16 resize-none text-[11px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="WKT geometry, e.g. MultiPolygon (((x y, x y, ...)))"
      />
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.shp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn text-[10px]"
          onClick={() => inputRef.current?.click()}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Parsing…' : 'Upload shapefile…'}
        </button>
        {features && features.length > 1 && (
          <select
            className="input mono flex-1 text-[10px]"
            defaultValue=""
            onChange={(e) => {
              const f = features[Number(e.target.value)];
              if (f) onChange(f.wkt);
            }}
          >
            <option value="" disabled>{features.length} features found — pick one</option>
            {features.map((f, i) => <option key={f.index} value={i}>{f.label}</option>)}
          </select>
        )}
      </div>
      {status === 'error' && <span className="block text-[10px] text-red-400">{error}</span>}
      <span className="block text-[10px] text-ink-faint">
        Upload a .zip (.shp/.dbf/...) or a bare .shp — geometry is extracted as WKT, coordinates unprojected/as-is.
      </span>
    </div>
  );
}

export default function FormMode({ body, params, values, onValues, onCopyResolved, onVariableTypeChange }: {
  body: string;
  params: QueryParamDef[];
  values: Record<string, string>;
  onValues: (v: Record<string, string>) => void;
  onCopyResolved: (resolved: string) => void;
  onVariableTypeChange?: (name: string, dataType: string, isList: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const resolved = useMemo(() => resolveBinds(body, values, params), [body, values, params]);

  function set(name: string, v: string) {
    onValues({ ...values, [name]: v });
  }

  async function copy() {
    await navigator.clipboard.writeText(resolved);
    onCopyResolved(resolved);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (params.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">
        No bind variables (:name) detected — Form Mode applies to parameterized queries.
      </div>
    );
  }

  return (
    <div className="flex flex-1 gap-0 overflow-hidden">
      <div className="w-72 shrink-0 space-y-3 overflow-y-auto border-r border-edge p-4">
        <div className="text-[10px] uppercase tracking-widest text-ink-faint">Parameters</div>
        {params.map((p) => (
          <label key={p.name} className="block">
            <span className="mb-1 flex items-center justify-between gap-1">
              <span className="mono text-[11px] text-[var(--accent-hi)]">:{p.name}</span>
              {onVariableTypeChange && (
                <select
                  className="mono rounded-sm border border-edge bg-bg px-1 py-0.5 text-[10px] text-ink-faint"
                  value={variableTypeKey(p)}
                  onChange={(e) => {
                    const t = VARIABLE_TYPES.find((v) => v.value === e.target.value)!;
                    onVariableTypeChange(p.name, t.data_type, t.is_list);
                  }}
                  aria-label={`Variable type for ${p.name}`}
                  title="How this variable is treated: a single value, or a list used inside IN (:param)"
                >
                  {VARIABLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              )}
            </span>
            {p.label && <span className="mb-1 block text-[10px] text-ink-faint">{p.label}</span>}
            {p.is_list ? (
              <>
                <textarea
                  className="input mono h-16 resize-none"
                  value={values[p.name] ?? p.default_value ?? ''}
                  onChange={(e) => set(p.name, e.target.value)}
                  placeholder={`one ${p.data_type} per line, or comma-separated`}
                />
                <span className="mt-1 block text-[10px] text-ink-faint">
                  Write the bind in your query with parens: <span className="mono">IN (:{p.name})</span>
                </span>
              </>
            ) : p.data_type === 'enum' && p.enum_options ? (
              <select className="input" value={values[p.name] ?? p.default_value ?? ''} onChange={(e) => set(p.name, e.target.value)}>
                <option value="">— pick —</option>
                {p.enum_options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : p.data_type === 'geometry' ? (
              <GeometryField value={values[p.name] ?? p.default_value ?? ''} onChange={(v) => set(p.name, v)} />
            ) : (
              <input
                className="input mono"
                type={p.data_type === 'number' ? 'number' : p.data_type === 'date' ? 'date' : 'text'}
                value={values[p.name] ?? p.default_value ?? ''}
                onChange={(e) => set(p.name, e.target.value)}
                placeholder={p.data_type}
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-widest text-ink-faint">Resolved preview — values substituted as Oracle literals</span>
          <button className="btn btn-primary" onClick={copy}>{copied ? '✓ Copied' : 'Copy resolved'}</button>
        </div>
        <pre className="mono flex-1 overflow-auto whitespace-pre-wrap bg-bg p-3 text-xs leading-5">{resolved}</pre>
      </div>
    </div>
  );
}
