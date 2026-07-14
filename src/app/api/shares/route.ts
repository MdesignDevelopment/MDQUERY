import { handler, json } from '@/lib/api';
import { query } from '@/lib/db';

export const GET = handler(async (_req, user) => {
  const { rows } = await query(
    `SELECT s.*, fu.name AS from_name
     FROM share_events s JOIN users fu ON fu.id = s.from_user_id
     WHERE s.to_user_id = $1
     ORDER BY s.shared_at DESC LIMIT 100`,
    [user.id],
  );
  return json({ shares: rows });
});
