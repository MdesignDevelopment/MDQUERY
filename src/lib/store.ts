import { query, withTx } from './db';
import { detectBinds, validateTag } from './params';
import { validateSql, missingConfirmations } from './validation';
import type { QueryParamDef, QueryRow, RiskLevel, User, ValidationResult, WorkflowRow, WorkflowStepRow } from './types';

export class HttpError extends Error {
  status: number;
  extra?: unknown;
  constructor(status: number, message: string, extra?: unknown) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export async function loadQuery(id: number, user: User): Promise<QueryRow> {
  const { rows } = await query<QueryRow>(
    `SELECT q.*, u.name AS owner_name,
            EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = $2 AND f.item_type = 'query' AND f.item_id = q.id) AS favorited
     FROM queries q LEFT JOIN users u ON u.id = q.owner_id
     WHERE q.id = $1`,
    [id, user.id],
  );
  const q = rows[0];
  if (!q) throw new HttpError(404, 'Query not found');
  if (!q.is_public && q.owner_id !== user.id) throw new HttpError(403, 'This query belongs to another user’s private dictionary.');
  q.params = await loadParams(id);
  return q;
}

export async function loadParams(queryId: number): Promise<QueryParamDef[]> {
  const { rows } = await query<QueryParamDef>(
    'SELECT name, data_type, default_value, enum_options, label FROM query_params WHERE query_id = $1 ORDER BY sort, name',
    [queryId],
  );
  return rows;
}

interface SaveInput {
  tag?: string;
  title?: string;
  description?: string;
  body?: string;
  department?: string | null;
  client_label?: string | null;
  params?: Partial<QueryParamDef>[];
  confirmations?: string[];
  change_source?: 'manual' | 'ai' | 'restore';
}

/**
 * The single save pipeline (§2.5, §3 auditability): validate → require
 * confirmations → version snapshot → param sync → validation log.
 * Used for manual saves, AI-accepted saves, and restores alike.
 */
export async function saveQuery(id: number, user: User, input: SaveInput): Promise<{ query: QueryRow; validation: ValidationResult }> {
  const existing = await loadQuery(id, user);
  const editable = !existing.is_public
    ? existing.owner_id === user.id
    : user.role === 'curator' || user.role === 'admin';
  if (!editable) throw new HttpError(403, 'Public entries can only be edited directly by curators/admins — use "Propose edit" instead.');

  const tag = input.tag ?? existing.tag;
  const body = input.body ?? existing.body;

  const tagError = validateTag(tag);
  if (tagError) throw new HttpError(400, tagError);

  const validation = validateSql(body);
  if (!validation.ok) throw new HttpError(422, 'Query has syntax errors — fix them before saving.', { validation });
  const missing = missingConfirmations(validation, input.confirmations ?? []);
  if (missing.length > 0) {
    throw new HttpError(409, 'This query needs explicit confirmation before it can be saved.', { validation, missing });
  }

  const result = await withTx(async (tx) => {
    // tag uniqueness inside scope
    const clash = existing.is_public
      ? await tx('SELECT id FROM queries WHERE is_public AND lower(tag) = lower($1) AND id <> $2', [tag, id])
      : await tx('SELECT id FROM queries WHERE NOT is_public AND owner_id = $1 AND lower(tag) = lower($2) AND id <> $3', [user.id, tag, id]);
    if (clash.rows.length > 0) throw new HttpError(409, `Tag "${tag}" is already in use in this dictionary.`);

    const updated = await tx(
      `UPDATE queries SET tag = $1, title = $2, description = $3, body = $4, department = $5,
         client_label = $6, risk_level = $7, updated_at = now(), updated_by = $8
       WHERE id = $9 RETURNING *`,
      [
        tag,
        input.title ?? existing.title,
        input.description ?? existing.description,
        body,
        input.department !== undefined ? input.department : existing.department,
        input.client_label !== undefined ? input.client_label : existing.client_label,
        validation.risk_level,
        user.id,
        id,
      ],
    );

    await tx(
      `INSERT INTO query_versions (query_id, body_snapshot, tag_snapshot, title_snapshot, risk_level, changed_by, change_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, body, tag, input.title ?? existing.title, validation.risk_level, user.id, input.change_source ?? 'manual'],
    );

    await syncParams(tx, id, body, input.params);

    await tx(
      `INSERT INTO validation_log (query_id, result, details) VALUES ($1,$2,$3)`,
      [id, validation.findings.some((f) => f.severity === 'warning') ? 'warn' : 'pass', JSON.stringify(validation)],
    );

    return updated.rows[0] as QueryRow;
  });

  result.params = await loadParams(id);
  return { query: result, validation };
}

/** Keep query_params in sync with binds detected in the body, preserving existing config. */
async function syncParams(
  tx: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>,
  queryId: number,
  body: string,
  overrides?: Partial<QueryParamDef>[],
) {
  const binds = detectBinds(body);
  await tx('DELETE FROM query_params WHERE query_id = $1 AND NOT (name = ANY($2::text[]))', [queryId, binds]);
  let sort = 0;
  for (const name of binds) {
    const ov = overrides?.find((o) => o.name === name);
    await tx(
      `INSERT INTO query_params (query_id, name, data_type, default_value, enum_options, label, sort)
       VALUES ($1,$2,COALESCE($3,'text'),$4,$5,$6,$7)
       ON CONFLICT (query_id, name) DO UPDATE SET
         data_type = COALESCE($3, query_params.data_type),
         default_value = CASE WHEN $8 THEN $4 ELSE query_params.default_value END,
         enum_options = CASE WHEN $8 THEN $5 ELSE query_params.enum_options END,
         label = CASE WHEN $8 THEN $6 ELSE query_params.label END,
         sort = $7`,
      [
        queryId, name,
        ov?.data_type ?? null,
        ov?.default_value ?? null,
        ov?.enum_options ? JSON.stringify(ov.enum_options) : null,
        ov?.label ?? null,
        sort++,
        !!ov,
      ],
    );
  }
}

export async function createQuery(user: User, input: SaveInput & { is_public?: boolean }): Promise<{ query: QueryRow; validation: ValidationResult }> {
  const tag = input.tag ?? 'untitled-query';
  const tagError = validateTag(tag);
  if (tagError) throw new HttpError(400, tagError);
  if (input.is_public && user.role !== 'curator' && user.role !== 'admin') {
    throw new HttpError(403, 'Only curators/admins create public entries directly — use the promotion flow.');
  }
  const body = input.body ?? '';
  const validation = body.trim() ? validateSql(body) : { findings: [], risk_level: 'safe' as RiskLevel, statement_kinds: [], ok: true };
  if (!validation.ok) throw new HttpError(422, 'Query has syntax errors.', { validation });
  const missing = missingConfirmations(validation as ValidationResult, input.confirmations ?? []);
  if (missing.length > 0) throw new HttpError(409, 'This query needs explicit confirmation before it can be saved.', { validation, missing });

  const created = await withTx(async (tx) => {
    const clash = input.is_public
      ? await tx('SELECT id FROM queries WHERE is_public AND lower(tag) = lower($1)', [tag])
      : await tx('SELECT id FROM queries WHERE NOT is_public AND owner_id = $1 AND lower(tag) = lower($2)', [user.id, tag]);
    if (clash.rows.length > 0) throw new HttpError(409, `Tag "${tag}" is already in use in this dictionary.`);
    const res = await tx(
      `INSERT INTO queries (owner_id, is_public, tag, title, description, body, department, client_label, risk_level, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        input.is_public ? null : user.id,
        !!input.is_public,
        tag,
        input.title ?? tag,
        input.description ?? '',
        body,
        input.department ?? user.department,
        input.client_label ?? null,
        (validation as ValidationResult).risk_level,
        user.id,
      ],
    );
    const q = res.rows[0] as QueryRow;
    await tx(
      `INSERT INTO query_versions (query_id, body_snapshot, tag_snapshot, title_snapshot, risk_level, changed_by, change_source)
       VALUES ($1,$2,$3,$4,$5,$6,'manual')`,
      [q.id, body, tag, q.title, q.risk_level, user.id],
    );
    await syncParams(tx, q.id, body);
    return q;
  });
  created.params = await loadParams(created.id);
  return { query: created, validation: validation as ValidationResult };
}

/** Clone a public query into the user's private dictionary (§2.1). */
export async function cloneQuery(publicId: number, user: User): Promise<QueryRow> {
  const { rows } = await query<QueryRow>('SELECT * FROM queries WHERE id = $1 AND is_public', [publicId]);
  const src = rows[0];
  if (!src) throw new HttpError(404, 'Public query not found');

  return withTx(async (tx) => {
    let tag = src.tag;
    let n = 1;
    while (true) {
      const clash = await tx('SELECT id FROM queries WHERE NOT is_public AND owner_id = $1 AND lower(tag) = lower($2)', [user.id, tag]);
      if (clash.rows.length === 0) break;
      tag = `${src.tag}-${++n}`;
    }
    const res = await tx(
      `INSERT INTO queries (owner_id, is_public, source_query_id, source_body_snapshot, tag, title, description, body, department, client_label, risk_level, updated_by)
       VALUES ($1, FALSE, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $1) RETURNING *`,
      [user.id, src.id, src.body, tag, src.title, src.description, src.body, src.department, src.risk_level],
    );
    const q = res.rows[0] as QueryRow;
    await tx(
      `INSERT INTO query_params (query_id, name, data_type, default_value, enum_options, label, sort)
       SELECT $1, name, data_type, default_value, enum_options, label, sort FROM query_params WHERE query_id = $2`,
      [q.id, src.id],
    );
    await tx(
      `INSERT INTO query_versions (query_id, body_snapshot, tag_snapshot, title_snapshot, risk_level, changed_by, change_source)
       VALUES ($1,$2,$3,$4,$5,$6,'manual')`,
      [q.id, q.body, q.tag, q.title, q.risk_level, user.id],
    );
    return q;
  });
}

export function workflowRisk(steps: WorkflowStepRow[]): RiskLevel {
  const order: RiskLevel[] = ['safe', 'scoped_write', 'high_risk'];
  let max: RiskLevel = 'safe';
  for (const s of steps) {
    const r = (s.query?.risk_level ?? 'safe') as RiskLevel;
    if (order.indexOf(r) > order.indexOf(max)) max = r;
  }
  return max;
}

export async function loadWorkflow(id: number, user: User): Promise<WorkflowRow> {
  const { rows } = await query<WorkflowRow>(
    `SELECT w.*, u.name AS owner_name,
            EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = $2 AND f.item_type = 'workflow' AND f.item_id = w.id) AS favorited
     FROM workflows w LEFT JOIN users u ON u.id = w.owner_id WHERE w.id = $1`,
    [id, user.id],
  );
  const wf = rows[0];
  if (!wf) throw new HttpError(404, 'Workflow not found');
  if (!wf.is_public && wf.owner_id !== user.id) throw new HttpError(403, 'This workflow belongs to another user’s private dictionary.');
  const steps = await query<WorkflowStepRow & { q: any }>(
    `SELECT s.*, row_to_json(q) AS q FROM workflow_steps s JOIN queries q ON q.id = s.query_id
     WHERE s.workflow_id = $1 ORDER BY s.step_order`,
    [id],
  );
  // Load params for every step query in one round trip (avoids N+1)
  const paramRows = await query<QueryParamDef & { query_id: number }>(
    `SELECT query_id, name, data_type, default_value, enum_options, label
     FROM query_params WHERE query_id = ANY($1::int[]) ORDER BY sort, name`,
    [steps.rows.map((s) => s.query_id)],
  );
  const paramsByQuery = new Map<number, QueryParamDef[]>();
  for (const p of paramRows.rows) {
    const { query_id, ...def } = p;
    if (!paramsByQuery.has(query_id)) paramsByQuery.set(query_id, []);
    paramsByQuery.get(query_id)!.push(def);
  }
  wf.steps = steps.rows.map((s) => {
    const step: WorkflowStepRow = { ...s, query: s.q as QueryRow };
    step.query!.params = paramsByQuery.get(s.query_id) ?? [];
    return step;
  });
  wf.risk_level = workflowRisk(wf.steps);
  return wf;
}

export async function notify(userId: number, kind: string, payload: Record<string, unknown>) {
  await query('INSERT INTO notifications (user_id, kind, payload) VALUES ($1,$2,$3)', [userId, kind, JSON.stringify(payload)]);
}
