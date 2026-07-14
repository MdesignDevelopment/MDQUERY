import { handler, json } from '@/lib/api';
import { validateSql } from '@/lib/validation';
import { detectBinds } from '@/lib/params';

/** Live validation while typing (debounced client-side). Pure text analysis. */
export const POST = handler(async (req) => {
  const { body } = await req.json();
  const validation = validateSql(String(body ?? ''));
  return json({ validation, binds: detectBinds(String(body ?? '')) });
});
