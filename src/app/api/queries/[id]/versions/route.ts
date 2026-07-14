import { handler, json, idParam } from '@/lib/api';
import { query } from '@/lib/db';
import { HttpError, loadQuery, saveQuery } from '@/lib/store';

/**
 * Version list — metadata only. Body snapshots can be large and number in the
 * hundreds for long-lived queries, so each body is lazy-loaded via
 * /versions/[vid] only when the user expands that version.
 */
export const GET = handler(async (_req, user, params) => {
  const id = idParam(params);
  await loadQuery(id, user); // access check
  const { rows } = await query(
    `SELECT v.id, v.tag_snapshot, v.title_snapshot, v.risk_level, v.changed_at, v.change_source,
            length(v.body_snapshot) AS body_size,
            u.name AS changed_by_name
     FROM query_versions v LEFT JOIN users u ON u.id = v.changed_by
     WHERE v.query_id = $1 ORDER BY v.changed_at DESC, v.id DESC`,
    [id],
  );
  return json({ versions: rows });
});

/** Restore a version: goes through the same save pipeline (validation, audit). */
export const POST = handler(async (req, user, params) => {
  const id = idParam(params);
  const { version_id, confirmations } = await req.json();
  const { rows } = await query('SELECT * FROM query_versions WHERE id = $1 AND query_id = $2', [version_id, id]);
  const v = rows[0];
  if (!v) throw new HttpError(404, 'Version not found');
  const result = await saveQuery(id, user, {
    body: v.body_snapshot,
    confirmations: confirmations ?? [],
    change_source: 'restore',
  });
  return json(result);
});
