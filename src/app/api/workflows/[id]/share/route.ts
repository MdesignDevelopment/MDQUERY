import { handler, json, idParam } from '@/lib/api';
import { query } from '@/lib/db';
import { HttpError, loadWorkflow, notify } from '@/lib/store';

export const POST = handler(async (req, user, params) => {
  const id = idParam(params);
  const wf = await loadWorkflow(id, user);
  if (wf.is_public) throw new HttpError(400, 'Public workflows don’t need sharing.');
  if (wf.owner_id !== user.id) throw new HttpError(403, 'You can only share your own workflows.');
  const { to_user_ids } = await req.json();
  if (!Array.isArray(to_user_ids) || to_user_ids.length === 0) throw new HttpError(400, 'Pick at least one recipient.');

  const snapshot = {
    tag: wf.tag, title: wf.title, description: wf.description, client_label: wf.client_label,
    steps: wf.steps!.map((s) => ({
      step_order: s.step_order, note: s.note, param_bindings: s.param_bindings,
      query: {
        id: s.query!.id, tag: s.query!.tag, title: s.query!.title, description: s.query!.description,
        body: s.query!.body, department: s.query!.department, client_label: s.query!.client_label,
        risk_level: s.query!.risk_level, params: s.query!.params ?? [],
      },
    })),
  };
  const created: number[] = [];
  for (const to of to_user_ids) {
    if (to === user.id) continue;
    const { rows } = await query(
      `INSERT INTO share_events (item_type, source_item_id, snapshot, from_user_id, to_user_id)
       VALUES ('workflow', $1, $2, $3, $4) RETURNING id`,
      [id, JSON.stringify(snapshot), user.id, to],
    );
    created.push(rows[0].id);
    await notify(to, 'share', { share_id: rows[0].id, from: user.name, tag: wf.tag, item_type: 'workflow' });
  }
  return json({ ok: true, shares: created }, 201);
});
