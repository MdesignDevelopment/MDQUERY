import { handler, json, idParam } from '@/lib/api';
import { query, withTx } from '@/lib/db';
import { HttpError } from '@/lib/store';
import { validateTag } from '@/lib/params';

/**
 * Accept/dismiss a share (§2.2). Accept materializes an independent copy in
 * the recipient's private dictionary from the share-time snapshot, carrying a
 * shared_from reference. No live sync in either direction afterward.
 */
export const POST = handler(async (req, user, params) => {
  const id = idParam(params);
  const { action, tag_override } = await req.json();
  const { rows } = await query(
    `SELECT s.*, fu.name AS from_name FROM share_events s JOIN users fu ON fu.id = s.from_user_id
     WHERE s.id = $1 AND s.to_user_id = $2`,
    [id, user.id],
  );
  const share = rows[0];
  if (!share) throw new HttpError(404, 'Share not found');
  if (share.status !== 'pending') throw new HttpError(409, 'Share already resolved');

  if (action === 'dismiss') {
    await query(`UPDATE share_events SET status = 'dismissed', resolved_at = now() WHERE id = $1`, [id]);
    return json({ ok: true });
  }
  if (action !== 'accept') throw new HttpError(400, 'action must be "accept" or "dismiss"');

  const snap = share.snapshot;
  let tag: string = tag_override?.trim() || snap.tag;
  const tagError = validateTag(tag);
  if (tagError) throw new HttpError(400, tagError);

  if (share.item_type === 'workflow') {
    const created = await withTx(async (tx) => {
      // Copy each step query first, then the workflow shell
      const queryIdMap: Record<number, number> = {};
      for (const stepSnap of snap.steps as any[]) {
        const sq = stepSnap.query;
        let qtag = sq.tag;
        let n = 1;
        while (true) {
          const clash = await tx('SELECT id FROM queries WHERE NOT is_public AND owner_id = $1 AND lower(tag) = lower($2)', [user.id, qtag]);
          if (clash.rows.length === 0) break;
          qtag = `${sq.tag}-${++n}`;
        }
        const res = await tx(
          `INSERT INTO queries (owner_id, is_public, shared_from, tag, title, description, body, department, client_label, risk_level, updated_by)
           VALUES ($1, FALSE, $2, $3, $4, $5, $6, $7, $8, $9, $1) RETURNING id`,
          [
            user.id,
            JSON.stringify({ from_user_id: share.from_user_id, from_user_name: share.from_name, source_item_id: sq.id, shared_at: share.shared_at }),
            qtag, sq.title, sq.description ?? '', sq.body, sq.department, sq.client_label, sq.risk_level,
          ],
        );
        queryIdMap[sq.id] = res.rows[0].id;
        for (const [i, p] of (sq.params ?? []).entries()) {
          await tx(
            `INSERT INTO query_params (query_id, name, data_type, default_value, enum_options, label, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [res.rows[0].id, p.name, p.data_type ?? 'text', p.default_value, p.enum_options ? JSON.stringify(p.enum_options) : null, p.label, i],
          );
        }
        await tx(
          `INSERT INTO query_versions (query_id, body_snapshot, tag_snapshot, title_snapshot, risk_level, changed_by, change_source)
           VALUES ($1,$2,$3,$4,$5,$6,'manual')`,
          [res.rows[0].id, sq.body, qtag, sq.title, sq.risk_level, user.id],
        );
      }
      let wtag = tag;
      let n = 1;
      while (true) {
        const clash = await tx('SELECT id FROM workflows WHERE NOT is_public AND owner_id = $1 AND lower(tag) = lower($2)', [user.id, wtag]);
        if (clash.rows.length === 0) break;
        wtag = `${tag}-${++n}`;
      }
      const wf = await tx(
        `INSERT INTO workflows (owner_id, is_public, tag, title, description, client_label, shared_from)
         VALUES ($1, FALSE, $2, $3, $4, $5, $6) RETURNING id`,
        [
          user.id, wtag, snap.title, snap.description ?? '', snap.client_label,
          JSON.stringify({ from_user_id: share.from_user_id, from_user_name: share.from_name, source_item_id: share.source_item_id, shared_at: share.shared_at }),
        ],
      );
      for (const stepSnap of snap.steps as any[]) {
        await tx(
          `INSERT INTO workflow_steps (workflow_id, query_id, step_order, param_bindings, note) VALUES ($1,$2,$3,$4,$5)`,
          [wf.rows[0].id, queryIdMap[stepSnap.query.id], stepSnap.step_order, JSON.stringify(stepSnap.param_bindings ?? {}), stepSnap.note],
        );
      }
      return wf.rows[0].id;
    });
    await query(`UPDATE share_events SET status = 'accepted', resolved_at = now(), created_item_id = $1 WHERE id = $2`, [created, id]);
    return json({ ok: true, item_type: 'workflow', created_id: created });
  }

  // plain query share
  const created = await withTx(async (tx) => {
    let qtag = tag;
    let n = 1;
    while (true) {
      const clash = await tx('SELECT id FROM queries WHERE NOT is_public AND owner_id = $1 AND lower(tag) = lower($2)', [user.id, qtag]);
      if (clash.rows.length === 0) break;
      qtag = `${tag}-${++n}`;
    }
    const res = await tx(
      `INSERT INTO queries (owner_id, is_public, shared_from, tag, title, description, body, department, client_label, risk_level, updated_by)
       VALUES ($1, FALSE, $2, $3, $4, $5, $6, $7, $8, $9, $1) RETURNING id`,
      [
        user.id,
        JSON.stringify({ from_user_id: share.from_user_id, from_user_name: share.from_name, source_item_id: share.source_item_id, shared_at: share.shared_at }),
        qtag, snap.title, snap.description ?? '', snap.body, snap.department, snap.client_label, snap.risk_level,
      ],
    );
    for (const [i, p] of (snap.params ?? []).entries()) {
      await tx(
        `INSERT INTO query_params (query_id, name, data_type, default_value, enum_options, label, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [res.rows[0].id, p.name, p.data_type ?? 'text', p.default_value, p.enum_options ? JSON.stringify(p.enum_options) : null, p.label, i],
      );
    }
    await tx(
      `INSERT INTO query_versions (query_id, body_snapshot, tag_snapshot, title_snapshot, risk_level, changed_by, change_source)
       VALUES ($1,$2,$3,$4,$5,$6,'manual')`,
      [res.rows[0].id, snap.body, qtag, snap.title, snap.risk_level, user.id],
    );
    return res.rows[0].id;
  });
  await query(`UPDATE share_events SET status = 'accepted', resolved_at = now(), created_item_id = $1 WHERE id = $2`, [created, id]);
  return json({ ok: true, item_type: 'query', created_id: created });
});
