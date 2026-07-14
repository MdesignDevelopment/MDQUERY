import { handler, json, idParam } from '@/lib/api';
import { query } from '@/lib/db';
import { HttpError, loadQuery } from '@/lib/store';

/** After the user reviews public-source drift on a clone, re-baseline the snapshot. */
export const POST = handler(async (_req, user, params) => {
  const id = idParam(params);
  const q = await loadQuery(id, user);
  if (q.owner_id !== user.id) throw new HttpError(403, 'Not your query.');
  if (!q.source_query_id) throw new HttpError(400, 'Query has no public source.');
  await query(
    'UPDATE queries SET source_body_snapshot = (SELECT body FROM queries s WHERE s.id = $1) WHERE id = $2',
    [q.source_query_id, id],
  );
  return json({ ok: true });
});
