import { handler, json, idParam } from '@/lib/api';
import { query } from '@/lib/db';
import { invalidateUserCache } from '@/lib/auth';
import { HttpError } from '@/lib/store';

const ROLES = ['user', 'lead', 'curator', 'admin'];

/**
 * Admin user management. Guards: you cannot demote or deactivate yourself,
 * and the platform must always keep at least one active admin.
 */
export const PUT = handler(async (req, user, params) => {
  if (user.role !== 'admin') throw new HttpError(403, 'Admin only.');
  const id = idParam(params);
  const { name, role, department, active } = await req.json();

  const { rows } = await query('SELECT id, role, active FROM users WHERE id = $1', [id]);
  const target = rows[0];
  if (!target) throw new HttpError(404, 'User not found.');

  const nextRole = role ?? target.role;
  const nextActive = active !== undefined ? !!active : target.active;
  if (!ROLES.includes(nextRole)) throw new HttpError(400, 'Invalid role.');

  if (id === user.id && (nextRole !== 'admin' || !nextActive)) {
    throw new HttpError(400, 'You cannot demote or deactivate your own account.');
  }
  // last-active-admin protection
  if (target.role === 'admin' && target.active && (nextRole !== 'admin' || !nextActive)) {
    const admins = await query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1`, [id]);
    if (admins.rows[0].n === 0) throw new HttpError(400, 'This is the last active admin — assign another admin first.');
  }

  const updated = await query(
    `UPDATE users SET
       name = COALESCE($1, name),
       role = $2,
       department = COALESCE($3, department),
       active = $4
     WHERE id = $5
     RETURNING id, email, name, role, department, active`,
    [name?.trim() || null, nextRole, department?.trim() || null, nextActive, id],
  );
  invalidateUserCache(id); // role/active changes apply on the target's very next request
  return json({ user: updated.rows[0] });
});
