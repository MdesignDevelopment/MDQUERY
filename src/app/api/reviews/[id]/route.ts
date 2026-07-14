import { handler, json, idParam } from '@/lib/api';
import { query, withTx } from '@/lib/db';
import { canReview } from '@/lib/auth';
import { HttpError, notify } from '@/lib/store';

export const GET = handler(async (_req, user, params) => {
  const id = idParam(params);
  const { rows } = await query(
    `SELECT r.*, ru.name AS requested_by_name, vu.name AS reviewed_by_name
     FROM review_requests r JOIN users ru ON ru.id = r.requested_by LEFT JOIN users vu ON vu.id = r.reviewed_by
     WHERE r.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Review request not found');
  if (r.requested_by !== user.id && !canReview(user)) throw new HttpError(403, 'Not your request.');
  // thread: walk parent chain
  const thread: any[] = [];
  let cursor = r.parent_request_id;
  while (cursor) {
    const prev = await query(
      `SELECT r.*, ru.name AS requested_by_name, vu.name AS reviewed_by_name
       FROM review_requests r JOIN users ru ON ru.id = r.requested_by LEFT JOIN users vu ON vu.id = r.reviewed_by WHERE r.id = $1`,
      [cursor],
    );
    if (!prev.rows[0]) break;
    thread.push(prev.rows[0]);
    cursor = prev.rows[0].parent_request_id;
  }
  // current public body for update diffs
  let current_public_body: string | null = null;
  if (r.request_type === 'update' && r.target_public_id) {
    const cur = await query('SELECT body FROM queries WHERE id = $1', [r.target_public_id]);
    current_public_body = cur.rows[0]?.body ?? null;
  }
  return json({ review: r, thread, current_public_body });
});

/**
 * Approve / reject (§2.1). Peer review rules enforced server-side:
 * reviewers are curators/admins or Support engineers, and a requester can
 * never approve their own request — admins included.
 */
export const POST = handler(async (req, user, params) => {
  const id = idParam(params);
  const { action, notes } = await req.json();
  if (!['approve', 'reject'].includes(action)) throw new HttpError(400, 'action must be approve or reject');
  if (!canReview(user)) throw new HttpError(403, 'You are not a reviewer (curator/admin or Support engineer).');

  const { rows } = await query('SELECT * FROM review_requests WHERE id = $1', [id]);
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Review request not found');
  if (r.status !== 'pending') throw new HttpError(409, 'Request already resolved.');
  if (r.requested_by === user.id) throw new HttpError(403, 'You cannot approve or reject your own request — peer review required.');

  if (action === 'reject') {
    if (!notes?.trim()) throw new HttpError(400, 'Rejection requires notes so the requester can revise and resubmit.');
    await query(
      `UPDATE review_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_notes = $2 WHERE id = $3`,
      [user.id, notes.trim(), id],
    );
    await notify(r.requested_by, 'review_rejected', { review_id: id, tag: r.proposed.tag, by: user.name, notes: notes.trim() });
    return json({ ok: true, status: 'rejected' });
  }

  // approve → publish
  const p = r.proposed;
  await withTx(async (tx) => {
    if (r.item_type === 'query') {
      if (r.request_type === 'new_promotion') {
        const clash = await tx('SELECT id FROM queries WHERE is_public AND lower(tag) = lower($1)', [p.tag]);
        if (clash.rows.length > 0) throw new HttpError(409, `Public tag "${p.tag}" was taken while this request was pending — ask the requester to rename and resubmit.`);
        const res = await tx(
          `INSERT INTO queries (owner_id, is_public, tag, title, description, body, department, risk_level, updated_by)
           VALUES (NULL, TRUE, $1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [p.tag, p.title, p.description ?? '', p.body, p.department ?? null, p.validation?.risk_level ?? 'safe', user.id],
        );
        await tx(
          `INSERT INTO query_params (query_id, name, data_type, default_value, enum_options, label, sort)
           SELECT $1, name, data_type, default_value, enum_options, label, sort FROM query_params WHERE query_id = $2`,
          [res.rows[0].id, r.item_id],
        );
        await tx(
          `INSERT INTO query_versions (query_id, body_snapshot, tag_snapshot, title_snapshot, risk_level, changed_by, change_source)
           VALUES ($1,$2,$3,$4,$5,$6,'review')`,
          [res.rows[0].id, p.body, p.tag, p.title, p.validation?.risk_level ?? 'safe', user.id],
        );
      } else {
        await tx(
          `UPDATE queries SET title = $1, description = $2, body = $3, risk_level = $4, updated_at = now(), updated_by = $5, flagged_stale = FALSE, stale_note = NULL
           WHERE id = $6 AND is_public`,
          [p.title, p.description ?? '', p.body, p.validation?.risk_level ?? 'safe', user.id, r.target_public_id],
        );
        await tx(
          `INSERT INTO query_versions (query_id, body_snapshot, tag_snapshot, title_snapshot, risk_level, changed_by, change_source)
           VALUES ($1,$2,$3,$4,$5,$6,'review')`,
          [r.target_public_id, p.body, p.tag, p.title, p.validation?.risk_level ?? 'safe', user.id],
        );
      }
    } else {
      // workflow promotion: publish step queries first, then the workflow
      const clash = await tx('SELECT id FROM workflows WHERE is_public AND lower(tag) = lower($1)', [p.tag]);
      if (clash.rows.length > 0) throw new HttpError(409, `Public workflow tag "${p.tag}" already exists.`);
      const queryIdMap: Record<number, number> = {};
      for (const step of p.steps as any[]) {
        const sq = step.query;
        let qtag = sq.tag;
        let n = 1;
        while (true) {
          const c = await tx('SELECT id FROM queries WHERE is_public AND lower(tag) = lower($1)', [qtag]);
          if (c.rows.length === 0) break;
          qtag = `${sq.tag}-${++n}`;
        }
        const res = await tx(
          `INSERT INTO queries (owner_id, is_public, tag, title, description, body, department, risk_level, updated_by)
           VALUES (NULL, TRUE, $1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [qtag, sq.title, sq.description ?? '', sq.body, sq.department ?? null, sq.risk_level ?? 'safe', user.id],
        );
        queryIdMap[sq.id] = res.rows[0].id;
        for (const [i, prm] of (sq.params ?? []).entries()) {
          await tx(
            `INSERT INTO query_params (query_id, name, data_type, default_value, enum_options, label, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [res.rows[0].id, prm.name, prm.data_type ?? 'text', prm.default_value, prm.enum_options ? JSON.stringify(prm.enum_options) : null, prm.label, i],
          );
        }
      }
      const wf = await tx(
        `INSERT INTO workflows (owner_id, is_public, tag, title, description) VALUES (NULL, TRUE, $1,$2,$3) RETURNING id`,
        [p.tag, p.title, p.description ?? ''],
      );
      for (const step of p.steps as any[]) {
        await tx(
          `INSERT INTO workflow_steps (workflow_id, query_id, step_order, param_bindings, note) VALUES ($1,$2,$3,$4,$5)`,
          [wf.rows[0].id, queryIdMap[step.query.id], step.step_order, JSON.stringify(step.param_bindings ?? {}), step.note],
        );
      }
    }
    await tx(
      `UPDATE review_requests SET status = 'approved', reviewed_by = $1, reviewed_at = now(), review_notes = $2 WHERE id = $3`,
      [user.id, notes?.trim() || null, id],
    );
  });
  await notify(r.requested_by, 'review_approved', { review_id: id, tag: r.proposed.tag, by: user.name });
  return json({ ok: true, status: 'approved' });
});

/** Resubmit a rejected request — stays linked to the original thread (§2.1). */
export const PUT = handler(async (req, user, params) => {
  const id = idParam(params);
  const { proposed } = await req.json();
  const { rows } = await query('SELECT * FROM review_requests WHERE id = $1', [id]);
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Review request not found');
  if (r.requested_by !== user.id) throw new HttpError(403, 'Only the requester can resubmit.');
  if (r.status !== 'rejected') throw new HttpError(409, 'Only rejected requests can be resubmitted.');

  const newProposed = { ...r.proposed, ...proposed };
  if (r.item_type === 'query' && typeof newProposed.body === 'string') {
    const { validateSql } = await import('@/lib/validation');
    const v = validateSql(newProposed.body);
    if (!v.ok) throw new HttpError(422, 'Revised query has syntax errors.', { validation: v });
    newProposed.validation = v;
  }
  const res = await query(
    `INSERT INTO review_requests (item_type, item_id, target_public_id, request_type, proposed, requested_by, parent_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [r.item_type, r.item_id, r.target_public_id, r.request_type, JSON.stringify(newProposed), user.id, r.id],
  );
  return json({ review: res.rows[0] }, 201);
});
