import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';

/** Colleague picker for sharing (search by name/email). */
export const GET = handler(async (req, user) => {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  const { rows } = await query(
    `SELECT id, name, email, department FROM users
     WHERE id <> $1 AND active AND (name ILIKE $2 OR email ILIKE $2)
     ORDER BY name LIMIT 20`,
    [user.id, `%${q}%`],
  );
  return json({ users: rows });
});
