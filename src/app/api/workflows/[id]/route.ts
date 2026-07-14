import { handler, json, idParam } from '@/lib/api';
import { query, withTx } from '@/lib/db';
import { HttpError, loadWorkflow } from '@/lib/store';
import { validateTag } from '@/lib/params';

export const GET = handler(async (_req, user, params) => {
  const wf = await loadWorkflow(idParam(params), user);
  return json({ workflow: wf });
});

/** Update meta + full step list (order, query refs, param mappings). */
export const PUT = handler(async (req, user, params) => {
  const id = idParam(params);
  const wf = await loadWorkflow(id, user);
  const editable = wf.is_public ? user.role === 'curator' || user.role === 'admin' : wf.owner_id === user.id;
  if (!editable) throw new HttpError(403, 'Not editable by you.');

  const { tag, title, description, client_label, steps } = await req.json();
  const t = tag ?? wf.tag;
  const tagError = validateTag(t);
  if (tagError) throw new HttpError(400, tagError);

  await withTx(async (tx) => {
    const clash = wf.is_public
      ? await tx('SELECT id FROM workflows WHERE is_public AND lower(tag) = lower($1) AND id <> $2', [t, id])
      : await tx('SELECT id FROM workflows WHERE NOT is_public AND owner_id = $1 AND lower(tag) = lower($2) AND id <> $3', [user.id, t, id]);
    if (clash.rows.length > 0) throw new HttpError(409, `Workflow tag "${t}" is already in use.`);

    await tx(
      `UPDATE workflows SET tag = $1, title = $2, description = $3, client_label = $4, updated_at = now() WHERE id = $5`,
      [t, title ?? wf.title, description ?? wf.description, client_label !== undefined ? client_label : wf.client_label, id],
    );
    if (Array.isArray(steps)) {
      // steps must reference queries the workflow's audience can read
      for (const s of steps) {
        const q = await tx('SELECT id, is_public, owner_id FROM queries WHERE id = $1', [s.query_id]);
        if (!q.rows[0]) throw new HttpError(400, `Step query ${s.query_id} not found.`);
        if (wf.is_public && !q.rows[0].is_public) throw new HttpError(400, 'Public workflows can only reference public queries.');
        if (!wf.is_public && !q.rows[0].is_public && q.rows[0].owner_id !== user.id) throw new HttpError(403, 'Steps must reference public queries or your own.');
      }
      await tx('DELETE FROM workflow_steps WHERE workflow_id = $1', [id]);
      let order = 1;
      for (const s of steps) {
        await tx(
          `INSERT INTO workflow_steps (workflow_id, query_id, step_order, param_bindings, note) VALUES ($1,$2,$3,$4,$5)`,
          [id, s.query_id, order++, JSON.stringify(s.param_bindings ?? {}), s.note ?? null],
        );
      }
    }
  });
  const updated = await loadWorkflow(id, user);
  return json({ workflow: updated });
});

export const DELETE = handler(async (_req, user, params) => {
  const id = idParam(params);
  const wf = await loadWorkflow(id, user);
  const allowed = wf.is_public ? user.role === 'curator' || user.role === 'admin' : wf.owner_id === user.id;
  if (!allowed) throw new HttpError(403, 'Not deletable by you.');
  await query('DELETE FROM favorites WHERE item_type = $1 AND item_id = $2', ['workflow', id]);
  await query('DELETE FROM workflows WHERE id = $1', [id]);
  return json({ ok: true });
});
