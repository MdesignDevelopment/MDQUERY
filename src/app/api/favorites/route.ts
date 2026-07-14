import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';
import { HttpError } from '@/lib/store';

/** All favorited items (queries + workflows) in one round trip. */
export const GET = handler(async (req, user) => {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  const like = `%${q}%`;
  const { rows } = await query(
    `SELECT qq.id, 'query' AS kind, qq.tag, qq.title, qq.department, qq.client_label, qq.risk_level,
            qq.is_public, qq.flagged_stale, qq.shared_from, qq.source_query_id, qq.updated_at,
            NULL::int AS step_count, TRUE AS favorited
     FROM favorites f JOIN queries qq ON qq.id = f.item_id
     WHERE f.user_id = $1 AND f.item_type = 'query' AND (qq.is_public OR qq.owner_id = $1)
       AND ($2 = '' OR qq.tag ILIKE $3 OR qq.title ILIKE $3)
     UNION ALL
     SELECT w.id, 'workflow' AS kind, w.tag, w.title, NULL, w.client_label, NULL,
            w.is_public, w.flagged_stale, w.shared_from, NULL, w.updated_at,
            (SELECT count(*)::int FROM workflow_steps s WHERE s.workflow_id = w.id), TRUE
     FROM favorites f JOIN workflows w ON w.id = f.item_id
     WHERE f.user_id = $1 AND f.item_type = 'workflow' AND (w.is_public OR w.owner_id = $1)
       AND ($2 = '' OR w.tag ILIKE $3 OR w.title ILIKE $3)
     ORDER BY updated_at DESC`,
    [user.id, q, like],
  );
  return json({ items: rows });
});

export const POST = handler(async (req, user) => {
  const { item_type, item_id } = await req.json();
  if (!['query', 'workflow'].includes(item_type) || !Number.isInteger(item_id)) throw new HttpError(400, 'Bad favorite payload');
  const { rows } = await query(
    'DELETE FROM favorites WHERE user_id = $1 AND item_type = $2 AND item_id = $3 RETURNING 1 AS removed',
    [user.id, item_type, item_id],
  );
  if (rows.length === 0) {
    await query('INSERT INTO favorites (user_id, item_type, item_id) VALUES ($1,$2,$3)', [user.id, item_type, item_id]);
    return json({ favorited: true });
  }
  return json({ favorited: false });
});
