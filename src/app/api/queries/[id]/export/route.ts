import { handler, idParam } from '@/lib/api';
import { exportQuery, type FormatTarget } from '@/lib/export';
import { loadQuery } from '@/lib/store';

export const GET = handler(async (req, user, params) => {
  const id = idParam(params);
  const q = await loadQuery(id, user);
  const url = new URL(req.url);
  const target = (url.searchParams.get('target') as FormatTarget) ?? 'sqldev';
  const valuesRaw = url.searchParams.get('values');
  const values = valuesRaw ? (JSON.parse(valuesRaw) as Record<string, string>) : undefined;
  const sql = exportQuery(q, target, values);
  return new Response(sql, {
    headers: {
      'content-type': 'application/sql; charset=utf-8',
      'content-disposition': `attachment; filename="${q.tag}.sql"`,
    },
  });
});
