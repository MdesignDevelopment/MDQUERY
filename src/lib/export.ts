import type { QueryRow, WorkflowRow } from './types';
import { resolveBinds } from './params';

/**
 * Export builders (§2.9). Execution always happens outside the platform, in a
 * client tool M.Design does not control, so the output is annotated plain SQL.
 */

export type FormatTarget = 'sqlplus' | 'sqldev';

function header(lines: string[], target: FormatTarget): string {
  const bar = '-'.repeat(70);
  const body = lines.map((l) => `-- ${l}`).join('\n');
  return `--${bar}\n${body}\n--${bar}`;
}

export function exportQuery(q: QueryRow, target: FormatTarget = 'sqldev', values?: Record<string, string>): string {
  const meta = [
    `Tag:         ${q.tag}`,
    `Title:       ${q.title}`,
    ...(q.description ? [`Description: ${q.description.replace(/\n/g, ' ')}`] : []),
    `Risk:        ${q.risk_level}`,
    ...(q.client_label ? [`Client:      ${q.client_label}`] : []),
    `Exported:    from M.Design Query Dictionary (system of record only — review before running)`,
  ];
  let body = q.body.trimEnd();
  if (values && Object.keys(values).length > 0) {
    body = resolveBinds(body, values, q.params ?? []).trimEnd();
  }
  const needsSemi = !/[;/]\s*$/.test(body);
  const stmt = needsSemi ? `${body};` : body;
  const pre = target === 'sqlplus' ? 'SET SQLBLANKLINES ON\nSET DEFINE OFF\n\n' : '';
  return `${header(meta, target)}\n${pre}${stmt}\n`;
}

export function exportBundle(queries: QueryRow[], target: FormatTarget = 'sqldev'): string {
  const parts = queries.map((q) => exportQuery(q, target));
  const top = header(
    [
      `M.Design Query Dictionary — bundle of ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}`,
      'Statements are annotated with tag + description. Review each before running.',
    ],
    target,
  );
  return `${top}\n\n${parts.join('\n\n')}`;
}

export function exportWorkflow(wf: WorkflowRow, target: FormatTarget = 'sqldev', stepValues?: Record<number, Record<string, string>>): string {
  const top = header(
    [
      `Workflow:    ${wf.tag} — ${wf.title}`,
      ...(wf.description ? [`Description: ${wf.description.replace(/\n/g, ' ')}`] : []),
      `Steps:       ${wf.steps?.length ?? 0} (run in order; results feed later steps manually)`,
      ...(wf.client_label ? [`Client:      ${wf.client_label}`] : []),
      `Overall risk: ${wf.risk_level ?? 'safe'}`,
    ],
    target,
  );
  const stepParts = (wf.steps ?? []).map((s, i) => {
    const q = s.query!;
    const values = stepValues?.[s.step_order] ?? stepValues?.[i + 1];
    const meta = [
      `STEP ${i + 1} of ${wf.steps!.length} — ${q.tag}: ${q.title}`,
      ...(s.note ? [`Note: ${s.note}`] : []),
      `Risk: ${q.risk_level}`,
    ];
    let body = q.body.trimEnd();
    if (values && Object.keys(values).length > 0) body = resolveBinds(body, values, q.params ?? []).trimEnd();
    const stmt = /[;/]\s*$/.test(body) ? body : `${body};`;
    return `${header(meta, target)}\n${stmt}`;
  });
  return `${top}\n\n${stepParts.join('\n\n')}\n`;
}
