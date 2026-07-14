import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';

export const GET = handler(async (_req, user) => {
  const { rows } = await query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [user.id],
  );
  const unread = rows.filter((r: any) => !r.read).length;
  return json({ notifications: rows, unread });
});

export const POST = handler(async (_req, user) => {
  await query('UPDATE notifications SET read = TRUE WHERE user_id = $1', [user.id]);
  return json({ ok: true });
});
