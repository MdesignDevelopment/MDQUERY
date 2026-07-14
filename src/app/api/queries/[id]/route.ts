import { handler, json, idParam } from '@/lib/api';
import { query } from '@/lib/db';
import { HttpError, loadQuery, saveQuery } from '@/lib/store';

export const GET = handler(async (_req, user, params) => {
  const id = idParam(params);
  const q = await loadQuery(id, user);

  // Public-source drift check for clones (§2.1 "Public version updated — review changes?")
  let source_update: { source_id: number; source_body: string } | null = null;
  if (q.source_query_id && q.source_body_snapshot != null) {
    const { rows } = await query('SELECT id, body FROM queries WHERE id = $1 AND is_public', [q.source_query_id]);
    if (rows[0] && rows[0].body !== q.source_body_snapshot) {
      source_update = { source_id: rows[0].id, source_body: rows[0].body };
    }
  }
  return json({ query: q, source_update });
});

export const PUT = handler(async (req, user, params) => {
  const id = idParam(params);
  const input = await req.json();
  const result = await saveQuery(id, user, input);
  return json(result);
});

export const DELETE = handler(async (_req, user, params) => {
  const id = idParam(params);
  const q = await loadQuery(id, user);
  if (q.is_public) {
    if (user.role !== 'curator' && user.role !== 'admin') throw new HttpError(403, 'Only curators/admins can unpublish public entries.');
  } else if (q.owner_id !== user.id) {
    throw new HttpError(403, 'Not your query.');
  }
  await query('DELETE FROM favorites WHERE item_type = $1 AND item_id = $2', ['query', id]);
  await query('DELETE FROM queries WHERE id = $1', [id]);
  return json({ ok: true });
});
