import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';
import { canReview } from '@/lib/auth';
import { HttpError, loadQuery, loadWorkflow } from '@/lib/store';
import { validateSql } from '@/lib/validation';
import { validateTag } from '@/lib/params';

export const GET = handler(async (req, user) => {
  const filter = new URL(req.url).searchParams.get('filter') ?? 'mine';
  if (filter === 'queue' && !canReview(user)) throw new HttpError(403, 'Not a reviewer.');
  const where = filter === 'queue' ? `r.status = 'pending'` : `r.requested_by = $1`;
  const values = filter === 'queue' ? [] : [user.id];
  const { rows } = await query(
    `SELECT r.*, ru.name AS requested_by_name, vu.name AS reviewed_by_name
     FROM review_requests r
     JOIN users ru ON ru.id = r.requested_by
     LEFT JOIN users vu ON vu.id = r.reviewed_by
     WHERE ${where}
     ORDER BY r.created_at DESC LIMIT 200`,
    values,
  );
  return json({ reviews: rows });
});

/**
 * Create a promotion or public-update proposal (§2.1). Never publishes
 * directly — a peer reviewer or curator/admin must approve.
 */
export const POST = handler(async (req, user) => {
  const { item_type, item_id, request_type, target_public_id, proposed: proposedIn, parent_request_id } = await req.json();

  if (!['query', 'workflow'].includes(item_type)) throw new HttpError(400, 'Bad item_type');
  if (!['new_promotion', 'update'].includes(request_type)) throw new HttpError(400, 'Bad request_type');
  if (item_type === 'workflow' && request_type === 'update') {
    throw new HttpError(400, 'Editing an already-public workflow via proposal is not in v1 — ask a curator to edit it directly.');
  }

  let proposed = proposedIn;
  if (item_type === 'query') {
    if (!proposed) {
      const q = await loadQuery(item_id, user);
      proposed = { tag: q.tag, title: q.title, description: q.description, body: q.body, department: q.department };
    }
    const tagError = validateTag(proposed.tag);
    if (tagError) throw new HttpError(400, tagError);
    const v = validateSql(proposed.body ?? '');
    if (!v.ok) throw new HttpError(422, 'Proposed query has syntax errors — fix them before submitting for review.', { validation: v });
    proposed.validation = v; // reviewers see static validation results alongside the diff
    if (request_type === 'update') {
      const { rows } = await query('SELECT id, body FROM queries WHERE id = $1 AND is_public', [target_public_id]);
      if (!rows[0]) throw new HttpError(404, 'Target public query not found');
    } else {
      const clash = await query('SELECT id FROM queries WHERE is_public AND lower(tag) = lower($1)', [proposed.tag]);
      if (clash.rows.length > 0) throw new HttpError(409, `Public tag "${proposed.tag}" already exists — rename before promoting.`);
    }
  } else {
    const wf = await loadWorkflow(item_id, user);
    if (wf.owner_id !== user.id) throw new HttpError(403, 'You can only promote your own workflows.');
    proposed = {
      tag: wf.tag, title: wf.title, description: wf.description,
      steps: wf.steps!.map((s) => ({
        step_order: s.step_order, note: s.note, param_bindings: s.param_bindings,
        query: { id: s.query!.id, tag: s.query!.tag, title: s.query!.title, description: s.query!.description, body: s.query!.body, department: s.query!.department, risk_level: s.query!.risk_level, params: s.query!.params ?? [] },
      })),
    };
    const tagError = validateTag(proposed.tag);
    if (tagError) throw new HttpError(400, tagError);
  }

  const { rows } = await query(
    `INSERT INTO review_requests (item_type, item_id, target_public_id, request_type, proposed, requested_by, parent_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [item_type, item_id, target_public_id ?? null, request_type, JSON.stringify(proposed), user.id, parent_request_id ?? null],
  );
  return json({ review: rows[0] }, 201);
});
