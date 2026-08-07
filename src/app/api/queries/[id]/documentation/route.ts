import { handler, json, idParam } from '@/lib/api';
import { saveQueryDocumentation } from '@/lib/store';

/** Documentation saves independently of the SQL body — see saveQueryDocumentation for the permission rule. */
export const PUT = handler(async (req, user, params) => {
  const id = idParam(params);
  const input = await req.json();
  const q = await saveQueryDocumentation(id, user, input.documentation ?? '');
  return json({ query: q });
});
