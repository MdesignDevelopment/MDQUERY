import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';
import { isCuratorOrAdmin } from '@/lib/auth';
import { HttpError } from '@/lib/store';

/**
 * Query/workflow categories — a lightweight, user-manageable taxonomy
 * mirroring the public/private split of the dictionaries themselves.
 */
export const GET = handler(async (req, user) => {
  const scope = new URL(req.url).searchParams.get('scope') ?? 'all'; // private | public | all
  // $1 (user.id) is only referenced by the private/all branches — passing it
  // for the public-only query trips Postgres's bind protocol ("supplies 1
  // parameters, but prepared statement requires 0"), so keep values in sync.
  let where: string;
  let values: unknown[];
  if (scope === 'private') { where = 'NOT is_public AND owner_id = $1'; values = [user.id]; }
  else if (scope === 'public') { where = 'is_public'; values = []; }
  else { where = '(is_public OR owner_id = $1)'; values = [user.id]; }
  const { rows } = await query(
    `SELECT id, owner_id, is_public, name, created_at,
            (SELECT count(*)::int FROM queries q WHERE q.category_id = c.id) AS query_count,
            (SELECT count(*)::int FROM workflows w WHERE w.category_id = c.id) AS workflow_count
     FROM categories c WHERE ${where} ORDER BY is_public DESC, lower(name)`,
    values,
  );
  return json({ categories: rows });
});

function validateCategoryName(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim() === '') return 'Category name is required.';
  if (name.trim().length > 60) return 'Category name must be 60 characters or fewer.';
  return null;
}

export const POST = handler(async (req, user) => {
  const { name, is_public } = await req.json();
  const nameError = validateCategoryName(name);
  if (nameError) throw new HttpError(400, nameError);
  if (is_public && !isCuratorOrAdmin(user)) {
    throw new HttpError(403, 'Only curators/admins create public categories.');
  }
  const trimmed = (name as string).trim();
  const clash = is_public
    ? await query('SELECT id FROM categories WHERE is_public AND lower(name) = lower($1)', [trimmed])
    : await query('SELECT id FROM categories WHERE NOT is_public AND owner_id = $1 AND lower(name) = lower($2)', [user.id, trimmed]);
  if (clash.rows.length > 0) throw new HttpError(409, `A ${is_public ? 'public' : 'private'} category named "${trimmed}" already exists.`);

  const { rows } = await query(
    'INSERT INTO categories (owner_id, is_public, name) VALUES ($1, $2, $3) RETURNING *',
    [is_public ? null : user.id, !!is_public, trimmed],
  );
  return json({ category: rows[0] }, 201);
});
