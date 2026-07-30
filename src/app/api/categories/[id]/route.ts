import { handler, json, idParam } from '@/lib/api';
import { query } from '@/lib/db';
import { isCuratorOrAdmin } from '@/lib/auth';
import { HttpError } from '@/lib/store';

/** Delete a category. Queries/workflows referencing it become uncategorized (ON DELETE SET NULL) — never cascade-deleted. */
export const DELETE = handler(async (_req, user, params) => {
  const id = idParam(params);
  const { rows } = await query('SELECT * FROM categories WHERE id = $1', [id]);
  const cat = rows[0];
  if (!cat) throw new HttpError(404, 'Category not found');

  if (cat.is_public) {
    if (!isCuratorOrAdmin(user)) throw new HttpError(403, 'Only curators/admins delete public categories.');
  } else if (cat.owner_id !== user.id) {
    throw new HttpError(403, 'Not your category.');
  }
  await query('DELETE FROM categories WHERE id = $1', [id]);
  return json({ ok: true });
});
