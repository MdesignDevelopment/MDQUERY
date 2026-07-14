import { handler, idParam } from '@/lib/api';
import { exportWorkflow, type FormatTarget } from '@/lib/export';
import { loadWorkflow } from '@/lib/store';

export const GET = handler(async (req, user, params) => {
  const wf = await loadWorkflow(idParam(params), user);
  const url = new URL(req.url);
  const target = (url.searchParams.get('target') as FormatTarget) ?? 'sqldev';
  const valuesRaw = url.searchParams.get('values'); // { "<step_order>": { "param": "value" } }
  const values = valuesRaw ? JSON.parse(valuesRaw) : undefined;
  const sql = exportWorkflow(wf, target, values);
  return new Response(sql, {
    headers: {
      'content-type': 'application/sql; charset=utf-8',
      'content-disposition': `attachment; filename="${wf.tag}.sql"`,
    },
  });
});
