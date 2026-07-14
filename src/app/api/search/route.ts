import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';

/** Global typeahead (§2.8): tag/title/body/department/author/client. */
export const GET = handler(async (req, user) => {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (!q) return json({ results: [] });
  const like = `%${q}%`;
  const { rows: queries } = await query(
    `SELECT qq.id, qq.tag, qq.title, qq.is_public, qq.risk_level, qq.client_label, 'query' AS kind
     FROM queries qq LEFT JOIN users u ON u.id = qq.owner_id
     WHERE (qq.is_public OR qq.owner_id = $1)
       AND (qq.tag ILIKE $2 OR qq.title ILIKE $2 OR qq.body ILIKE $2 OR qq.description ILIKE $2
            OR qq.department ILIKE $2 OR qq.client_label ILIKE $2 OR u.name ILIKE $2)
     ORDER BY qq.updated_at DESC LIMIT 12`,
    [user.id, like],
  );
  const { rows: workflows } = await query(
    `SELECT w.id, w.tag, w.title, w.is_public, w.client_label, 'workflow' AS kind
     FROM workflows w
     WHERE (w.is_public OR w.owner_id = $1)
       AND (w.tag ILIKE $2 OR w.title ILIKE $2 OR w.description ILIKE $2 OR w.client_label ILIKE $2)
     ORDER BY w.updated_at DESC LIMIT 8`,
    [user.id, like],
  );
  return json({ results: [...queries, ...workflows] });
});
