import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';
import { createQuery } from '@/lib/store';

export const GET = handler(async (req, user) => {
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? 'private'; // private | public
  const q = url.searchParams.get('q')?.trim() ?? '';
  const department = url.searchParams.get('department');
  const client = url.searchParams.get('client');
  const category = url.searchParams.get('category');
  const sort = url.searchParams.get('sort') ?? 'recent';

  const where: string[] = [];
  const values: unknown[] = [user.id];
  if (scope === 'public') where.push('qq.is_public');
  else where.push(`NOT qq.is_public AND qq.owner_id = $1`);
  if (q) {
    values.push(`%${q}%`);
    where.push(`(qq.tag ILIKE $${values.length} OR qq.title ILIKE $${values.length} OR qq.description ILIKE $${values.length} OR qq.body ILIKE $${values.length})`);
  }
  if (department) {
    values.push(department);
    where.push(`qq.department = $${values.length}`);
  }
  if (client) {
    values.push(client);
    where.push(`qq.client_label = $${values.length}`);
  }
  if (category) {
    values.push(Number(category));
    where.push(`qq.category_id = $${values.length}`);
  }
  const order =
    sort === 'popular'
      ? 'fav_count DESC, qq.updated_at DESC'
      : sort === 'tag'
        ? 'lower(qq.tag) ASC'
        : 'qq.updated_at DESC';

  const { rows } = await query(
    `SELECT qq.id, qq.tag, qq.title, qq.department, qq.client_label, qq.category_id, c.name AS category_name, qq.risk_level,
            qq.is_public, qq.flagged_stale, qq.updated_at, qq.source_query_id, qq.shared_from,
            u.name AS owner_name,
            (SELECT count(*)::int FROM favorites f2 WHERE f2.item_type = 'query' AND f2.item_id = qq.id) AS fav_count,
            EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = $1 AND f.item_type = 'query' AND f.item_id = qq.id) AS favorited
     FROM queries qq LEFT JOIN users u ON u.id = qq.owner_id LEFT JOIN categories c ON c.id = qq.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}
     LIMIT 500`,
    values,
  );
  return json({ queries: rows });
});

export const POST = handler(async (req, user) => {
  const input = await req.json();
  const result = await createQuery(user, input);
  return json(result, 201);
});
