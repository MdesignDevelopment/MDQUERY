import { handler, json, idParam } from '@/lib/api';
import { query } from '@/lib/db';
import { HttpError, loadQuery } from '@/lib/store';

/** Single version body — fetched lazily when a version is expanded in the History dialog. */
export const GET = handler(async (_req, user, params) => {
  const id = idParam(params);
  const vid = Number(params.vid);
  if (!Number.isInteger(vid)) throw new HttpError(400, 'Invalid version id');
  await loadQuery(id, user); // access check
  const { rows } = await query(
    'SELECT id, body_snapshot FROM query_versions WHERE id = $1 AND query_id = $2',
    [vid, id],
  );
  if (!rows[0]) throw new HttpError(404, 'Version not found');
  return json({ id: rows[0].id, body_snapshot: rows[0].body_snapshot });
});
