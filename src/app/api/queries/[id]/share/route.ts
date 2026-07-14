import { handler, json, idParam } from '@/lib/api';
import { query } from '@/lib/db';
import { HttpError, loadQuery, notify } from '@/lib/store';

/** Person-to-person share (§2.2): snapshot now, copy on accept. */
export const POST = handler(async (req, user, params) => {
  const id = idParam(params);
  const q = await loadQuery(id, user);
  if (q.is_public) throw new HttpError(400, 'Public entries don’t need sharing — anyone can clone them.');
  if (q.owner_id !== user.id) throw new HttpError(403, 'You can only share your own queries.');

  const { to_user_ids } = await req.json();
  if (!Array.isArray(to_user_ids) || to_user_ids.length === 0) throw new HttpError(400, 'Pick at least one recipient.');

  const snapshot = {
    tag: q.tag, title: q.title, description: q.description, body: q.body,
    department: q.department, client_label: q.client_label, risk_level: q.risk_level,
    params: q.params ?? [],
  };
  const created: number[] = [];
  for (const to of to_user_ids) {
    if (to === user.id) continue;
    const { rows } = await query(
      `INSERT INTO share_events (item_type, source_item_id, snapshot, from_user_id, to_user_id)
       VALUES ('query', $1, $2, $3, $4) RETURNING id`,
      [id, JSON.stringify(snapshot), user.id, to],
    );
    created.push(rows[0].id);
    await notify(to, 'share', { share_id: rows[0].id, from: user.name, tag: q.tag, item_type: 'query' });
  }
  return json({ ok: true, shares: created }, 201);
});
