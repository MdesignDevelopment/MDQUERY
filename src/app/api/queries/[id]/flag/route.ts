import { handler, json, idParam } from '@/lib/api';
import { query } from '@/lib/db';
import { isCuratorOrAdmin } from '@/lib/auth';
import { HttpError } from '@/lib/store';

/**
 * "Possibly stale" flag on public entries (§2.1). Any user can raise it;
 * curators/admins resolve it (dismiss with note — v1 resolution model).
 */
export const POST = handler(async (req, user, params) => {
  const id = idParam(params);
  const { action, note } = await req.json();
  const { rows } = await query('SELECT id, is_public, tag FROM queries WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'Query not found');
  if (!rows[0].is_public) throw new HttpError(400, 'Stale flags only apply to public entries.');

  if (action === 'flag') {
    if (!note?.trim()) throw new HttpError(400, 'A short note is required (what looks stale, and why).');
    await query('UPDATE queries SET flagged_stale = TRUE, stale_note = $1 WHERE id = $2', [`${note.trim()} — flagged by ${user.name}`, id]);
    return json({ ok: true });
  }
  if (action === 'resolve') {
    if (!isCuratorOrAdmin(user)) throw new HttpError(403, 'Only curators/admins resolve stale flags.');
    await query('UPDATE queries SET flagged_stale = FALSE, stale_note = NULL WHERE id = $1', [id]);
    return json({ ok: true });
  }
  throw new HttpError(400, 'action must be "flag" or "resolve"');
});
