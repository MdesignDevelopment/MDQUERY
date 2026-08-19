import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';
import { HttpError } from '@/lib/store';

const ROLES = ['user', 'lead', 'curator', 'admin'];

function requireAdmin(role: string) {
  if (role !== 'admin') throw new HttpError(403, 'Admin only.');
}

export const GET = handler(async (_req, user) => {
  requireAdmin(user.role);
  const { rows } = await query(
    `SELECT u.id, u.email, u.name, u.role, u.department, u.active,
            (SELECT count(*)::int FROM queries q WHERE q.owner_id = u.id) AS query_count,
            (SELECT count(*)::int FROM workflows w WHERE w.owner_id = u.id) AS workflow_count
     FROM users u ORDER BY u.active DESC, u.name`,
  );
  return json({ users: rows });
});

// New accounts are pre-provisioned with no password: the person authenticates
// exclusively via "Sign in with MD Portal" the first time they sign in, which
// links to this row by email (see src/app/api/auth/mdportal/callback/route.ts).
export const POST = handler(async (req, user) => {
  requireAdmin(user.role);
  const { name, email, role, department } = await req.json();
  if (!name?.trim() || !email?.trim()) throw new HttpError(400, 'Name and email are required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) throw new HttpError(400, 'That does not look like a valid email address.');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role.');
  const clash = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email.trim()]);
  if (clash.rows.length > 0) throw new HttpError(409, 'A user with that email already exists.');
  const { rows } = await query(
    `INSERT INTO users (name, email, role, department)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, role, department, active`,
    [name.trim(), email.trim().toLowerCase(), role, department?.trim() || 'Support'],
  );
  return json({ user: rows[0] }, 201);
});
