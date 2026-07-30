import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';
import { HttpError, resolveCategoryId } from '@/lib/store';
import { validateTag } from '@/lib/params';

export const GET = handler(async (req, user) => {
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? 'private';
  const q = url.searchParams.get('q')?.trim() ?? '';
  const category = url.searchParams.get('category');
  const where: string[] = [];
  const values: unknown[] = [user.id];
  if (scope === 'public') where.push('w.is_public');
  else where.push('NOT w.is_public AND w.owner_id = $1');
  if (q) {
    values.push(`%${q}%`);
    where.push(`(w.tag ILIKE $${values.length} OR w.title ILIKE $${values.length} OR w.description ILIKE $${values.length})`);
  }
  if (category) {
    values.push(Number(category));
    where.push(`w.category_id = $${values.length}`);
  }
  const { rows } = await query(
    `SELECT w.id, w.tag, w.title, w.client_label, w.category_id, c.name AS category_name, w.is_public, w.flagged_stale, w.updated_at, w.shared_from,
            u.name AS owner_name,
            (SELECT count(*)::int FROM workflow_steps s WHERE s.workflow_id = w.id) AS step_count,
            (SELECT COALESCE(max(CASE q2.risk_level WHEN 'high_risk' THEN 2 WHEN 'scoped_write' THEN 1 ELSE 0 END), 0)
             FROM workflow_steps s2 JOIN queries q2 ON q2.id = s2.query_id WHERE s2.workflow_id = w.id) AS risk_rank,
            EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = $1 AND f.item_type = 'workflow' AND f.item_id = w.id) AS favorited
     FROM workflows w LEFT JOIN users u ON u.id = w.owner_id LEFT JOIN categories c ON c.id = w.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY w.updated_at DESC LIMIT 500`,
    values,
  );
  const riskName = ['safe', 'scoped_write', 'high_risk'];
  return json({ workflows: rows.map((r: any) => ({ ...r, risk_level: riskName[r.risk_rank] ?? 'safe' })) });
});

export const POST = handler(async (req, user) => {
  const { tag, title, description, client_label, category_id } = await req.json();
  const t = tag ?? 'untitled-workflow';
  const tagError = validateTag(t);
  if (tagError) throw new HttpError(400, tagError);
  const categoryId = await resolveCategoryId(category_id, false, user);
  const clash = await query('SELECT id FROM workflows WHERE NOT is_public AND owner_id = $1 AND lower(tag) = lower($2)', [user.id, t]);
  if (clash.rows.length > 0) throw new HttpError(409, `Workflow tag "${t}" is already in use.`);
  const { rows } = await query(
    `INSERT INTO workflows (owner_id, is_public, tag, title, description, client_label, category_id)
     VALUES ($1, FALSE, $2, $3, $4, $5, $6) RETURNING *`,
    [user.id, t, title ?? t, description ?? '', client_label ?? null, categoryId ?? null],
  );
  return json({ workflow: rows[0] }, 201);
});
