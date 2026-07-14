import { handler, json, idParam } from '@/lib/api';
import { cloneQuery } from '@/lib/store';

export const POST = handler(async (_req, user, params) => {
  const q = await cloneQuery(idParam(params), user);
  return json({ query: q }, 201);
});
